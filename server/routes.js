'use strict';
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { db, all, get, run, tx, getSetting, setSetting, audit, notify, DATA_DIR } = require('./db');
const auth = require('./auth');
const { computeScore } = require('./scoring');
const { analyzeTranscript, aiConfigured } = require('./ai');
const { clearDemo } = require('./seed');
const io = require('./io');

const router = express.Router();
const { requireAuth, requireRole } = auth;
const ADMIN = requireRole('admin');
const QUALITY = requireRole('admin', 'qualidade');
const RESULTS = ['C', 'P', 'NC', 'NA'];

const n = (v) => (v === undefined || v === '' ? null : v);
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const intOrNull = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const httpError = (status, message) => Object.assign(new Error(message), { status });
const isUrl = (s) => { try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } };
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// --------------------------------------------------------------- Autenticação
router.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const key = `${req.ip}|${String(username || '').toLowerCase()}`;
  const wait = auth.loginThrottle(key);
  if (wait) return res.status(429).json({ error: `Muitas tentativas. Aguarde ${Math.ceil(wait / 60)} min e tente de novo.` });
  const u = get('SELECT * FROM users WHERE username = ?', String(username || '').trim());
  if (!u || !u.active || !auth.verifyPassword(String(password || ''), u.password_hash)) {
    auth.loginFailed(key);
    return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  }
  auth.loginOk(key);
  const s = auth.createSession(u.id);
  run('UPDATE users SET last_login = ? WHERE id = ?', now(), u.id);
  audit(u.id, 'login', 'user', u.id);
  auth.setSessionCookie(req, res, s.token, s.expires);
  res.json({ user: auth.publicUser(get('SELECT * FROM users WHERE id = ?', u.id)) });
});

router.post('/auth/logout', (req, res) => {
  if (req.sessionToken) run('DELETE FROM sessions WHERE token = ?', req.sessionToken);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/auth/me', (req, res) => {
  if (!req.user) return res.json({ user: null, company: getSetting('company_name', 'Paschoalotto') });
  res.json({ user: auth.publicUser(req.user), company: getSetting('company_name', 'Paschoalotto') });
});

router.post('/auth/onboarding', requireAuth, (req, res) => {
  const name = String(req.body?.display_name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Conte para a gente como prefere ser chamado.' });
  const theme = ['dark', 'light'].includes(req.body?.theme) ? req.body.theme : req.user.theme;
  run('UPDATE users SET display_name = ?, theme = ?, onboarded = 1 WHERE id = ?', name, theme, req.user.id);
  res.json({ user: auth.publicUser(get('SELECT * FROM users WHERE id = ?', req.user.id)) });
});

router.post('/auth/password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  if (!auth.verifyPassword(String(current || ''), req.user.password_hash)) return res.status(400).json({ error: 'A senha atual não confere.' });
  const err = auth.validatePassword(next);
  if (err) return res.status(400).json({ error: err });
  if (current === next) return res.status(400).json({ error: 'A nova senha precisa ser diferente da atual.' });
  run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', auth.hashPassword(next), req.user.id);
  run('DELETE FROM sessions WHERE user_id = ? AND token <> ?', req.user.id, req.sessionToken);
  audit(req.user.id, 'senha_alterada', 'user', req.user.id);
  res.json({ user: auth.publicUser(get('SELECT * FROM users WHERE id = ?', req.user.id)) });
});

router.patch('/auth/profile', requireAuth, (req, res) => {
  const b = req.body || {};
  const display = b.display_name !== undefined ? String(b.display_name).trim().slice(0, 40) || req.user.display_name : req.user.display_name;
  const theme = ['dark', 'light'].includes(b.theme) ? b.theme : req.user.theme;
  const email = b.email !== undefined ? String(b.email).trim().slice(0, 120) || null : req.user.email;
  run('UPDATE users SET display_name = ?, theme = ?, email = ? WHERE id = ?', display, theme, email, req.user.id);
  res.json({ user: auth.publicUser(get('SELECT * FROM users WHERE id = ?', req.user.id)) });
});

// A partir daqui tudo exige login
router.use(requireAuth);
router.use((req, res, next) => {
  // Troca de senha obrigatória bloqueia o restante da API
  if (req.user.must_change_password && !req.path.startsWith('/auth/')) return res.status(428).json({ error: 'Troque sua senha para continuar.' });
  next();
});

// --------------------------------------------------------------- Escopo de supervisor
function opScope(req, alias = 'o') {
  if (req.user.role === 'supervisor' && getSetting('supervisor_scope', 'all') === 'team') {
    return { sql: ` AND ${alias}.supervisor_user_id = ?`, params: [req.user.id] };
  }
  return { sql: '', params: [] };
}

function assertEvalAccess(req, evalId) {
  const sc = opScope(req);
  const e = get(`SELECT e.id FROM evaluations e JOIN operators o ON o.id = e.operator_id WHERE e.id = ?${sc.sql}`, evalId, ...sc.params);
  if (!e) throw httpError(404, 'Atendimento não encontrado.');
}

// --------------------------------------------------------------- Metadados
router.get('/meta', (req, res) => {
  const sc = opScope(req);
  res.json({
    cycles: all('SELECT * FROM cycles ORDER BY start_date DESC'),
    operators: all(`SELECT o.* FROM operators o WHERE 1=1${sc.sql} ORDER BY o.name`, ...sc.params),
    criteria: all('SELECT * FROM criteria ORDER BY sort, id'),
    supervisors: all("SELECT id, name, display_name FROM users WHERE role = 'supervisor' AND active = 1 ORDER BY name"),
    teams: all(`SELECT DISTINCT team FROM operators o WHERE team IS NOT NULL AND team <> ''${sc.sql} ORDER BY team`, ...sc.params).map((r) => r.team),
    ai: { configured: aiConfigured(), model: getSetting('ai_model', 'claude-opus-5-5'), auto_apply: getSetting('ai_auto_apply', '1') === '1' },
    company: getSetting('company_name', 'Paschoalotto'),
    counts: {
      pending_feedback: get(`SELECT COUNT(*) c FROM evaluations e JOIN operators o ON o.id = e.operator_id WHERE e.status <> 'feedback_aplicado'${sc.sql}`, ...sc.params).c,
      pending_review: get(`SELECT COUNT(*) c FROM evaluations e JOIN operators o ON o.id = e.operator_id WHERE e.status = 'pendente'${sc.sql}`, ...sc.params).c,
      open_bugs: req.user.role === 'admin' ? get("SELECT COUNT(*) c FROM bugs WHERE status IN ('aberto','em_analise')").c : 0,
      unread: get('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0', req.user.id).c,
    },
  });
});

// --------------------------------------------------------------- Atendimentos
const EVAL_SELECT = `
  SELECT e.id, e.cycle_id, e.operator_id, e.product, e.call_date, e.protocol, e.contract, e.customer, e.duration_sec,
         e.speech_score, e.final_score, e.status, e.ai_status, e.reviewed_at, e.created_at, e.updated_at,
         e.audio_url, c.audio_folder_url AS cycle_audio_url, COALESCE(NULLIF(e.audio_url, ''), c.audio_folder_url) AS audio_link,
         (e.transcript IS NOT NULL AND e.transcript <> '') AS has_transcript,
         o.name AS operator_name, o.registration, o.team, o.supervisor_name, c.name AS cycle_name,
         (SELECT COUNT(*) FROM evaluation_items i WHERE i.evaluation_id = e.id AND i.adjusted = 1) AS adjustments,
         (SELECT COUNT(*) FROM evaluation_items i WHERE i.evaluation_id = e.id AND i.ai_result IS NOT NULL AND i.ai_result <> COALESCE(i.speech_result,'')) AS ai_divergences,
         (SELECT COUNT(*) FROM evaluation_items i WHERE i.evaluation_id = e.id AND i.final_result = 'NC') AS nc_count,
         (SELECT COUNT(*) FROM evaluation_items i WHERE i.evaluation_id = e.id AND i.final_result = 'C') AS c_count,
         (SELECT COUNT(*) FROM evaluation_items i WHERE i.evaluation_id = e.id AND i.final_result = 'P') AS p_count,
         (SELECT COUNT(*) FROM evaluation_items i JOIN criteria cr ON cr.id = i.criterion_id WHERE i.evaluation_id = e.id AND i.final_result = 'NC' AND cr.critical = 1) AS critical_fail,
         f.id AS feedback_id, f.applied_at AS feedback_at, fu.display_name AS feedback_by_display, fu.name AS feedback_by
  FROM evaluations e
  JOIN operators o ON o.id = e.operator_id
  LEFT JOIN cycles c ON c.id = e.cycle_id
  LEFT JOIN feedbacks f ON f.id = (SELECT id FROM feedbacks WHERE evaluation_id = e.id ORDER BY applied_at DESC LIMIT 1)
  LEFT JOIN users fu ON fu.id = f.applied_by`;

function evalFilters(req, q) {
  const where = ['1=1'], params = [];
  const sc = opScope(req); where.push(sc.sql.replace(/^ AND /, '') || '1=1'); params.push(...sc.params);
  const ids = (v) => String(v).split(',').map(Number).filter(Boolean);
  if (q.cycle_id) { const l = ids(q.cycle_id); if (l.length) { where.push(`e.cycle_id IN (${l.map(() => '?').join(',')})`); params.push(...l); } }
  if (q.product) { where.push('e.product = ?'); params.push(q.product); }
  if (q.operator_id) { where.push('e.operator_id = ?'); params.push(Number(q.operator_id)); }
  if (q.team) { where.push('o.team = ?'); params.push(q.team); }
  if (q.supervisor) { where.push('o.supervisor_user_id = ?'); params.push(Number(q.supervisor)); }
  if (q.status) { where.push('e.status = ?'); params.push(q.status); }
  if (q.feedback === 'applied') where.push("e.status = 'feedback_aplicado'");
  if (q.feedback === 'pending') where.push("e.status <> 'feedback_aplicado'");
  if (q.adjusted === '1') where.push('EXISTS (SELECT 1 FROM evaluation_items i WHERE i.evaluation_id = e.id AND i.adjusted = 1)');
  if (q.critical === '1') where.push("EXISTS (SELECT 1 FROM evaluation_items i JOIN criteria cr ON cr.id = i.criterion_id WHERE i.evaluation_id = e.id AND i.final_result = 'NC' AND cr.critical = 1)");
  if (q.min !== undefined && q.min !== '') { where.push('e.final_score >= ?'); params.push(Number(q.min)); }
  if (q.max !== undefined && q.max !== '') { where.push('e.final_score <= ?'); params.push(Number(q.max)); }
  if (q.from) { where.push('e.call_date >= ?'); params.push(q.from); }
  if (q.to) { where.push('e.call_date <= ?'); params.push(q.to); }
  if (q.q) {
    const like = `%${String(q.q).trim()}%`;
    where.push('(o.name LIKE ? OR e.protocol LIKE ? OR e.customer LIKE ? OR e.contract LIKE ? OR o.registration LIKE ?)');
    params.push(like, like, like, like, like);
  }
  return { where: where.join(' AND '), params };
}

router.get('/evaluations', (req, res) => {
  const { where, params } = evalFilters(req, req.query);
  const sort = { recentes: 'e.call_date DESC, e.id DESC', nota_asc: 'e.final_score ASC', nota_desc: 'e.final_score DESC', operador: 'o.name ASC, e.call_date DESC' }[req.query.sort] || 'e.call_date DESC, e.id DESC';
  const limit = Math.min(Number(req.query.limit) || 500, 2000);
  res.json(all(`${EVAL_SELECT} WHERE ${where} ORDER BY ${sort} LIMIT ${limit}`, ...params));
});

function loadEvaluation(id) {
  const e = get(`${EVAL_SELECT} WHERE e.id = ?`, id);
  if (!e) return null;
  const full = get('SELECT transcript, transcript_name, ai_summary, ai_model, ai_ran_at, speech_summary, reviewed_by FROM evaluations WHERE id = ?', id);
  Object.assign(e, full);
  e.ai = e.ai_summary ? safeJson(e.ai_summary) : null;
  e.items = all(`SELECT i.*, c.code, c.name, c.description, c.weight, c.critical, c.product AS criterion_product,
                 au.display_name AS adjusted_by_display, au.name AS adjusted_by_name
                 FROM evaluation_items i JOIN criteria c ON c.id = i.criterion_id
                 LEFT JOIN users au ON au.id = i.adjusted_by
                 WHERE i.evaluation_id = ? ORDER BY c.sort, c.id`, id);
  e.feedbacks = all(`SELECT f.*, u.name AS applied_by_name, u.display_name AS applied_by_display, u.role AS applied_by_role
                     FROM feedbacks f LEFT JOIN users u ON u.id = f.applied_by WHERE f.evaluation_id = ? ORDER BY f.applied_at DESC`, id);
  e.history = all(`SELECT a.*, u.name AS user_name, u.display_name AS user_display FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
                   WHERE a.entity = 'evaluation' AND a.entity_id = ? ORDER BY a.id DESC LIMIT 100`, id).map((h) => ({ ...h, detail: safeJson(h.detail) }));
  e.reviewer = e.reviewed_by ? get('SELECT name, display_name FROM users WHERE id = ?', e.reviewed_by) : null;
  return e;
}
function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

router.get('/evaluations/:id', (req, res) => {
  assertEvalAccess(req, Number(req.params.id));
  const e = loadEvaluation(Number(req.params.id));
  if (!e) return res.status(404).json({ error: 'Atendimento não encontrado.' });
  res.json(e);
});

function recompute(evalId) {
  const items = all('SELECT i.*, c.weight, c.critical FROM evaluation_items i JOIN criteria c ON c.id = i.criterion_id WHERE i.evaluation_id = ?', evalId);
  const fin = computeScore(items, 'final_result').score;
  run("UPDATE evaluations SET final_score = ?, updated_at = datetime('now') WHERE id = ?", fin, evalId);
  return fin;
}

function criteriaFor(product) {
  return all("SELECT * FROM criteria WHERE active = 1 AND (product = 'AMBOS' OR product = ?) ORDER BY sort, id", product);
}

function createEvaluation(b, userId) {
  const product = b.product === 'ENTREGA' ? 'ENTREGA' : 'REFIN';
  if (!b.operator_id) throw httpError(400, 'Selecione o operador.');
  if (!get('SELECT id FROM operators WHERE id = ?', Number(b.operator_id))) throw httpError(400, 'Operador inválido.');
  const crit = criteriaFor(product);
  const given = new Map((b.items || []).map((i) => [Number(i.criterion_id), i]));
  const items = crit.map((c) => {
    const g = given.get(c.id) || {};
    const sr = RESULTS.includes(g.speech_result) ? g.speech_result : null;
    return { c, speech_result: sr, speech_note: n(g.speech_note), final_result: sr };
  });
  const speechCalc = computeScore(items.map((i) => ({ ...i.c, speech_result: i.speech_result })), 'speech_result').score;
  const speechScore = b.speech_score !== undefined && b.speech_score !== null && b.speech_score !== '' ? Number(b.speech_score) : speechCalc;
  const info = run(`INSERT INTO evaluations (cycle_id, operator_id, product, call_date, protocol, contract, customer, duration_sec, audio_url,
      speech_score, final_score, speech_summary, transcript, transcript_name, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  intOrNull(b.cycle_id), Number(b.operator_id), product, n(b.call_date), n(b.protocol), n(b.contract), n(b.customer), intOrNull(b.duration_sec),
  b.audio_url && isUrl(b.audio_url) ? b.audio_url : null, speechScore, speechCalc ?? speechScore, n(b.speech_summary),
  n(b.transcript), n(b.transcript_name), userId);
  const id = Number(info.lastInsertRowid);
  for (const it of items) {
    run('INSERT INTO evaluation_items (evaluation_id, criterion_id, speech_result, speech_note, final_result) VALUES (?, ?, ?, ?, ?)',
      id, it.c.id, it.speech_result, it.speech_note, it.final_result);
  }
  recompute(id);
  return id;
}

router.post('/evaluations', QUALITY, (req, res) => {
  const b = req.body || {};
  if (b.audio_url && req.user.role !== 'admin') delete b.audio_url;
  const id = tx(() => createEvaluation(b, req.user.id));
  audit(req.user.id, 'atendimento_criado', 'evaluation', id, { origem: b.origin || 'manual' });
  res.json(loadEvaluation(id));
});

router.patch('/evaluations/:id', QUALITY, (req, res) => {
  const id = Number(req.params.id);
  const e = get('SELECT * FROM evaluations WHERE id = ?', id);
  if (!e) return res.status(404).json({ error: 'Atendimento não encontrado.' });
  const b = req.body || {};
  const fields = ['call_date', 'protocol', 'contract', 'customer', 'speech_summary'];
  const changes = {};
  for (const f of fields) if (b[f] !== undefined && b[f] !== e[f]) changes[f] = n(b[f]);
  if (b.cycle_id !== undefined) changes.cycle_id = intOrNull(b.cycle_id);
  if (b.operator_id !== undefined && Number(b.operator_id) !== e.operator_id) changes.operator_id = Number(b.operator_id);
  if (!Object.keys(changes).length) return res.json(loadEvaluation(id));
  run(`UPDATE evaluations SET ${Object.keys(changes).map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...Object.values(changes), id);
  audit(req.user.id, 'dados_editados', 'evaluation', id, changes);
  res.json(loadEvaluation(id));
});

// Ajuste de análise: corrige o resultado de cada critério
router.put('/evaluations/:id/items', QUALITY, (req, res) => {
  const id = Number(req.params.id);
  const e = get('SELECT * FROM evaluations WHERE id = ?', id);
  if (!e) return res.status(404).json({ error: 'Atendimento não encontrado.' });
  const list = Array.isArray(req.body?.items) ? req.body.items : [];
  const changed = [];
  tx(() => {
    for (const it of list) {
      const cur = get('SELECT i.*, c.code, c.name FROM evaluation_items i JOIN criteria c ON c.id = i.criterion_id WHERE i.evaluation_id = ? AND i.criterion_id = ?', id, Number(it.criterion_id));
      if (!cur || !RESULTS.includes(it.final_result)) continue;
      const reason = String(it.adjust_reason || '').trim();
      if (cur.final_result === it.final_result && (reason === (cur.adjust_reason || ''))) continue;
      const isAdjust = it.final_result !== cur.speech_result;
      if (isAdjust && !reason) throw httpError(400, `Informe o motivo do ajuste em "${cur.name}".`);
      run(`UPDATE evaluation_items SET final_result = ?, adjusted = ?, adjust_reason = ?, adjust_source = ?, adjusted_by = ?, adjusted_at = ? WHERE id = ?`,
        it.final_result, isAdjust ? 1 : 0, isAdjust ? reason : null, isAdjust ? 'manual' : null, isAdjust ? req.user.id : null, isAdjust ? now() : null, cur.id);
      changed.push({ codigo: cur.code, criterio: cur.name, de: cur.final_result, para: it.final_result, speech: cur.speech_result, motivo: reason || null });
    }
    const score = recompute(id);
    const markReviewed = req.body?.mark_reviewed !== false;
    if (markReviewed && e.status === 'pendente') run("UPDATE evaluations SET status = 'revisada' WHERE id = ?", id);
    if (markReviewed) run('UPDATE evaluations SET reviewed_by = ?, reviewed_at = ? WHERE id = ?', req.user.id, now(), id);
    if (changed.length) audit(req.user.id, 'analise_ajustada', 'evaluation', id, { alteracoes: changed, nota_final: score });
    else if (markReviewed) audit(req.user.id, 'analise_validada', 'evaluation', id, { nota_final: score });
  });
  res.json(loadEvaluation(id));
});

router.post('/evaluations/:id/revert', QUALITY, (req, res) => {
  const id = Number(req.params.id);
  tx(() => {
    run(`UPDATE evaluation_items SET final_result = speech_result, adjusted = 0, adjust_reason = NULL, adjust_source = NULL, adjusted_by = NULL, adjusted_at = NULL
         WHERE evaluation_id = ? AND speech_result IS NOT NULL`, id);
    recompute(id);
    audit(req.user.id, 'ajustes_revertidos', 'evaluation', id);
  });
  res.json(loadEvaluation(id));
});

// Link do áudio — somente admin
router.put('/evaluations/:id/audio', ADMIN, (req, res) => {
  const id = Number(req.params.id);
  const url = String(req.body?.audio_url || '').trim();
  if (url && !isUrl(url)) return res.status(400).json({ error: 'Informe um link válido (https://...).' });
  const prev = get('SELECT audio_url FROM evaluations WHERE id = ?', id);
  if (!prev) return res.status(404).json({ error: 'Atendimento não encontrado.' });
  run("UPDATE evaluations SET audio_url = ?, updated_at = datetime('now') WHERE id = ?", url || null, id);
  audit(req.user.id, 'link_audio_alterado', 'evaluation', id, { de: prev.audio_url, para: url || null });
  res.json(loadEvaluation(id));
});

router.post('/evaluations/bulk-audio', ADMIN, (req, res) => {
  const b = req.body || {};
  const url = String(b.audio_url || '').trim();
  if (url && !isUrl(url)) return res.status(400).json({ error: 'Informe um link válido (https://...).' });
  let ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Boolean) : [];
  if (!ids.length && b.cycle_id) ids = all('SELECT id FROM evaluations WHERE cycle_id = ?', Number(b.cycle_id)).map((r) => r.id);
  if (!ids.length) return res.status(400).json({ error: 'Nenhum atendimento selecionado.' });
  const onlyEmpty = b.mode === 'only_empty';
  let count = 0;
  tx(() => {
    for (const id of ids) {
      const r = run(`UPDATE evaluations SET audio_url = ?, updated_at = datetime('now') WHERE id = ?${onlyEmpty ? " AND (audio_url IS NULL OR audio_url = '')" : ''}`, url || null, id);
      if (r.changes) { count++; audit(req.user.id, 'link_audio_alterado', 'evaluation', id, { para: url || null, em_lote: true }); }
    }
  });
  res.json({ updated: count });
});

router.delete('/evaluations/:id', ADMIN, (req, res) => {
  const id = Number(req.params.id);
  const e = get('SELECT e.*, o.name operator FROM evaluations e JOIN operators o ON o.id = e.operator_id WHERE e.id = ?', id);
  if (!e) return res.status(404).json({ error: 'Atendimento não encontrado.' });
  run('DELETE FROM evaluations WHERE id = ?', id);
  audit(req.user.id, 'atendimento_excluido', 'evaluation', id, { operador: e.operator, protocolo: e.protocol });
  res.json({ ok: true });
});

// --------------------------------------------------------------- Transcrição + IA
router.post('/evaluations/:id/transcript', QUALITY, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!get('SELECT id FROM evaluations WHERE id = ?', id)) return res.status(404).json({ error: 'Atendimento não encontrado.' });
  const { text, name } = await io.readTranscript(req.body || {});
  if (!text.trim()) return res.status(400).json({ error: 'A transcrição está vazia.' });
  run("UPDATE evaluations SET transcript = ?, transcript_name = ?, ai_status = 'nao_executada', updated_at = datetime('now') WHERE id = ?", text, name, id);
  audit(req.user.id, 'transcricao_anexada', 'evaluation', id, { arquivo: name, caracteres: text.length });
  res.json(loadEvaluation(id));
}));

router.post('/transcripts/parse', QUALITY, wrap(async (req, res) => {
  res.json(await io.readTranscript(req.body || {}));
}));

function friendlyAiError(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'Chave da API da Anthropic inválida. Revise em Configurações.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'A chave da API não tem permissão para este modelo.';
  if (e instanceof Anthropic.RateLimitError) return 'Limite de uso da IA atingido no momento. Aguarde alguns instantes e tente de novo.';
  if (e instanceof Anthropic.BadRequestError) return `A IA recusou a requisição: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Não foi possível conectar à IA. Verifique a internet do servidor.';
  if (e instanceof Anthropic.APIError) return `Serviço de IA indisponível (${e.status || 'erro'}). Tente novamente.`;
  return e.message || 'Falha na análise.';
}

async function runAnalysis(id, user) {
  const e = get('SELECT e.*, o.name AS operator_name FROM evaluations e JOIN operators o ON o.id = e.operator_id WHERE e.id = ?', id);
  if (!e) throw httpError(404, 'Atendimento não encontrado.');
  const items = all('SELECT i.*, c.code, c.name, c.description, c.weight, c.critical FROM evaluation_items i JOIN criteria c ON c.id = i.criterion_id WHERE i.evaluation_id = ? ORDER BY c.sort', id);
  run("UPDATE evaluations SET ai_status = 'executando' WHERE id = ?", id);
  let result;
  try { result = await analyzeTranscript(e, items); }
  catch (err) {
    run("UPDATE evaluations SET ai_status = 'erro' WHERE id = ?", id);
    audit(user.id, 'ia_erro', 'evaluation', id, { erro: friendlyAiError(err) });
    throw httpError(502, friendlyAiError(err));
  }
  const autoApply = result.engine === 'claude' && getSetting('ai_auto_apply', '1') === '1';
  const threshold = Number(getSetting('ai_confidence_threshold', '0.7'));
  const applied = [];
  tx(() => {
    for (const r of result.items || []) {
      const it = items.find((i) => i.code === r.code);
      if (!it || !RESULTS.includes(r.result)) continue;
      const conf = Math.max(0, Math.min(1, Number(r.confidence) || 0));
      run('UPDATE evaluation_items SET ai_result = ?, ai_evidence = ?, ai_reason = ?, ai_confidence = ? WHERE id = ?',
        r.result, n(r.evidence), n(r.reason), conf, it.id);
      const humanLocked = it.adjust_source === 'manual';
      if (autoApply && !humanLocked && conf >= threshold && r.result !== it.final_result) {
        const isAdjust = r.result !== it.speech_result;
        run(`UPDATE evaluation_items SET final_result = ?, adjusted = ?, adjust_reason = ?, adjust_source = ?, adjusted_by = NULL, adjusted_at = ? WHERE id = ?`,
          r.result, isAdjust ? 1 : 0, isAdjust ? `IA: ${r.reason}` : null, isAdjust ? 'ia' : null, isAdjust ? now() : null, it.id);
        applied.push({ codigo: it.code, criterio: it.name, de: it.final_result, para: r.result });
      }
    }
    const summary = { summary: result.summary, customer_profile: result.customer_profile, discrepancy_overview: result.discrepancy_overview, feedback: result.feedback, engine: result.engine, applied };
    run("UPDATE evaluations SET ai_status = 'concluida', ai_summary = ?, ai_model = ?, ai_ran_at = ?, updated_at = datetime('now') WHERE id = ?",
      JSON.stringify(summary), result.model, now(), id);
    recompute(id);
    audit(user.id, 'ia_analise', 'evaluation', id, { motor: result.engine, modelo: result.model, correcoes_aplicadas: applied });
  });
  return loadEvaluation(id);
}

router.post('/evaluations/:id/analyze', QUALITY, wrap(async (req, res) => {
  const id = Number(req.params.id);
  res.json(await runAnalysis(id, req.user));
}));

// Aplica sugestões da IA manualmente (heurística ou baixa confiança)
router.post('/evaluations/:id/ai/apply', QUALITY, (req, res) => {
  const id = Number(req.params.id);
  const codes = Array.isArray(req.body?.codes) ? req.body.codes : null;
  const items = all('SELECT i.*, c.code, c.name FROM evaluation_items i JOIN criteria c ON c.id = i.criterion_id WHERE i.evaluation_id = ? AND i.ai_result IS NOT NULL', id);
  const applied = [];
  tx(() => {
    for (const it of items) {
      if (codes && !codes.includes(it.code)) continue;
      if (it.ai_result === it.final_result) continue;
      const isAdjust = it.ai_result !== it.speech_result;
      run(`UPDATE evaluation_items SET final_result = ?, adjusted = ?, adjust_reason = ?, adjust_source = ?, adjusted_by = ?, adjusted_at = ? WHERE id = ?`,
        it.ai_result, isAdjust ? 1 : 0, isAdjust ? `IA (validado por analista): ${it.ai_reason || ''}` : null, isAdjust ? 'ia_validada' : null, req.user.id, now(), it.id);
      applied.push({ codigo: it.code, criterio: it.name, de: it.final_result, para: it.ai_result });
    }
    recompute(id);
    if (applied.length) audit(req.user.id, 'ia_sugestoes_aplicadas', 'evaluation', id, { alteracoes: applied });
  });
  res.json(loadEvaluation(id));
});

// Nova análise a partir de uma transcrição (sem speech prévio)
router.post('/analyses', QUALITY, wrap(async (req, res) => {
  const b = req.body || {};
  const { text, name } = await io.readTranscript(b);
  if (!text.trim()) return res.status(400).json({ error: 'A transcrição está vazia.' });
  const id = tx(() => createEvaluation({ ...b, transcript: text, transcript_name: name, audio_url: req.user.role === 'admin' ? b.audio_url : null }, req.user.id));
  audit(req.user.id, 'atendimento_criado', 'evaluation', id, { origem: 'transcricao', arquivo: name });
  const out = await runAnalysis(id, req.user).catch((err) => ({ ...loadEvaluation(id), ai_error: err.message }));
  // sem speech prévio, o resultado da IA vira a base da monitoria
  if (!out.ai_error) {
    tx(() => {
      run(`UPDATE evaluation_items SET speech_result = COALESCE(speech_result, ai_result), final_result = COALESCE(final_result, ai_result),
           adjusted = CASE WHEN speech_result IS NULL THEN 0 ELSE adjusted END,
           adjust_reason = CASE WHEN speech_result IS NULL THEN NULL ELSE adjust_reason END,
           adjust_source = CASE WHEN speech_result IS NULL THEN NULL ELSE adjust_source END,
           speech_note = CASE WHEN speech_result IS NULL THEN 'Sem speech: resultado inicial gerado pela análise da transcrição' ELSE speech_note END
           WHERE evaluation_id = ?`, id);
      const items = all('SELECT i.*, c.weight, c.critical FROM evaluation_items i JOIN criteria c ON c.id = i.criterion_id WHERE i.evaluation_id = ?', id);
      run('UPDATE evaluations SET speech_score = ? WHERE id = ? AND speech_score IS NULL', computeScore(items, 'speech_result').score, id);
      const summary = safeJson(get('SELECT ai_summary FROM evaluations WHERE id = ?', id).ai_summary) || {};
      run('UPDATE evaluations SET ai_summary = ? WHERE id = ?', JSON.stringify({ ...summary, applied: [], origin: 'transcricao' }), id);
      recompute(id);
    });
  }
  res.json(out.ai_error ? out : loadEvaluation(id));
}));

// --------------------------------------------------------------- Feedbacks
function saveFeedback(req, evalId, fbId) {
  const e = get('SELECT * FROM evaluations WHERE id = ?', evalId);
  if (!e) throw httpError(404, 'Atendimento não encontrado.');
  const b = req.body || {};
  const content = String(b.content || '').trim();
  if (content.length < 10) throw httpError(400, 'Descreva o que foi passado ao operador (mínimo 10 caracteres).');
  const appliedAt = n(b.applied_at) || now();
  const vals = [appliedAt, n(b.modality), content, n(b.strengths), n(b.improvements), n(b.action_plan), b.operator_ack ? 1 : 0, n(b.followup_date)];
  let id = fbId;
  tx(() => {
    if (fbId) {
      const f = get('SELECT * FROM feedbacks WHERE id = ? AND evaluation_id = ?', fbId, evalId);
      if (!f) throw httpError(404, 'Feedback não encontrado.');
      if (req.user.role !== 'admin' && f.applied_by !== req.user.id) throw httpError(403, 'Só quem registrou o feedback (ou o admin) pode editá-lo.');
      run(`UPDATE feedbacks SET applied_at = ?, modality = ?, content = ?, strengths = ?, improvements = ?, action_plan = ?, operator_ack = ?, followup_date = ?, updated_at = datetime('now') WHERE id = ?`, ...vals, fbId);
      audit(req.user.id, 'feedback_editado', 'evaluation', evalId, { feedback_id: fbId });
    } else {
      id = Number(run(`INSERT INTO feedbacks (evaluation_id, operator_id, applied_by, applied_at, modality, content, strengths, improvements, action_plan, operator_ack, followup_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, evalId, e.operator_id, req.user.id, ...vals).lastInsertRowid);
      audit(req.user.id, 'feedback_aplicado', 'evaluation', evalId, { feedback_id: id, modalidade: b.modality || null });
      const op = get('SELECT * FROM operators WHERE id = ?', e.operator_id);
      const who = req.user.display_name || req.user.name;
      notify([op?.supervisor_user_id, e.reviewed_by].filter((u) => u && u !== req.user.id), 'Feedback aplicado', `${who} aplicou feedback para ${op?.name}.`, `#/atendimentos/${evalId}`);
    }
    run("UPDATE evaluations SET status = 'feedback_aplicado', updated_at = datetime('now') WHERE id = ?", evalId);
  });
  return id;
}

router.post('/evaluations/:id/feedback', (req, res) => {
  const id = Number(req.params.id);
  assertEvalAccess(req, id);
  saveFeedback(req, id);
  res.json(loadEvaluation(id));
});

router.put('/evaluations/:id/feedback/:fid', (req, res) => {
  const id = Number(req.params.id);
  assertEvalAccess(req, id);
  saveFeedback(req, id, Number(req.params.fid));
  res.json(loadEvaluation(id));
});

router.delete('/evaluations/:id/feedback/:fid', (req, res) => {
  const id = Number(req.params.id), fid = Number(req.params.fid);
  const f = get('SELECT * FROM feedbacks WHERE id = ? AND evaluation_id = ?', fid, id);
  if (!f) return res.status(404).json({ error: 'Feedback não encontrado.' });
  if (req.user.role !== 'admin' && f.applied_by !== req.user.id) return res.status(403).json({ error: 'Só quem registrou o feedback (ou o admin) pode removê-lo.' });
  tx(() => {
    run('DELETE FROM feedbacks WHERE id = ?', fid);
    const left = get('SELECT COUNT(*) c FROM feedbacks WHERE evaluation_id = ?', id).c;
    if (!left) run(`UPDATE evaluations SET status = CASE WHEN reviewed_at IS NOT NULL THEN 'revisada' ELSE 'pendente' END WHERE id = ?`, id);
    audit(req.user.id, 'feedback_removido', 'evaluation', id, { feedback_id: fid });
  });
  res.json(loadEvaluation(id));
});

router.get('/feedbacks', (req, res) => {
  const sc = opScope(req);
  const q = req.query, where = ['1=1'], params = [];
  if (q.cycle_id) { where.push('e.cycle_id = ?'); params.push(Number(q.cycle_id)); }
  if (q.operator_id) { where.push('f.operator_id = ?'); params.push(Number(q.operator_id)); }
  if (q.product) { where.push('e.product = ?'); params.push(q.product); }
  if (q.team) { where.push('o.team = ?'); params.push(q.team); }
  if (q.applied_by) { where.push('f.applied_by = ?'); params.push(Number(q.applied_by)); }
  if (q.from) { where.push('f.applied_at >= ?'); params.push(q.from); }
  if (q.to) { where.push('f.applied_at <= ?'); params.push(q.to + ' 23:59:59'); }
  if (q.q) { const like = `%${q.q}%`; where.push('(o.name LIKE ? OR f.content LIKE ? OR e.protocol LIKE ?)'); params.push(like, like, like); }
  res.json(all(`SELECT f.*, o.name AS operator_name, o.team, o.registration, e.product, e.call_date, e.protocol, e.final_score, e.speech_score,
                c.name AS cycle_name, u.name AS applied_by_name, u.display_name AS applied_by_display, u.role AS applied_by_role
                FROM feedbacks f JOIN evaluations e ON e.id = f.evaluation_id JOIN operators o ON o.id = f.operator_id
                LEFT JOIN cycles c ON c.id = e.cycle_id LEFT JOIN users u ON u.id = f.applied_by
                WHERE ${where.join(' AND ')}${sc.sql} ORDER BY f.applied_at DESC LIMIT 2000`, ...params, ...sc.params));
});

// --------------------------------------------------------------- Estatísticas
function statsData(req, q) {
  const { where, params } = evalFilters(req, q);
  const evals = all(`SELECT e.id, e.cycle_id, e.operator_id, e.product, e.call_date, e.speech_score, e.final_score, e.status,
                     o.name AS operator_name, o.team, c.name AS cycle_name, c.start_date
                     FROM evaluations e JOIN operators o ON o.id = e.operator_id LEFT JOIN cycles c ON c.id = e.cycle_id WHERE ${where}`, ...params);
  const ids = evals.map((e) => e.id);
  const items = ids.length ? all(`SELECT i.evaluation_id, i.speech_result, i.final_result, i.adjusted, i.adjust_source, c.id AS criterion_id, c.code, c.name, c.critical, c.product
                                  FROM evaluation_items i JOIN criteria c ON c.id = i.criterion_id
                                  WHERE i.evaluation_id IN (SELECT e.id FROM evaluations e JOIN operators o ON o.id = e.operator_id WHERE ${where})`, ...params) : [];
  const avg = (arr) => { const v = arr.filter((x) => x != null); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; };

  const kpis = {
    total: evals.length,
    avg_final: avg(evals.map((e) => e.final_score)),
    avg_speech: avg(evals.map((e) => e.speech_score)),
    feedback_applied: evals.filter((e) => e.status === 'feedback_aplicado').length,
    reviewed: evals.filter((e) => e.status !== 'pendente').length,
    operators: new Set(evals.map((e) => e.operator_id)).size,
    critical_fails: new Set(items.filter((i) => i.critical && i.final_result === 'NC').map((i) => i.evaluation_id)).size,
    items_total: items.filter((i) => i.final_result && i.final_result !== 'NA').length,
    items_conform: items.filter((i) => i.final_result === 'C').length,
    items_adjusted: items.filter((i) => i.adjusted).length,
    evals_adjusted: new Set(items.filter((i) => i.adjusted).map((i) => i.evaluation_id)).size,
  };
  kpis.conformity = kpis.items_total ? Math.round((kpis.items_conform / kpis.items_total) * 1000) / 10 : null;
  kpis.feedback_rate = kpis.total ? Math.round((kpis.feedback_applied / kpis.total) * 1000) / 10 : null;
  kpis.speech_accuracy = items.length ? Math.round((1 - kpis.items_adjusted / items.length) * 1000) / 10 : null;
  for (const p of ['REFIN', 'ENTREGA']) {
    const ev = evals.filter((e) => e.product === p);
    kpis[`avg_${p.toLowerCase()}`] = avg(ev.map((e) => e.final_score));
    kpis[`total_${p.toLowerCase()}`] = ev.length;
  }

  // Evolução por ciclo
  const cycles = [...new Map(evals.filter((e) => e.cycle_id).map((e) => [e.cycle_id, { id: e.cycle_id, name: e.cycle_name, start: e.start_date }])).values()]
    .sort((a, b) => a.start.localeCompare(b.start));
  const evolution = cycles.map((c) => {
    const ev = evals.filter((e) => e.cycle_id === c.id);
    const it = items.filter((i) => ev.some((e) => e.id === i.evaluation_id));
    const applicable = it.filter((i) => i.final_result && i.final_result !== 'NA');
    return {
      cycle_id: c.id, cycle: c.name, total: ev.length,
      geral: avg(ev.map((e) => e.final_score)),
      refin: avg(ev.filter((e) => e.product === 'REFIN').map((e) => e.final_score)),
      entrega: avg(ev.filter((e) => e.product === 'ENTREGA').map((e) => e.final_score)),
      speech: avg(ev.map((e) => e.speech_score)),
      conformity: applicable.length ? Math.round((applicable.filter((i) => i.final_result === 'C').length / applicable.length) * 1000) / 10 : null,
      feedback_rate: ev.length ? Math.round((ev.filter((e) => e.status === 'feedback_aplicado').length / ev.length) * 1000) / 10 : null,
    };
  });

  // Operadores
  const byOp = new Map();
  for (const e of evals) {
    const o = byOp.get(e.operator_id) || { operator_id: e.operator_id, name: e.operator_name, team: e.team, evals: [] };
    o.evals.push(e); byOp.set(e.operator_id, o);
  }
  const lastCycle = cycles[cycles.length - 1], prevCycle = cycles[cycles.length - 2];
  const operators = [...byOp.values()].map((o) => {
    const scores = o.evals.map((e) => e.final_score).filter((x) => x != null);
    const mean = avg(scores);
    const sd = scores.length > 1 ? Math.round(Math.sqrt(scores.reduce((a, s) => a + (s - mean) ** 2, 0) / (scores.length - 1)) * 10) / 10 : 0;
    const last = lastCycle ? avg(o.evals.filter((e) => e.cycle_id === lastCycle.id).map((e) => e.final_score)) : null;
    const prev = prevCycle ? avg(o.evals.filter((e) => e.cycle_id === prevCycle.id).map((e) => e.final_score)) : null;
    return {
      operator_id: o.operator_id, name: o.name, team: o.team, total: o.evals.length, avg: mean, sd,
      avg_speech: avg(o.evals.map((e) => e.speech_score)),
      refin: avg(o.evals.filter((e) => e.product === 'REFIN').map((e) => e.final_score)),
      entrega: avg(o.evals.filter((e) => e.product === 'ENTREGA').map((e) => e.final_score)),
      last, prev, delta: last != null && prev != null ? Math.round((last - prev) * 10) / 10 : null,
      feedback_rate: Math.round((o.evals.filter((e) => e.status === 'feedback_aplicado').length / o.evals.length) * 1000) / 10,
      pending_feedback: o.evals.filter((e) => e.status !== 'feedback_aplicado').length,
      series: cycles.map((c) => avg(o.evals.filter((e) => e.cycle_id === c.id).map((e) => e.final_score))),
    };
  }).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));

  // Critérios ofensores
  const byCrit = new Map();
  for (const i of items) {
    const c = byCrit.get(i.criterion_id) || { criterion_id: i.criterion_id, code: i.code, name: i.name, product: i.product, critical: !!i.critical, C: 0, P: 0, NC: 0, NA: 0, adjusted: 0, speech_nc: 0 };
    if (i.final_result) c[i.final_result]++;
    if (i.adjusted) c.adjusted++;
    if (i.speech_result === 'NC') c.speech_nc++;
    byCrit.set(i.criterion_id, c);
  }
  const criteria = [...byCrit.values()].map((c) => {
    const base = c.C + c.P + c.NC;
    return { ...c, base, conformity: base ? Math.round((c.C / base) * 1000) / 10 : null, fail_rate: base ? Math.round(((c.NC + c.P * 0.5) / base) * 1000) / 10 : null };
  }).sort((a, b) => (b.fail_rate ?? 0) - (a.fail_rate ?? 0));

  // Distribuição de notas
  const bins = [[0, 59.9, '< 60'], [60, 69.9, '60–69'], [70, 79.9, '70–79'], [80, 89.9, '80–89'], [90, 100, '90–100']];
  const distribution = bins.map(([a, b, label]) => ({ label, count: evals.filter((e) => e.final_score != null && e.final_score >= a && e.final_score <= b).length }));

  // Dispersão speech x final
  const scatter = evals.filter((e) => e.final_score != null && e.speech_score != null).map((e) => ({ id: e.id, x: e.speech_score, y: e.final_score, product: e.product, operator: e.operator_name }));

  // Equipes
  const teams = [...new Set(evals.map((e) => e.team).filter(Boolean))].map((t) => {
    const ev = evals.filter((e) => e.team === t);
    return { team: t, total: ev.length, avg: avg(ev.map((e) => e.final_score)), feedback_rate: Math.round((ev.filter((e) => e.status === 'feedback_aplicado').length / ev.length) * 1000) / 10 };
  });

  return { kpis, evolution, operators, criteria, distribution, scatter, teams, cycles };
}

router.get('/stats/overview', (req, res) => res.json(statsData(req, req.query)));

router.get('/stats/operator/:id', (req, res) => {
  const id = Number(req.params.id);
  const sc = opScope(req);
  const op = get(`SELECT o.* FROM operators o WHERE o.id = ?${sc.sql}`, id, ...sc.params);
  if (!op) return res.status(404).json({ error: 'Operador não encontrado.' });
  const data = statsData(req, { ...req.query, operator_id: id });
  const evals = all(`${EVAL_SELECT} WHERE e.operator_id = ? ORDER BY e.call_date DESC`, id);
  const feedbacks = all(`SELECT f.*, u.name applied_by_name, u.display_name applied_by_display, e.product, e.call_date, e.final_score, c.name cycle_name
                         FROM feedbacks f JOIN evaluations e ON e.id = f.evaluation_id LEFT JOIN users u ON u.id = f.applied_by LEFT JOIN cycles c ON c.id = e.cycle_id
                         WHERE f.operator_id = ? ORDER BY f.applied_at DESC`, id);
  const team = statsData(req, { cycle_id: req.query.cycle_id, team: op.team });
  res.json({ operator: op, ...data, evaluations: evals, feedbacks, team_avg: team.kpis.avg_final, team_evolution: team.evolution });
});

router.get('/reports/data', (req, res) => {
  const q = req.query;
  const data = statsData(req, q);
  const cycles = q.cycle_id ? all(`SELECT * FROM cycles WHERE id IN (${String(q.cycle_id).split(',').map(Number).filter(Boolean).join(',') || 0}) ORDER BY start_date`) : [];
  // Comparativo entre ciclos (por operador e por critério)
  const perCycle = cycles.map((c) => ({ cycle: c, ...statsData(req, { ...q, cycle_id: c.id }) }));
  const highlights = all(`${EVAL_SELECT} WHERE ${evalFilters(req, q).where} ORDER BY e.final_score DESC LIMIT 5`, ...evalFilters(req, q).params);
  const lowlights = all(`${EVAL_SELECT} WHERE ${evalFilters(req, q).where} AND e.final_score IS NOT NULL ORDER BY e.final_score ASC LIMIT 5`, ...evalFilters(req, q).params);
  const feedbacks = all(`SELECT f.content, f.applied_at, o.name operator_name, e.final_score, e.product FROM feedbacks f
                         JOIN evaluations e ON e.id = f.evaluation_id JOIN operators o ON o.id = f.operator_id
                         WHERE e.id IN (SELECT e.id FROM evaluations e JOIN operators o ON o.id = e.operator_id WHERE ${evalFilters(req, q).where})
                         ORDER BY f.applied_at DESC LIMIT 12`, ...evalFilters(req, q).params);
  res.json({ ...data, selected_cycles: cycles, per_cycle: perCycle, highlights, lowlights, feedbacks, company: getSetting('company_name', 'Paschoalotto'), report_footer: getSetting('report_footer'),
    generated_by: req.user.display_name || req.user.name, generated_at: now() });
});

// --------------------------------------------------------------- Importação
router.get('/import/template', QUALITY, wrap(async (req, res) => {
  const buf = await io.buildTemplate(all('SELECT * FROM criteria WHERE active = 1 ORDER BY sort'));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="modelo-importacao-px-monitorias.xlsx"');
  res.send(buf);
}));

router.post('/import/preview', QUALITY, wrap(async (req, res) => {
  const rows = await io.parseSheet(req.body || {});
  const criteria = all('SELECT * FROM criteria WHERE active = 1 ORDER BY sort');
  const operators = all('SELECT id, name, registration FROM operators');
  res.json(io.normalizeRows(rows, criteria, operators));
}));

router.post('/import/commit', QUALITY, (req, res) => {
  const b = req.body || {};
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'Nenhuma linha válida para importar.' });
  const cycleId = intOrNull(b.cycle_id);
  const out = tx(() => {
    let created = 0, newOps = 0;
    for (const r of rows) {
      if (r.errors && r.errors.length) continue;
      let op = r.operator_id ? get('SELECT * FROM operators WHERE id = ?', r.operator_id) : null;
      if (!op && r.registration) op = get('SELECT * FROM operators WHERE registration = ?', r.registration);
      if (!op) op = get('SELECT * FROM operators WHERE name = ? COLLATE NOCASE', r.operator);
      if (!op) {
        const sup = r.supervisor ? get("SELECT id FROM users WHERE role = 'supervisor' AND (name = ? COLLATE NOCASE OR display_name = ? COLLATE NOCASE OR username = ? COLLATE NOCASE)", r.supervisor, r.supervisor, r.supervisor) : null;
        const id = Number(run('INSERT INTO operators (name, registration, team, supervisor_name, supervisor_user_id) VALUES (?, ?, ?, ?, ?)',
          r.operator, n(r.registration), n(r.team), n(r.supervisor), sup ? sup.id : null).lastInsertRowid);
        op = { id }; newOps++;
      }
      createEvaluation({
        cycle_id: cycleId || r.cycle_id, operator_id: op.id, product: r.product, call_date: r.call_date, protocol: r.protocol,
        contract: r.contract, customer: r.customer, duration_sec: r.duration_sec, speech_score: r.speech_score, speech_summary: r.summary,
        audio_url: req.user.role === 'admin' ? r.audio_url : null, transcript: r.transcript || null, transcript_name: r.transcript ? 'planilha' : null,
        items: r.items,
      }, req.user.id);
      created++;
    }
    return { created, newOps };
  });
  audit(req.user.id, 'importacao', 'import', null, { ...out, ciclo: cycleId, arquivo: b.filename || null });
  res.json(out);
});

// --------------------------------------------------------------- Bugs
router.post('/bugs', (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim().slice(0, 140), description = String(b.description || '').trim().slice(0, 5000);
  if (!title || !description) return res.status(400).json({ error: 'Preencha o título e a descrição do problema.' });
  const shot = typeof b.screenshot === 'string' && /^data:image\/(png|jpe?g|webp);base64,/.test(b.screenshot) && b.screenshot.length < 4e6 ? b.screenshot : null;
  const id = Number(run('INSERT INTO bugs (user_id, title, description, severity, page, user_agent, screenshot) VALUES (?, ?, ?, ?, ?, ?, ?)',
    req.user.id, title, description, ['baixa', 'media', 'alta', 'critica'].includes(b.severity) ? b.severity : 'media',
    n(String(b.page || '').slice(0, 300)), n(String(req.headers['user-agent'] || '').slice(0, 300)), shot).lastInsertRowid);
  notify(all("SELECT id FROM users WHERE role = 'admin' AND active = 1").map((u) => u.id).filter((u) => u !== req.user.id),
    'Novo bug reportado', `${req.user.display_name || req.user.name}: ${title}`, '#/bugs');
  res.json({ id });
});

router.get('/bugs', (req, res) => {
  const mine = req.user.role !== 'admin';
  res.json(all(`SELECT b.id, b.title, b.description, b.severity, b.page, b.user_agent, b.status, b.admin_notes, b.created_at, b.resolved_at,
                (b.screenshot IS NOT NULL) has_screenshot, u.name user_name, u.display_name user_display
                FROM bugs b LEFT JOIN users u ON u.id = b.user_id ${mine ? 'WHERE b.user_id = ?' : ''} ORDER BY b.id DESC`, ...(mine ? [req.user.id] : [])));
});

router.get('/bugs/:id/screenshot', (req, res) => {
  const b = get('SELECT user_id, screenshot FROM bugs WHERE id = ?', Number(req.params.id));
  if (!b || !b.screenshot || (req.user.role !== 'admin' && b.user_id !== req.user.id)) return res.status(404).end();
  const [meta, data] = b.screenshot.split(',');
  res.setHeader('Content-Type', meta.slice(5, meta.indexOf(';')));
  res.send(Buffer.from(data, 'base64'));
});

router.put('/bugs/:id', ADMIN, (req, res) => {
  const id = Number(req.params.id);
  const b = get('SELECT * FROM bugs WHERE id = ?', id);
  if (!b) return res.status(404).json({ error: 'Registro não encontrado.' });
  const status = ['aberto', 'em_analise', 'resolvido', 'descartado'].includes(req.body?.status) ? req.body.status : b.status;
  run('UPDATE bugs SET status = ?, admin_notes = ?, resolved_at = ? WHERE id = ?', status, n(req.body?.admin_notes) ?? b.admin_notes,
    status === 'resolvido' ? (b.resolved_at || now()) : null, id);
  if (status !== b.status && b.user_id) notify([b.user_id], 'Atualização do seu report', `"${b.title}" agora está: ${status.replace('_', ' ')}.`, '#/bugs');
  res.json({ ok: true });
});

// --------------------------------------------------------------- Notificações
router.get('/notifications', (req, res) => res.json(all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50', req.user.id)));
router.post('/notifications/read', (req, res) => { run('UPDATE notifications SET read = 1 WHERE user_id = ?', req.user.id); res.json({ ok: true }); });

// --------------------------------------------------------------- Administração
router.get('/users', ADMIN, (req, res) => res.json(all('SELECT * FROM users ORDER BY active DESC, name').map(auth.publicUser)));

router.post('/users', ADMIN, (req, res) => {
  const b = req.body || {};
  const username = String(b.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return res.status(400).json({ error: 'Login deve ter de 3 a 40 caracteres (letras, números, ponto, hífen).' });
  if (!['admin', 'qualidade', 'supervisor'].includes(b.role)) return res.status(400).json({ error: 'Perfil inválido.' });
  if (!String(b.name || '').trim()) return res.status(400).json({ error: 'Informe o nome.' });
  if (get('SELECT id FROM users WHERE username = ?', username)) return res.status(400).json({ error: 'Este login já existe.' });
  const temp = b.password || tempPassword();
  const err = auth.validatePassword(temp);
  if (err) return res.status(400).json({ error: err });
  const id = Number(run('INSERT INTO users (username, name, email, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, ?, 1)',
    username, String(b.name).trim(), n(b.email), b.role, auth.hashPassword(temp)).lastInsertRowid);
  audit(req.user.id, 'usuario_criado', 'user', id, { username, perfil: b.role });
  res.json({ user: auth.publicUser(get('SELECT * FROM users WHERE id = ?', id)), temp_password: temp });
});

router.put('/users/:id', ADMIN, (req, res) => {
  const id = Number(req.params.id);
  const u = get('SELECT * FROM users WHERE id = ?', id);
  if (!u) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const b = req.body || {};
  const role = ['admin', 'qualidade', 'supervisor'].includes(b.role) ? b.role : u.role;
  const active = b.active === undefined ? u.active : (b.active ? 1 : 0);
  if (u.role === 'admin' && (role !== 'admin' || !active)) {
    const admins = get("SELECT COUNT(*) c FROM users WHERE role = 'admin' AND active = 1").c;
    if (admins <= 1) return res.status(400).json({ error: 'É preciso manter pelo menos um administrador ativo.' });
  }
  run('UPDATE users SET name = ?, email = ?, role = ?, active = ? WHERE id = ?', String(b.name || u.name).trim(), b.email !== undefined ? n(b.email) : u.email, role, active, id);
  if (!active) run('DELETE FROM sessions WHERE user_id = ?', id);
  audit(req.user.id, 'usuario_editado', 'user', id, { perfil: role, ativo: !!active });
  res.json(auth.publicUser(get('SELECT * FROM users WHERE id = ?', id)));
});

function tempPassword() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const d = '23456789';
  const r = (s) => s[require('crypto').randomInt(s.length)];
  return `Px${r(c)}${r(c)}${r(c)}${r(c)}${r(d)}${r(d)}${r(d)}${r(c)}`;
}

router.post('/users/:id/reset-password', ADMIN, (req, res) => {
  const id = Number(req.params.id);
  if (!get('SELECT id FROM users WHERE id = ?', id)) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const temp = tempPassword();
  run('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', auth.hashPassword(temp), id);
  run('DELETE FROM sessions WHERE user_id = ?', id);
  audit(req.user.id, 'senha_resetada', 'user', id);
  res.json({ temp_password: temp });
});

// Ciclos (quinzenas)
router.post('/cycles', ADMIN, (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.start_date || !b.end_date) return res.status(400).json({ error: 'Informe nome, início e fim.' });
  if (b.audio_folder_url && !isUrl(b.audio_folder_url)) return res.status(400).json({ error: 'Link da pasta de áudios inválido.' });
  const id = Number(run('INSERT INTO cycles (name, start_date, end_date, audio_folder_url, status) VALUES (?, ?, ?, ?, ?)',
    b.name, b.start_date, b.end_date, n(b.audio_folder_url), ['aberto', 'publicado', 'encerrado'].includes(b.status) ? b.status : 'aberto').lastInsertRowid);
  audit(req.user.id, 'ciclo_criado', 'cycle', id, { nome: b.name });
  res.json(get('SELECT * FROM cycles WHERE id = ?', id));
});

router.put('/cycles/:id', ADMIN, (req, res) => {
  const id = Number(req.params.id);
  const c = get('SELECT * FROM cycles WHERE id = ?', id);
  if (!c) return res.status(404).json({ error: 'Ciclo não encontrado.' });
  const b = { ...c, ...req.body };
  if (b.audio_folder_url && !isUrl(b.audio_folder_url)) return res.status(400).json({ error: 'Link da pasta de áudios inválido.' });
  const status = ['aberto', 'publicado', 'encerrado'].includes(b.status) ? b.status : c.status;
  run('UPDATE cycles SET name = ?, start_date = ?, end_date = ?, audio_folder_url = ?, status = ?, published_at = ? WHERE id = ?',
    b.name, b.start_date, b.end_date, n(b.audio_folder_url), status, status === 'publicado' && c.status !== 'publicado' ? now() : c.published_at, id);
  audit(req.user.id, 'ciclo_editado', 'cycle', id, { pasta_audio: { de: c.audio_folder_url, para: n(b.audio_folder_url) }, status });
  if (status === 'publicado' && c.status !== 'publicado') {
    notify(all("SELECT id FROM users WHERE active = 1 AND role IN ('supervisor','qualidade')").map((u) => u.id), 'Report publicado', `O report de qualidade "${b.name}" foi publicado.`, '#/painel');
  }
  res.json(get('SELECT * FROM cycles WHERE id = ?', id));
});

router.delete('/cycles/:id', ADMIN, (req, res) => {
  const id = Number(req.params.id);
  const used = get('SELECT COUNT(*) c FROM evaluations WHERE cycle_id = ?', id).c;
  if (used) return res.status(400).json({ error: `Este ciclo possui ${used} atendimento(s). Mova ou exclua os atendimentos antes.` });
  run('DELETE FROM cycles WHERE id = ?', id);
  audit(req.user.id, 'ciclo_excluido', 'cycle', id);
  res.json({ ok: true });
});

// Operadores
router.post('/operators', QUALITY, (req, res) => {
  const b = req.body || {};
  if (!String(b.name || '').trim()) return res.status(400).json({ error: 'Informe o nome do operador.' });
  const sup = b.supervisor_user_id ? get('SELECT name FROM users WHERE id = ?', Number(b.supervisor_user_id)) : null;
  const id = Number(run('INSERT INTO operators (name, registration, team, supervisor_user_id, supervisor_name) VALUES (?, ?, ?, ?, ?)',
    String(b.name).trim(), n(b.registration), n(b.team), sup ? Number(b.supervisor_user_id) : null, sup ? sup.name : n(b.supervisor_name)).lastInsertRowid);
  audit(req.user.id, 'operador_criado', 'operator', id, { nome: b.name });
  res.json(get('SELECT * FROM operators WHERE id = ?', id));
});

router.put('/operators/:id', QUALITY, (req, res) => {
  const id = Number(req.params.id);
  const o = get('SELECT * FROM operators WHERE id = ?', id);
  if (!o) return res.status(404).json({ error: 'Operador não encontrado.' });
  const b = { ...o, ...req.body };
  const sup = b.supervisor_user_id ? get('SELECT name FROM users WHERE id = ?', Number(b.supervisor_user_id)) : null;
  run('UPDATE operators SET name = ?, registration = ?, team = ?, supervisor_user_id = ?, supervisor_name = ?, active = ? WHERE id = ?',
    String(b.name).trim(), n(b.registration), n(b.team), sup ? Number(b.supervisor_user_id) : null, sup ? sup.name : n(b.supervisor_name), b.active ? 1 : 0, id);
  audit(req.user.id, 'operador_editado', 'operator', id);
  res.json(get('SELECT * FROM operators WHERE id = ?', id));
});

// Critérios
router.post('/criteria', ADMIN, (req, res) => {
  const b = req.body || {};
  if (!['REFIN', 'ENTREGA', 'AMBOS'].includes(b.product) || !b.code || !b.name) return res.status(400).json({ error: 'Informe produto, código e nome.' });
  const sort = (get('SELECT MAX(sort) m FROM criteria').m || 0) + 1;
  const id = Number(run('INSERT INTO criteria (product, code, name, description, weight, critical, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
    b.product, String(b.code).toUpperCase().slice(0, 8), b.name, n(b.description), Number(b.weight) || 1, b.critical ? 1 : 0, sort).lastInsertRowid);
  audit(req.user.id, 'criterio_criado', 'criterion', id, { codigo: b.code });
  res.json(get('SELECT * FROM criteria WHERE id = ?', id));
});

router.put('/criteria/:id', ADMIN, (req, res) => {
  const id = Number(req.params.id);
  const c = get('SELECT * FROM criteria WHERE id = ?', id);
  if (!c) return res.status(404).json({ error: 'Critério não encontrado.' });
  const b = { ...c, ...req.body };
  run('UPDATE criteria SET product = ?, code = ?, name = ?, description = ?, weight = ?, critical = ?, sort = ?, active = ? WHERE id = ?',
    b.product, String(b.code).toUpperCase().slice(0, 8), b.name, n(b.description), Number(b.weight) || 1, b.critical ? 1 : 0, Number(b.sort) || c.sort, b.active ? 1 : 0, id);
  audit(req.user.id, 'criterio_editado', 'criterion', id);
  res.json(get('SELECT * FROM criteria WHERE id = ?', id));
});

// Configurações
const SETTING_KEYS = ['company_name', 'ai_model', 'ai_effort', 'ai_auto_apply', 'ai_confidence_threshold', 'supervisor_scope', 'default_audio_folder', 'report_footer'];
router.get('/settings', ADMIN, (req, res) => {
  const out = Object.fromEntries(SETTING_KEYS.map((k) => [k, getSetting(k)]));
  const key = getSetting('anthropic_api_key');
  out.anthropic_api_key_set = !!key || !!process.env.ANTHROPIC_API_KEY;
  out.anthropic_api_key_source = process.env.ANTHROPIC_API_KEY ? 'variavel_ambiente' : key ? 'banco' : null;
  out.anthropic_api_key_hint = key ? `${key.slice(0, 7)}…${key.slice(-4)}` : null;
  out.data_dir = DATA_DIR;
  res.json(out);
});

router.put('/settings', ADMIN, (req, res) => {
  const b = req.body || {};
  for (const k of SETTING_KEYS) if (b[k] !== undefined) setSetting(k, b[k]);
  if (b.anthropic_api_key !== undefined) {
    const k = String(b.anthropic_api_key || '').trim();
    setSetting('anthropic_api_key', k || null);
  }
  audit(req.user.id, 'configuracoes_alteradas', 'settings', null, { chaves: Object.keys(b).filter((k) => k !== 'anthropic_api_key').concat(b.anthropic_api_key !== undefined ? ['anthropic_api_key (oculta)'] : []) });
  res.json({ ok: true });
});

router.get('/audit', ADMIN, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 300, 2000);
  res.json(all(`SELECT a.*, u.name user_name, u.display_name user_display FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
                ${req.query.action ? 'WHERE a.action = ?' : ''} ORDER BY a.id DESC LIMIT ${limit}`, ...(req.query.action ? [req.query.action] : [])).map((r) => ({ ...r, detail: safeJson(r.detail) })));
});

router.post('/admin/clear-demo', ADMIN, (req, res) => {
  clearDemo();
  audit(req.user.id, 'demo_removida', 'settings', null);
  res.json({ ok: true });
});

router.get('/admin/backup', ADMIN, (req, res) => {
  const path = require('path'), fs = require('fs');
  const file = path.join(DATA_DIR, `backup-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  audit(req.user.id, 'backup_baixado', 'settings', null);
  res.download(file, `px-monitorias-backup-${new Date().toISOString().slice(0, 10)}.db`, () => fs.unlink(file, () => {}));
});

router.get('/export/evaluations.xlsx', wrap(async (req, res) => {
  const { where, params } = evalFilters(req, req.query);
  const rows = all(`${EVAL_SELECT} WHERE ${where} ORDER BY e.call_date DESC`, ...params);
  const buf = await io.exportEvaluations(rows);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="atendimentos-px-monitorias.xlsx"');
  res.send(buf);
}));

router.get('/export/feedbacks.xlsx', wrap(async (req, res) => {
  const sc = opScope(req);
  const rows = all(`SELECT f.*, o.name operator_name, o.team, e.product, e.call_date, e.protocol, e.final_score, c.name cycle_name, u.name applied_by_name
                    FROM feedbacks f JOIN evaluations e ON e.id = f.evaluation_id JOIN operators o ON o.id = f.operator_id
                    LEFT JOIN cycles c ON c.id = e.cycle_id LEFT JOIN users u ON u.id = f.applied_by WHERE 1=1${sc.sql} ORDER BY f.applied_at DESC`, ...sc.params);
  const buf = await io.exportFeedbacks(rows);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="feedbacks-px-monitorias.xlsx"');
  res.send(buf);
}));

// --------------------------------------------------------------- Erros
router.use((err, req, res, _next) => {
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500 && !err.status) console.error(err);
  res.status(status).json({ error: status === 413 ? 'Arquivo grande demais (limite de 15 MB).' : status >= 500 && !err.status ? 'Erro interno. Tente novamente ou reporte o bug.' : err.message });
});

module.exports = router;

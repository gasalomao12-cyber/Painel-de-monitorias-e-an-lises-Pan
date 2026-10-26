// @ts-nocheck — rotas da API (portadas do servidor Node; mesma forma req/res/next)
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
import { Router } from './router.ts';
import { admin, authClient, must, count, fetchAll } from './supa.ts';
import { getSetting, setSetting, audit, notify, loadSettings, ensureSettings } from './db.ts';
import * as auth from './auth.ts';
import { computeScore } from './scoring.ts';
import { analyzeTranscript, aiConfigured, splitWithClaude } from './ai.ts';
import { seedDemo, clearDemo } from './seed.ts';
import { normalizeRows } from './normalize.ts';
import { importDashboard } from './dashboard.ts';

const router = new Router();
const sb = () => admin();
const { requireAuth, requireRole } = auth;
const ADMIN = requireRole('admin');
const QUALITY = requireRole('admin', 'qualidade');
// Contestação de monitoria: pedida pela supervisão (o admin também pode abrir)
const CONTESTER = requireRole('admin', 'supervisor');
const RESULTS = ['C', 'P', 'NC', 'NA'];
// Carteiras PAN importadas dos dashboards + Refinanciamento/Entrega Amigável lançados à mão
const PRODUCTS = ['VEICULOS', 'CARTOES', 'CONSIGNADO', 'REFIN', 'ENTREGA'];
const SEGMENTS = { CARTOES: ['CLEAN_CURTO', 'CLEAN_LONGO'], CONSIGNADO: ['PUBLICO', 'PRIVADO'] };
const CRITERIA_PRODUCTS = ['REFIN', 'ENTREGA', 'AMBOS', 'VEICULOS', 'SEM_GARANTIA', 'CARTOES', 'CONSIGNADO'];
const CRITERIA_FOR = { REFIN: ['AMBOS', 'REFIN'], ENTREGA: ['AMBOS', 'ENTREGA'], VEICULOS: ['VEICULOS'], CARTOES: ['SEM_GARANTIA', 'CARTOES'], CONSIGNADO: ['SEM_GARANTIA', 'CONSIGNADO'] };

const n = (v) => (v === undefined || v === '' ? null : v);
const nowIso = () => new Date().toISOString();
const intOrNull = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const httpError = (status, message) => Object.assign(new Error(message), { status });
const isUrl = (s) => { try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } };
// Express 4 não captura promessas rejeitadas: todo handler assíncrono passa por aqui
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));
const likeSafe = (s) => String(s || '').replace(/[,()*%\\:"']/g, ' ').trim().slice(0, 80);
// As transcrições chegam já como texto (o navegador lê .txt/.docx/.vtt/.srt/.json)
const readTranscript = (b) => ({ text: String(b.text || '').replace(/\r\n/g, '\n').slice(0, 400000), name: String(b.name || 'transcricao.txt').slice(0, 200) });

router.use(h(async (_req, _res, next) => { await ensureSettings(); next(); }));

// --------------------------------------------------------------- Autenticação
// Login, "esqueci minha senha" e logout acontecem no navegador com o Supabase Auth.
// Aqui ficam o perfil da plataforma e as ações que exigem a chave secreta.
router.get('/auth/me', h(async (req, res) => {
  const company = getSetting('company_name', 'Paschoalotto');
  if (!req.authUserId) return res.json({ user: null, company });
  if (!req.user) return res.status(403).json({ error: 'Este e-mail não tem acesso à plataforma de monitorias (ou o acesso está desativado). Fale com o administrador.', code: 'NO_PROFILE', company });
  let u = req.user;
  if (req.query.login === '1') {
    u = await must(sb().from('px_profiles').update({ last_login: nowIso() }).eq('id', u.id).select().single());
    await audit(u.id, 'login', 'user', null);
  }
  res.json({ user: auth.publicUser(u), company });
}));

router.post('/auth/onboarding', requireAuth, h(async (req, res) => {
  const name = String(req.body?.display_name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Conte para a gente como prefere ser chamado.' });
  const theme = ['dark', 'light'].includes(req.body?.theme) ? req.body.theme : req.user.theme;
  const u = await must(sb().from('px_profiles').update({ display_name: name, theme, onboarded: true }).eq('id', req.user.id).select().single());
  res.json({ user: auth.publicUser(u) });
}));

router.post('/auth/password', requireAuth, h(async (req, res) => {
  const { current, next } = req.body || {};
  const check = await authClient().auth.signInWithPassword({ email: req.user.email, password: String(current || '') });
  if (check.error) return res.status(400).json({ error: 'A senha atual não confere.' });
  const err = auth.validatePassword(next);
  if (err) return res.status(400).json({ error: err });
  if (current === next) return res.status(400).json({ error: 'A nova senha precisa ser diferente da atual.' });
  const { error } = await sb().auth.admin.updateUserById(req.user.id, { password: next });
  if (error) return res.status(400).json({ error: error.message });
  const u = await must(sb().from('px_profiles').update({ must_change_password: false }).eq('id', req.user.id).select().single());
  await audit(req.user.id, 'senha_alterada', 'user', null);
  res.json({ user: auth.publicUser(u) });
}));

// Chamado pela página de recuperação (sessão aberta pelo link do e-mail)
router.post('/auth/recover', requireAuth, h(async (req, res) => {
  const password = req.body?.password;
  const err = auth.validatePassword(password);
  if (err) return res.status(400).json({ error: err });
  const { error } = await sb().auth.admin.updateUserById(req.user.id, { password });
  if (error) return res.status(400).json({ error: error.message });
  const u = await must(sb().from('px_profiles').update({ must_change_password: false }).eq('id', req.user.id).select().single());
  await audit(req.user.id, 'senha_redefinida', 'user', null);
  res.json({ user: auth.publicUser(u) });
}));

router.patch('/auth/profile', requireAuth, h(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.display_name !== undefined) patch.display_name = String(b.display_name).trim().slice(0, 40) || req.user.display_name;
  if (['dark', 'light'].includes(b.theme)) patch.theme = b.theme;
  const u = Object.keys(patch).length ? await must(sb().from('px_profiles').update(patch).eq('id', req.user.id).select().single()) : req.user;
  res.json({ user: auth.publicUser(u) });
}));

// A partir daqui tudo exige login
router.use(requireAuth);
router.use((req, res, next) => {
  if (req.user.must_change_password && !req.path.startsWith('/auth/')) return res.status(428).json({ error: 'Troque sua senha para continuar.' });
  next();
});

// --------------------------------------------------------------- Escopo e filtros
const supervisorTeamOnly = (req) => req.user.role === 'supervisor' && getSetting('supervisor_scope', 'all') === 'team';

function scoped(query, req) {
  return supervisorTeamOnly(req) ? query.eq('supervisor_user_id', req.user.id) : query;
}

// Filtros comuns às views px_v_eval_cards e px_v_item_facts
function applyFilters(query, req, q, { cards = true } = {}) {
  let x = scoped(query, req);
  const ids = (v) => String(v).split(',').map(Number).filter(Boolean);
  if (q.cycle_id) { const l = ids(q.cycle_id); if (l.length) x = x.in('cycle_id', l); }
  if (q.product) x = x.eq('product', q.product);
  if (q.segment) x = q.segment === 'none' ? x.is('segment', null) : x.eq('segment', q.segment);
  if (q.operator_id) x = x.eq('operator_id', Number(q.operator_id));
  if (q.team) x = x.eq('team', q.team);
  if (q.supervisor) x = x.eq('supervisor_user_id', q.supervisor);
  if (q.status) x = x.eq('status', q.status);
  if (q.feedback === 'applied') x = x.eq('status', 'feedback_aplicado');
  if (q.feedback === 'pending') x = x.neq('status', 'feedback_aplicado');
  if (q.min !== undefined && q.min !== '') x = x.gte('final_score', Number(q.min));
  if (q.max !== undefined && q.max !== '') x = x.lte('final_score', Number(q.max));
  if (q.from) x = x.gte('call_date', q.from);
  if (q.to) x = x.lte('call_date', q.to);
  const s = likeSafe(q.q);
  if (s) x = x.or(['operator_name', 'protocol', 'customer', 'contract', 'registration', ...(cards ? ['login', 'audio_file', 'supervisor_name'] : [])].map((c) => `${c}.ilike.*${s}*`).join(','));
  if (cards && q.alert) x = x.contains('alerts', [q.alert]);
  if (cards && q.adjusted === '1') x = x.gt('adjustments', 0);
  if (cards && q.critical === '1') x = x.gt('critical_fail', 0);
  return x;
}

async function assertEvalAccess(req, evalId) {
  const rows = await must(scoped(sb().from('px_v_eval_cards').select('id'), req).eq('id', evalId).limit(1));
  if (!rows.length) throw httpError(404, 'Atendimento não encontrado.');
}

// --------------------------------------------------------------- Metadados
router.get('/meta', h(async (req, res) => {
  const ops = await must(scoped(sb().from('px_operators').select('*'), req).order('name'));
  const pend = (st) => count(scoped(sb().from('px_v_eval_cards').select('id', { count: 'exact', head: true }), req)[st === 'review' ? 'eq' : 'neq']('status', st === 'review' ? 'pendente' : 'feedback_aplicado'));
  const [cycles, criteria, supervisors, pendingFeedback, pendingReview, openBugs, unread, mix] = await Promise.all([
    must(sb().from('px_cycles').select('*').order('start_date', { ascending: false })),
    must(sb().from('px_criteria').select('*').order('sort').order('id')),
    must(sb().from('px_profiles').select('id, name, display_name').eq('role', 'supervisor').eq('active', true).order('name')),
    pend('feedback'), pend('review'),
    req.user.role === 'admin' ? count(sb().from('px_bugs').select('id', { count: 'exact', head: true }).in('status', ['aberto', 'em_analise'])) : 0,
    count(sb().from('px_notifications').select('id', { count: 'exact', head: true }).eq('user_id', req.user.id).eq('read', false)),
    // Tolerante: antes da migração de carteiras a coluna "segment" ainda não existe
    fetchAll(() => scoped(sb().from('px_v_eval_cards').select('product, segment'), req).order('id')).catch(() => []),
  ]);
  const openContests = await count(contestQuery(req, { status: 'aberta' }, { head: true })).catch(() => 0);
  // Quantas monitorias existem por produto e segmento (os filtros só mostram o que tem dado)
  const products = PRODUCTS.map((p) => {
    const rows = mix.filter((r) => r.product === p);
    const segs = (SEGMENTS[p] || []).map((sg) => ({ segment: sg, total: rows.filter((r) => r.segment === sg).length }));
    const none = rows.filter((r) => !r.segment).length;
    return { product: p, total: rows.length, segments: SEGMENTS[p] ? [...segs, ...(none ? [{ segment: 'none', total: none }] : [])] : [] };
  }).filter((p) => p.total);
  res.json({
    cycles, operators: ops, criteria, supervisors, products, segments: SEGMENTS,
    teams: [...new Set(ops.map((o) => o.team).filter(Boolean))].sort(),
    ai: { configured: aiConfigured(), model: getSetting('ai_model', 'claude-opus-5-5'), auto_apply: getSetting('ai_auto_apply', '1') === '1' },
    company: getSetting('company_name', 'Paschoalotto'),
    counts: { pending_feedback: pendingFeedback, pending_review: pendingReview, open_bugs: openBugs, unread, open_contests: openContests },
  });
}));

// --------------------------------------------------------------- Atendimentos
const SORTS = {
  recentes: [['call_date', false], ['id', false]], nota_asc: [['final_score', true]], nota_desc: [['final_score', false]], operador: [['operator_name', true], ['call_date', false]],
};
function sorted(query, key) {
  for (const [col, asc] of SORTS[key] || SORTS.recentes) query = query.order(col, { ascending: asc, nullsFirst: false });
  return query;
}

router.get('/evaluations', h(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 500, 2000);
  const rows = await fetchAll(() => sorted(applyFilters(sb().from('px_v_eval_cards').select('*'), req, req.query), req.query.sort).order('id', { ascending: false }));
  res.json(rows.slice(0, limit).map(cardForUser(req)));
}));

// A análise por IA é exclusiva do administrador: os demais perfis não recebem sugestões,
// parecer nem histórico da IA (o parecer importado dos dashboards continua visível)
const AI_ITEM_FIELDS = ['ai_result', 'ai_evidence', 'ai_reason', 'ai_confidence'];
function stripAi(row) {
  const out = { ...row };
  for (const f of AI_ITEM_FIELDS) delete out[f];
  return out;
}
function forUser(req, e) {
  if (!e || req.user.role === 'admin') return e;
  const out = { ...e, items: (e.items || []).map(stripAi), ai_divergences: 0, ai_model: null, ai_ran_at: null };
  if (out.ai_summary?.engine !== 'dashboard') { out.ai_summary = null; out.ai = null; out.ai_status = 'nao_executada'; }
  out.history = (e.history || []).filter((x) => !String(x.action).startsWith('ia_'));
  return out;
}
const cardForUser = (req) => (r) => (req.user.role === 'admin' ? r : { ...r, ai_status: r.ai_status === 'concluida' ? 'nao_executada' : r.ai_status, ai_divergences: 0 });

async function loadEvaluation(id) {
  const e = await must(sb().from('px_v_eval_cards').select('*').eq('id', id).maybeSingle());
  if (!e) return null;
  const [full, items, feedbacks, history, contests] = await Promise.all([
    must(sb().from('px_evaluations').select('*').eq('id', id).single()).then((r) => ({
      transcript: r.transcript, transcript_name: r.transcript_name, ai_summary: r.ai_summary, ai_model: r.ai_model, ai_ran_at: r.ai_ran_at,
      speech_summary: r.speech_summary, reviewed_by: r.reviewed_by, details: r.details || null,
    })),
    must(sb().from('px_v_eval_items').select('*').eq('evaluation_id', id).order('sort').order('criterion_id')),
    must(sb().from('px_v_feedbacks').select('*').eq('evaluation_id', id).order('applied_at', { ascending: false })),
    must(sb().from('px_v_audit').select('*').eq('entity', 'evaluation').eq('entity_id', id).order('id', { ascending: false }).limit(100)),
    // Antes da migração de contestações a view ainda não existe
    must(sb().from('px_v_contests').select('*').eq('evaluation_id', id).order('created_at', { ascending: false })).catch(() => []),
  ]);
  Object.assign(e, full);
  e.ai = e.ai_summary || null;
  e.items = items;
  e.feedbacks = feedbacks;
  e.history = history;
  e.contests = contests;
  e.reviewer = e.reviewed_by ? await must(sb().from('px_profiles').select('name, display_name').eq('id', e.reviewed_by).maybeSingle()) : null;
  return e;
}

router.get('/evaluations/:id', h(async (req, res) => {
  const id = Number(req.params.id);
  await assertEvalAccess(req, id);
  res.json(forUser(req, await loadEvaluation(id)));
}));

async function recompute(evalId) {
  const items = await must(sb().from('px_v_eval_items').select('final_result, speech_result, weight, critical').eq('evaluation_id', evalId));
  const fin = computeScore(items, 'final_result').score;
  await must(sb().from('px_evaluations').update({ final_score: fin, updated_at: nowIso() }).eq('id', evalId));
  return fin;
}

async function criteriaFor(product) {
  return must(sb().from('px_criteria').select('*').eq('active', true).in('product', CRITERIA_FOR[product] || ['AMBOS', product]).order('sort').order('id'));
}
const segmentFor = (product, segment) => ((SEGMENTS[product] || []).includes(segment) ? segment : null);

async function createEvaluation(b, userId) {
  const product = PRODUCTS.includes(b.product) ? b.product : 'REFIN';
  if (!b.operator_id) throw httpError(400, 'Selecione o operador.');
  const op = await must(sb().from('px_operators').select('id').eq('id', Number(b.operator_id)).maybeSingle());
  if (!op) throw httpError(400, 'Operador inválido.');
  const crit = await criteriaFor(product);
  const given = new Map((b.items || []).map((i) => [Number(i.criterion_id), i]));
  const items = crit.map((c) => {
    const g = given.get(c.id) || {};
    const sr = RESULTS.includes(g.speech_result) ? g.speech_result : null;
    return { c, speech_result: sr, speech_note: n(g.speech_note), final_result: sr };
  });
  const speechCalc = computeScore(items.map((i) => ({ ...i.c, speech_result: i.speech_result })), 'speech_result').score;
  const speechScore = b.speech_score !== undefined && b.speech_score !== null && b.speech_score !== '' ? Number(b.speech_score) : speechCalc;
  const ev = await must(sb().from('px_evaluations').insert({
    cycle_id: intOrNull(b.cycle_id), operator_id: Number(b.operator_id), product, segment: segmentFor(product, b.segment), call_date: n(b.call_date), protocol: n(b.protocol),
    contract: n(b.contract), customer: n(b.customer), duration_sec: intOrNull(b.duration_sec),
    audio_url: b.audio_url && isUrl(b.audio_url) ? b.audio_url : null, speech_score: speechScore, final_score: speechCalc ?? speechScore,
    speech_summary: n(b.speech_summary), transcript: n(b.transcript), transcript_name: n(b.transcript_name), created_by: userId,
  }).select('id').single());
  try {
    if (items.length) {
      await must(sb().from('px_evaluation_items').insert(items.map((it) => ({
        evaluation_id: ev.id, criterion_id: it.c.id, speech_result: it.speech_result, speech_note: it.speech_note, final_result: it.final_result,
      }))));
    }
  } catch (e) {
    await sb().from('px_evaluations').delete().eq('id', ev.id);
    throw e;
  }
  await recompute(ev.id);
  return ev.id;
}

router.post('/evaluations', QUALITY, h(async (req, res) => {
  const b = req.body || {};
  if (b.audio_url && req.user.role !== 'admin') delete b.audio_url;
  const id = await createEvaluation(b, req.user.id);
  await audit(req.user.id, 'atendimento_criado', 'evaluation', id, { origem: b.origin || 'manual' });
  res.json(forUser(req, await loadEvaluation(id)));
}));

router.patch('/evaluations/:id', QUALITY, h(async (req, res) => {
  const id = Number(req.params.id);
  const e = await must(sb().from('px_evaluations').select('*').eq('id', id).maybeSingle());
  if (!e) return res.status(404).json({ error: 'Atendimento não encontrado.' });
  const b = req.body || {};
  const changes = {};
  for (const f of ['call_date', 'protocol', 'contract', 'customer', 'speech_summary']) if (b[f] !== undefined && b[f] !== e[f]) changes[f] = n(b[f]);
  if (b.cycle_id !== undefined) changes.cycle_id = intOrNull(b.cycle_id);
  if (b.segment !== undefined && (b.segment || null) !== e.segment) {
    if (b.segment && !segmentFor(e.product, b.segment)) return res.status(400).json({ error: 'Segmento inválido para este produto.' });
    changes.segment = b.segment || null;
  }
  if (b.operator_id !== undefined && Number(b.operator_id) !== e.operator_id) changes.operator_id = Number(b.operator_id);
  if (Object.keys(changes).length) {
    await must(sb().from('px_evaluations').update({ ...changes, updated_at: nowIso() }).eq('id', id));
    await audit(req.user.id, 'dados_editados', 'evaluation', id, changes);
  }
  res.json(forUser(req, await loadEvaluation(id)));
}));

// Ajuste de análise: corrige o resultado de cada critério
router.put('/evaluations/:id/items', QUALITY, h(async (req, res) => {
  const id = Number(req.params.id);
  const e = await must(sb().from('px_evaluations').select('id, status').eq('id', id).maybeSingle());
  if (!e) return res.status(404).json({ error: 'Atendimento não encontrado.' });
  const list = Array.isArray(req.body?.items) ? req.body.items : [];
  const current = await must(sb().from('px_v_eval_items').select('*').eq('evaluation_id', id));
  const updates = [];
  for (const it of list) {
    const cur = current.find((c) => c.criterion_id === Number(it.criterion_id));
    if (!cur || !RESULTS.includes(it.final_result)) continue;
    const reason = String(it.adjust_reason || '').trim();
    if (cur.final_result === it.final_result && reason === (cur.adjust_reason || '')) continue;
    const isAdjust = it.final_result !== cur.speech_result;
    if (isAdjust && !reason) throw httpError(400, `Informe o motivo do ajuste em "${cur.name}".`);
    updates.push({ cur, patch: {
      final_result: it.final_result, adjusted: isAdjust, adjust_reason: isAdjust ? reason : null, adjust_source: isAdjust ? 'manual' : null,
      adjusted_by: isAdjust ? req.user.id : null, adjusted_at: isAdjust ? nowIso() : null,
    }, log: { codigo: cur.code, criterio: cur.name, de: cur.final_result, para: it.final_result, speech: cur.speech_result, motivo: reason || null } });
  }
  for (const u of updates) await must(sb().from('px_evaluation_items').update(u.patch).eq('id', u.cur.id));
  const score = await recompute(id);
  const markReviewed = req.body?.mark_reviewed !== false;
  if (markReviewed) {
    await must(sb().from('px_evaluations').update({ reviewed_by: req.user.id, reviewed_at: nowIso(), ...(e.status === 'pendente' ? { status: 'revisada' } : {}) }).eq('id', id));
  }
  if (updates.length) await audit(req.user.id, 'analise_ajustada', 'evaluation', id, { alteracoes: updates.map((u) => u.log), nota_final: score });
  else if (markReviewed) await audit(req.user.id, 'analise_validada', 'evaluation', id, { nota_final: score });
  res.json(forUser(req, await loadEvaluation(id)));
}));

router.post('/evaluations/:id/revert', QUALITY, h(async (req, res) => {
  const id = Number(req.params.id);
  const items = await must(sb().from('px_evaluation_items').select('id, speech_result').eq('evaluation_id', id).not('speech_result', 'is', null));
  for (const it of items) {
    await must(sb().from('px_evaluation_items').update({ final_result: it.speech_result, adjusted: false, adjust_reason: null, adjust_source: null, adjusted_by: null, adjusted_at: null }).eq('id', it.id));
  }
  await recompute(id);
  await audit(req.user.id, 'ajustes_revertidos', 'evaluation', id);
  res.json(forUser(req, await loadEvaluation(id)));
}));

// Link do áudio — somente admin
router.put('/evaluations/:id/audio', ADMIN, h(async (req, res) => {
  const id = Number(req.params.id);
  const url = String(req.body?.audio_url || '').trim();
  if (url && !isUrl(url)) return res.status(400).json({ error: 'Informe um link válido (https://...).' });
  const prev = await must(sb().from('px_evaluations').select('audio_url').eq('id', id).maybeSingle());
  if (!prev) return res.status(404).json({ error: 'Atendimento não encontrado.' });
  await must(sb().from('px_evaluations').update({ audio_url: url || null, updated_at: nowIso() }).eq('id', id));
  await audit(req.user.id, 'link_audio_alterado', 'evaluation', id, { de: prev.audio_url, para: url || null });
  res.json(forUser(req, await loadEvaluation(id)));
}));

router.post('/evaluations/bulk-audio', ADMIN, h(async (req, res) => {
  const b = req.body || {};
  const url = String(b.audio_url || '').trim();
  if (url && !isUrl(url)) return res.status(400).json({ error: 'Informe um link válido (https://...).' });
  let ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Boolean) : [];
  if (!ids.length && b.cycle_id) ids = (await must(sb().from('px_evaluations').select('id').eq('cycle_id', Number(b.cycle_id)))).map((r) => r.id);
  if (!ids.length) return res.status(400).json({ error: 'Nenhum atendimento selecionado.' });
  let updated = [];
  for (let i = 0; i < ids.length; i += 200) {
    let q = sb().from('px_evaluations').update({ audio_url: url || null, updated_at: nowIso() }).in('id', ids.slice(i, i + 200));
    if (b.mode === 'only_empty') q = q.or('audio_url.is.null,audio_url.eq.');
    updated = updated.concat(await must(q.select('id')));
  }
  if (updated.length) {
    const { error } = await sb().from('px_audit_log').insert(updated.map((r) => ({ user_id: req.user.id, action: 'link_audio_alterado', entity: 'evaluation', entity_id: r.id, detail: { para: url || null, em_lote: true } })));
    if (error) console.error(error.message);
  }
  res.json({ updated: updated.length });
}));

router.delete('/evaluations/:id', ADMIN, h(async (req, res) => {
  const id = Number(req.params.id);
  const e = await must(sb().from('px_v_eval_cards').select('operator_name, protocol').eq('id', id).maybeSingle());
  if (!e) return res.status(404).json({ error: 'Atendimento não encontrado.' });
  await must(sb().from('px_evaluations').delete().eq('id', id));
  await audit(req.user.id, 'atendimento_excluido', 'evaluation', id, { operador: e.operator_name, protocolo: e.protocol });
  res.json({ ok: true });
}));

// --------------------------------------------------------------- Transcrição + IA
router.post('/evaluations/:id/transcript', QUALITY, h(async (req, res) => {
  const id = Number(req.params.id);
  const ex = await must(sb().from('px_evaluations').select('id').eq('id', id).maybeSingle());
  if (!ex) return res.status(404).json({ error: 'Atendimento não encontrado.' });
  const { text, name } = readTranscript(req.body || {});
  if (!text.trim()) return res.status(400).json({ error: 'A transcrição está vazia.' });
  await must(sb().from('px_evaluations').update({ transcript: text, transcript_name: name, ai_status: 'nao_executada', updated_at: nowIso() }).eq('id', id));
  await audit(req.user.id, 'transcricao_anexada', 'evaluation', id, { arquivo: name, caracteres: text.length });
  res.json(forUser(req, await loadEvaluation(id)));
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
  const e = await must(sb().from('px_evaluations').select('*, px_operators(name)').eq('id', id).maybeSingle());
  if (!e) throw httpError(404, 'Atendimento não encontrado.');
  e.operator_name = e.px_operators?.name;
  const items = await must(sb().from('px_v_eval_items').select('*').eq('evaluation_id', id).order('sort'));
  await must(sb().from('px_evaluations').update({ ai_status: 'executando' }).eq('id', id));
  let result;
  try { result = await analyzeTranscript(e, items); }
  catch (err) {
    await sb().from('px_evaluations').update({ ai_status: 'erro' }).eq('id', id);
    await audit(user.id, 'ia_erro', 'evaluation', id, { erro: friendlyAiError(err) });
    throw httpError(502, friendlyAiError(err));
  }
  const autoApply = result.engine === 'claude' && getSetting('ai_auto_apply', '1') === '1';
  const threshold = Number(getSetting('ai_confidence_threshold', '0.7'));
  const applied = [];
  for (const r of result.items || []) {
    const it = items.find((i) => i.code === r.code);
    if (!it || !RESULTS.includes(r.result)) continue;
    const conf = Math.max(0, Math.min(1, Number(r.confidence) || 0));
    const patch = { ai_result: r.result, ai_evidence: n(r.evidence), ai_reason: n(r.reason), ai_confidence: conf };
    const humanLocked = it.adjust_source === 'manual';
    if (autoApply && !humanLocked && conf >= threshold && r.result !== it.final_result) {
      const isAdjust = r.result !== it.speech_result;
      Object.assign(patch, { final_result: r.result, adjusted: isAdjust, adjust_reason: isAdjust ? `IA: ${r.reason}` : null, adjust_source: isAdjust ? 'ia' : null, adjusted_by: null, adjusted_at: isAdjust ? nowIso() : null });
      applied.push({ codigo: it.code, criterio: it.name, de: it.final_result, para: r.result });
    }
    await must(sb().from('px_evaluation_items').update(patch).eq('id', it.id));
  }
  const summary = { summary: result.summary, customer_profile: result.customer_profile, discrepancy_overview: result.discrepancy_overview, feedback: result.feedback, engine: result.engine, applied };
  await must(sb().from('px_evaluations').update({ ai_status: 'concluida', ai_summary: summary, ai_model: result.model, ai_ran_at: nowIso(), updated_at: nowIso() }).eq('id', id));
  await recompute(id);
  await audit(user.id, 'ia_analise', 'evaluation', id, { motor: result.engine, modelo: result.model, correcoes_aplicadas: applied });
  return loadEvaluation(id);
}

router.post('/evaluations/:id/analyze', ADMIN, h(async (req, res) => res.json(await runAnalysis(Number(req.params.id), req.user))));

// Aplica sugestões da IA manualmente (heurística ou baixa confiança)
router.post('/evaluations/:id/ai/apply', ADMIN, h(async (req, res) => {
  const id = Number(req.params.id);
  const codes = Array.isArray(req.body?.codes) ? req.body.codes : null;
  const items = await must(sb().from('px_v_eval_items').select('*').eq('evaluation_id', id).not('ai_result', 'is', null));
  const applied = [];
  for (const it of items) {
    if (codes && !codes.includes(it.code)) continue;
    if (it.ai_result === it.final_result) continue;
    const isAdjust = it.ai_result !== it.speech_result;
    await must(sb().from('px_evaluation_items').update({
      final_result: it.ai_result, adjusted: isAdjust, adjust_reason: isAdjust ? `IA (validado por analista): ${it.ai_reason || ''}` : null,
      adjust_source: isAdjust ? 'ia_validada' : null, adjusted_by: req.user.id, adjusted_at: nowIso(),
    }).eq('id', it.id));
    applied.push({ codigo: it.code, criterio: it.name, de: it.final_result, para: it.ai_result });
  }
  await recompute(id);
  if (applied.length) await audit(req.user.id, 'ia_sugestoes_aplicadas', 'evaluation', id, { alteracoes: applied });
  res.json(forUser(req, await loadEvaluation(id)));
}));

// Documento com várias transcrições fora do padrão: a IA aponta onde cada ligação começa e termina
router.post('/transcripts/split', ADMIN, h(async (req, res) => {
  const lines = (Array.isArray(req.body?.lines) ? req.body.lines : []).map((l) => String(l ?? '')).slice(0, 20000);
  if (lines.length < 3) return res.status(400).json({ error: 'Documento vazio.' });
  if (!aiConfigured()) return res.status(400).json({ error: 'Configure a chave da API da Anthropic para separar com IA.' });
  try {
    const out = await splitWithClaude(lines);
    await audit(req.user.id, 'ia_separacao_documento', 'import', null, { linhas: lines.length, ligacoes: out.calls.length, arquivo: req.body?.name ? String(req.body.name).slice(0, 200) : null });
    res.json(out);
  } catch (e) { res.status(502).json({ error: friendlyAiError(e) }); }
}));

// Nova análise a partir de uma transcrição (sem speech prévio)
router.post('/analyses', ADMIN, h(async (req, res) => {
  const b = req.body || {};
  const { text, name } = readTranscript(b);
  if (!text.trim()) return res.status(400).json({ error: 'A transcrição está vazia.' });
  const id = await createEvaluation({ ...b, transcript: text, transcript_name: name, audio_url: req.user.role === 'admin' ? b.audio_url : null }, req.user.id);
  await audit(req.user.id, 'atendimento_criado', 'evaluation', id, { origem: 'transcricao', arquivo: name });
  try { await runAnalysis(id, req.user); }
  catch (err) { return res.json({ ...(await loadEvaluation(id)), ai_error: err.message }); }
  // Sem speech prévio, o resultado da IA vira a base da monitoria
  const items = await must(sb().from('px_evaluation_items').select('*').eq('evaluation_id', id));
  for (const it of items.filter((x) => x.speech_result == null && x.ai_result)) {
    await must(sb().from('px_evaluation_items').update({
      speech_result: it.ai_result, final_result: it.final_result || it.ai_result, adjusted: false, adjust_reason: null, adjust_source: null,
      speech_note: 'Sem speech: resultado inicial gerado pela análise da transcrição',
    }).eq('id', it.id));
  }
  const full = await must(sb().from('px_v_eval_items').select('speech_result, final_result, weight, critical').eq('evaluation_id', id));
  const ev = await must(sb().from('px_evaluations').select('speech_score, ai_summary').eq('id', id).single());
  await must(sb().from('px_evaluations').update({
    speech_score: ev.speech_score ?? computeScore(full, 'speech_result').score,
    ai_summary: { ...(ev.ai_summary || {}), applied: [], origin: 'transcricao' },
  }).eq('id', id));
  await recompute(id);
  res.json(forUser(req, await loadEvaluation(id)));
}));

// --------------------------------------------------------------- Contestações
const CONTEST_STATUS = ['aberta', 'aceita', 'recusada', 'cancelada'];
function contestQuery(req, q = {}, { head = false } = {}) {
  let x = scoped(sb().from('px_v_contests').select(head ? 'id' : '*', head ? { count: 'exact', head: true } : undefined), req);
  if (q.status) x = x.eq('status', q.status);
  if (q.cycle_id) x = x.eq('cycle_id', Number(q.cycle_id));
  if (q.evaluation_id) x = x.eq('evaluation_id', Number(q.evaluation_id));
  return head ? x : x.order('created_at', { ascending: false });
}

router.get('/contests', h(async (req, res) => {
  const q = { ...req.query };
  if (q.status && !CONTEST_STATUS.includes(q.status)) delete q.status;
  res.json(await must(contestQuery(req, q).limit(500)));
}));

router.post('/evaluations/:id/contests', CONTESTER, h(async (req, res) => {
  const id = Number(req.params.id);
  await assertEvalAccess(req, id);
  const b = req.body || {};
  const reason = String(b.reason || '').trim().slice(0, 3000);
  if (reason.length < 15) return res.status(400).json({ error: 'Explique o motivo da contestação (mínimo 15 caracteres).' });
  const open = await must(sb().from('px_contests').select('id').eq('evaluation_id', id).eq('status', 'aberta').limit(1));
  if (open.length) return res.status(409).json({ error: 'Esta monitoria já tem uma contestação aberta. Aguarde a resposta da Qualidade.' });
  const ids = (Array.isArray(b.criteria) ? b.criteria : []).map(Number).filter(Boolean);
  const items = ids.length ? await must(sb().from('px_v_eval_items').select('criterion_id, code, name').eq('evaluation_id', id).in('criterion_id', ids)) : [];
  const ct = await must(sb().from('px_contests').insert({
    evaluation_id: id, requested_by: req.user.id, reason, criteria: items.map((i) => ({ criterion_id: i.criterion_id, code: i.code, name: i.name })),
  }).select('id').single());
  await audit(req.user.id, 'contestacao_aberta', 'evaluation', id, { contestacao: ct.id, itens: items.map((i) => i.code), motivo: reason });
  const ev = await must(sb().from('px_v_eval_cards').select('operator_name').eq('id', id).single());
  const quality = await must(sb().from('px_profiles').select('id').in('role', ['admin', 'qualidade']).eq('active', true));
  const who = req.user.display_name || req.user.name;
  await notify(quality.map((u) => u.id).filter((u) => u !== req.user.id), 'Nova contestação de monitoria', `${who} contestou a monitoria de ${ev.operator_name}.`, `#/atendimentos/${id}`);
  res.json(forUser(req, await loadEvaluation(id)));
}));

// Qualidade responde: aceita (e ajusta a análise no card) ou recusa, sempre com resposta
router.put('/contests/:id', h(async (req, res) => {
  const cid = Number(req.params.id);
  const ct = await must(sb().from('px_contests').select('*').eq('id', cid).maybeSingle());
  if (!ct) return res.status(404).json({ error: 'Contestação não encontrada.' });
  await assertEvalAccess(req, ct.evaluation_id);
  if (ct.status !== 'aberta') return res.status(409).json({ error: 'Esta contestação já foi encerrada.' });
  const b = req.body || {};
  if (b.status === 'cancelada') {
    if (ct.requested_by !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Só quem abriu a contestação pode cancelá-la.' });
    await must(sb().from('px_contests').update({ status: 'cancelada', responded_by: req.user.id, responded_at: nowIso() }).eq('id', cid));
    await audit(req.user.id, 'contestacao_cancelada', 'evaluation', ct.evaluation_id, { contestacao: cid });
    return res.json(forUser(req, await loadEvaluation(ct.evaluation_id)));
  }
  if (!['admin', 'qualidade'].includes(req.user.role)) return res.status(403).json({ error: 'Só a Qualidade responde contestações.' });
  if (!['aceita', 'recusada'].includes(b.status)) return res.status(400).json({ error: 'Informe se a contestação foi aceita ou recusada.' });
  const response = String(b.response || '').trim().slice(0, 3000);
  if (response.length < 10) return res.status(400).json({ error: 'Escreva a resposta para a supervisão (mínimo 10 caracteres).' });
  await must(sb().from('px_contests').update({ status: b.status, response, responded_by: req.user.id, responded_at: nowIso() }).eq('id', cid));
  await audit(req.user.id, 'contestacao_respondida', 'evaluation', ct.evaluation_id, { contestacao: cid, decisao: b.status, resposta: response });
  const who = req.user.display_name || req.user.name;
  await notify([ct.requested_by].filter((u) => u && u !== req.user.id), `Contestação ${b.status === 'aceita' ? 'aceita' : 'recusada'}`, `${who} respondeu: ${response.slice(0, 140)}`, `#/atendimentos/${ct.evaluation_id}`);
  res.json(forUser(req, await loadEvaluation(ct.evaluation_id)));
}));

// --------------------------------------------------------------- Feedbacks
async function saveFeedback(req, evalId, fbId) {
  const e = await must(sb().from('px_evaluations').select('id, operator_id, reviewed_by').eq('id', evalId).maybeSingle());
  if (!e) throw httpError(404, 'Atendimento não encontrado.');
  const b = req.body || {};
  const content = String(b.content || '').trim();
  if (content.length < 10) throw httpError(400, 'Descreva o que foi passado ao operador (mínimo 10 caracteres).');
  let appliedAt = nowIso();
  if (b.applied_at) { const d = new Date(b.applied_at); if (!Number.isNaN(d.getTime())) appliedAt = d.toISOString(); }
  const vals = { applied_at: appliedAt, modality: n(b.modality), content, strengths: n(b.strengths), improvements: n(b.improvements), action_plan: n(b.action_plan), operator_ack: !!b.operator_ack, followup_date: n(b.followup_date) };
  if (fbId) {
    const f = await must(sb().from('px_feedbacks').select('*').eq('id', fbId).eq('evaluation_id', evalId).maybeSingle());
    if (!f) throw httpError(404, 'Feedback não encontrado.');
    if (req.user.role !== 'admin' && f.applied_by !== req.user.id) throw httpError(403, 'Só quem registrou o feedback (ou o admin) pode editá-lo.');
    await must(sb().from('px_feedbacks').update({ ...vals, updated_at: nowIso() }).eq('id', fbId));
    await audit(req.user.id, 'feedback_editado', 'evaluation', evalId, { feedback_id: fbId });
  } else {
    const f = await must(sb().from('px_feedbacks').insert({ ...vals, evaluation_id: evalId, operator_id: e.operator_id, applied_by: req.user.id }).select('id').single());
    await audit(req.user.id, 'feedback_aplicado', 'evaluation', evalId, { feedback_id: f.id, modalidade: b.modality || null });
    const op = await must(sb().from('px_operators').select('name, supervisor_user_id').eq('id', e.operator_id).single());
    const who = req.user.display_name || req.user.name;
    await notify([op.supervisor_user_id, e.reviewed_by].filter((u) => u && u !== req.user.id), 'Feedback aplicado', `${who} aplicou feedback para ${op.name}.`, `#/atendimentos/${evalId}`);
  }
  await must(sb().from('px_evaluations').update({ status: 'feedback_aplicado', updated_at: nowIso() }).eq('id', evalId));
}

router.post('/evaluations/:id/feedback', QUALITY, h(async (req, res) => {
  const id = Number(req.params.id);
  await assertEvalAccess(req, id);
  await saveFeedback(req, id);
  res.json(forUser(req, await loadEvaluation(id)));
}));

router.put('/evaluations/:id/feedback/:fid', QUALITY, h(async (req, res) => {
  const id = Number(req.params.id);
  await assertEvalAccess(req, id);
  await saveFeedback(req, id, Number(req.params.fid));
  res.json(forUser(req, await loadEvaluation(id)));
}));

router.delete('/evaluations/:id/feedback/:fid', QUALITY, h(async (req, res) => {
  const id = Number(req.params.id), fid = Number(req.params.fid);
  const f = await must(sb().from('px_feedbacks').select('*').eq('id', fid).eq('evaluation_id', id).maybeSingle());
  if (!f) return res.status(404).json({ error: 'Feedback não encontrado.' });
  if (req.user.role !== 'admin' && f.applied_by !== req.user.id) return res.status(403).json({ error: 'Só quem registrou o feedback (ou o admin) pode removê-lo.' });
  await must(sb().from('px_feedbacks').delete().eq('id', fid));
  const left = await count(sb().from('px_feedbacks').select('id', { count: 'exact', head: true }).eq('evaluation_id', id));
  if (!left) {
    const ev = await must(sb().from('px_evaluations').select('reviewed_at').eq('id', id).single());
    await must(sb().from('px_evaluations').update({ status: ev.reviewed_at ? 'revisada' : 'pendente' }).eq('id', id));
  }
  await audit(req.user.id, 'feedback_removido', 'evaluation', id, { feedback_id: fid });
  res.json(forUser(req, await loadEvaluation(id)));
}));

function feedbackQuery(req, q) {
  let x = scoped(sb().from('px_v_feedbacks').select('*'), req);
  if (q.cycle_id) x = x.eq('cycle_id', Number(q.cycle_id));
  if (q.operator_id) x = x.eq('operator_id', Number(q.operator_id));
  if (q.product) x = x.eq('product', q.product);
  if (q.segment) x = q.segment === 'none' ? x.is('segment', null) : x.eq('segment', q.segment);
  if (q.team) x = x.eq('team', q.team);
  if (q.applied_by) x = x.eq('applied_by', q.applied_by);
  if (q.from) x = x.gte('applied_at', q.from);
  if (q.to) x = x.lte('applied_at', `${q.to}T23:59:59`);
  const s = likeSafe(q.q);
  if (s) x = x.or(['operator_name', 'content', 'protocol'].map((c) => `${c}.ilike.*${s}*`).join(','));
  return x.order('applied_at', { ascending: false });
}

router.get('/feedbacks', h(async (req, res) => {
  res.json(await must(feedbackQuery(req, req.query).limit(1000)));
}));

// --------------------------------------------------------------- Estatísticas
async function loadStatsRows(req, q) {
  const evals = await fetchAll(() => applyFilters(sb().from('px_v_eval_cards').select('*'), req, q).order('id'));
  const ids = new Set(evals.map((e) => e.id));
  const cols = 'evaluation_id, speech_result, final_result, adjusted, adjust_source, criterion_id, code, name, critical, criterion_product, sort';
  const facts = (extra) => fetchAll(() => applyFilters(sb().from('px_v_item_facts').select(cols + extra), req, q, { cards: false }).order('id'));
  const items = evals.length
    // Antes da migração de carteiras a view ainda não tem o peso do critério
    ? (await facts(', weight, stage').catch(() => facts('')))
      .filter((i) => ids.has(i.evaluation_id)).map((i) => ({ ...i, product: i.criterion_product }))
    : [];
  return { evals, items };
}

// Aderência ao roteiro como nos dashboards PAN: itens feitos ÷ itens que cabiam, somando todas as
// ligações (peso 0 e N/A ficam fora). Difere da nota média, que pesa cada ligação igualmente.
function adherence(items) {
  let tot = 0, pts = 0;
  for (const i of items) {
    const w = i.weight == null ? 1 : Number(i.weight);
    if (!(w > 0) || !i.final_result || i.final_result === 'NA') continue;
    tot += w; pts += i.final_result === 'C' ? w : i.final_result === 'P' ? w * 0.5 : 0;
  }
  return tot ? Math.round((pts / tot) * 1000) / 10 : null;
}

const avg = (arr) => { const v = arr.filter((x) => x != null); return v.length ? Math.round((v.reduce((a, b) => a + Number(b), 0) / v.length) * 10) / 10 : null; };

function computeStats(evals, items) {
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
  kpis.adherence = adherence(items);
  kpis.conformity = kpis.items_total ? Math.round((kpis.items_conform / kpis.items_total) * 1000) / 10 : null;
  kpis.feedback_rate = kpis.total ? Math.round((kpis.feedback_applied / kpis.total) * 1000) / 10 : null;
  kpis.speech_accuracy = items.length ? Math.round((1 - kpis.items_adjusted / items.length) * 1000) / 10 : null;
  for (const p of PRODUCTS) {
    const ev = evals.filter((e) => e.product === p);
    kpis[`avg_${p.toLowerCase()}`] = avg(ev.map((e) => e.final_score));
    kpis[`total_${p.toLowerCase()}`] = ev.length;
  }
  kpis.alerts = Object.fromEntries(['sigilo', 'conduta', 'oferta_perdida', 'postura', 'sem_proposta', 'audio_ruim', 'sem_speech']
    .map((a) => [a, evals.filter((e) => (e.alerts || []).includes(a)).length]));

  const itemsByEval = new Map();
  for (const i of items) { if (!itemsByEval.has(i.evaluation_id)) itemsByEval.set(i.evaluation_id, []); itemsByEval.get(i.evaluation_id).push(i); }

  const cycles = [...new Map(evals.filter((e) => e.cycle_id).map((e) => [e.cycle_id, { id: e.cycle_id, name: e.cycle_name, start: e.cycle_start }])).values()]
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const evolution = cycles.map((c) => {
    const ev = evals.filter((e) => e.cycle_id === c.id);
    const applicable = ev.flatMap((e) => itemsByEval.get(e.id) || []).filter((i) => i.final_result && i.final_result !== 'NA');
    return {
      cycle_id: c.id, cycle: c.name, total: ev.length,
      geral: avg(ev.map((e) => e.final_score)),
      ...Object.fromEntries(PRODUCTS.map((p) => [p.toLowerCase(), avg(ev.filter((e) => e.product === p).map((e) => e.final_score))])),
      speech: avg(ev.map((e) => e.speech_score)),
      conformity: applicable.length ? Math.round((applicable.filter((i) => i.final_result === 'C').length / applicable.length) * 1000) / 10 : null,
      feedback_rate: ev.length ? Math.round((ev.filter((e) => e.status === 'feedback_aplicado').length / ev.length) * 1000) / 10 : null,
    };
  });

  const byOp = new Map();
  for (const e of evals) {
    const o = byOp.get(e.operator_id) || { operator_id: e.operator_id, name: e.operator_name, team: e.team, supervisor_name: e.supervisor_name, login: e.login, evals: [] };
    o.evals.push(e); byOp.set(e.operator_id, o);
  }
  const lastCycle = cycles[cycles.length - 1], prevCycle = cycles[cycles.length - 2];
  const operators = [...byOp.values()].map((o) => {
    const scores = o.evals.map((e) => e.final_score).filter((x) => x != null).map(Number);
    const mean = avg(scores);
    const sd = scores.length > 1 ? Math.round(Math.sqrt(scores.reduce((a, s) => a + (s - mean) ** 2, 0) / (scores.length - 1)) * 10) / 10 : 0;
    const last = lastCycle ? avg(o.evals.filter((e) => e.cycle_id === lastCycle.id).map((e) => e.final_score)) : null;
    const prev = prevCycle ? avg(o.evals.filter((e) => e.cycle_id === prevCycle.id).map((e) => e.final_score)) : null;
    return {
      operator_id: o.operator_id, name: o.name, team: o.team, supervisor_name: o.supervisor_name || null, login: o.login || null, total: o.evals.length, avg: mean, sd,
      adherence: adherence(o.evals.flatMap((e) => itemsByEval.get(e.id) || [])),
      avg_speech: avg(o.evals.map((e) => e.speech_score)),
      ...Object.fromEntries(PRODUCTS.map((p) => [p.toLowerCase(), avg(o.evals.filter((e) => e.product === p).map((e) => e.final_score))])),
      products: [...new Set(o.evals.map((e) => e.product))],
      last, prev, delta: last != null && prev != null ? Math.round((last - prev) * 10) / 10 : null,
      feedback_rate: Math.round((o.evals.filter((e) => e.status === 'feedback_aplicado').length / o.evals.length) * 1000) / 10,
      pending_feedback: o.evals.filter((e) => e.status !== 'feedback_aplicado').length,
      series: cycles.map((c) => avg(o.evals.filter((e) => e.cycle_id === c.id).map((e) => e.final_score))),
    };
  }).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));

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

  const bins = [[0, 59.9, '< 60'], [60, 69.9, '60–69'], [70, 79.9, '70–79'], [80, 89.9, '80–89'], [90, 100, '90–100']];
  const distribution = bins.map(([a, b, label]) => ({ label, count: evals.filter((e) => e.final_score != null && e.final_score >= a && e.final_score <= b).length }));
  const scatter = evals.filter((e) => e.final_score != null && e.speech_score != null).map((e) => ({ id: e.id, x: Number(e.speech_score), y: Number(e.final_score), product: e.product, operator: e.operator_name }));
  const teams = [...new Set(evals.map((e) => e.team).filter(Boolean))].map((t) => {
    const ev = evals.filter((e) => e.team === t);
    return { team: t, total: ev.length, avg: avg(ev.map((e) => e.final_score)), feedback_rate: Math.round((ev.filter((e) => e.status === 'feedback_aplicado').length / ev.length) * 1000) / 10 };
  });
  // Visão apartada: cada produto e, dentro dele, cada segmento (Clean Curto/Longo, Público/Privado)
  const groupStats = (ev) => {
    const its = ev.flatMap((e) => itemsByEval.get(e.id) || []).filter((i) => i.final_result && i.final_result !== 'NA');
    return {
      total: ev.length, avg: avg(ev.map((e) => e.final_score)), avg_speech: avg(ev.map((e) => e.speech_score)),
      adherence: adherence(ev.flatMap((e) => itemsByEval.get(e.id) || [])),
      conformity: its.length ? Math.round((its.filter((i) => i.final_result === 'C').length / its.length) * 1000) / 10 : null,
      feedback_rate: ev.length ? Math.round((ev.filter((e) => e.status === 'feedback_aplicado').length / ev.length) * 1000) / 10 : null,
      operators: new Set(ev.map((e) => e.operator_id)).size,
      alerts: ev.filter((e) => (e.alerts || []).length).length,
    };
  };
  const segments = PRODUCTS.flatMap((p) => {
    const ev = evals.filter((e) => e.product === p);
    if (!ev.length) return [];
    const rows = [{ product: p, segment: null, level: 'product', ...groupStats(ev) }];
    if (SEGMENTS[p]) {
      for (const sg of [...SEGMENTS[p], 'none']) {
        const sev = ev.filter((e) => (sg === 'none' ? !e.segment : e.segment === sg));
        if (sev.length || sg !== 'none') rows.push({ product: p, segment: sg, level: 'segment', ...groupStats(sev) });
      }
    }
    return rows;
  });
  return { kpis, evolution, operators, criteria, distribution, scatter, teams, cycles, segments };
}

router.get('/stats/overview', h(async (req, res) => {
  const { evals, items } = await loadStatsRows(req, req.query);
  res.json(computeStats(evals, items));
}));

router.get('/stats/operator/:id', h(async (req, res) => {
  const id = Number(req.params.id);
  const op = await must(scoped(sb().from('px_operators').select('*'), req).eq('id', id).maybeSingle());
  if (!op) return res.status(404).json({ error: 'Operador não encontrado.' });
  const [mine, team, evaluations, feedbacks] = await Promise.all([
    loadStatsRows(req, { ...req.query, operator_id: id }),
    loadStatsRows(req, { cycle_id: req.query.cycle_id, team: op.team || undefined }),
    must(sb().from('px_v_eval_cards').select('*').eq('operator_id', id).order('call_date', { ascending: false })).then((r) => r.map(cardForUser(req))),
    must(sb().from('px_v_feedbacks').select('*').eq('operator_id', id).order('applied_at', { ascending: false })),
  ]);
  const teamStats = computeStats(team.evals, team.items);
  res.json({ operator: op, ...computeStats(mine.evals, mine.items), evaluations, feedbacks, team_avg: teamStats.kpis.avg_final, team_evolution: teamStats.evolution });
}));

router.get('/reports/data', h(async (req, res) => {
  const q = req.query;
  const { evals, items } = await loadStatsRows(req, q);
  const data = computeStats(evals, items);
  const cycleIds = String(q.cycle_id || '').split(',').map(Number).filter(Boolean);
  const cycles = cycleIds.length ? await must(sb().from('px_cycles').select('*').in('id', cycleIds).order('start_date')) : [];
  const perCycle = cycles.map((c) => {
    const ev = evals.filter((e) => e.cycle_id === c.id);
    const ids = new Set(ev.map((e) => e.id));
    return { cycle: c, ...computeStats(ev, items.filter((i) => ids.has(i.evaluation_id))) };
  });
  const scoredDesc = evals.filter((e) => e.final_score != null).sort((a, b) => b.final_score - a.final_score);
  const ids = new Set(evals.map((e) => e.id));
  const fbs = (await must(feedbackQuery(req, { cycle_id: cycleIds.length === 1 ? cycleIds[0] : undefined, product: q.product, segment: q.segment, team: q.team, operator_id: q.operator_id }).limit(300)))
    .filter((f) => ids.has(f.evaluation_id)).slice(0, 12);
  res.json({
    ...data, selected_cycles: cycles, per_cycle: perCycle, highlights: scoredDesc.slice(0, 5), lowlights: scoredDesc.slice(-5).reverse(), feedbacks: fbs,
    company: getSetting('company_name', 'Paschoalotto'), report_footer: getSetting('report_footer'),
    generated_by: req.user.display_name || req.user.name, generated_at: nowIso(),
  });
}));

// --------------------------------------------------------------- Importação
router.post('/import/preview', QUALITY, h(async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 5000) : [];
  const [criteria, operators] = await Promise.all([
    must(sb().from('px_criteria').select('*').eq('active', true).order('sort')),
    must(sb().from('px_operators').select('id, name, registration')),
  ]);
  res.json(normalizeRows(rows, criteria, operators));
}));

router.post('/import/commit', QUALITY, h(async (req, res) => {
  const b = req.body || {};
  const rows = (Array.isArray(b.rows) ? b.rows : []).filter((r) => !(r.errors && r.errors.length));
  if (!rows.length) return res.status(400).json({ error: 'Nenhuma linha válida para importar.' });
  const cycleId = intOrNull(b.cycle_id);
  const operators = await must(sb().from('px_operators').select('id, name, registration'));
  const sups = await must(sb().from('px_profiles').select('id, name, display_name, email').eq('role', 'supervisor'));
  const low = (s) => String(s || '').trim().toLowerCase();
  let created = 0, newOps = 0;
  for (const r of rows) {
    let op = operators.find((o) => (r.operator_id && o.id === r.operator_id) || (r.registration && o.registration && String(o.registration) === String(r.registration)) || low(o.name) === low(r.operator));
    if (!op) {
      const sup = sups.find((s) => [s.name, s.display_name, s.email].some((v) => v && low(v) === low(r.supervisor)));
      op = await must(sb().from('px_operators').insert({ name: r.operator, registration: n(r.registration), team: n(r.team), supervisor_name: n(r.supervisor), supervisor_user_id: sup ? sup.id : null }).select('id, name, registration').single());
      operators.push(op); newOps++;
    }
    await createEvaluation({
      cycle_id: cycleId || r.cycle_id, operator_id: op.id, product: r.product, call_date: r.call_date, protocol: r.protocol,
      contract: r.contract, customer: r.customer, duration_sec: r.duration_sec, speech_score: r.speech_score, speech_summary: r.summary,
      audio_url: req.user.role === 'admin' ? r.audio_url : null, transcript: r.transcript || null, transcript_name: r.transcript ? 'planilha' : null, items: r.items,
    }, req.user.id);
    created++;
  }
  await audit(req.user.id, 'importacao', 'import', null, { created, newOps, ciclo: cycleId, arquivo: b.filename || null });
  res.json({ created, newOps });
}));

// Dashboards de monitoria PAN (HTML com JSON embutido): o navegador extrai o JSON e envia em lotes
router.post('/import/dashboard', QUALITY, h(async (req, res) => {
  const b = req.body || {};
  const out = await importDashboard({ kind: b.kind, calls: b.calls, cycle_id: intOrNull(b.cycle_id), period: b.period ? String(b.period).slice(0, 60) : null }, req.user.id);
  if (out.created || b.last) await audit(req.user.id, 'importacao_dashboard', 'import', null, { ...out, arquivo: b.filename ? String(b.filename).slice(0, 200) : null, lote: b.batch || null });
  res.json(out);
}));

// --------------------------------------------------------------- Bugs
router.post('/bugs', h(async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim().slice(0, 140), description = String(b.description || '').trim().slice(0, 5000);
  if (!title || !description) return res.status(400).json({ error: 'Preencha o título e a descrição do problema.' });
  const shot = typeof b.screenshot === 'string' && /^data:image\/(png|jpe?g|webp);base64,/.test(b.screenshot) && b.screenshot.length < 4e6 ? b.screenshot : null;
  const bug = await must(sb().from('px_bugs').insert({
    user_id: req.user.id, title, description, severity: ['baixa', 'media', 'alta', 'critica'].includes(b.severity) ? b.severity : 'media',
    page: n(String(b.page || '').slice(0, 300)), user_agent: n(String(req.headers['user-agent'] || '').slice(0, 300)), screenshot: shot,
  }).select('id').single());
  const admins = await must(sb().from('px_profiles').select('id').eq('role', 'admin').eq('active', true));
  await notify(admins.map((u) => u.id).filter((u) => u !== req.user.id), 'Novo bug reportado', `${req.user.display_name || req.user.name}: ${title}`, '#/bugs');
  res.json({ id: bug.id });
}));

router.get('/bugs', h(async (req, res) => {
  let q = sb().from('px_v_bugs').select('*').order('id', { ascending: false });
  if (req.user.role !== 'admin') q = q.eq('user_id', req.user.id);
  res.json(await must(q));
}));

router.get('/bugs/:id/screenshot', h(async (req, res) => {
  const b = await must(sb().from('px_bugs').select('user_id, screenshot').eq('id', Number(req.params.id)).maybeSingle());
  if (!b || !b.screenshot || (req.user.role !== 'admin' && b.user_id !== req.user.id)) return res.status(404).end();
  const [meta, data] = b.screenshot.split(',');
  res.setHeader('Content-Type', meta.slice(5, meta.indexOf(';')));
  res.send(Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0)));
}));

router.put('/bugs/:id', ADMIN, h(async (req, res) => {
  const id = Number(req.params.id);
  const b = await must(sb().from('px_bugs').select('id, status, title, user_id, admin_notes, resolved_at').eq('id', id).maybeSingle());
  if (!b) return res.status(404).json({ error: 'Registro não encontrado.' });
  const status = ['aberto', 'em_analise', 'resolvido', 'descartado'].includes(req.body?.status) ? req.body.status : b.status;
  await must(sb().from('px_bugs').update({ status, admin_notes: n(req.body?.admin_notes) ?? b.admin_notes, resolved_at: status === 'resolvido' ? (b.resolved_at || nowIso()) : null }).eq('id', id));
  if (status !== b.status && b.user_id) await notify([b.user_id], 'Atualização do seu report', `"${b.title}" agora está: ${status.replace('_', ' ')}.`, '#/bugs');
  res.json({ ok: true });
}));

// --------------------------------------------------------------- Notificações
router.get('/notifications', h(async (req, res) => {
  res.json(await must(sb().from('px_notifications').select('*').eq('user_id', req.user.id).order('id', { ascending: false }).limit(50)));
}));
router.post('/notifications/read', h(async (req, res) => {
  await must(sb().from('px_notifications').update({ read: true }).eq('user_id', req.user.id).eq('read', false));
  res.json({ ok: true });
}));

// --------------------------------------------------------------- Usuários (Supabase Auth + px_profiles)
router.get('/users', ADMIN, h(async (req, res) => {
  const rows = await must(sb().from('px_profiles').select('*').order('active', { ascending: false }).order('name'));
  res.json(rows.map(auth.publicUser));
}));

router.post('/users', ADMIN, h(async (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  if (!isEmail(email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
  if (!['admin', 'qualidade', 'supervisor'].includes(b.role)) return res.status(400).json({ error: 'Perfil inválido.' });
  if (!String(b.name || '').trim()) return res.status(400).json({ error: 'Informe o nome.' });
  const exists = await must(sb().from('px_profiles').select('id').ilike('email', email).maybeSingle());
  if (exists) return res.status(400).json({ error: 'Este e-mail já tem acesso à plataforma.' });
  let user = await auth.findAuthUserByEmail(email);
  let temp = null;
  if (!user) {
    temp = auth.tempPassword();
    const { data, error } = await sb().auth.admin.createUser({ email, password: temp, email_confirm: true, user_metadata: { name: String(b.name).trim() } });
    if (error) return res.status(400).json({ error: error.message });
    user = data.user;
  }
  const profile = await must(sb().from('px_profiles').insert({ id: user.id, email, name: String(b.name).trim(), role: b.role, must_change_password: !!temp }).select().single());
  await audit(req.user.id, 'usuario_criado', 'user', null, { email, perfil: b.role, conta_existente: !temp });
  res.json({ user: auth.publicUser(profile), temp_password: temp, existing_account: !temp });
}));

router.put('/users/:id', ADMIN, h(async (req, res) => {
  const id = req.params.id;
  const u = await auth.loadProfile(id);
  if (!u) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const b = req.body || {};
  const role = ['admin', 'qualidade', 'supervisor'].includes(b.role) ? b.role : u.role;
  const active = b.active === undefined ? u.active : !!b.active;
  if (u.role === 'admin' && (role !== 'admin' || !active)) {
    const admins = await count(sb().from('px_profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('active', true));
    if (admins <= 1) return res.status(400).json({ error: 'É preciso manter pelo menos um administrador ativo.' });
  }
  const email = b.email !== undefined ? String(b.email).trim().toLowerCase() : u.email;
  if (!isEmail(email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
  const authPatch = {};
  if (email !== u.email) Object.assign(authPatch, { email, email_confirm: true });
  if (active !== u.active) authPatch.ban_duration = active ? 'none' : '876000h';
  if (Object.keys(authPatch).length) {
    const { error } = await sb().auth.admin.updateUserById(id, authPatch);
    if (error) return res.status(400).json({ error: error.message });
  }
  const saved = await must(sb().from('px_profiles').update({ name: String(b.name || u.name).trim(), email, role, active }).eq('id', id).select().single());
  await audit(req.user.id, 'usuario_editado', 'user', null, { email, perfil: role, ativo: active });
  res.json(auth.publicUser(saved));
}));

router.post('/users/:id/reset-password', ADMIN, h(async (req, res) => {
  const u = await auth.loadProfile(req.params.id);
  if (!u) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const temp = auth.tempPassword();
  const { error } = await sb().auth.admin.updateUserById(u.id, { password: temp });
  if (error) return res.status(400).json({ error: error.message });
  await must(sb().from('px_profiles').update({ must_change_password: true }).eq('id', u.id));
  await audit(req.user.id, 'senha_resetada', 'user', null, { email: u.email });
  res.json({ temp_password: temp });
}));

// --------------------------------------------------------------- Quinzenas
const CYCLE_STATUS = ['aberto', 'publicado', 'encerrado'];
router.post('/cycles', ADMIN, h(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.start_date || !b.end_date) return res.status(400).json({ error: 'Informe nome, início e fim.' });
  if (b.audio_folder_url && !isUrl(b.audio_folder_url)) return res.status(400).json({ error: 'Link da pasta de áudios inválido.' });
  const c = await must(sb().from('px_cycles').insert({ name: b.name, start_date: b.start_date, end_date: b.end_date, audio_folder_url: n(b.audio_folder_url), status: CYCLE_STATUS.includes(b.status) ? b.status : 'aberto' }).select().single());
  await audit(req.user.id, 'ciclo_criado', 'cycle', c.id, { nome: b.name });
  res.json(c);
}));

router.put('/cycles/:id', ADMIN, h(async (req, res) => {
  const id = Number(req.params.id);
  const c = await must(sb().from('px_cycles').select('*').eq('id', id).maybeSingle());
  if (!c) return res.status(404).json({ error: 'Ciclo não encontrado.' });
  const b = { ...c, ...req.body };
  if (b.audio_folder_url && !isUrl(b.audio_folder_url)) return res.status(400).json({ error: 'Link da pasta de áudios inválido.' });
  const status = CYCLE_STATUS.includes(b.status) ? b.status : c.status;
  const saved = await must(sb().from('px_cycles').update({
    name: b.name, start_date: b.start_date, end_date: b.end_date, audio_folder_url: n(b.audio_folder_url), status,
    published_at: status === 'publicado' && c.status !== 'publicado' ? nowIso() : c.published_at,
  }).eq('id', id).select().single());
  await audit(req.user.id, 'ciclo_editado', 'cycle', id, { pasta_audio: { de: c.audio_folder_url, para: n(b.audio_folder_url) }, status });
  if (status === 'publicado' && c.status !== 'publicado') {
    const team = await must(sb().from('px_profiles').select('id').eq('active', true).in('role', ['supervisor', 'qualidade']));
    await notify(team.map((u) => u.id), 'Report publicado', `O report de qualidade "${b.name}" foi publicado.`, '#/painel');
  }
  res.json(saved);
}));

router.delete('/cycles/:id', ADMIN, h(async (req, res) => {
  const id = Number(req.params.id);
  const used = await count(sb().from('px_evaluations').select('id', { count: 'exact', head: true }).eq('cycle_id', id));
  if (used) return res.status(400).json({ error: `Este ciclo possui ${used} atendimento(s). Mova ou exclua os atendimentos antes.` });
  await must(sb().from('px_cycles').delete().eq('id', id));
  await audit(req.user.id, 'ciclo_excluido', 'cycle', id);
  res.json({ ok: true });
}));

// --------------------------------------------------------------- Operadores
async function supName(id) {
  if (!id) return null;
  return must(sb().from('px_profiles').select('name').eq('id', id).maybeSingle());
}

router.post('/operators', QUALITY, h(async (req, res) => {
  const b = req.body || {};
  if (!String(b.name || '').trim()) return res.status(400).json({ error: 'Informe o nome do operador.' });
  const sup = await supName(b.supervisor_user_id);
  const o = await must(sb().from('px_operators').insert({
    name: String(b.name).trim(), registration: n(b.registration), team: n(b.team),
    supervisor_user_id: sup ? b.supervisor_user_id : null, supervisor_name: sup ? sup.name : n(b.supervisor_name),
  }).select().single());
  await audit(req.user.id, 'operador_criado', 'operator', o.id, { nome: b.name });
  res.json(o);
}));

router.put('/operators/:id', QUALITY, h(async (req, res) => {
  const id = Number(req.params.id);
  const o = await must(sb().from('px_operators').select('*').eq('id', id).maybeSingle());
  if (!o) return res.status(404).json({ error: 'Operador não encontrado.' });
  const b = { ...o, ...req.body };
  const sup = await supName(b.supervisor_user_id);
  const saved = await must(sb().from('px_operators').update({
    name: String(b.name).trim(), registration: n(b.registration), team: n(b.team),
    supervisor_user_id: sup ? b.supervisor_user_id : null, supervisor_name: sup ? sup.name : n(b.supervisor_name), active: !!b.active,
  }).eq('id', id).select().single());
  await audit(req.user.id, 'operador_editado', 'operator', id);
  res.json(saved);
}));

// --------------------------------------------------------------- Critérios
// Peso 0 é permitido: o item aparece na monitoria, mas fica fora da nota
const weightOf = (v) => { const w = Number(v); return Number.isFinite(w) && w >= 0 ? Math.min(w, 10) : 1; };
router.post('/criteria', ADMIN, h(async (req, res) => {
  const b = req.body || {};
  if (!CRITERIA_PRODUCTS.includes(b.product) || !b.code || !b.name) return res.status(400).json({ error: 'Informe produto, código e nome.' });
  const last = await must(sb().from('px_criteria').select('sort').order('sort', { ascending: false }).limit(1));
  const c = await must(sb().from('px_criteria').insert({
    product: b.product, code: String(b.code).toUpperCase().slice(0, 8), name: b.name, description: n(b.description),
    weight: weightOf(b.weight), critical: !!b.critical, sort: (last[0]?.sort || 0) + 1, stage: n(b.stage),
  }).select().single());
  await audit(req.user.id, 'criterio_criado', 'criterion', c.id, { codigo: b.code });
  res.json(c);
}));

router.put('/criteria/:id', ADMIN, h(async (req, res) => {
  const id = Number(req.params.id);
  const c = await must(sb().from('px_criteria').select('*').eq('id', id).maybeSingle());
  if (!c) return res.status(404).json({ error: 'Critério não encontrado.' });
  const b = { ...c, ...req.body };
  if (!CRITERIA_PRODUCTS.includes(b.product)) return res.status(400).json({ error: 'Produto inválido.' });
  const saved = await must(sb().from('px_criteria').update({
    product: b.product, code: String(b.code).toUpperCase().slice(0, 8), name: b.name, description: n(b.description),
    weight: weightOf(b.weight), critical: !!b.critical, sort: Number(b.sort) || c.sort, active: !!b.active, stage: n(b.stage),
  }).eq('id', id).select().single());
  await audit(req.user.id, 'criterio_editado', 'criterion', id);
  res.json(saved);
}));

// --------------------------------------------------------------- Configurações
const SETTING_KEYS = ['company_name', 'ai_model', 'ai_effort', 'ai_auto_apply', 'ai_confidence_threshold', 'supervisor_scope', 'report_footer'];
router.get('/settings', ADMIN, h(async (req, res) => {
  await loadSettings();
  const out = Object.fromEntries(SETTING_KEYS.map((k) => [k, getSetting(k)]));
  const key = getSetting('anthropic_api_key');
  out.anthropic_api_key_set = !!key || !!Deno.env.get('ANTHROPIC_API_KEY');
  out.anthropic_api_key_source = Deno.env.get('ANTHROPIC_API_KEY') ? 'variavel_ambiente' : key ? 'banco' : null;
  out.anthropic_api_key_hint = key ? `${key.slice(0, 7)}…${key.slice(-4)}` : null;
  out.storage = 'Supabase';
  res.json(out);
}));

router.put('/settings', ADMIN, h(async (req, res) => {
  const b = req.body || {};
  for (const k of SETTING_KEYS) if (b[k] !== undefined) await setSetting(k, b[k]);
  if (b.anthropic_api_key !== undefined) await setSetting('anthropic_api_key', String(b.anthropic_api_key || '').trim() || null);
  await audit(req.user.id, 'configuracoes_alteradas', 'settings', null, { chaves: Object.keys(b).filter((k) => k !== 'anthropic_api_key').concat(b.anthropic_api_key !== undefined ? ['anthropic_api_key (oculta)'] : []) });
  res.json({ ok: true });
}));

router.get('/audit', ADMIN, h(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 300, 1000);
  let q = sb().from('px_v_audit').select('*').order('id', { ascending: false }).limit(limit);
  if (req.query.action) q = q.eq('action', req.query.action);
  res.json(await must(q));
}));

router.post('/admin/seed-demo', ADMIN, h(async (req, res) => {
  await seedDemo();
  await audit(req.user.id, 'demo_carregada', 'settings', null);
  res.json({ ok: true });
}));

router.post('/admin/clear-demo', ADMIN, h(async (req, res) => {
  await clearDemo();
  await audit(req.user.id, 'demo_removida', 'settings', null);
  res.json({ ok: true });
}));

// Backup em JSON de todas as tabelas da plataforma (a chave da IA não é exportada)
const BACKUP_TABLES = ['px_profiles', 'px_cycles', 'px_operators', 'px_criteria', 'px_evaluations', 'px_evaluation_items', 'px_feedbacks', 'px_bugs', 'px_audit_log', 'px_settings', 'px_notifications'];
router.get('/admin/backup', ADMIN, h(async (req, res) => {
  const out = { generated_at: nowIso(), source: 'PX Monitorias & Feedbacks', tables: {} };
  for (const t of BACKUP_TABLES) {
    const rows = await fetchAll(() => sb().from(t).select('*').order(t === 'px_settings' ? 'key' : 'id'));
    out.tables[t] = t === 'px_settings' ? rows.filter((r) => r.key !== 'anthropic_api_key') : rows;
  }
  await audit(req.user.id, 'backup_baixado', 'settings', null);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="px-monitorias-backup-${nowIso().slice(0, 10)}.json"`);
  res.send(JSON.stringify(out));
}));

router.get('/export/evaluations', h(async (req, res) => {
  res.json(await fetchAll(() => sorted(applyFilters(sb().from('px_v_eval_cards').select('*'), req, req.query), 'recentes').order('id')));
}));

router.get('/export/feedbacks', h(async (req, res) => {
  res.json(await fetchAll(() => scoped(sb().from('px_v_feedbacks').select('*'), req).order('applied_at', { ascending: false }).order('id')));
}));

// --------------------------------------------------------------- Erros
router.use((err, req, res, _next) => {
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500 && !err.status) console.error(err?.stack || err);
  res.status(status).json({ error: status === 413 ? 'Arquivo grande demais (limite de 15 MB).' : status >= 500 && !err.status ? 'Erro interno. Tente novamente ou reporte o bug.' : err.message });
});

export { router };

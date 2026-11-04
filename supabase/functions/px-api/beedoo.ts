// @ts-nocheck — Formalização no Beedoo: a plataforma monta a mensagem (feedback, monitoria ou ação), a pessoa
// revisa e confirma, e o agente PX Beedoo (no computador dela, dentro da rede) envia pelo chat do Beedoo.
// O Beedoo só abre de dentro da rede da empresa, por isso o envio não sai deste servidor.
import { admin, must } from './supa.ts';
import { getSetting, setSetting, audit, notify } from './db.ts';
import { carteiraScope, inScope, scopeValues } from './carteira.ts';

const sb = () => admin();
const KINDS = ['feedback', 'monitoria', 'acao'];
const httpError = (status, message) => Object.assign(new Error(message), { status });
const nowIso = () => new Date().toISOString();
const br = (d) => { const s = String(d || ''); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
const brDay = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');
const score = (v) => (v == null || v === '' ? '' : Number(v).toFixed(1).replace('.', ','));
const firstName = (n) => { const w = String(n || '').trim().split(/\s+/)[0] || ''; return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ''; };
const RES = { NC: 'Não conforme', P: 'Parcial', C: 'Conforme' };
const CART_LABEL = { PAN: 'PAN', 'SAFRA ADM': 'Safra ADM e Call', 'SAFRA BS': 'Safra BS', PORTO: 'Porto Bank', SAFRA: 'Safra' };
const PRODUCT = { VEICULOS: 'Veículos', CARTOES: 'Cartões', CONSIGNADO: 'Consignado', REFIN: 'Refinanciamento', ENTREGA: 'Entrega amigável', CHEQUE: 'Cheque especial/empresarial', EMPRESTIMOS: 'Empréstimos', PARCELAMENTO: 'Parcelamento de dívidas', PDD: 'PDD', ADIANTAMENTO: 'Adiantamento ao depositante', SAFRA_PAY: 'Safra Pay' };
const AGENT_ONLINE_MS = 2 * 60 * 1000;
const STALE_MS = 10 * 60 * 1000;

// Modelos de mensagem: {campo} é trocado pelo valor; uma linha cujos campos ficaram todos vazios some
export const DEFAULT_TEMPLATES = {
  feedback: `Olá, {primeiro_nome}! Tudo bem?

Segue a formalização do feedback aplicado em {data}{modalidade_txt}.

Atendimentos avaliados: {atendimentos}
Nota: {nota}

O que conversamos:
{conteudo}

✅ Pontos fortes: {pontos_fortes}
📌 Pontos de melhoria: {pontos_melhoria}
🎯 Plano de ação: {plano_acao}
📅 Reavaliação: {reavaliacao}

Qualquer dúvida, estou à disposição.
{responsavel} · Qualidade {carteira}`,
  monitoria: `Olá, {primeiro_nome}! Tudo bem?

Segue o resultado da monitoria da sua ligação {protocolo} de {data_ligacao} ({produto}).
Nota: {nota}

📌 Pontos de atenção:
{pontos_atencao}

✅ Mandou bem em: {pontos_positivos}

{resumo}

Qualquer dúvida, estou à disposição.
{responsavel} · Qualidade {carteira}`,
  acao: `Olá, {primeiro_nome}! Tudo bem?

Registro da ação "{acao}" realizada em {data} (tema: {tema}).
{obs}

Qualquer dúvida, estou à disposição.
{responsavel} · Qualidade {carteira}`,
};
export const FIELDS = {
  feedback: ['operador', 'primeiro_nome', 'login', 'data', 'modalidade', 'atendimentos', 'nota', 'conteudo', 'pontos_fortes', 'pontos_melhoria', 'plano_acao', 'reavaliacao', 'responsavel', 'carteira'],
  monitoria: ['operador', 'primeiro_nome', 'login', 'protocolo', 'data_ligacao', 'produto', 'nota', 'pontos_atencao', 'pontos_positivos', 'resumo', 'responsavel', 'carteira'],
  acao: ['operador', 'primeiro_nome', 'login', 'acao', 'tema', 'data', 'obs', 'responsavel', 'carteira'],
};
const template = (kind) => getSetting(`beedoo_tpl:${kind}`) || DEFAULT_TEMPLATES[kind];

export function render(tpl, vals) {
  const lines = String(tpl).split('\n').flatMap((line) => {
    const keys = [...line.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
    if (keys.length && keys.every((k) => !String(vals[k] ?? '').trim())) return [];
    return [line.replace(/\{([a-z_]+)\}/g, (_, k) => String(vals[k] ?? ''))];
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const who = (u) => u.display_name || u.name || '';
async function operatorOf(id) {
  return id ? await must(sb().from('px_operators').select('id, name, login, portfolio').eq('id', id).maybeSingle()) : null;
}
const bullets = (l) => l.map((x) => `• ${x}`).join('\n');

// Monta o rascunho (dados + mensagem pelo modelo) a partir do que já está na plataforma
async function draftFor(req, kind, q) {
  const scope = carteiraScope(req);
  const base = { responsavel: who(req.user) };
  if (kind === 'feedback') {
    let f = q.feedback_id ? await must(sb().from('px_v_feedbacks').select('*').eq('id', Number(q.feedback_id)).maybeSingle()) : null;
    const batch = q.batch_id || f?.batch_id;
    let rows = batch ? await must(sb().from('px_v_feedbacks').select('*').eq('batch_id', batch).order('id')) : f ? [f] : [];
    if (!rows.length) throw httpError(404, 'Feedback não encontrado.');
    f = rows[0];
    if (!inScope(scope, f.portfolio)) throw httpError(404, 'Feedback não encontrado.');
    const op = await operatorOf(f.operator_id);
    const notas = rows.map((r) => r.final_score).filter((v) => v != null);
    const protos = rows.map((r) => r.protocol).filter(Boolean);
    const vals = {
      ...base, operador: op?.name || f.operator_name, primeiro_nome: firstName(op?.name || f.operator_name), login: op?.login || '',
      data: brDay(f.applied_at), modalidade: f.modality || '', modalidade_txt: f.modality ? ` (${f.modality.toLowerCase()})` : '',
      atendimentos: `${rows.length}${protos.length ? ` · ${protos.slice(0, 6).join(', ')}${protos.length > 6 ? '…' : ''}` : ''}`,
      nota: notas.length ? `${score(notas.reduce((a, v) => a + Number(v), 0) / notas.length)}${rows.length > 1 ? ' (média)' : ''}` : '',
      conteudo: f.content || '', pontos_fortes: f.strengths || '', pontos_melhoria: f.improvements || '', plano_acao: f.action_plan || '',
      reavaliacao: br(f.followup_date), carteira: CART_LABEL[f.portfolio] || f.portfolio || '',
    };
    return { kind, source_id: f.id, operator_id: f.operator_id, login: vals.login, operator_name: vals.operador, portfolio: f.portfolio || 'PAN', vals, attachments: [] };
  }
  if (kind === 'monitoria') {
    const e = await must(sb().from('px_v_eval_cards').select('*').eq('id', Number(q.evaluation_id)).maybeSingle());
    if (!e || !inScope(scope, e.portfolio)) throw httpError(404, 'Atendimento não encontrado.');
    const op = await operatorOf(e.operator_id);
    const its = await must(sb().from('px_v_eval_items').select('code, name, final_result, speech_result, adjust_reason, speech_note, ai_reason, weight, sort').eq('evaluation_id', e.id).order('sort'));
    const res = (i) => i.final_result || i.speech_result;
    const why = (i) => String(i.adjust_reason || i.ai_reason || i.speech_note || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    const bad = its.filter((i) => ['NC', 'P'].includes(res(i)));
    const good = its.filter((i) => res(i) === 'C' && Number(i.weight ?? 1) > 0);
    const full = await must(sb().from('px_evaluations').select('speech_summary').eq('id', e.id).maybeSingle());
    const vals = {
      ...base, operador: op?.name || e.operator_name, primeiro_nome: firstName(op?.name || e.operator_name), login: op?.login || e.login || '',
      protocolo: e.protocol || `#${e.id}`, data_ligacao: br(e.call_date), produto: [PRODUCT[e.product] || e.product, e.segment].filter(Boolean).join(' · '),
      nota: score(e.final_score), pontos_atencao: bullets(bad.map((i) => `${i.name} (${RES[res(i)]})${why(i) ? `: ${why(i)}` : ''}`)),
      pontos_positivos: good.slice(0, 6).map((i) => i.name).join(', '), resumo: String(full?.speech_summary || '').trim().slice(0, 600),
      carteira: CART_LABEL[e.portfolio] || e.portfolio || '',
    };
    const attachments = e.audio_file ? [{ type: 'audio', file: e.audio_file, name: e.audio_file, optional: true }] : [];
    return { kind, source_id: e.id, operator_id: e.operator_id, login: vals.login, operator_name: vals.operador, portfolio: e.portfolio || 'PAN', vals, attachments, audio_link: e.audio_link || null };
  }
  const a = await must(sb().from('px_v_actions').select('*').eq('id', Number(q.action_id)).maybeSingle());
  if (!a || !inScope(scope, a.portfolio)) throw httpError(404, 'Ação não encontrada.');
  const op = await operatorOf(a.operator_id);
  const vals = {
    ...base, operador: op?.name || a.operator_name || '', primeiro_nome: firstName(op?.name || a.operator_name), login: op?.login || a.login || '',
    acao: a.action || '', tema: a.theme || '', data: br(a.action_date), obs: a.obs || '', carteira: CART_LABEL[a.portfolio] || a.portfolio || '',
  };
  return { kind, source_id: a.id, operator_id: a.operator_id, login: vals.login, operator_name: vals.operador, portfolio: a.portfolio || 'PAN', vals, attachments: [] };
}

const sha256 = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const cleanLogin = (v) => String(v || '').trim().toLowerCase().replace(/[^a-z0-9._@-]/g, '').slice(0, 80);
const onlineAgent = (agents) => agents.find((a) => !a.revoked_at && a.last_seen_at && Date.now() - new Date(a.last_seen_at).getTime() < AGENT_ONLINE_MS);

// --------------------------------------------------------------- Agente (antes do login: autentica pela chave)
export function registerBeedooAgent(router, { h }) {
  const agentOf = async (req) => {
    const key = String(req.headers['x-px-agent'] || '').trim();
    if (!/^pxb_[a-f0-9]{48}$/.test(key)) throw httpError(401, 'Chave do agente inválida.');
    const ag = await must(sb().from('px_beedoo_agents').select('*').eq('key_hash', await sha256(key)).maybeSingle());
    if (!ag || ag.revoked_at) throw httpError(401, 'Chave do agente revogada ou inválida. Gere outra em Envios ao Beedoo.');
    await must(sb().from('px_beedoo_agents').update({ last_seen_at: nowIso(), name: String(req.headers['x-px-agent-name'] || ag.name || '').slice(0, 80) || null }).eq('id', ag.id));
    return ag;
  };
  router.post('/beedoo/agent/ping', h(async (req, res) => {
    const ag = await agentOf(req);
    const p = await must(sb().from('px_profiles').select('name, display_name').eq('id', ag.user_id).maybeSingle());
    res.json({ ok: true, user: p ? who(p) : null });
  }));
  // Próxima mensagem da fila de quem é dono da chave
  router.get('/beedoo/agent/next', h(async (req, res) => {
    const ag = await agentOf(req);
    // Envio que travou no meio (agente fechado): não reenvia sozinho, porque pode ter saído
    const stale = new Date(Date.now() - STALE_MS).toISOString();
    await sb().from('px_beedoo_messages').update({ status: 'erro', error: 'O envio foi interrompido. Confira no Beedoo se a mensagem chegou antes de tentar de novo.' })
      .eq('created_by', ag.user_id).eq('status', 'enviando').lt('claimed_at', stale);
    for (let i = 0; i < 3; i++) {
      const next = await must(sb().from('px_beedoo_messages').select('*').eq('created_by', ag.user_id).eq('status', 'pendente').order('id').limit(1));
      if (!next.length) return res.json({ message: null });
      const m = next[0];
      const got = await must(sb().from('px_beedoo_messages').update({ status: 'enviando', claimed_at: nowIso(), attempts: (m.attempts || 0) + 1, agent_id: ag.id, error: null })
        .eq('id', m.id).eq('status', 'pendente').select('id, login, operator_name, message, attachments, kind'));
      if (got.length) return res.json({ message: got[0] });
    }
    res.json({ message: null });
  }));
  router.post('/beedoo/agent/result', h(async (req, res) => {
    const ag = await agentOf(req);
    const b = req.body || {};
    const m = await must(sb().from('px_beedoo_messages').select('*').eq('id', Number(b.id)).eq('created_by', ag.user_id).maybeSingle());
    if (!m) throw httpError(404, 'Mensagem não encontrada.');
    const ok = b.ok === true;
    const error = ok ? (b.warning ? String(b.warning).slice(0, 500) : null) : String(b.error || 'Falha no envio.').slice(0, 500);
    await must(sb().from('px_beedoo_messages').update({ status: ok ? 'enviado' : 'erro', error, sent_at: ok ? nowIso() : null }).eq('id', m.id));
    await audit(ag.user_id, ok ? 'beedoo_enviado' : 'beedoo_erro', 'beedoo', m.id, { login: m.login, tipo: m.kind, erro: ok ? undefined : error });
    if (!ok) await notify([ag.user_id], 'Beedoo: mensagem não enviada', `${m.operator_name || m.login}: ${error}`, '#/beedoo');
    res.json({ ok: true });
  }));
}

// --------------------------------------------------------------- Rotas da plataforma (com login)
export function registerBeedoo(router, { h, QUALITY, ADMIN }) {
  const scoped = (q, req) => { const s = carteiraScope(req); if (!s) return q; const v = scopeValues(s); return v.length === 1 ? q.eq('portfolio', v[0]) : q.in('portfolio', v); };

  router.get('/beedoo/draft', QUALITY, h(async (req, res) => {
    const kind = String(req.query.kind || '');
    if (!KINDS.includes(kind)) throw httpError(400, 'Tipo de mensagem inválido.');
    const d = await draftFor(req, kind, req.query);
    const prev = await must(sb().from('px_beedoo_messages').select('id, status, created_at, sent_at').eq('kind', kind).eq('source_id', d.source_id).neq('status', 'cancelado').order('id', { ascending: false }).limit(5));
    const agents = await must(sb().from('px_beedoo_agents').select('id, last_seen_at, revoked_at').eq('user_id', req.user.id));
    res.json({ ...d, message: render(template(kind), d.vals), previous: prev, agent_online: !!onlineAgent(agents), has_agent: agents.some((a) => !a.revoked_at) });
  }));

  // Confirmado na revisão: entra na fila do agente (ou fica registrado como enviado à mão)
  router.post('/beedoo/messages', QUALITY, h(async (req, res) => {
    const b = req.body || {};
    const kind = KINDS.includes(b.kind) ? b.kind : 'acao';
    const message = String(b.message || '').replace(/\r\n/g, '\n').trim();
    const login = cleanLogin(b.login);
    if (!login) throw httpError(400, 'Informe o login do operador no Beedoo.');
    if (message.length < 5) throw httpError(400, 'A mensagem está vazia.');
    if (message.length > 6000) throw httpError(400, 'A mensagem passou de 6.000 caracteres. Resuma antes de enviar.');
    let portfolio = 'PAN', operator_name = String(b.operator_name || '').slice(0, 160) || null;
    if (b.operator_id) {
      const op = await operatorOf(Number(b.operator_id));
      if (!op || !inScope(carteiraScope(req), op.portfolio)) throw httpError(404, 'Operador não encontrado.');
      portfolio = op.portfolio || 'PAN'; operator_name = op.name;
    } else { const s = carteiraScope(req); portfolio = s ? s[0] : 'PAN'; }
    const attachments = (Array.isArray(b.attachments) ? b.attachments : []).slice(0, 5)
      .map((a) => ({ type: a.type === 'audio' ? 'audio' : 'file', file: String(a.file || '').replace(/[\\/]/g, '').slice(0, 200), name: String(a.name || a.file || '').slice(0, 200) }))
      .filter((a) => a.file);
    const manual = b.mode === 'manual';
    const row = await must(sb().from('px_beedoo_messages').insert({
      portfolio, kind, source_id: b.source_id ? Number(b.source_id) : null, operator_id: b.operator_id ? Number(b.operator_id) : null, login, operator_name,
      message, attachments, status: manual ? 'manual' : 'pendente', sent_at: manual ? nowIso() : null, created_by: req.user.id,
    }).select().single());
    await audit(req.user.id, manual ? 'beedoo_manual' : 'beedoo_fila', 'beedoo', row.id, { login, tipo: kind, origem: row.source_id });
    res.json(row);
  }));

  router.get('/beedoo/messages', QUALITY, h(async (req, res) => {
    let q = scoped(sb().from('px_beedoo_messages').select('*'), req);
    if (req.query.status) q = q.eq('status', String(req.query.status));
    if (req.query.mine === '1' || req.user.role !== 'admin') q = q.eq('created_by', req.user.id);
    const rows = await must(q.order('id', { ascending: false }).limit(300));
    const agents = await must(sb().from('px_beedoo_agents').select('id, name, created_at, last_seen_at, revoked_at').eq('user_id', req.user.id).order('id', { ascending: false }));
    const live = onlineAgent(agents);
    res.json({ rows, agents: agents.filter((a) => !a.revoked_at), agent_online: !!live, agent_seen: agents.find((a) => !a.revoked_at)?.last_seen_at || null, agent_name: live?.name || null });
  }));

  const mine = async (req) => {
    const m = await must(sb().from('px_beedoo_messages').select('*').eq('id', Number(req.params.id)).maybeSingle());
    if (!m || (m.created_by !== req.user.id && req.user.role !== 'admin')) throw httpError(404, 'Mensagem não encontrada.');
    return m;
  };
  router.post('/beedoo/messages/:id/cancel', QUALITY, h(async (req, res) => {
    const m = await mine(req);
    if (!['pendente', 'erro'].includes(m.status)) throw httpError(400, 'Só dá para cancelar mensagem que ainda não saiu.');
    res.json(await must(sb().from('px_beedoo_messages').update({ status: 'cancelado' }).eq('id', m.id).select().single()));
  }));
  router.post('/beedoo/messages/:id/retry', QUALITY, h(async (req, res) => {
    const m = await mine(req);
    if (!['erro', 'cancelado'].includes(m.status)) throw httpError(400, 'Esta mensagem não está com erro.');
    const patch = { status: 'pendente', error: null, claimed_at: null };
    if (typeof req.body?.message === 'string' && req.body.message.trim().length >= 5) patch.message = req.body.message.trim().slice(0, 6000);
    res.json(await must(sb().from('px_beedoo_messages').update(patch).eq('id', m.id).select().single()));
  }));
  router.post('/beedoo/messages/:id/manual', QUALITY, h(async (req, res) => {
    const m = await mine(req);
    if (m.status === 'enviado') throw httpError(400, 'Esta mensagem já foi enviada.');
    res.json(await must(sb().from('px_beedoo_messages').update({ status: 'manual', sent_at: nowIso(), error: null }).eq('id', m.id).select().single()));
  }));

  // Chave do agente: cada pessoa gera a sua (só aparece uma vez; o banco guarda o hash)
  router.post('/beedoo/agent/key', QUALITY, h(async (req, res) => {
    const raw = `pxb_${[...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    await sb().from('px_beedoo_agents').update({ revoked_at: nowIso() }).eq('user_id', req.user.id).is('revoked_at', null);
    await must(sb().from('px_beedoo_agents').insert({ user_id: req.user.id, key_hash: await sha256(raw), name: 'PX Beedoo' }));
    await audit(req.user.id, 'beedoo_chave', 'beedoo', null, {});
    res.json({ key: raw });
  }));

  router.get('/beedoo/templates', QUALITY, h(async (_req, res) => {
    res.json(Object.fromEntries(KINDS.map((k) => [k, { text: template(k), custom: !!getSetting(`beedoo_tpl:${k}`), fields: FIELDS[k], default: DEFAULT_TEMPLATES[k] }])));
  }));
  router.put('/beedoo/templates/:kind', ADMIN, h(async (req, res) => {
    const k = req.params.kind;
    if (!KINDS.includes(k)) throw httpError(400, 'Tipo de mensagem inválido.');
    const t = String(req.body?.text || '').replace(/\r\n/g, '\n').trim();
    await setSetting(`beedoo_tpl:${k}`, t && t !== DEFAULT_TEMPLATES[k] ? t.slice(0, 4000) : null);
    await audit(req.user.id, 'beedoo_modelo', 'beedoo', null, { tipo: k });
    res.json({ ok: true, text: template(k) });
  }));
}

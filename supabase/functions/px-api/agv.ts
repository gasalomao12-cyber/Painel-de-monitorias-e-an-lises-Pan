// @ts-nocheck — divisão AGV: relatório do speech "PAN TESTE DE PERGUNTAS AGV" (.xlsx lido no navegador)
// e os dados enxutos que a tela de comparativos usa.
// Cada linha do relatório é a avaliação de uma ligação (o id vem do nome do áudio). A resposta crua do
// speech fica como "speech"; o resultado final passa pelas regras de coerência de N/A antes de entrar.
import { admin, must } from './supa.ts';
import { computeScore } from './scoring.ts';
import { cycleFor } from './discador.ts';

const sb = () => admin();
const httpError = (status, message) => Object.assign(new Error(message), { status });
const nowIso = () => new Date().toISOString();
const clip = (s, n) => (s == null || String(s).trim() === '' ? null : String(s).trim().slice(0, n));

export const AGV_CODES = ['APR', 'ATR', 'SMO', 'SQQ', 'PRP', 'ALT', 'BEN', 'CSQ', 'CFA'];
const NEGOTIATION = ['SMO', 'SQQ', 'PRP', 'ALT', 'BEN', 'CSQ', 'CFA'];
export const OUTCOMES = {
  'ACORDO COM BOLETO': 'Acordo com boleto', 'PROMESSA SEM BOLETO': 'Promessa sem boleto', 'RETORNO COMBINADO': 'Retorno combinado',
  'SEM ACORDO': 'Sem acordo', NA: 'Sem negociação com o titular', 'NAO AVALIAVEL': 'Final cortado',
};
const plain = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
// SIM / NÃO / NA / NÃO AVALIÁVEL / AMEAÇA (consequência dita como intimidação)
function answer(v) {
  const p = plain(v);
  if (!p) return null;
  if (p === 'N/A' || p === 'NA' || p === 'NAO SE APLICA') return 'NA';
  if (p.startsWith('NAO AVALI')) return 'NAO AVALIAVEL';
  if (p.startsWith('AMEACA')) return 'AMEACA';
  if (p === 'SIM') return 'SIM';
  if (p === 'NAO') return 'NAO';
  return p;
}
const RESULT = { SIM: 'C', NAO: 'NC', AMEACA: 'NC', NA: 'NA', 'NAO AVALIAVEL': 'NA' };
// Quem atendeu não era o titular (recado, familiar, terceiro): nada da negociação se aplica
const THIRD_PARTY = /recado|outra pessoa (?:que )?atendeu|terceiro|n[ãa]o (?:é|era|seria) (?:o|a) (?:pr[óo]pri[oa] )?(?:titular|cliente)|quem atendeu (?:foi|era) (?:a|o) |(?:esposa|marido|filh[oa]|m[ãa]e|pai|irm[ãa]o?) d[oa] (?:titular|cliente)/i;

// Regras de coerência do próprio roteiro (as mesmas da análise de acurácia do speech)
export function coherent(a, summaries = '') {
  const out = {}, why = {};
  for (const c of AGV_CODES) out[c] = RESULT[a[c]] ?? null;
  const set = (codes, value, reason) => { for (const c of codes) if (out[c] && out[c] !== value) { out[c] = value; why[c] = reason; } };
  const thirdParty = THIRD_PARTY.test(summaries);
  if (thirdParty) set(['ATR', ...NEGOTIATION], 'NA', 'Quem atendeu não era o titular: sem negociação, não se aplica');
  else if (a.DESF === 'NA') set(NEGOTIATION, 'NA', 'Sem negociação com o titular: não se aplica');
  else {
    if (a.DESF !== 'ACORDO COM BOLETO') set(['CFA'], 'NA', 'Não houve acordo com boleto: confirmação não se aplica');
    if (a.DESF === 'ACORDO COM BOLETO') {
      set(['CSQ'], 'NA', 'Houve acordo: consequências não se aplicam');
      if (out.PRP === 'NC') { out.PRP = 'C'; why.PRP = 'Acordo com boleto pressupõe proposta com valor'; }
    }
    if (out.PRP && out.PRP !== 'C') set(['ALT'], 'NA', 'Sem proposta feita: outra condição não se aplica');
  }
  return { result: out, why, thirdParty };
}

export async function importSpeechAgv({ rows }, userId) {
  if (!Array.isArray(rows) || !rows.length) throw httpError(400, 'Nenhuma avaliação recebida.');
  if (rows.length > 500) throw httpError(400, 'Envie no máximo 500 avaliações por vez.');
  // A mesma ligação pode ter sido avaliada mais de uma vez: vale a avaliação mais recente
  const latest = new Map();
  for (const r of rows) {
    const id = clip(r.call_id, 40);
    if (!id) continue;
    const at = clip(r.at, 30) || '';
    if (!latest.has(id) || at >= (latest.get(id).at || '')) latest.set(id, { ...r, call_id: id, at });
  }
  const ids = [...latest.keys()];
  if (!ids.length) throw httpError(400, 'As linhas não têm o id da ligação (no nome do áudio).');

  const found = new Map();
  for (const col of ['external_id', 'protocol']) {
    const evs = await must(sb().from('px_evaluations').select('id, external_id, protocol, channel, details, alerts, speech_summary, outcome, audio_file').in(col, ids));
    for (const e of evs) if (!found.has(String(e[col])) || e.channel === 'AGV') found.set(String(e[col]), e);
  }
  const evIds = [...new Set([...found.values()].map((e) => e.id))];
  const items = evIds.length ? await must(sb().from('px_evaluation_items').select('id, evaluation_id, criterion_id, speech_result, final_result, adjust_source').in('evaluation_id', evIds)) : [];
  const crit = await must(sb().from('px_criteria').select('id, code, product, weight, critical').eq('active', true));
  const agvCrit = crit.filter((c) => c.product === 'AGV');
  if (agvCrit.length < AGV_CODES.length) throw httpError(400, 'O roteiro AGV ainda não existe no banco. Rode a migração 20261029120000_px_agv.sql no Supabase.');
  const critById = new Map(crit.map((c) => [c.id, c]));

  const out = { updated: 0, unchanged: 0, unmatched: [], skipped: [], corrected: 0, rules: {} };
  for (const [id, r] of latest) {
    const ev = found.get(id);
    if (!ev) { out.unmatched.push(id); continue; }
    const prev = ev.details?.speech_agv;
    if (prev && prev.at && r.at && prev.at > r.at) { out.unchanged++; continue; }
    // Ligação já revisada num dashboard AGV: a leitura revisada vale mais que a resposta crua do speech
    if (ev.details?.agv_source) { out.skipped.push({ id, reason: 'já revisada no dashboard AGV' }); continue; }
    let its = items.filter((i) => i.evaluation_id === ev.id);
    const isAgv = (i) => critById.get(i.criterion_id)?.product === 'AGV';
    if (!its.some(isAgv)) {
      // Atendimento já avaliado em outro roteiro (ex.: dashboard de Veículos): não mistura os dois
      if (its.some((i) => i.final_result || i.speech_result)) { out.skipped.push({ id, reason: 'já avaliada em outro roteiro' }); continue; }
      if (its.length) await must(sb().from('px_evaluation_items').delete().in('id', its.map((i) => i.id)));
      its = await must(sb().from('px_evaluation_items').insert(agvCrit.map((c) => ({ evaluation_id: ev.id, criterion_id: c.id }))).select('id, evaluation_id, criterion_id, speech_result, final_result, adjust_source'));
    }
    const a = Object.fromEntries([...AGV_CODES, 'DESF'].map((k) => [k, answer(r.answers?.[k])]));
    const summaries = ['ident', 'neg', 'fin'].map((k) => clip(r.summaries?.[k], 2000)).filter(Boolean);
    const { result, why, thirdParty } = coherent(a, summaries.join('\n'));
    const scored = [];
    for (const it of its) {
      const c = critById.get(it.criterion_id);
      if (!c || c.product !== 'AGV') continue;
      const raw = RESULT[a[c.code]] ?? null;
      const fin = result[c.code] ?? null;
      const corrected = !!why[c.code];
      if (corrected) { out.corrected++; out.rules[why[c.code]] = (out.rules[why[c.code]] || 0) + 1; }
      const note = a[c.code] === 'NAO AVALIAVEL' ? 'Speech: trecho cortado (não avaliável)' : a[c.code] === 'AMEACA' ? 'Speech: consequência dita como ameaça' : null;
      // O que a Qualidade já ajustou à mão continua valendo
      const patch = it.adjust_source === 'manual'
        ? { speech_result: raw, speech_note: note }
        : { speech_result: raw, speech_note: note, final_result: fin, adjusted: corrected, adjust_reason: corrected ? why[c.code] : null, adjust_source: corrected ? 'regra' : null, adjusted_by: null, adjusted_at: corrected ? nowIso() : null };
      await must(sb().from('px_evaluation_items').update(patch).eq('id', it.id));
      scored.push({ weight: c.weight, critical: c.critical, speech_result: raw, final_result: it.adjust_source === 'manual' ? it.final_result : fin });
    }
    const cut = Object.values(a).filter((v) => v === 'NAO AVALIAVEL').length >= 4;
    const alerts = new Set((ev.alerts || []).filter((x) => !['conduta', 'audio_ruim', 'sem_proposta'].includes(x) || !prev));
    if (a.CSQ === 'AMEACA') alerts.add('conduta');
    if (cut) alerts.add('audio_ruim');
    if (!thirdParty && a.DESF !== 'NA' && result.PRP === 'NC') alerts.add('sem_proposta');
    const outcome = thirdParty ? OUTCOMES.NA : OUTCOMES[a.DESF] || clip(r.answers?.DESF, 80);
    const details = ev.details || { facts: [] };
    const facts = (details.facts || []).filter(([k]) => !['Desfecho (speech)', 'Relatório do speech', 'Avaliada pelo speech em'].includes(k));
    facts.push(['Desfecho (speech)', outcome], ['Relatório do speech', clip(r.report, 120) || 'PAN TESTE DE PERGUNTAS AGV'], ['Avaliada pelo speech em', r.at ? `${r.at.slice(8, 10)}/${r.at.slice(5, 7)}/${r.at.slice(0, 4)} ${r.at.slice(11, 16)}`.trim() : '—']);
    const highlights = (details.highlights || []).filter((x) => x.kind !== 'speech_agv');
    const TITLES = { ident: 'Itens obrigatórios', neg: 'Etapas da negociação', fin: 'Benefícios, consequências e desfecho' };
    for (const k of ['ident', 'neg', 'fin']) { const t = clip(r.summaries?.[k], 2000); if (t) highlights.push({ kind: 'speech_agv', title: TITLES[k], text: t }); }
    await must(sb().from('px_evaluations').update({
      channel: 'AGV', outcome, alerts: [...alerts], updated_at: nowIso(),
      speech_score: computeScore(scored, 'speech_result').score, final_score: computeScore(scored, 'final_result').score,
      speech_summary: summaries.join('\n\n').slice(0, 6000) || ev.speech_summary || null,
      ...(r.file && !ev.audio_file ? { audio_file: clip(r.file, 300) } : {}),
      details: { ...details, facts, highlights, speech_agv: { audio_id: clip(r.audio_id, 40), at: r.at || null, file: clip(r.file, 300), imported_by: userId, imported_at: nowIso() } },
    }).eq('id', ev.id));
    out.updated++;
  }
  return out;
}

// ------------------------------------------------------------------ Dashboards AGV (.html com JSON embutido)
// Dois formatos:
//   • dash_agv      — "Teste do speech AGV" por gerência (Sem Garantia, Leves e Motos, Ativas): resposta do speech,
//                      resposta revisada, o porquê de cada correção, login, operador e líder
//   • dash_agv_cmp  — "Comparativo AGV" (ex.: Cartões 04/09 x 06/10): leitura da transcrição, item a item (1/0/null)
// A mesma ligação pode já existir (discador ou relatório do speech): ela é completada, nunca duplicada.
const GER_KEYS = { ident: 'APR', divida: 'ATR', sond: 'SMO', cap: 'SQQ', prop: 'PRP', alt: 'ALT', ben: 'BEN', cons: 'CSQ', conf: 'CFA' };
const CMP_KEYS = { ab: 'APR', div: 'ATR', sd: 'SMO', sv: 'SQQ', prop: 'PRP', alt: 'ALT', ben: 'BEN', cons: 'CSQ', conf: 'CFA' };
const GER_DESF = { ACORDO: OUTCOMES['ACORDO COM BOLETO'], PROMESSA: OUTCOMES['PROMESSA SEM BOLETO'], RETORNO: OUTCOMES['RETORNO COMBINADO'], SEM_ACORDO: OUTCOMES['SEM ACORDO'], NA: OUTCOMES.NA, NAV: OUTCOMES['NAO AVALIAVEL'] };
const CMP_DES = { 'ACORDO COM BOLETO OU PIX': OUTCOMES['ACORDO COM BOLETO'], 'PROMESSA SEM BOLETO': OUTCOMES['PROMESSA SEM BOLETO'], RECUSA: OUTCOMES['SEM ACORDO'], 'JA PAGOU': 'Já tinha pago', 'CAIU OU DESLIGOU': 'Caiu ou desligou', 'SEM NEGOCIACAO': OUTCOMES.NA };
const CMP_MOT = { 'DESEMPREGO OU SEM RENDA': 'Desemprego ou sem renda', 'SALARIO ATRASADO OU DATA DE RECEBIMENTO': 'Salário atrasado ou data de recebimento', 'DOENCA OU IMPREVISTO': 'Doença ou imprevisto', 'OUTRAS DIVIDAS': 'Outras dívidas', 'CARTAO USADO POR OUTRA PESSOA': 'Cartão usado por outra pessoa', 'JA PAGOU': 'Já pagou', 'NAO RECONHECE A DIVIDA': 'Não reconhece a dívida', 'ESQUECEU OU VAI PAGAR': 'Esqueceu ou vai pagar', 'NAO INFORMOU': 'Não informou o motivo', NA: 'Não se aplica' };
const CMP_OFS = { 'PAGAMENTO MINIMO': 'Pagamento mínimo', 'VALOR INTERMEDIARIO': 'Valor intermediário', 'FATURA OU PARCELA TOTAL': 'Fatura ou parcela total', 'PARCELAMENTO OU RENEGOCIACAO': 'Parcelamento ou renegociação', 'QUITACAO COM DESCONTO': 'Quitação com desconto' };
const CMP_ESF = { A: 'Negociação completa', M: 'Negociação parcial', B: 'Negociação fraca', Z: 'Sem nenhuma proposta' };
const QUEM = { CLIENTE: 'Titular', 'OUTRA PESSOA': 'Outra pessoa', NINGUEM: 'Ninguém (caiu ou mudo)' };
const EV_LABEL = { OK: 'Evidência completa', GENERICA: 'Evidência genérica', VAZIA: 'Sem evidência' };
const CMP_EVID = { IDENT: 'ab', MOTIVO: 'sd', SONDAGEM: 'sd', SOND_VALOR: 'sv', PROPOSTA: 'prop', OUTRA_OPCAO: 'alt', BENEFICIO: 'ben', CONSEQUENCIA: 'cons' };
const UNKNOWN_OP = 'Operador não identificado';
const SUMMARY_TITLES = ['Itens obrigatórios', 'Etapas da negociação', 'Benefícios, consequências e desfecho'];
const yesNo = (v) => (v === 1 ? 'Sim' : v === 0 ? 'Não' : null);
const productOfSeg = (seg) => (seg === 'CAR' ? 'CARTOES' : seg === 'CON' ? 'CONSIGNADO' : 'VEICULOS');

export function detectAgvKind(calls) {
  const c = (calls || []).find((x) => x && ((x.sp && x.fin) || (x.q && Object.keys(x.q).length))) || (calls || [])[0];
  if (!c) return null;
  if (c.sp && c.fin && 'ident' in c.sp) return 'dash_agv';
  if (c.day && c.q && ('sv' in c.q || 'conv' in c.q)) return 'dash_agv_cmp';
  return null;
}

// Ligação do dashboard → formato comum (itens no código do roteiro AGV)
function gerCall(c, meta) {
  const sp = c.sp || {}, fin = c.fin || {}, why = c.porque || {}, corr = new Set(c.corr || []), nv = new Set(c.nverif || []);
  const items = {};
  for (const [k, code] of Object.entries(GER_KEYS)) {
    const s = RESULT[answer(sp[k])] ?? null, f = RESULT[answer(fin[k])] ?? s;
    items[code] = {
      speech: s, final: f, reason: s !== f || corr.has(k) ? clip(why[k], 400) || 'Corrigido na revisão do dashboard AGV' : null,
      note: nv.has(k) ? 'Não deu para verificar pela evidência do speech' : null,
    };
  }
  const outcome = GER_DESF[fin.desf] || clip(fin.desf, 80);
  const alerts = [];
  if (c.ev === 'VAZIA') alerts.push('sem_speech');
  if (fin.desf !== 'NA' && fin.desf !== 'NAV' && items.PRP.final === 'NC') alerts.push('sem_proposta');
  const highlights = (c.pv || []).map((t, i) => (t ? { kind: 'speech_agv', title: SUMMARY_TITLES[i] || 'Resumo do speech', text: clip(t, 2000) } : null)).filter(Boolean);
  if (c.ev && c.ev !== 'OK') highlights.push({ kind: c.ev === 'VAZIA' ? 'bad' : 'warn', title: EV_LABEL[c.ev], text: 'O resumo do speech não trouxe trecho suficiente: as respostas sem prova ficaram como o speech marcou.' });
  if (sp.desf && fin.desf && sp.desf !== fin.desf) highlights.push({ kind: 'info', title: 'Desfecho corrigido na revisão', text: `${GER_DESF[sp.desf] || sp.desf} → ${outcome}${why.desf ? ` — ${why.desf}` : ''}` });
  return {
    id: String(c.id), dt: String(c.dt || ''), dur: c.dur, login: String(c.login || '').trim().toLowerCase(), name: clip(c.op, 160),
    leader: clip(c.lid, 160), registration: null, team: clip(meta?.curto, 80), manager: clip(meta?.nome, 80), product: productOfSeg(c.seg),
    campaign: clip(c.camp, 120), tabulation: clip(c.tab, 120), audio_file: clip(c.arq, 300), customer: clip(c.cli, 160),
    items, outcome, effort: null, alerts, highlights,
    summary: (c.pv || []).filter(Boolean).join('\n\n').slice(0, 6000) || null, transcript: null, ai_summary: null,
    facts: [['Gerência', meta?.nome ? `${meta.nome}${meta.curto ? ` · ${meta.curto}` : ''}` : null], ['Tabulação', c.tab], ['Campanha', c.camp], ['Canal', 'AGV (agente virtual)'],
      ['Desconexão', c.desc], ['Desfecho', outcome], ['Esforço negocial', c.esf != null ? `${c.esf}%` : null], ['Evidência do speech', EV_LABEL[c.ev] || c.ev]],
  };
}

function cmpCall(c, meta) {
  const q = c.q || {}, ev = c.ev || {};
  const talked = c.quem === 'CLIENTE' && Object.keys(q).length > 0;
  const items = {};
  for (const [k, code] of Object.entries(CMP_KEYS)) {
    const f = talked ? (q[k] === 1 ? 'C' : q[k] === 0 ? 'NC' : 'NA') : 'NA';
    items[code] = { speech: f, final: f, reason: null, note: null };
  }
  for (const [ek, k] of Object.entries(CMP_EVID)) {
    if (!ev[ek]) continue;
    const code = CMP_KEYS[k];
    items[code].note = clip([items[code].note, `${ek === 'MOTIVO' ? 'Cliente' : 'Trecho'}: “${ev[ek]}”`].filter(Boolean).join(' · '), 600);
  }
  const outcome = q.conv === 1 ? OUTCOMES['ACORDO COM BOLETO'] : !talked ? (c.quem === 'NINGUEM' ? 'Caiu ou desligou' : OUTCOMES.NA) : CMP_DES[c.des] || clip(c.des, 80);
  const sigilo = (c.al || []).filter((a) => a[0] === 'sig').map((a) => a[1]);
  if (ev.SIGILO) sigilo.push(ev.SIGILO);
  const alerts = [];
  if (sigilo.length) alerts.push('sigilo');
  if (c.esf === 'Z') alerts.push('sem_proposta');
  const highlights = [];
  if (sigilo.length) highlights.push({ kind: 'bad', title: 'Dados passados a outra pessoa (sigilo)', text: [...new Set(sigilo)].join(' · ') });
  const period = meta?.periods?.[c.day] || c.day;
  return {
    id: String(c.id), dt: String(c.dt || ''), dur: c.dur, login: String(c.log || '').trim().toLowerCase(), name: c.log ? clip(c.op, 160) : null,
    leader: null, registration: clip(c.nc, 40), team: 'PAN Sem Garantia', manager: null, product: 'CARTOES',
    campaign: null, tabulation: null, audio_file: clip(c.arq, 300), customer: clip(c.cli, 160),
    items, outcome, effort: CMP_ESF[c.esf] ? c.esf : null, alerts, highlights,
    summary: clip(c.res, 2000), transcript: c.txt ? String(c.txt).slice(0, 400000) : null,
    ai_summary: c.res || c.pf || c.fb ? { engine: 'dashboard', summary: c.res || '', feedback: { strengths: c.pf || '', improvements: c.fb || '', action_plan: '' } } : null,
    facts: [['Comparativo', meta?.title || null], ['Período do comparativo', period ? `${c.day} · ${period}` : null], ['Canal', 'AGV (agente virtual)'], ['Quem atendeu', QUEM[c.quem] || c.quem],
      ['Desfecho', outcome], ['Motivo do atraso', CMP_MOT[c.mot] || c.mot], ['Ofertas feitas', (c.ofs || []).map((o) => CMP_OFS[o] || o).join(', ') || null],
      ['Esforço negocial', CMP_ESF[c.esf] || null], ['Confirmou o CPF', yesNo(q.cpf)], ['Atualizou o cadastro', yesNo(q.cad)], ['Não pediu os dados de novo após o bot', yesNo(q.rep)],
      ['Nome que o operador disse', c.opn && !/^nao informado$/i.test(c.opn) ? c.opn : null]],
  };
}

async function resolveAgvOperators(calls) {
  const ops = await must(sb().from('px_operators').select('*'));
  const supervisors = await must(sb().from('px_profiles').select('id, name').eq('role', 'supervisor').eq('active', true));
  const norm = (s) => plain(s).toLowerCase();
  const supByName = new Map(supervisors.map((s) => [norm(s.name), s.id]));
  const byLogin = new Map(ops.filter((o) => o.login).map((o) => [o.login.toLowerCase(), o]));
  const byName = new Map(ops.map((o) => [norm(o.name), o]));
  const out = new Map();
  let created = 0;
  for (const c of calls) {
    const key = c.login || (c.name ? `nome:${norm(c.name)}` : 'nenhum');
    if (out.has(key)) continue;
    let op = (c.login && byLogin.get(c.login)) || (c.name ? byName.get(norm(c.name)) : null) || (!c.login && !c.name ? byName.get(norm(UNKNOWN_OP)) : null);
    const fields = {};
    if (c.login) fields.login = c.login;
    if (c.leader && !/^sem lideran/i.test(c.leader)) { fields.supervisor_name = c.leader; const sup = supByName.get(norm(c.leader)); if (sup) fields.supervisor_user_id = sup; }
    if (c.team) fields.team = c.team;
    if (c.manager) fields.manager_name = c.manager;
    if (c.registration) fields.registration = c.registration;
    if (op) {
      // Completa o cadastro (operador criado pelo discador fica com o login como nome até aqui)
      const changes = Object.fromEntries(Object.entries(fields).filter(([k, v]) => v && !op[k]));
      if (c.name && (op.name === op.login || !op.name)) changes.name = c.name;
      if (Object.keys(changes).length) op = await must(sb().from('px_operators').update(changes).eq('id', op.id).select().single());
    } else {
      op = await must(sb().from('px_operators').insert({ name: c.name || c.login || UNKNOWN_OP, ...fields }).select().single());
      created++;
      if (op.login) byLogin.set(op.login.toLowerCase(), op);
      byName.set(norm(op.name), op);
    }
    out.set(key, op.id);
  }
  return { opOf: (c) => out.get(c.login || (c.name ? `nome:${norm(c.name)}` : 'nenhum')), created };
}

export async function importAgvDashboard({ kind, calls, meta, cycle_id, filename }, userId) {
  if (!['dash_agv', 'dash_agv_cmp'].includes(kind)) throw httpError(400, 'Formato de dashboard AGV não reconhecido.');
  if (!Array.isArray(calls) || !calls.length) throw httpError(400, 'Nenhuma ligação recebida.');
  if (calls.length > 200) throw httpError(400, 'Envie no máximo 200 ligações por vez.');
  const list = calls.filter((c) => c && c.id).map((c) => (kind === 'dash_agv' ? gerCall(c, meta) : cmpCall(c, meta)));
  const crit = await must(sb().from('px_criteria').select('id, code, product, weight, critical').eq('active', true));
  const agvCrit = crit.filter((c) => c.product === 'AGV');
  if (agvCrit.length < AGV_CODES.length) throw httpError(400, 'O roteiro AGV ainda não existe no banco. Rode a migração 20261029120000_px_agv.sql no Supabase.');
  const critById = new Map(crit.map((c) => [c.id, c]));
  const ids = [...new Set(list.map((c) => c.id))];
  const found = new Map();
  for (const col of ['external_id', 'protocol']) {
    const evs = await must(sb().from('px_evaluations').select('*').in(col, ids));
    for (const e of evs) if (!found.has(String(e[col])) || e.channel === 'AGV') found.set(String(e[col]), e);
  }
  const evIds = [...new Set([...found.values()].map((e) => e.id))];
  const items = evIds.length ? await must(sb().from('px_evaluation_items').select('id, evaluation_id, criterion_id, speech_result, final_result, adjust_source').in('evaluation_id', evIds)) : [];
  const { opOf, created: opsCreated } = await resolveAgvOperators(list);
  const now = nowIso();
  const source = { kind, file: clip(filename, 200), at: now };
  const out = { kind, created: 0, updated: 0, skipped: [], operators_created: opsCreated, cycle_id: cycle_id || null };
  const cycles = new Map();
  const seen = new Set();
  const scoreOf = (its, field) => computeScore(its.map((it) => ({ ...critByCode(agvCrit, it.code), [field]: it[field] })), field).score;

  for (const c of list) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const date = /^\d{4}-\d{2}-\d{2}/.test(c.dt) ? c.dt.slice(0, 10) : null;
    const ex = found.get(c.id);
    const facts = c.facts.filter(([, v]) => v != null && v !== '');
    const audit = [];
    if (ex) {
      let its = items.filter((i) => i.evaluation_id === ex.id);
      const isAgv = (i) => critById.get(i.criterion_id)?.product === 'AGV';
      if (!its.some(isAgv)) {
        if (its.some((i) => i.final_result || i.speech_result)) { out.skipped.push({ id: c.id, reason: 'já avaliada em outro roteiro' }); continue; }
        if (its.length) await must(sb().from('px_evaluation_items').delete().in('id', its.map((i) => i.id)));
        its = await must(sb().from('px_evaluation_items').insert(agvCrit.map((k) => ({ evaluation_id: ex.id, criterion_id: k.id }))).select('id, evaluation_id, criterion_id, speech_result, final_result, adjust_source'));
      }
      const scored = [];
      for (const it of its) {
        const k = critById.get(it.criterion_id);
        if (!k || k.product !== 'AGV' || !c.items[k.code]) continue;
        const v = c.items[k.code];
        const adjusted = v.speech !== v.final;
        // O que a Qualidade ajustou à mão continua valendo
        const patch = it.adjust_source === 'manual'
          ? { speech_result: v.speech, speech_note: v.note }
          : { speech_result: v.speech, speech_note: v.note, final_result: v.final, adjusted, adjust_reason: adjusted ? v.reason : null, adjust_source: adjusted ? 'dashboard' : null, adjusted_by: null, adjusted_at: adjusted ? now : null };
        await must(sb().from('px_evaluation_items').update(patch).eq('id', it.id));
        scored.push({ code: k.code, speech_result: v.speech, final_result: it.adjust_source === 'manual' ? it.final_result : v.final });
      }
      const old = ex.details || {};
      const keys = new Set(facts.map(([k]) => k));
      const details = {
        ...old, origem: old.origem || `Dashboard AGV`,
        facts: [...(old.facts || []).filter(([k]) => !keys.has(k)), ...facts],
        highlights: [...(old.highlights || []).filter((h) => h.kind !== 'speech_agv' || !c.highlights.some((x) => x.kind === 'speech_agv')), ...c.highlights.filter((h) => !(old.highlights || []).some((o) => o.title === h.title && o.text === h.text))],
        agv_source: source,
      };
      const fill = (field, v) => (ex[field] == null || ex[field] === '' ? (v ?? undefined) : undefined);
      const patch = {
        channel: 'AGV', outcome: c.outcome || ex.outcome, alerts: [...new Set([...(ex.alerts || []), ...c.alerts])], details, updated_at: now,
        speech_score: scoreOf(scored, 'speech_result'), final_score: scoreOf(scored, 'final_result'),
        status: ex.status === 'pendente' ? 'revisada' : ex.status, reviewed_by: ex.reviewed_by || userId, reviewed_at: ex.reviewed_at || now,
        tabulation: fill('tabulation', c.tabulation), campaign: fill('campaign', c.campaign), audio_file: fill('audio_file', c.audio_file),
        duration_sec: fill('duration_sec', Number.isFinite(Number(c.dur)) && Number(c.dur) > 0 ? Math.round(Number(c.dur)) : null),
        customer: fill('customer', c.customer), speech_summary: c.summary || ex.speech_summary, effort: c.effort || ex.effort,
        transcript: fill('transcript', c.transcript), transcript_name: c.transcript && !ex.transcript ? `transcricao-${c.id}.txt` : undefined,
        ai_summary: fill('ai_summary', c.ai_summary),
      };
      // Operador do discador sem nome completo: assume o do dashboard
      const opId = opOf(c);
      if (opId && opId !== ex.operator_id && (c.login || c.name)) patch.operator_id = opId;
      await must(sb().from('px_evaluations').update(Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))).eq('id', ex.id));
      out.updated++;
      continue;
    }
    if (!date) { out.skipped.push({ id: c.id, reason: 'sem data da ligação' }); continue; }
    const its = Object.entries(c.items).map(([code, v]) => ({ code, speech_result: v.speech, final_result: v.final }));
    const cyc = cycle_id || await cycleFor(date, cycles);
    const row = await must(sb().from('px_evaluations').insert({
      cycle_id: cyc, operator_id: opOf(c), product: c.product, segment: null, channel: 'AGV', source: kind, external_id: c.id, protocol: c.id,
      call_date: date, call_time: c.dt.slice(11, 16) || null, duration_sec: Number.isFinite(Number(c.dur)) && Number(c.dur) > 0 ? Math.round(Number(c.dur)) : null,
      customer: c.customer, audio_file: c.audio_file, campaign: c.campaign, tabulation: c.tabulation, outcome: c.outcome, effort: c.effort,
      speech_score: scoreOf(its, 'speech_result'), final_score: scoreOf(its, 'final_result'), alerts: c.alerts,
      speech_summary: c.summary, transcript: c.transcript, transcript_name: c.transcript ? `transcricao-${c.id}.txt` : null, ai_summary: c.ai_summary,
      status: 'revisada', reviewed_by: userId, reviewed_at: now, created_by: userId,
      details: { origem: kind === 'dash_agv' ? 'Dashboard AGV (teste do speech)' : 'Dashboard comparativo AGV', facts, highlights: c.highlights, agv_source: source },
    }).select('id').single());
    try {
      await must(sb().from('px_evaluation_items').insert(agvCrit.map((k) => {
        const v = c.items[k.code] || { speech: null, final: null };
        const adjusted = v.speech !== v.final;
        return { evaluation_id: row.id, criterion_id: k.id, speech_result: v.speech, speech_note: v.note || null, final_result: v.final, adjusted, adjust_reason: adjusted ? v.reason : null, adjust_source: adjusted ? 'dashboard' : null, adjusted_at: adjusted ? now : null };
      })));
    } catch (e) { await sb().from('px_evaluations').delete().eq('id', row.id); throw e; }
    out.created++;
    if (!out.cycle_id) out.cycle_id = cyc;
  }
  return out;
}
const critByCode = (list, code) => list.find((c) => c.code === code) || {};

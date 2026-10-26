// @ts-nocheck — divisão AGV: relatório do speech "PAN TESTE DE PERGUNTAS AGV" (.xlsx lido no navegador)
// e os dados enxutos que a tela de comparativos usa.
// Cada linha do relatório é a avaliação de uma ligação (o id vem do nome do áudio). A resposta crua do
// speech fica como "speech"; o resultado final passa pelas regras de coerência de N/A antes de entrar.
import { admin, must } from './supa.ts';
import { computeScore } from './scoring.ts';

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

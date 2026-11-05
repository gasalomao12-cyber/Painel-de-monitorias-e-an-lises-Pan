// @ts-nocheck — Análise manual AGV: a analista escolhe a ligação (ou digita os dados), marca o roteiro AGV
// critério a critério e salva. O CSV de metadados do Mosaic é opcional e só pré-preenche os campos no navegador.
import { admin, must } from './supa.ts';
import { computeScore } from './scoring.ts';
import { cycleFor } from './discador.ts';
import { carteiraFor } from './safra.ts';

const sb = () => admin();
const httpError = (status, message) => Object.assign(new Error(message), { status });
const clip = (s, n) => (s == null || String(s).trim() === '' ? null : String(s).trim().slice(0, n));
const RESULTS = ['C', 'P', 'NC', 'NA'];
const ROTEIROS = { AGV2: 'Esforço negocial', AGV: 'Perguntas do speech' };
const OUTCOMES = ['Acordo com boleto', 'Promessa sem boleto', 'Retorno combinado', 'Sem acordo', 'Sem negociação com o titular', 'Final cortado'];
const EFFORT = (s) => (s == null ? null : s >= 85 ? 'A' : s >= 65 ? 'M' : s >= 40 ? 'B' : 'Z');

// "00:02:32", "2:32" ou "152" → segundos
function seconds(v) {
  if (v == null || v === '') return null;
  if (/^\d+(\.\d+)?$/.test(String(v))) return Math.round(Number(v));
  const p = String(v).split(':').map(Number);
  if (p.some(Number.isNaN)) return null;
  return Math.round(p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]);
}
// "2026-11-05 14:32:10", "2026-11-05T14:32" ou "05/11/2026 14:32" → { date, time }
function when(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : null };
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) return { date: `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, time: m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : null };
  return { date: null, time: null };
}

export function registerAgvManual(router, { h, QUALITY, audit, PRODUCTS }) {
  router.post('/agv/manual', QUALITY, h(async (req, res) => {
    const b = req.body || {};
    const portfolio = carteiraFor(req, b.carteira);
    const roteiro = ROTEIROS[b.roteiro] ? b.roteiro : 'AGV2';
    const product = PRODUCTS.includes(b.product) ? b.product : null;
    if (!product) throw httpError(400, 'Escolha o produto da ligação.');
    const login = clip(b.login, 60)?.toLowerCase();
    if (!login) throw httpError(400, 'Informe o login do operador.');
    const c = b.call || {};
    const { date, time } = when(c.datetime);
    if (!date) throw httpError(400, 'Informe a data da ligação.');
    const callId = clip(c.id, 40);

    // A mesma ligação não entra duas vezes
    if (callId) {
      const dup = await must(sb().from('px_evaluations').select('id').or(`external_id.eq.${callId.replace(/[^\w.-]/g, '')},protocol.eq.${callId.replace(/[^\w.-]/g, '')}`).limit(1));
      if (dup.length) throw Object.assign(httpError(409, `A ligação ${callId} já está na plataforma (atendimento #${dup[0].id}). Abra o atendimento para revisar.`), { code: 'DUPLICATE' });
    }

    // Operador pelo login, na carteira da análise (cria se ainda não existir)
    let op = (await must(sb().from('px_operators').select('id, name').eq('portfolio', portfolio).ilike('login', login).limit(1)))[0];
    let created = false;
    if (!op) {
      op = await must(sb().from('px_operators').insert({ name: clip(b.operator_name, 160) || login, login, portfolio }).select('id, name').single());
      created = true;
    }

    // Roteiro AGV marcado critério a critério
    const crit = await must(sb().from('px_criteria').select('id, code, name, weight, critical').eq('product', roteiro).eq('active', true).order('sort'));
    if (!crit.length) throw httpError(400, 'O roteiro AGV não tem critérios ativos.');
    const given = new Map((Array.isArray(b.items) ? b.items : []).map((i) => [String(i.code), i]));
    const items = crit.map((cr) => {
      const g = given.get(cr.code) || {};
      const r = RESULTS.includes(g.result) ? g.result : null;
      return { ...cr, final_result: r, speech_result: r, note: clip(g.note, 500) };
    });
    if (!items.some((i) => i.final_result)) throw httpError(400, 'Marque ao menos um critério do roteiro.');
    const { score } = computeScore(items, 'final_result');
    const outcome = OUTCOMES.includes(b.outcome) ? b.outcome : clip(b.outcome, 60);
    const analysis = clip(b.analysis, 60) || `Manual ${date.slice(8, 10)}/${date.slice(5, 7)}`;
    const now = new Date().toISOString();
    const facts = [['Origem', 'Análise manual AGV'], ['Roteiro', ROTEIROS[roteiro]], ['Campanha', clip(c.campaign, 120)], ['Tabulação', clip(c.tabulation, 120)],
      ['Desconexão', clip(c.disconnect, 40)], ['Login', login], ['Duração', clip(c.duration, 12)]].filter(([, v]) => v);

    const ev = await must(sb().from('px_evaluations').insert({
      cycle_id: await cycleFor(date, new Map()), operator_id: op.id, product, segment: clip(b.segment, 40), channel: 'AGV', source: 'manual_agv',
      external_id: callId, protocol: callId, call_date: date, call_time: time, customer: clip(c.customer, 160), contract: clip(c.contract, 80),
      duration_sec: seconds(c.duration), campaign: clip(c.campaign, 120), tabulation: clip(c.tabulation, 120), outcome,
      audio_file: clip(c.audio_file, 300), effort: roteiro === 'AGV2' ? EFFORT(score) : null,
      speech_score: score, final_score: score, speech_summary: clip(b.summary, 4000),
      status: 'revisada', reviewed_by: req.user.id, reviewed_at: now, created_by: req.user.id, alerts: [],
      details: {
        origem: 'Análise manual AGV', facts, agv_source: { kind: 'manual', mosaic: !!b.from_csv },
        esforco: { periodo: analysis }, desconexao: clip(c.disconnect, 40),
        highlights: items.filter((i) => i.final_result === 'NC').slice(0, 4).map((i) => [i.name, i.note || 'Não conforme na análise manual.']),
      },
    }).select('id').single());
    try {
      await must(sb().from('px_evaluation_items').insert(items.map((i) => ({
        evaluation_id: ev.id, criterion_id: i.id, speech_result: i.final_result, final_result: i.final_result, speech_note: i.note, adjusted: false,
      }))));
    } catch (e) {
      await sb().from('px_evaluations').delete().eq('id', ev.id);
      throw e;
    }
    await audit(req.user.id, 'analise_agv_manual', 'evaluation', ev.id, { ligacao: callId, login, roteiro, analise: analysis, carteira: portfolio, operador_criado: created });
    res.json({ id: ev.id, score, operator_created: created, analysis, portfolio });
  }));
}

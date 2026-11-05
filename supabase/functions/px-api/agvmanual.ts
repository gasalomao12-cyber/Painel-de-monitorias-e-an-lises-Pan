// @ts-nocheck — Análise manual AGV: a analista escolhe a ligação (ou digita os dados), marca o roteiro AGV
// critério a critério e salva. O CSV de metadados do Mosaic é opcional e só pré-preenche os campos no navegador.
// A análise salva pode ser aberta de novo e editada, e recebe o áudio da ligação (bucket privado, link assinado).
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
const BUCKET = 'px-quedas'; // bucket privado de áudios da plataforma (o mesmo da força-tarefa de queda), pasta avaliacoes/
const MAX_AUDIO = 50 * 1024 * 1024;
const safeId = (v) => String(v).replace(/[^\w.-]/g, '');
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

// "2026-11-05" + "08:05" → "2026-11-05T08:05" (campo de data e hora da tela)
const localDT = (d, t) => (d ? `${d}T${String(t || '00:00').slice(0, 5)}` : '');
const fmtDur = (s) => (s == null ? '' : s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`);

export function registerAgvManual(router, { h, QUALITY, audit, PRODUCTS, scoped, assertEvalAccess }) {
  // Monta a análise a partir do que veio da tela (nova ou edição)
  async function build(req, b, editId) {
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
      let q = sb().from('px_evaluations').select('id').or(`external_id.eq.${safeId(callId)},protocol.eq.${safeId(callId)}`).limit(2);
      if (editId) q = q.neq('id', editId);
      const dup = await must(q);
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
    const facts = [['Origem', 'Análise manual AGV'], ['Roteiro', ROTEIROS[roteiro]], ['Campanha', clip(c.campaign, 120)], ['Tabulação', clip(c.tabulation, 120)],
      ['Desconexão', clip(c.disconnect, 40)], ['Login', login], ['Duração', clip(c.duration, 12)]].filter(([, v]) => v);
    const row = {
      cycle_id: await cycleFor(date, new Map()), operator_id: op.id, product, segment: clip(b.segment, 40), channel: 'AGV', source: 'manual_agv',
      external_id: callId, protocol: callId, call_date: date, call_time: time, customer: clip(c.customer, 160), contract: clip(c.contract, 80),
      duration_sec: seconds(c.duration), campaign: clip(c.campaign, 120), tabulation: clip(c.tabulation, 120), outcome,
      audio_file: clip(c.audio_file, 300), effort: roteiro === 'AGV2' ? EFFORT(score) : null,
      speech_score: score, final_score: score, speech_summary: clip(b.summary, 4000),
    };
    const details = {
      origem: 'Análise manual AGV', facts, agv_source: { kind: 'manual', mosaic: !!b.from_csv },
      esforco: { periodo: analysis }, desconexao: clip(c.disconnect, 40),
      highlights: items.filter((i) => i.final_result === 'NC').slice(0, 4).map((i) => [i.name, i.note || 'Não conforme na análise manual.']),
      manual: { roteiro },
    };
    return { portfolio, roteiro, login, callId, score, analysis, created, items, row, details };
  }
  const itemRows = (evId, items) => items.map((i) => ({ evaluation_id: evId, criterion_id: i.id, speech_result: i.final_result, final_result: i.final_result, speech_note: i.note, adjusted: false }));

  router.post('/agv/manual', QUALITY, h(async (req, res) => {
    const x = await build(req, req.body || {}, null);
    const now = new Date().toISOString();
    const ev = await must(sb().from('px_evaluations').insert({
      ...x.row, status: 'revisada', reviewed_by: req.user.id, reviewed_at: now, created_by: req.user.id, alerts: [], details: x.details,
    }).select('id').single());
    try {
      await must(sb().from('px_evaluation_items').insert(itemRows(ev.id, x.items)));
    } catch (e) {
      await sb().from('px_evaluations').delete().eq('id', ev.id);
      throw e;
    }
    await audit(req.user.id, 'analise_agv_manual', 'evaluation', ev.id, { ligacao: x.callId, login: x.login, roteiro: x.roteiro, analise: x.analysis, carteira: x.portfolio, operador_criado: x.created });
    res.json({ id: ev.id, score: x.score, operator_created: x.created, analysis: x.analysis, portfolio: x.portfolio });
  }));

  // Análises manuais recentes, para abrir de novo e editar
  router.get('/agv/manual', QUALITY, h(async (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const mine = await must(sb().from('px_evaluations').select('id, protocol, call_date, final_score, created_at, details').eq('source', 'manual_agv').order('created_at', { ascending: false }).limit(400));
    if (!mine.length) return res.json([]);
    const vis = new Map((await must(scoped(sb().from('px_v_eval_cards').select('id, operator_name, login, status'), req).in('id', mine.map((m) => m.id)))).map((v) => [v.id, v]));
    const out = mine.filter((m) => vis.has(m.id)).map((m) => ({
      id: m.id, call_id: m.protocol, call_date: m.call_date, score: m.final_score, created_at: m.created_at,
      analysis: m.details?.esforco?.periodo || '', login: vis.get(m.id).login || '', operator: vis.get(m.id).operator_name || '', status: vis.get(m.id).status, audio: !!m.details?.audio_upload,
    })).filter((m) => !q || `${m.call_id || ''} ${m.login} ${m.operator} ${m.analysis}`.toLowerCase().includes(q));
    res.json(out.slice(0, 60));
  }));

  // Uma análise manual com tudo o que a tela precisa para editar
  router.get('/agv/manual/:id', QUALITY, h(async (req, res) => {
    const id = Number(req.params.id);
    await assertEvalAccess(req, id);
    const e = await must(sb().from('px_evaluations').select('*').eq('id', id).maybeSingle());
    if (!e || e.source !== 'manual_agv') throw httpError(404, 'Esta ligação não é uma análise manual AGV.');
    e.op = await must(sb().from('px_operators').select('login, name, portfolio').eq('id', e.operator_id).maybeSingle());
    const raw = await must(sb().from('px_evaluation_items').select('criterion_id, final_result, speech_note').eq('evaluation_id', id));
    const cmap = new Map(raw.length ? (await must(sb().from('px_criteria').select('id, code, product').in('id', raw.map((i) => i.criterion_id)))).map((c) => [c.id, c]) : []);
    const its = raw.map((i) => ({ ...i, crit: cmap.get(i.criterion_id) }));
    const roteiro = e.details?.manual?.roteiro || its.find((i) => i.crit?.product)?.crit.product || 'AGV2';
    res.json({
      id, carteira: e.op?.portfolio || null, login: e.op?.login || '', product: e.product, roteiro, outcome: e.outcome || '', analysis: e.details?.esforco?.periodo || '', summary: e.speech_summary || '',
      from_csv: !!e.details?.agv_source?.mosaic, status: e.status,
      call: { id: e.protocol || e.external_id || '', datetime: localDT(e.call_date, e.call_time), duration: fmtDur(e.duration_sec), campaign: e.campaign || '', tabulation: e.tabulation || '',
        disconnect: e.details?.desconexao || '', customer: e.customer || '', contract: e.contract || '', audio_file: e.audio_file || '' },
      items: its.filter((i) => i.crit?.code).map((i) => ({ code: i.crit.code, result: i.final_result, note: i.speech_note || '' })),
      audio: e.details?.audio_upload ? { name: e.details.audio_upload.name, size: e.details.audio_upload.size } : null,
    });
  }));

  // Editar: troca os dados e o roteiro marcado; feedback e contestação continuam ligados ao atendimento
  router.put('/agv/manual/:id', QUALITY, h(async (req, res) => {
    const id = Number(req.params.id);
    await assertEvalAccess(req, id);
    const cur = await must(sb().from('px_evaluations').select('id, source, details').eq('id', id).maybeSingle());
    if (!cur || cur.source !== 'manual_agv') throw httpError(404, 'Esta ligação não é uma análise manual AGV.');
    const x = await build(req, req.body || {}, id);
    const prevItems = await must(sb().from('px_evaluation_items').select('*').eq('evaluation_id', id));
    const keep = { ...(cur.details || {}) };
    await must(sb().from('px_evaluations').update({ ...x.row, details: { ...keep, ...x.details, agv_source: { ...(keep.agv_source || {}), ...x.details.agv_source }, edited_at: new Date().toISOString() }, updated_at: new Date().toISOString() }).eq('id', id));
    await must(sb().from('px_evaluation_items').delete().eq('evaluation_id', id));
    try {
      await must(sb().from('px_evaluation_items').insert(itemRows(id, x.items)));
    } catch (e) {
      // volta os critérios de antes se a gravação falhar
      if (prevItems.length) await sb().from('px_evaluation_items').insert(prevItems.map(({ id: _i, ...r }) => r));
      throw e;
    }
    await audit(req.user.id, 'analise_agv_manual_editada', 'evaluation', id, { ligacao: x.callId, login: x.login, roteiro: x.roteiro, analise: x.analysis, nota: x.score });
    res.json({ id, score: x.score, operator_created: x.created, analysis: x.analysis, portfolio: x.portfolio, edited: true });
  }));

  // Áudio da ligação: guardado no bucket privado; para ouvir, um link assinado de 10 minutos
  router.post('/evaluations/:id/audio-file', QUALITY, h(async (req, res) => {
    const id = Number(req.params.id);
    await assertEvalAccess(req, id);
    if (!req.raw?.byteLength) throw httpError(400, 'Arquivo de áudio vazio.');
    if (req.raw.byteLength > MAX_AUDIO) throw httpError(400, 'Áudio acima de 50 MB.');
    const cur = await must(sb().from('px_evaluations').select('id, details, audio_file').eq('id', id).maybeSingle());
    const orig = String(req.query.name || 'audio.wav').slice(0, 200);
    const name = orig.replace(/[^\w.\-]+/g, '_').slice(-120);
    const path = `avaliacoes/${id}/${Date.now()}-${name}`;
    const { error } = await sb().storage.from(BUCKET).upload(path, req.raw, { contentType: req.headers['content-type'] || 'audio/wav', upsert: false });
    if (error) throw httpError(500, `Não foi possível guardar o áudio: ${error.message}`);
    const prev = cur.details?.audio_upload?.path;
    if (prev) await sb().storage.from(BUCKET).remove([prev]).catch(() => {});
    const details = { ...(cur.details || {}), audio_upload: { path, name: orig, size: req.raw.byteLength, at: new Date().toISOString(), by: req.user.id } };
    await must(sb().from('px_evaluations').update({ details, ...(cur.audio_file ? {} : { audio_file: orig.slice(0, 300) }), updated_at: new Date().toISOString() }).eq('id', id));
    await audit(req.user.id, 'audio_anexado', 'evaluation', id, { arquivo: orig, tamanho: req.raw.byteLength });
    res.json({ ok: true, name: orig, size: req.raw.byteLength });
  }));
  router.get('/evaluations/:id/audio-file', h(async (req, res) => {
    const id = Number(req.params.id);
    await assertEvalAccess(req, id);
    const cur = await must(sb().from('px_evaluations').select('details').eq('id', id).maybeSingle());
    const path = cur?.details?.audio_upload?.path;
    if (!path) throw httpError(404, 'Nenhum áudio anexado.');
    const { data, error } = await sb().storage.from(BUCKET).createSignedUrl(path, 600);
    if (error) throw httpError(500, error.message);
    res.json({ url: data.signedUrl, name: cur.details.audio_upload.name });
  }));
  router.delete('/evaluations/:id/audio-file', QUALITY, h(async (req, res) => {
    const id = Number(req.params.id);
    await assertEvalAccess(req, id);
    const cur = await must(sb().from('px_evaluations').select('details').eq('id', id).maybeSingle());
    const path = cur?.details?.audio_upload?.path;
    if (path) await sb().storage.from(BUCKET).remove([path]).catch(() => {});
    const { audio_upload: _a, ...rest } = cur?.details || {};
    await must(sb().from('px_evaluations').update({ details: rest, updated_at: new Date().toISOString() }).eq('id', id));
    await audit(req.user.id, 'audio_removido', 'evaluation', id, {});
    res.json({ ok: true });
  }));
}

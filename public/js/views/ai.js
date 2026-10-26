import { api, qs } from '../api.js';
import { html, icon, $, $$, toast, busy, fmtDate, fmtScore, avatar, productChip, emptyState, PRODUCTS, PRODUCT } from '../ui.js';
import { readTranscriptLines } from '../files.js';
import { splitTranscripts, classify, metaOf, matchOperator, matchEvaluation } from '../transcripts.js';

let evals = [];

export async function render(el, _p, ctx) {
  const { store, can } = ctx;
  const ai = store.meta.ai;
  docs = [];
  evals = await api.get(`/evaluations${qs({ limit: 2000 })}`);
  if (!ctx.isCurrent()) return;
  const pendingAI = evals.filter((e) => e.has_transcript && e.ai_status !== 'concluida');
  el.innerHTML = String(html`
    <div class="page-head"><div><h2>Análise com <span class="gradient-text">IA</span></h2><p>Anexe transcrições e deixe a plataforma avaliar cada critério, com evidências, corrigindo as leituras divergentes do speech.</p></div></div>
    ${ai.configured
      ? html`<div class="banner ok">${icon('sparkles')}<div><b>IA ativa</b> · modelo ${ai.model}. Correções com confiança alta são ${ai.auto_apply ? 'aplicadas automaticamente' : 'sugeridas para validação'}; ajustes manuais de analistas nunca são sobrescritos.</div></div>`
      : html`<div class="banner warn">${icon('alert')}<div><b>IA ainda não configurada.</b> A análise roda em modo heurístico (palavras-chave), apenas como sugestão. ${can('admin') ? html`<a href="#/configuracoes">Configure a chave da API da Anthropic</a> para ativar a análise completa.` : 'Peça ao administrador para ativar a IA.'}</div></div>`}

    <div class="grid g-3">
      <div class="card span-2">
        <div class="card-head"><div><h3>1. Transcrições para analisar</h3><div class="sub">Um arquivo por ligação ou um .docx com várias ligações: a plataforma separa cada uma, encontra o operador (login, nome ou arquivo de áudio) e vincula à monitoria já importada quando acha o ID da ligação. Confira antes de analisar.</div></div></div>
        <div class="card-body">
          <label class="drop" id="ai-drop"><input type="file" id="ai-files" multiple accept=".txt,.docx,.vtt,.srt,.json,.md,.wav,.mp3,.ogg,.opus,.m4a,.flac,.wma,.amr,.webm,.gsm,audio/*" hidden>
            <div class="ic">${icon('upload')}</div><h4>Arraste as transcrições aqui</h4><p class="muted small" style="margin:0">Vários arquivos de uma vez, ou um documento com várias ligações · .docx, .txt, .vtt, .srt, .json · ou o áudio (.wav, .mp3), transcrito pelo Azure Speech</p></label>
          <div id="ai-queue" class="stack mt"></div>
          <div class="row mt" id="ai-actions" hidden><span class="small" id="ai-missing" style="color:var(--warn-ink)"></span><div style="flex:1"></div><button class="btn ghost" id="ai-clear">Limpar</button><button class="btn primary lg" id="ai-run">${icon('sparkles')}Analisar</button></div>
        </div>
      </div>
      <div class="stack">
        <div class="card card-pad"><h3 style="margin:0 0 8px;font-size:15px">Como funciona</h3>
          <div class="stack small t2">
            <div class="row" style="flex-wrap:nowrap;align-items:flex-start"><span class="chip brand">1</span><span>A IA lê a transcrição inteira e avalia cada item do roteiro da carteira (Veículos, Cartões ou Consignado).</span></div>
            <div class="row" style="flex-wrap:nowrap;align-items:flex-start"><span class="chip brand">2</span><span>Compara com o apontamento do speech e explica cada divergência com o trecho da fala.</span></div>
            <div class="row" style="flex-wrap:nowrap;align-items:flex-start"><span class="chip brand">3</span><span>Corrige automaticamente o que tem alta confiança e deixa o restante como sugestão para o analista.</span></div>
            <div class="row" style="flex-wrap:nowrap;align-items:flex-start"><span class="chip brand">4</span><span>Gera sugestão de feedback (pontos fortes, melhorias e plano de ação).</span></div>
          </div></div>
        <div class="card card-pad"><div class="row between"><h3 style="margin:0;font-size:15px">Fila: transcrições sem análise</h3><span class="chip">${pendingAI.length}</span></div>
          ${pendingAI.length ? html`<div class="stack mt" style="max-height:300px;overflow:auto">${pendingAI.slice(0, 50).map((e) => html`<a class="row" href="#/atendimentos/${e.id}" style="text-decoration:none;flex-wrap:nowrap">${avatar(e.operator_name, 'sm')}<div style="flex:1;min-width:0"><b class="small ellipsis" style="display:block">${e.operator_name}</b><span class="tiny muted">${fmtDate(e.call_date)} · ${e.protocol || ''}</span></div>${productChip(e.product, e.segment)}</a>`)}</div>
            <button class="btn block mt" id="ai-batch">${icon('zap')}Analisar todas (${pendingAI.length})</button><div id="ai-batch-st" class="small muted mt"></div>` : html`<p class="small muted" style="margin:10px 0 0">Nenhuma transcrição aguardando análise.</p>`}
        </div>
      </div>
    </div>
    <div id="ai-results" class="mt"></div>`);

  const drop = $('#ai-drop');
  $('#ai-files').onchange = (e) => addFiles([...e.target.files], ctx);
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => addFiles([...e.dataTransfer.files], ctx));
  $('#ai-clear').onclick = () => { docs = []; drawQueue(ctx); };
  $('#ai-run').onclick = (e) => runQueue(e.currentTarget, ctx);
  $('#ai-batch')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; busy(btn, true, 'Analisando');
    let ok = 0, fail = 0;
    for (const [i, ev] of pendingAI.entries()) {
      $('#ai-batch-st').textContent = `${i + 1} de ${pendingAI.length}: ${ev.operator_name}…`;
      try { await api.post(`/evaluations/${ev.id}/analyze`); ok++; } catch { fail++; }
      if (!ctx.isCurrent()) return;
    }
    toast(`${ok} análise(s) concluída(s)${fail ? `, ${fail} com erro` : ''}.`, fail ? 'err' : 'ok');
    render(el, _p, ctx);
  });
}

// ---------- Fila: cada arquivo pode trazer uma ou várias ligações ----------
// docs = [{ name, method, texts, items: [ligação] }]
let docs = [];
const allItems = () => docs.flatMap((d) => d.items);
const HOW = { login: 'pelo login', 'matrícula': 'pela matrícula', nome: 'pelo nome', 'nome falado na ligação': 'pelo nome dito na ligação — confira' };

function makeItem(it, ctx) {
  const meta = it.meta || {};
  const ops = ctx.store.meta.operators;
  const om = matchOperator(meta, ops);
  const match = matchEvaluation(meta, evals, om?.op?.id) || null;
  const openCycle = ctx.store.meta.cycles.find((c) => c.status === 'aberto') || ctx.store.meta.cycles[0];
  const cycleByDate = meta.date && ctx.store.meta.cycles.find((c) => c.start_date <= meta.date && c.end_date >= meta.date);
  return {
    n: it.n, title: meta.title || `Ligação ${it.n}`, text: it.text, meta, match, link: !!match,
    operator_id: match ? match.operator_id : om?.op?.id || '', opHow: om ? om.how : null, opWeak: !!om?.weak,
    product: match ? match.product : meta.product || 'VEICULOS',
    cycle_id: match?.cycle_id || cycleByDate?.id || ctx.store.cycle || openCycle?.id || '',
    call_date: meta.date || new Date().toISOString().slice(0, 10),
    protocol: meta.callId || '',
    status: 'aguardando', result: null, error: null,
  };
}

const AUDIO_EXT = /\.(wav|mp3|ogg|opus|m4a|flac|wma|amr|webm|gsm)$/i;

async function addFiles(files, ctx) {
  const okExt = /\.(txt|docx|vtt|srt|json|md)$/i;
  const bad = files.filter((f) => !okExt.test(f.name) && !AUDIO_EXT.test(f.name));
  if (bad.length) toast(`${bad.length} arquivo(s) ignorado(s): formato não suportado.`, 'err');
  // Áudios: o nome do arquivo (ID, login, data) já identifica a ligação; a transcrição sai do Azure Speech
  const audios = files.filter((f) => AUDIO_EXT.test(f.name));
  if (audios.length) {
    let d = docs.find((x) => x.audio);
    if (!d) { d = { name: 'Áudios para transcrever', method: 'áudio', audio: true, texts: null, items: [] }; docs.push(d); }
    for (const f of audios) {
      const meta = metaOf(classify([{ text: f.name }]));
      const q = makeItem({ n: d.items.length + 1, meta: { ...meta, title: f.name }, text: '' }, ctx);
      q.audio = f;
      d.items.push(q);
    }
  }
  for (const f of files.filter((x) => okExt.test(x.name))) {
    try {
      const { name, lines } = await readTranscriptLines(f);
      const sp = splitTranscripts(lines);
      docs.push({ name, method: sp.method, texts: classify(lines).map((l) => l.text), items: sp.items.map((it) => makeItem(it, ctx)) });
    } catch (e) { toast(`${f.name}: ${e.message}`, 'err'); }
  }
  drawQueue(ctx);
}

async function splitWithAI(d, btn, ctx) {
  busy(btn, true, 'Separando com IA');
  try {
    const r = await api.post('/transcripts/split', { lines: d.texts, name: d.name });
    if (!r.calls.length) throw new Error('A IA não encontrou ligações neste documento.');
    const c = classify(d.texts.map((t) => ({ text: t })));
    d.items = r.calls.map((call, k) => {
      const seg = c.slice(call.start_line - 1, call.end_line);
      const auto = metaOf(seg);
      const meta = {
        ...auto,
        operatorName: auto.operatorName || call.operator_name || undefined,
        login: auto.login || (call.operator_login ? call.operator_login.toLowerCase() : undefined),
        callId: auto.callId || call.call_id || undefined,
        date: auto.date || (/^\d{4}-\d{2}-\d{2}$/.test(call.call_date) ? call.call_date : undefined),
        audioFile: auto.audioFile || call.audio_file || undefined,
      };
      meta.title = meta.audioFile || (meta.callId ? `Ligação ${meta.callId}` : auto.title);
      return makeItem({ n: k + 1, meta, text: seg.map((l) => l.text).join('\n') }, ctx);
    });
    d.method = 'IA';
    toast(`${d.items.length} ligação(ões) encontradas pela IA.`);
  } catch (e) { toast(e.message, 'err', 7000); }
  drawQueue(ctx);
}

function itemRow(q, di, ii, m) {
  if (q.audio && q.status !== 'ok' && !q.text) q.preview = `Áudio · ${(q.audio.size / 1048576).toFixed(1)} MB · será transcrito pelo Azure Speech`;
  const ready = q.link || q.operator_id;
  return html`<div class="crit" data-d="${di}" data-i="${ii}" style="${q.status === 'ok' ? 'border-color:color-mix(in srgb, var(--ok) 45%, transparent)' : !ready ? 'border-color:color-mix(in srgb, var(--warn) 50%, transparent)' : ''}">
    <div class="row" style="flex-wrap:nowrap">
      <span class="chip ${q.status === 'ok' ? 'ok' : q.status === 'erro' ? 'bad' : q.status === 'processando' ? 'brand' : !ready ? 'warn' : ''}">${q.status === 'processando' ? html`<span class="spinner" style="width:11px;height:11px"></span>` : ''}${q.status === 'aguardando' && !ready ? 'falta operador' : q.status}</span>
      <b class="small ellipsis" style="flex:1" title="${q.title}">${icon('file')} ${q.n}. ${q.title}</b>
      ${q.result ? html`<a class="btn sm" href="#/atendimentos/${q.result.id}">Abrir ${icon('chevRight')}</a>` : html`<button class="btn-icon" data-rm aria-label="Remover">${icon('x')}</button>`}
    </div>
    ${q.error ? html`<div class="small" style="color:var(--bad-ink);margin-top:6px">${q.error}</div>` : ''}
    ${q.result ? html`<div class="small t2" style="margin-top:8px">${q.result.operator_name} · nota final <b>${fmtScore(q.result.final_score)}</b> · ${q.result.items.filter((x) => x.ai_result && x.ai_result !== x.speech_result).length} divergência(s) · ${q.result.items.filter((x) => x.adjust_source === 'ia').length} correção(ões) automáticas</div>` : ''}
    ${q.status === 'aguardando' || q.status === 'erro' ? html`
      ${q.match ? html`<label class="check small" style="margin-top:10px;align-items:center"><input type="checkbox" data-f="link" ${q.link ? 'checked' : ''}><span>Vincular à monitoria existente: <b>${q.match.operator_name}</b> · ${fmtDate(q.match.call_date)} · ${q.match.protocol || ''}</span>${productChip(q.match.product, q.match.segment)}</label>` : ''}
      ${!q.link ? html`<div class="grid" style="margin-top:10px;gap:10px;grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
        <div><select class="select sm" data-f="operator_id" aria-label="Operador"><option value="">Operador…</option>${m.operators.map((o) => html`<option value="${o.id}" ${String(q.operator_id) === String(o.id) ? 'selected' : ''}>${o.name}${o.login ? ` (${o.login})` : ''}</option>`)}</select>
          ${q.opHow ? html`<div class="tiny ${q.opWeak ? '' : 'muted'}" style="margin-top:4px;${q.opWeak ? 'color:var(--warn-ink)' : ''}">Encontrado ${HOW[q.opHow] || q.opHow}</div>` : q.meta.operatorName || q.meta.login ? html`<div class="tiny" style="margin-top:4px;color:var(--warn-ink)">No documento: ${q.meta.operatorName || q.meta.login} (sem cadastro)</div>` : ''}</div>
        <select class="select sm" data-f="product" aria-label="Produto">${PRODUCTS.map((p) => html`<option value="${p}" ${q.product === p ? 'selected' : ''}>${PRODUCT[p]}</option>`)}</select>
        <select class="select sm" data-f="cycle_id" aria-label="Quinzena"><option value="">Sem quinzena</option>${m.cycles.map((c) => html`<option value="${c.id}" ${String(q.cycle_id) === String(c.id) ? 'selected' : ''}>${c.name}</option>`)}</select>
        <input class="input sm" type="date" data-f="call_date" value="${q.call_date}" aria-label="Data da ligação">
        <input class="input sm" data-f="protocol" value="${q.protocol}" placeholder="Protocolo / ID da ligação" aria-label="Protocolo">
      </div>` : ''}
      ${q.audio ? html`<div class="tiny muted" style="margin-top:8px">${icon('audio')} ${q.preview}</div>` : html`<details style="margin-top:8px"><summary class="tiny muted" style="cursor:pointer">Ver transcrição (${q.text.split('\n').length} linhas)</summary>
        <pre class="small t2" style="white-space:pre-wrap;max-height:220px;overflow:auto;margin:6px 0 0;font-family:inherit">${q.text.slice(0, 6000)}</pre></details>`}` : ''}
  </div>`;
}

function drawQueue(ctx) {
  const box = $('#ai-queue');
  const items = allItems();
  const todo = items.filter((q) => q.status !== 'ok');
  $('#ai-actions').hidden = !items.length;
  $('#ai-run').innerHTML = String(html`${icon('sparkles')}Analisar ${todo.filter((q) => q.link || q.operator_id).length} ligação(ões)`);
  $('#ai-missing').textContent = todo.some((q) => !q.link && !q.operator_id) ? `${todo.filter((q) => !q.link && !q.operator_id).length} sem operador ficam de fora até você escolher.` : '';
  const m = ctx.store.meta;
  box.innerHTML = String(html`${docs.map((d, di) => html`<div class="card card-pad" style="background:var(--surface-2)">
    <div class="row" style="flex-wrap:nowrap;gap:8px">${icon('file')}<b class="small ellipsis" style="flex:1;min-width:0" title="${d.name}">${d.name}</b>
      ${d.audio && !ctx.store.meta.ai.speech ? html`<span class="chip warn">Azure Speech não configurado</span>` : ''}
      ${!d.audio && d.items.every((q) => q.status !== 'ok') ? html`<button class="btn sm" data-split="${di}" title="Use se a separação automática não acertou">${icon('sparkles')}Separar com IA</button><button class="btn-icon" data-rmdoc="${di}" aria-label="Remover arquivo">${icon('x')}</button>` : ''}</div>
    <div class="row" style="flex-wrap:wrap;gap:6px;margin-top:8px">
      <span class="chip ${d.items.length > 1 ? 'brand' : ''}">${d.items.length} ligação(ões)</span>
      <span class="chip outline" title="Como o documento foi separado">${d.method === 'IA' ? 'separado pela IA' : d.method === 'documento único' ? 'uma ligação' : `separado por ${d.method}`}</span>
      <span class="chip ok">${d.items.filter((q) => q.link).length} vinculadas</span>
      ${d.items.some((q) => !q.link && !q.operator_id) ? html`<span class="chip warn">${d.items.filter((q) => !q.link && !q.operator_id).length} sem operador</span>` : ''}
    </div>
    <div class="stack" style="margin-top:10px">${d.items.map((q, ii) => itemRow(q, di, ii, m))}</div></div>`)}`);
  $$('[data-d]', box).forEach((row) => {
    const d = docs[Number(row.dataset.d)], q = d.items[Number(row.dataset.i)];
    $$('[data-f]', row).forEach((inp) => inp.addEventListener('change', () => {
      q[inp.dataset.f] = inp.type === 'checkbox' ? inp.checked : inp.value;
      if (inp.dataset.f === 'operator_id') { q.opHow = null; q.opWeak = false; }
      if (['link', 'operator_id'].includes(inp.dataset.f)) drawQueue(ctx);
    }));
    $('[data-rm]', row)?.addEventListener('click', () => { d.items.splice(Number(row.dataset.i), 1); if (!d.items.length) docs.splice(docs.indexOf(d), 1); drawQueue(ctx); });
  });
  $$('[data-split]', box).forEach((b) => b.addEventListener('click', () => splitWithAI(docs[Number(b.dataset.split)], b, ctx)));
  $$('[data-rmdoc]', box).forEach((b) => b.addEventListener('click', () => { docs.splice(Number(b.dataset.rmdoc), 1); drawQueue(ctx); }));
}

async function analyzeOne(q) {
  if (q.audio) {
    if (q.link && q.match) return api.upload(`/evaluations/${q.match.id}/audio-transcribe${qs({ name: q.audio.name, analyze: 1 })}`, q.audio);
    const r = await api.upload(`/analyses/audio${qs({ name: q.audio.name, operator_id: q.operator_id, product: q.product, cycle_id: q.cycle_id, call_date: q.call_date, protocol: q.protocol })}`, q.audio);
    if (r.ai_error) throw Object.assign(new Error(r.ai_error), { result: r });
    return r;
  }
  const tr = { name: q.title, text: q.text };
  if (q.link && q.match) {
    await api.post(`/evaluations/${q.match.id}/transcript`, tr);
    return api.post(`/evaluations/${q.match.id}/analyze`);
  }
  const r = await api.post('/analyses', { ...tr, operator_id: q.operator_id, product: q.product, cycle_id: q.cycle_id, call_date: q.call_date, protocol: q.protocol, origin: 'transcricao' });
  if (r.ai_error) throw Object.assign(new Error(r.ai_error), { result: r });
  return r;
}

async function runQueue(btn, ctx) {
  const todo = allItems().filter((q) => q.status !== 'ok' && (q.link || q.operator_id) && (!q.audio || ctx.store.meta.ai.speech));
  if (!todo.length) { toast(allItems().some((q) => q.audio) && !ctx.store.meta.ai.speech ? 'Configure o Azure Speech para transcrever os áudios.' : 'Escolha o operador das ligações antes de analisar.', 'err'); return; }
  busy(btn, true, 'Analisando');
  // Até 3 análises ao mesmo tempo
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const q = todo[next++];
      q.status = 'processando'; q.error = null;
      if (ctx.isCurrent()) drawQueue(ctx);
      try { q.result = await analyzeOne(q); q.status = 'ok'; }
      catch (e) { q.status = 'erro'; q.error = e.message; if (e.result) { q.result = e.result; q.link = true; q.match = e.result; } }
      if (ctx.isCurrent()) drawQueue(ctx);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  busy(btn, false);
  const ok = todo.filter((q) => q.status === 'ok').length;
  toast(`${ok} de ${todo.length} ligação(ões) analisada(s).`, ok === todo.length ? 'ok' : 'err');
  ctx.refreshMeta();
  void emptyState;
}

export const hasUnsavedChanges = () => docs.length > 0;

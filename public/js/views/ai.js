import { api, qs } from '../api.js';
import { html, icon, $, $$, toast, busy, readFileAsBase64, fmtDate, fmtScore, avatar, productChip, emptyState } from '../ui.js';

let queue = [];
let evals = [];

export async function render(el, _p, ctx) {
  const { store, can } = ctx;
  const ai = store.meta.ai;
  queue = [];
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
        <div class="card-head"><div><h3>1. Transcrições para analisar</h3><div class="sub">Se o nome do arquivo tiver o protocolo, vinculamos à monitoria existente. Senão, criamos uma nova monitoria.</div></div></div>
        <div class="card-body">
          <label class="drop" id="ai-drop"><input type="file" id="ai-files" multiple accept=".txt,.docx,.vtt,.srt,.json,.md" hidden>
            <div class="ic">${icon('upload')}</div><h4>Arraste as transcrições aqui</h4><p class="muted small" style="margin:0">Vários arquivos de uma vez · .txt, .docx, .vtt, .srt, .json</p></label>
          <div id="ai-queue" class="stack mt"></div>
          <div class="row mt" id="ai-actions" hidden><div style="flex:1"></div><button class="btn ghost" id="ai-clear">Limpar</button><button class="btn primary lg" id="ai-run">${icon('sparkles')}Analisar</button></div>
        </div>
      </div>
      <div class="stack">
        <div class="card card-pad"><h3 style="margin:0 0 8px;font-size:15px">Como funciona</h3>
          <div class="stack small t2">
            <div class="row" style="flex-wrap:nowrap;align-items:flex-start"><span class="chip brand">1</span><span>A IA lê a transcrição inteira e avalia cada critério do formulário (Refinanciamento ou Entrega Amigável).</span></div>
            <div class="row" style="flex-wrap:nowrap;align-items:flex-start"><span class="chip brand">2</span><span>Compara com o apontamento do speech e explica cada divergência com o trecho da fala.</span></div>
            <div class="row" style="flex-wrap:nowrap;align-items:flex-start"><span class="chip brand">3</span><span>Corrige automaticamente o que tem alta confiança e deixa o restante como sugestão para o analista.</span></div>
            <div class="row" style="flex-wrap:nowrap;align-items:flex-start"><span class="chip brand">4</span><span>Gera sugestão de feedback (pontos fortes, melhorias e plano de ação).</span></div>
          </div></div>
        <div class="card card-pad"><div class="row between"><h3 style="margin:0;font-size:15px">Fila: transcrições sem análise</h3><span class="chip">${pendingAI.length}</span></div>
          ${pendingAI.length ? html`<div class="stack mt" style="max-height:300px;overflow:auto">${pendingAI.slice(0, 50).map((e) => html`<a class="row" href="#/atendimentos/${e.id}" style="text-decoration:none;flex-wrap:nowrap">${avatar(e.operator_name, 'sm')}<div style="flex:1;min-width:0"><b class="small ellipsis" style="display:block">${e.operator_name}</b><span class="tiny muted">${fmtDate(e.call_date)} · ${e.protocol || ''}</span></div>${productChip(e.product)}</a>`)}</div>
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
  $('#ai-clear').onclick = () => { queue = []; drawQueue(ctx); };
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

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function guess(file, ctx) {
  const name = norm(file.name);
  const digits = (file.name.match(/\d{8,}/g) || []);
  const match = evals.find((e) => e.protocol && digits.some((d) => String(e.protocol).includes(d) || d.includes(String(e.protocol))));
  const op = ctx.store.meta.operators.find((o) => {
    const parts = norm(o.name).split(/\s+/);
    return parts.length > 1 && name.includes(parts[0]) && name.includes(parts[parts.length - 1]);
  }) || ctx.store.meta.operators.find((o) => o.registration && name.includes(norm(o.registration)));
  const openCycle = ctx.store.meta.cycles.find((c) => c.status === 'aberto') || ctx.store.meta.cycles[0];
  return {
    file, match: match || null, link: !!match,
    operator_id: match ? match.operator_id : op?.id || '',
    product: match ? match.product : /entrega|amigavel|devolu/.test(name) ? 'ENTREGA' : 'REFIN',
    cycle_id: ctx.store.cycle || openCycle?.id || '',
    call_date: (file.name.match(/(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})/) || []).slice(1).join('-') || new Date().toISOString().slice(0, 10),
    protocol: digits[0] || '',
    status: 'aguardando', result: null, error: null,
  };
}

function addFiles(files, ctx) {
  const okExt = /\.(txt|docx|vtt|srt|json|md)$/i;
  const bad = files.filter((f) => !okExt.test(f.name));
  if (bad.length) toast(`${bad.length} arquivo(s) ignorado(s): formato não suportado.`, 'err');
  queue.push(...files.filter((f) => okExt.test(f.name)).map((f) => guess(f, ctx)));
  drawQueue(ctx);
}

function drawQueue(ctx) {
  const box = $('#ai-queue');
  $('#ai-actions').hidden = !queue.length;
  $('#ai-run').innerHTML = String(html`${icon('sparkles')}Analisar ${queue.filter((q) => q.status !== 'ok').length} transcrição(ões)`);
  const m = ctx.store.meta;
  box.innerHTML = String(html`${queue.map((q, i) => html`<div class="crit" data-q="${i}" style="${q.status === 'ok' ? 'border-color:color-mix(in srgb, var(--ok) 45%, transparent)' : ''}">
    <div class="row" style="flex-wrap:nowrap">
      <span class="chip ${q.status === 'ok' ? 'ok' : q.status === 'erro' ? 'bad' : q.status === 'processando' ? 'brand' : ''}">${q.status === 'processando' ? html`<span class="spinner" style="width:11px;height:11px"></span>` : ''}${q.status}</span>
      <b class="small ellipsis" style="flex:1">${icon('file')} ${q.file.name}</b>
      ${q.result ? html`<a class="btn sm" href="#/atendimentos/${q.result.id}">Abrir ${icon('chevRight')}</a>` : html`<button class="btn-icon" data-rm="${i}" aria-label="Remover">${icon('x')}</button>`}
    </div>
    ${q.error ? html`<div class="small" style="color:var(--bad-ink);margin-top:6px">${q.error}</div>` : ''}
    ${q.result ? html`<div class="small t2 mt-0" style="margin-top:8px">Nota final <b>${fmtScore(q.result.final_score)}</b> · ${q.result.items.filter((x) => x.ai_result && x.ai_result !== x.speech_result).length} divergência(s) com o speech · ${q.result.items.filter((x) => x.adjust_source === 'ia').length} correção(ões) automáticas</div>` : ''}
    ${q.status === 'aguardando' || q.status === 'erro' ? html`
      ${q.match ? html`<label class="check small mt" style="margin-top:10px"><input type="checkbox" data-f="link" ${q.link ? 'checked' : ''}> Vincular à monitoria existente: <b>${q.match.operator_name}</b> · ${fmtDate(q.match.call_date)} · protocolo ${q.match.protocol}</label>` : ''}
      ${!q.link ? html`<div class="grid g-4" style="margin-top:10px;gap:10px">
        <select class="select sm" data-f="operator_id" aria-label="Operador"><option value="">Operador…</option>${m.operators.map((o) => html`<option value="${o.id}" ${String(q.operator_id) === String(o.id) ? 'selected' : ''}>${o.name}</option>`)}</select>
        <select class="select sm" data-f="product" aria-label="Produto"><option value="REFIN" ${q.product === 'REFIN' ? 'selected' : ''}>Refinanciamento</option><option value="ENTREGA" ${q.product === 'ENTREGA' ? 'selected' : ''}>Entrega Amigável</option></select>
        <select class="select sm" data-f="cycle_id" aria-label="Quinzena"><option value="">Sem quinzena</option>${m.cycles.map((c) => html`<option value="${c.id}" ${String(q.cycle_id) === String(c.id) ? 'selected' : ''}>${c.name}</option>`)}</select>
        <input class="input sm" type="date" data-f="call_date" value="${q.call_date}" aria-label="Data da ligação">
        <input class="input sm" data-f="protocol" value="${q.protocol}" placeholder="Protocolo" aria-label="Protocolo">
      </div>` : ''}` : ''}
  </div>`)}`);
  $$('[data-q]', box).forEach((row) => {
    const q = queue[Number(row.dataset.q)];
    $$('[data-f]', row).forEach((inp) => inp.addEventListener('change', () => {
      q[inp.dataset.f] = inp.type === 'checkbox' ? inp.checked : inp.value;
      if (inp.dataset.f === 'link') drawQueue(ctx);
    }));
  });
  $$('[data-rm]', box).forEach((b) => b.addEventListener('click', () => { queue.splice(Number(b.dataset.rm), 1); drawQueue(ctx); }));
}

async function runQueue(btn, ctx) {
  const todo = queue.filter((q) => q.status !== 'ok');
  const missing = todo.find((q) => !q.link && !q.operator_id);
  if (missing) { toast(`Selecione o operador de "${missing.file.name}".`, 'err'); return; }
  busy(btn, true, 'Analisando');
  for (const q of todo) {
    q.status = 'processando'; q.error = null; drawQueue(ctx);
    try {
      const base64 = await readFileAsBase64(q.file);
      if (q.link && q.match) {
        await api.post(`/evaluations/${q.match.id}/transcript`, { name: q.file.name, base64 });
        q.result = await api.post(`/evaluations/${q.match.id}/analyze`);
      } else {
        q.result = await api.post('/analyses', { name: q.file.name, base64, operator_id: q.operator_id, product: q.product, cycle_id: q.cycle_id, call_date: q.call_date, protocol: q.protocol, origin: 'transcricao' });
        if (q.result.ai_error) throw new Error(q.result.ai_error);
      }
      q.status = 'ok';
    } catch (e) { q.status = 'erro'; q.error = e.message; }
    if (!ctx.isCurrent()) return;
    drawQueue(ctx);
  }
  busy(btn, false);
  const ok = queue.filter((q) => q.status === 'ok').length;
  toast(`${ok} transcrição(ões) analisada(s).`);
  ctx.refreshMeta();
  void emptyState;
}

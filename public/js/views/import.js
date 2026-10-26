import { api } from '../api.js';
import { html, icon, $, toast, busy, fmtDate, fmtScore, PRODUCT } from '../ui.js';
import { parseSheetFile, downloadTemplate } from '../files.js';

let preview = null, fileName = '';

export async function render(el, _p, ctx) {
  const { store } = ctx;
  preview = null;
  const open = store.meta.cycles.find((c) => c.status === 'aberto');
  el.innerHTML = String(html`
    <div class="page-head"><div><h2>Importar monitorias do speech</h2><p>Traga a planilha quinzenal de auditorias (Excel ou CSV). Cada linha vira um card de atendimento.</p></div></div>
    <div class="grid g-3">
      <div class="card card-pad"><span class="chip brand">Passo 1</span><h3 style="margin:10px 0 6px">Baixe o modelo</h3>
        <p class="small t2">Uma linha por atendimento. Os critérios ficam nas colunas pelo código (ex.: <b>IDT</b>, <b>RCE</b>) com C, P, NC ou NA — também aceitamos Sim/Não/Parcial. Colunas extras são ignoradas.</p>
        <button class="btn" id="tpl">${icon('download')}Modelo .xlsx</button></div>
      <div class="card card-pad span-2"><span class="chip brand">Passo 2</span><h3 style="margin:10px 0 6px">Envie a planilha</h3>
        <label class="drop" id="im-drop" style="padding:24px"><input type="file" id="im-file" accept=".xlsx,.csv" hidden>
          <div class="ic">${icon('upload')}</div><h4>Arraste a planilha ou clique</h4><p class="muted small" style="margin:0" id="im-name">.xlsx ou .csv · até 15 MB</p></label>
        <div class="field mt"><label for="im-cycle">Quinzena de destino</label><select class="select" id="im-cycle">
          <option value="">Sem quinzena</option>${store.meta.cycles.map((c) => html`<option value="${c.id}" ${(store.cycle ? String(c.id) === String(store.cycle) : open?.id === c.id) ? 'selected' : ''}>${c.name}</option>`)}</select>
          ${ctx.can('admin') ? html`<span class="hint">Crie novas quinzenas e o link da pasta de áudios em <a href="#/ciclos">Quinzenas &amp; áudios</a>.</span>` : ''}</div>
      </div>
    </div>
    <div id="im-prev" class="mt"></div>`);
  $('#tpl').onclick = async (e) => { busy(e.currentTarget, true); try { await downloadTemplate(store.meta.criteria.filter((c) => c.active)); } catch (ex) { toast(ex.message, 'err'); } busy(e.currentTarget, false); };
  const drop = $('#im-drop');
  const handle = async (f) => {
    if (!f) return;
    fileName = f.name;
    $('#im-name').textContent = `${f.name} · lendo…`;
    try {
      preview = await api.post('/import/preview', { rows: await parseSheetFile(f) });
      $('#im-name').textContent = `${f.name} · ${preview.summary.total} linha(s)`;
      drawPreview(el, ctx);
    } catch (ex) { toast(ex.message, 'err'); $('#im-name').textContent = '.xlsx ou .csv'; }
  };
  $('#im-file').onchange = (e) => handle(e.target.files[0]);
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => handle(e.dataTransfer.files[0]));
}

function drawPreview(el, ctx) {
  const p = preview, s = p.summary;
  const box = $('#im-prev', el);
  box.innerHTML = String(html`<div class="card">
    <div class="card-head"><div><span class="chip brand">Passo 3</span><h3 style="margin-top:8px">Confira antes de importar</h3><div class="sub">${s.valid} válida(s) · ${s.invalid} com erro · ${s.new_operators} operador(es) novo(s)</div></div><div class="grow"></div>
      <button class="btn primary lg" id="im-go" ${s.valid ? '' : 'disabled'}>${icon('upload')}Importar ${s.valid} monitoria(s)</button></div>
    <div class="card-body">
      <div class="row small t2 mb">${p.mapped.map((m) => html`<span class="chip ok">${m.header} → ${m.field}</span>`)}${p.criteria_columns.map((m) => html`<span class="chip info">${m.header} → ${m.code}</span>`)}${p.unmatched.map((h) => html`<span class="chip outline" title="Coluna ignorada">${h} (ignorada)</span>`)}</div>
      ${!p.criteria_columns.length ? html`<div class="banner warn">${icon('alert')}<div>Nenhuma coluna de critério reconhecida. Use os códigos do modelo (ex.: ABE, IDT, RPR) como cabeçalho para trazer a análise item a item.</div></div>` : ''}
      <div class="table-wrap" style="max-height:480px;overflow:auto"><table class="tbl"><thead><tr><th>Linha</th><th>Operador</th><th>Produto</th><th>Data</th><th>Protocolo</th><th class="right">Nota speech</th><th class="right">Critérios</th><th>Observações</th></tr></thead>
      <tbody>${p.rows.map((r) => html`<tr style="${r.errors.length ? 'background:var(--bad-soft)' : ''}">
        <td class="muted">${r.line}</td><td><b>${r.operator || '—'}</b>${!r.operator_id && r.operator ? html` <span class="chip brand">novo</span>` : ''}</td>
        <td>${r.product ? PRODUCT[r.product] : '—'}</td><td>${fmtDate(r.call_date)}</td><td class="small">${r.protocol || '—'}</td>
        <td class="right num">${fmtScore(r.speech_score)}</td><td class="right">${r.items.length}</td>
        <td class="small">${r.errors.map((x) => html`<div style="color:var(--bad-ink)">${x}</div>`)}${r.warnings.map((x) => html`<div class="muted">${x}</div>`)}</td></tr>`)}</tbody></table></div>
    </div></div>`);
  $('#im-go', box)?.addEventListener('click', async (e) => {
    busy(e.currentTarget, true, 'Importando');
    try {
      const r = await api.post('/import/commit', { cycle_id: $('#im-cycle').value, rows: p.rows.filter((x) => !x.errors.length), filename: fileName });
      toast(`${r.created} monitoria(s) importada(s)${r.newOps ? ` · ${r.newOps} operador(es) cadastrado(s)` : ''}.`);
      await ctx.refreshMeta();
      if ($('#im-cycle').value) { ctx.store.cycle = $('#im-cycle').value; localStorage.setItem('px_cycle', ctx.store.cycle); }
      ctx.navigate('atendimentos');
    } catch (ex) { toast(ex.message, 'err'); busy(e.currentTarget, false); }
  });
}

export const hasUnsavedChanges = () => !!preview;

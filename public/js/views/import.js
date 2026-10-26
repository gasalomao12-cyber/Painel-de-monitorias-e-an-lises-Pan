import { api } from '../api.js';
import { html, icon, $, toast, busy, fmtDate, fmtScore, fmtInt, PRODUCT, SEGMENT } from '../ui.js';
import { parseSheetFile, downloadTemplate } from '../files.js';

let preview = null, fileName = '', dash = null;

// ------------------------------------------------------------------ Dashboards de monitoria PAN (.html)
// O arquivo traz os dados num <script id="dados" type="application/json">. Lemos só esse JSON
// no navegador; o mapeamento (roteiro, ajustes, alertas, produto e segmento) é feito pela API.
const DASH_KIND = { dash_veiculos: 'Speech E.A. e Refin · PAN Veículos', dash_sem_garantia: 'Roteiro Sem Garantia · PAN Cartões e Consignado' };
function detectKind(calls) {
  const q = calls?.[0]?.q;
  if (!q) return null;
  if ('ea' in q && 'contrato' in q) return 'dash_veiculos';
  if ('ab' in q && 'cpf' in q) return 'dash_sem_garantia';
  return null;
}
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// Mesma regra da API: Cartões em Clean Curto/Longo e Consignado em Público/Privado (segmento do Capacity)
function productOf(kind, c) {
  if (kind === 'dash_veiculos') return ['VEICULOS', null];
  const seg = norm(c.seg);
  if (c.prod === 'CON') return ['CONSIGNADO', /privad/.test(seg) ? 'PRIVADO' : /consign|public/.test(seg) ? 'PUBLICO' : 'none'];
  return ['CARTOES', /longo/.test(seg) ? 'CLEAN_LONGO' : /curto/.test(seg) ? 'CLEAN_CURTO' : 'none'];
}
async function readDashboard(file) {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const node = doc.querySelector('script#dados[type="application/json"]');
  if (!node) throw new Error('Este arquivo não tem os dados do dashboard (bloco "dados" não encontrado).');
  let data;
  try { data = JSON.parse(node.textContent); } catch { throw new Error('Não foi possível ler os dados do dashboard.'); }
  const kind = detectKind(data.calls);
  if (!kind) throw new Error('Formato de dashboard não reconhecido. São aceitos o "Speech E.A. e Refin" (Veículos) e o "Roteiro Sem Garantia".');
  return { kind, calls: data.calls, period: data.periodo || '', name: file.name };
}

function drawDash(el, ctx) {
  const box = $('#dash-prev', el);
  if (!dash) { box.innerHTML = ''; return; }
  const { kind, calls } = dash;
  const groups = {};
  for (const c of calls) { const [p, s] = productOf(kind, c); const k = `${p}|${s || ''}`; groups[k] = (groups[k] || 0) + 1; }
  const dates = calls.map((c) => String(c.dt).slice(0, 10)).sort();
  const leaders = new Set(calls.map((c) => c.lid).filter((x) => x && !/^sem lideran/i.test(x)));
  const ops = new Set(calls.map((c) => c.log));
  const withTxt = calls.filter((c) => c.txt).length;
  box.innerHTML = String(html`<div class="card mt"><div class="card-head"><div><h3>${DASH_KIND[kind]}</h3>
      <div class="sub">${dash.name} · ${dash.period || `${fmtDate(dates[0])} a ${fmtDate(dates[dates.length - 1])}`}</div></div><div class="grow"></div>
      <button class="btn ghost" id="dash-cancel">Cancelar</button><button class="btn primary lg" id="dash-go">${icon('upload')}Importar ${fmtInt(calls.length)} ligações</button></div>
    <div class="card-body">
      <div class="grid g-4">
        <div class="insight"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${icon('headset')}</span><div><b>${fmtInt(calls.length)} ligações</b><div class="t2 small">${fmtDate(dates[0])} a ${fmtDate(dates[dates.length - 1])}</div></div></div>
        <div class="insight"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${icon('users')}</span><div><b>${fmtInt(ops.size)} operadores</b><div class="t2 small">${leaders.size} líder(es) · cadastro automático pelo login</div></div></div>
        <div class="insight"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${icon('file')}</span><div><b>${withTxt ? `${fmtInt(withTxt)} transcrições` : 'Respostas do speech'}</b><div class="t2 small">${withTxt ? 'Resumo, ponto forte e feedback sugerido de cada ligação' : 'Com os ajustes de coerência do dashboard'}</div></div></div>
        <div class="insight"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${icon('layers')}</span><div><b>Por produto</b><div class="t2 small">${Object.entries(groups).map(([k, n]) => { const [p, s] = k.split('|'); return `${PRODUCT[p]}${s ? ` · ${SEGMENT[s]}` : ''}: ${n}`; }).join(' · ')}</div></div></div>
      </div>
      ${groups['CARTOES|none'] || groups['CONSIGNADO|none'] ? html`<div class="banner warn mt">${icon('alert')}<div>${(groups['CARTOES|none'] || 0) + (groups['CONSIGNADO|none'] || 0)} ligação(ões) sem segmento identificável no Capacity entram como <b>Segmento a definir</b>. Dá para ajustar depois no card da ligação (botão “Segmento”).</div></div>` : ''}
      <div class="grid g-2 mt">
        <div class="field"><label for="dash-cycle">Quinzena de destino</label><select class="select" id="dash-cycle">
          <option value="">Automática (pelas datas das ligações)</option>${ctx.store.meta.cycles.map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select>
          <span class="hint">Se não existir uma quinzena com essas datas, ela é criada. Ligações já importadas são ignoradas, então pode reenviar o arquivo sem duplicar.</span></div>
        <div id="dash-progress" class="small t2" style="align-self:end"></div>
      </div>
    </div></div>`);
  $('#dash-cancel', box).onclick = () => { dash = null; $('#dash-name').textContent = '.html exportado do dashboard'; drawDash(el, ctx); };
  $('#dash-go', box).onclick = async (e) => {
    const btn = e.currentTarget; busy(btn, true, 'Importando');
    const prog = $('#dash-progress', box);
    const tot = { created: 0, skipped: 0, operators_created: 0 };
    let cycle = $('#dash-cycle', box).value || null;
    const size = 40;
    try {
      for (let i = 0; i < calls.length; i += size) {
        prog.innerHTML = String(html`<div class="meter" style="height:8px"><i style="width:${Math.round((i / calls.length) * 100)}%"></i></div><div class="mt-0" style="margin-top:6px">Enviando ${Math.min(i + size, calls.length)} de ${calls.length}…</div>`);
        const r = await api.post('/import/dashboard', { kind, calls: calls.slice(i, i + size), cycle_id: cycle, period: dash.period, filename: dash.name, batch: i / size + 1, last: i + size >= calls.length });
        cycle = r.cycle_id; tot.created += r.created; tot.skipped += r.skipped; tot.operators_created += r.operators_created;
      }
      toast(`${tot.created} ligação(ões) importada(s)${tot.skipped ? ` · ${tot.skipped} já existiam` : ''}${tot.operators_created ? ` · ${tot.operators_created} operador(es) cadastrado(s)` : ''}.`);
      dash = null;
      await ctx.refreshMeta();
      ctx.store.cycle = String(cycle); localStorage.setItem('px_cycle', ctx.store.cycle);
      ctx.navigate('painel');
    } catch (ex) {
      toast(`${ex.message}${tot.created ? ` (${tot.created} já foram importadas; reenvie o arquivo para continuar)` : ''}`, 'err', 8000);
      busy(btn, false); prog.textContent = '';
    }
  };
}

export async function render(el, _p, ctx) {
  const { store } = ctx;
  preview = null; dash = null;
  const open = store.meta.cycles.find((c) => c.status === 'aberto');
  el.innerHTML = String(html`
    <div class="page-head"><div><h2>Importar monitorias</h2><p>Traga o dashboard de monitoria da quinzena (.html) ou a planilha de auditorias do speech (Excel ou CSV). Cada ligação vira um card de atendimento.</p></div></div>
    <div class="card card-pad mb"><span class="chip brand">Dashboard PAN</span><h3 style="margin:10px 0 6px">Dashboard de monitoria já trabalhado (.html)</h3>
      <p class="small t2" style="margin-top:0">Aceita o <b>Speech E.A. e Refin</b> (Veículos) e o <b>Roteiro Sem Garantia</b> (Cartões em Clean Curto/Longo e Consignado em Público/Privado). Vêm junto o roteiro item a item, os ajustes de coerência com o motivo, líder e gerência, tabulação, desfecho, aptidão a E.A./refin, alertas de sigilo e conduta, transcrição, resumo e feedback sugerido.</p>
      <label class="drop" id="dash-drop" style="padding:20px"><input type="file" id="dash-file" accept=".html,.htm" hidden>
        <div class="ic">${icon('upload')}</div><h4>Arraste o arquivo do dashboard ou clique</h4><p class="muted small" style="margin:0" id="dash-name">.html exportado do dashboard</p></label>
      <div id="dash-prev"></div>
    </div>
    <h3 style="margin:22px 0 10px">Planilha do speech</h3>
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
  $('#tpl').onclick = async (e) => {
    const btnEl = e.currentTarget;
    busy(btnEl, true); try { await downloadTemplate(store.meta.criteria.filter((c) => c.active)); } catch (ex) { toast(ex.message, 'err'); } busy(btnEl, false); };
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

  const ddrop = $('#dash-drop');
  const handleDash = async (f) => {
    if (!f) return;
    $('#dash-name').textContent = `${f.name} · lendo…`;
    try { dash = await readDashboard(f); $('#dash-name').textContent = `${f.name} · ${dash.calls.length} ligações`; drawDash(el, ctx); }
    catch (ex) { dash = null; toast(ex.message, 'err', 7000); $('#dash-name').textContent = '.html exportado do dashboard'; drawDash(el, ctx); }
  };
  $('#dash-file').onchange = (e) => handleDash(e.target.files[0]);
  ['dragenter', 'dragover'].forEach((t) => ddrop.addEventListener(t, (e) => { e.preventDefault(); ddrop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => ddrop.addEventListener(t, (e) => { e.preventDefault(); ddrop.classList.remove('over'); }));
  ddrop.addEventListener('drop', (e) => handleDash(e.dataTransfer.files[0]));
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
    const btnEl = e.currentTarget;
    busy(btnEl, true, 'Importando');
    try {
      const r = await api.post('/import/commit', { cycle_id: $('#im-cycle').value, rows: p.rows.filter((x) => !x.errors.length), filename: fileName });
      toast(`${r.created} monitoria(s) importada(s)${r.newOps ? ` · ${r.newOps} operador(es) cadastrado(s)` : ''}.`);
      await ctx.refreshMeta();
      if ($('#im-cycle').value) { ctx.store.cycle = $('#im-cycle').value; localStorage.setItem('px_cycle', ctx.store.cycle); }
      ctx.navigate('atendimentos');
    } catch (ex) { toast(ex.message, 'err'); busy(btnEl, false); }
  });
}

export const hasUnsavedChanges = () => !!preview || !!dash;

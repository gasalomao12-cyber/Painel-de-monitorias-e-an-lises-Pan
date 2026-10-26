import { api, qs } from '../api.js';
import { downloadEvaluations } from '../files.js';
import { html, icon, $, $$, fmtScore, fmtDate, avatar, productChip, scoreRing, deltaTag, emptyState, toast, modal, busy, debounce, STATUS, userName, ALERT, origLabel, CONTEST } from '../ui.js';
import { filterBar, bindFilterBar } from './dashboard.js';
import { palette } from '../charts.js';

const state = { product: '', segment: '', alert: '', team: '', status: '', feedback: '', operator_id: '', adjusted: false, critical: false, q: '', sort: 'recentes', view: localStorage.getItem('px_eval_view') || 'grid', selecting: false, selected: new Set(), shown: 60 };

export function evalCard(e, { selectable = false, selected = false } = {}) {
  const c = palette();
  const fb = e.status === 'feedback_aplicado';
  const delta = e.final_score != null && e.speech_score != null ? e.final_score - e.speech_score : null;
  return html`<article class="ev-card st-${e.status} ${selected ? 'selected' : ''}" data-ev="${e.id}" tabindex="0" aria-label="Atendimento de ${e.operator_name}">
    ${selectable ? html`<label class="sel"><input type="checkbox" data-sel="${e.id}" ${selected ? 'checked' : ''} aria-label="Selecionar"></label>` : ''}
    ${fb ? html`<div class="fb-ribbon">${icon('checkCircle')}Feedback aplicado ${e.feedback_at ? `em ${fmtDate(e.feedback_at)}` : ''}${e.feedback_by ? ` · ${e.feedback_by_display || e.feedback_by}` : ''}</div>` : ''}
    <div class="ev-top">
      <div class="who">${avatar(e.operator_name)}<div style="min-width:0"><b>${e.operator_name}</b><span>${e.supervisor_name || e.team || 'Sem equipe'} · ${fmtDate(e.call_date)}${e.call_time ? ` ${e.call_time}` : ''}</span></div></div>
      ${scoreRing(e.final_score)}
    </div>
    <div class="ev-meta">
      ${productChip(e.product, e.segment)}
      ${(e.alerts || []).map((a) => html`<span class="chip alert ${a === 'audio_ruim' || a === 'sem_speech' ? 'warn' : ''}" title="${ALERT[a]?.[1] || ''}">${icon('alert')}${ALERT[a]?.[0] || a}</span>`)}
      ${e.status === 'pendente' ? html`<span class="chip warn">${icon('msgClock')}Pendente de revisão</span>` : e.status === 'revisada' ? html`<span class="chip info">${icon('check')}Revisada · aguarda feedback</span>` : ''}
      ${e.critical_fail ? html`<span class="chip bad">${icon('alert')}Falha crítica</span>` : ''}
      ${e.contest_status && CONTEST[e.contest_status] ? html`<span class="chip ${CONTEST[e.contest_status][1]}">${icon('flag')}${CONTEST[e.contest_status][0]}</span>` : ''}
      ${e.adjustments ? html`<span class="chip brand">${icon('edit')}${e.adjustments} ajuste${e.adjustments > 1 ? 's' : ''}</span>` : ''}
      ${e.ai_status === 'concluida' ? html`<span class="chip outline">${icon('sparkles')}IA</span>` : e.has_transcript ? html`<span class="chip outline">${icon('file')}Transcrição</span>` : ''}
    </div>
    <div class="ev-scores">${origLabel(e)} <b class="num">${fmtScore(e.speech_score)}</b> ${icon('arrowRight')} Final <b class="num">${fmtScore(e.final_score)}</b> ${delta && Math.abs(delta) >= 0.1 ? deltaTag(delta) : ''}</div>
    <div class="mini-bars" title="${e.nc_count} não conformes · ${e.p_count} parciais">
      <i style="flex:${e.c_count};background:${c.ok}"></i><i style="flex:${e.p_count};background:${c.warn}"></i><i style="flex:${e.nc_count};background:${c.bad}"></i>
    </div>
    <div class="ev-foot">
      <span class="nowrap" title="${e.audio_file || ''}">${icon('headset')} ${e.protocol || 'sem protocolo'}</span><span class="grow"></span>
      ${e.audio_link ? html`<a class="btn sm ghost" href="${e.audio_link}" target="_blank" rel="noopener" data-stop title="Abrir pasta/arquivo de áudio">${icon('play')}Áudio</a>` : html`<span class="tiny">sem áudio</span>`}
    </div>
  </article>`;
}

export function bindEvalCards(root, navigate) {
  $$('[data-ev]', root).forEach((card) => {
    card.addEventListener('click', (e) => { if (e.target.closest('[data-stop], .sel')) return; navigate(`atendimentos/${card.dataset.ev}`); });
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate(`atendimentos/${card.dataset.ev}`); });
  });
}

export async function render(el, _p, ctx) {
  const { store, can } = ctx;
  const preset = sessionStorage.getItem('px_eval_q');
  if (preset) { state.q = preset; sessionStorage.removeItem('px_eval_q'); }
  // Vindo do painel (ex.: clique em um alerta), já abre filtrado
  try {
    const f = JSON.parse(sessionStorage.getItem('px_eval_preset') || 'null');
    if (f) { Object.assign(state, { product: f.product || '', segment: f.segment || '', alert: f.alert || '' }); sessionStorage.removeItem('px_eval_preset'); }
  } catch { /* ignora */ }
  state.selecting = false; state.selected.clear(); state.shown = 60;
  const m = store.meta;
  el.innerHTML = String(html`
    <div class="page-head">
      <div><h2>Atendimentos auditados</h2><p>Cada card é uma monitoria. Verde = feedback aplicado ao operador.</p></div>
      <div class="grow"></div>
      ${can('admin') ? html`<button class="btn" id="sel-mode">${icon('link')}Links de áudio em lote</button>` : ''}
      <button class="btn" id="exp">${icon('download')}Exportar</button>
      ${can('admin') ? html`<a class="btn primary" href="#/analise-ia">${icon('plus')}Nova monitoria</a>` : ''}
    </div>
    ${filterBar(store, state, { extra: html`
      <select class="select sm" id="f-op" aria-label="Operador"><option value="">Todos os operadores</option>${m.operators.map((o) => html`<option value="${o.id}" ${String(state.operator_id) === String(o.id) ? 'selected' : ''}>${o.name}</option>`)}</select>
      <select class="select sm" id="f-status" aria-label="Status">
        <option value="">Todos os status</option>
        ${Object.entries(STATUS).map(([k, v]) => html`<option value="${k}" ${state.status === k ? 'selected' : ''}>${v}</option>`)}
      </select>
      <select class="select sm" id="f-alert" aria-label="Alerta"><option value="">Todos os alertas</option>${Object.entries(ALERT).map(([k, [t]]) => html`<option value="${k}" ${state.alert === k ? 'selected' : ''}>${t}</option>`)}</select>
      <label class="check small"><input type="checkbox" id="f-adj" ${state.adjusted ? 'checked' : ''}>Com ajustes</label>
      <label class="check small"><input type="checkbox" id="f-crit" ${state.critical ? 'checked' : ''}>Falha crítica</label>
      <div class="grow"></div>
      <input class="input sm" id="f-q" placeholder="Buscar protocolo, cliente, login, áudio…" value="${state.q}" style="min-width:200px">
      <select class="select sm" id="f-sort" aria-label="Ordenar">
        <option value="recentes" ${state.sort === 'recentes' ? 'selected' : ''}>Mais recentes</option>
        <option value="nota_asc" ${state.sort === 'nota_asc' ? 'selected' : ''}>Menor nota</option>
        <option value="nota_desc" ${state.sort === 'nota_desc' ? 'selected' : ''}>Maior nota</option>
        <option value="operador" ${state.sort === 'operador' ? 'selected' : ''}>Operador (A–Z)</option>
      </select>
      <div class="seg" id="f-view"><button data-v="grid" class="${state.view === 'grid' ? 'on' : ''}" aria-label="Cards">${icon('grid')}</button><button data-v="list" class="${state.view === 'list' ? 'on' : ''}" aria-label="Lista">${icon('rows')}</button></div>` })}
    <div id="bulk" hidden></div>
    <div class="row between mb"><span class="t2 small" id="ev-count"></span></div>
    <div id="ev-list"></div>`);

  const reload = () => { state.shown = 60; load(el, ctx); };
  bindFilterBar(el, store, state, reload);
  $('#f-op').onchange = (e) => { state.operator_id = e.target.value; reload(); };
  $('#f-status').onchange = (e) => { state.status = e.target.value; reload(); };
  $('#f-alert').onchange = (e) => { state.alert = e.target.value; reload(); };
  $('#f-adj').onchange = (e) => { state.adjusted = e.target.checked; reload(); };
  $('#f-crit').onchange = (e) => { state.critical = e.target.checked; reload(); };
  $('#f-sort').onchange = (e) => { state.sort = e.target.value; reload(); };
  $('#f-q').addEventListener('input', debounce((e) => { state.q = e.target.value; reload(); }, 300));
  $$('#f-view button').forEach((b) => b.addEventListener('click', () => {
    state.view = b.dataset.v; localStorage.setItem('px_eval_view', state.view);
    $$('#f-view button').forEach((x) => x.classList.toggle('on', x === b)); draw(el, ctx);
  }));
  $('#exp').onclick = async (e) => { busy(e.currentTarget, true); try { await downloadEvaluations(await api.get(`/export/evaluations${qs(params(store))}`)); } catch (ex) { toast(ex.message, 'err'); } busy(e.currentTarget, false); };
  $('#sel-mode')?.addEventListener('click', () => { state.selecting = !state.selecting; state.selected.clear(); drawBulk(el, ctx); draw(el, ctx); });
  await load(el, ctx);
}

function params(store) {
  return { cycle_id: store.cycle, product: state.product, segment: state.segment, alert: state.alert, team: state.team, status: state.status, operator_id: state.operator_id, adjusted: state.adjusted ? 1 : '', critical: state.critical ? 1 : '', q: state.q, sort: state.sort };
}

let rows = [];
async function load(el, ctx) {
  const list = $('#ev-list', el);
  list.style.opacity = '.5';
  rows = await api.get(`/evaluations${qs(params(ctx.store))}`);
  if (!ctx.isCurrent()) return;
  list.style.opacity = '';
  draw(el, ctx);
}

function draw(el, ctx) {
  const list = $('#ev-list', el);
  const fb = rows.filter((r) => r.status === 'feedback_aplicado').length;
  $('#ev-count', el).innerHTML = String(html`<b>${rows.length}</b> atendimento(s) · <span style="color:var(--ok-ink)">${fb} com feedback</span> · ${rows.length - fb} sem feedback`);
  if (!rows.length) { list.innerHTML = String(emptyState('search', 'Nenhum atendimento encontrado', 'Ajuste os filtros ou importe novas monitorias.')); return; }
  const shown = rows.slice(0, state.shown);
  if (state.view === 'grid') {
    list.innerHTML = String(html`<div class="ev-grid">${shown.map((e) => evalCard(e, { selectable: state.selecting, selected: state.selected.has(e.id) }))}</div>`);
  } else {
    list.innerHTML = String(html`<div class="card"><div class="table-wrap"><table class="tbl">
      <thead><tr>${state.selecting ? html`<th></th>` : ''}<th>Operador</th><th>Produto</th><th>Data</th><th>Protocolo</th><th class="right">Speech</th><th class="right">Final</th><th>Status</th><th>Áudio</th></tr></thead>
      <tbody>${shown.map((e) => html`<tr class="click" data-ev="${e.id}" style="${e.status === 'feedback_aplicado' ? 'box-shadow:inset 3px 0 0 var(--ok)' : ''}">
        ${state.selecting ? html`<td class="sel"><input type="checkbox" data-sel="${e.id}" ${state.selected.has(e.id) ? 'checked' : ''}></td>` : ''}
        <td><div class="who">${avatar(e.operator_name, 'sm')}<div><b>${e.operator_name}</b><span>${e.team || ''}</span></div></div></td>
        <td>${productChip(e.product, e.segment)}</td><td class="nowrap">${fmtDate(e.call_date)}</td><td class="small">${e.protocol || '—'}</td>
        <td class="right num">${fmtScore(e.speech_score)}</td><td class="right"><b class="num">${fmtScore(e.final_score)}</b></td>
        <td>${e.status === 'feedback_aplicado' ? html`<span class="chip ok">${icon('checkCircle')}Feedback aplicado</span>` : e.status === 'revisada' ? html`<span class="chip info">Revisada</span>` : html`<span class="chip warn">Pendente</span>`}</td>
        <td>${e.audio_link ? html`<a class="btn sm ghost" data-stop href="${e.audio_link}" target="_blank" rel="noopener">${icon('play')}</a>` : '—'}</td>
      </tr>`)}</tbody></table></div></div>`);
  }
  if (rows.length > state.shown) {
    list.insertAdjacentHTML('beforeend', `<div class="center mt"><button class="btn" id="more">Carregar mais (${rows.length - state.shown} restantes)</button></div>`);
    $('#more', list).onclick = () => { state.shown += 60; draw(el, ctx); };
  }
  bindEvalCards(list, ctx.navigate);
  $$('[data-sel]', list).forEach((cb) => cb.addEventListener('change', () => {
    const id = Number(cb.dataset.sel);
    cb.checked ? state.selected.add(id) : state.selected.delete(id);
    cb.closest('[data-ev]')?.classList.toggle('selected', cb.checked);
    drawBulk(el, ctx);
  }));
  $$('td.sel', list).forEach((td) => td.addEventListener('click', (e) => e.stopPropagation()));
}

function drawBulk(el, ctx) {
  const b = $('#bulk', el);
  if (!state.selecting) { b.hidden = true; $('#sel-mode').classList.remove('primary'); return; }
  $('#sel-mode').classList.add('primary');
  b.hidden = false;
  b.innerHTML = String(html`<div class="banner info">${icon('link')}<div style="flex:1"><b>Modo de edição de links de áudio.</b> Selecione os cards e aplique o link da pasta do OneDrive. <span class="t2">${state.selected.size} selecionado(s).</span></div>
    <button class="btn sm" id="sel-all">Selecionar todos (${rows.length})</button>
    <button class="btn sm primary" id="sel-apply" ${state.selected.size ? '' : 'disabled'}>${icon('link')}Definir link</button>
    <button class="btn sm ghost" id="sel-cancel">Cancelar</button></div>`);
  $('#sel-all', b).onclick = () => { rows.forEach((r) => state.selected.add(r.id)); drawBulk(el, ctx); draw(el, ctx); };
  $('#sel-cancel', b).onclick = () => { state.selecting = false; state.selected.clear(); drawBulk(el, ctx); draw(el, ctx); };
  $('#sel-apply', b).onclick = () => bulkAudio([...state.selected], async () => { state.selecting = false; state.selected.clear(); drawBulk(el, ctx); await load(el, ctx); });
  void userName;
}

export function bulkAudio(ids, done) {
  modal({
    title: 'Link de áudio em lote',
    body: html`<p class="t2" style="margin-top:0">Aplica o link a <b>${ids.length}</b> atendimento(s). Pode ser a pasta do OneDrive da quinzena ou de um operador.</p>
      <div class="field"><label for="ba-url">Link do OneDrive / SharePoint</label><input class="input" id="ba-url" type="url" placeholder="https://..." required></div>
      <label class="check"><input type="checkbox" id="ba-only"> Aplicar somente onde ainda não há link próprio</label>
      <p class="tiny muted">Deixe vazio para remover o link próprio (o card volta a usar a pasta da quinzena).</p>`,
    foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="ba-ok">Aplicar</button>`,
    onMount: (m, close) => {
      $('#ba-ok', m).onclick = async (e) => {
        busy(e.currentTarget, true);
        try {
          const r = await api.post('/evaluations/bulk-audio', { ids, audio_url: $('#ba-url', m).value.trim(), mode: $('#ba-only', m).checked ? 'only_empty' : 'replace' });
          toast(`${r.updated} atendimento(s) atualizados.`); close(); done?.();
        } catch (ex) { toast(ex.message, 'err'); busy(e.currentTarget, false); }
      };
    },
  });
}

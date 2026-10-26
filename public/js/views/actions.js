import { api, qs } from '../api.js';
import { html, icon, $, $$, fmtDate, toast, modal, busy, debounce, emptyState, confirmDialog } from '../ui.js';

// Ações (feedbacks, análises, calibragens e ações manuais) — cada linha vai para a planilha "CONTROLE DE AÇÕES"
const SOURCE = { feedback: ['Feedback', 'ok'], analise: ['Análise', 'info'], ia: ['Análise com IA', 'brand'], contestacao: ['Calibragem', 'warn'], manual: ['Registro manual', 'outline'] };
const SYNC = { enviado: ['Na planilha', 'ok', 'checkCircle'], pendente: ['Na fila', '', 'msgClock'], enviando: ['Enviando', 'brand', 'refresh'], erro: ['Erro no envio', 'bad', 'alert'], ignorado: ['Planilha desligada', 'outline', 'minus'] };
const state = { from: '', to: '', operator_id: '', source: '', status: '', q: '' };
let data = null;

export async function render(el, _p, ctx) {
  const { store, can } = ctx;
  ctx.setTitle('Ações', 'Feedbacks');
  el.innerHTML = String(html`
    <div class="page-head"><div><h2>Controle de ações</h2><p>Tudo o que é feito com os operadores, linha a linha, como na planilha “CONTROLE DE AÇÕES”. Feedbacks, análises e calibragens entram sozinhos; o resto você registra aqui.</p></div>
      <div class="grow"></div>
      ${can('admin', 'qualidade') ? html`<button class="btn" id="ac-sync">${icon('refresh')}Reenviar pendentes</button><button class="btn primary" id="ac-new">${icon('plus')}Registrar ação</button>` : ''}</div>
    <div id="ac-banner"></div>
    <div class="filters">
      <span class="muted">${icon('filter')}</span>
      <input class="input sm" type="date" id="ac-from" value="${state.from}" aria-label="De"><span class="small muted">até</span><input class="input sm" type="date" id="ac-to" value="${state.to}" aria-label="Até">
      <select class="select sm" id="ac-op" aria-label="Operador"><option value="">Todos os operadores</option>${store.meta.operators.map((o) => html`<option value="${o.id}" ${String(state.operator_id) === String(o.id) ? 'selected' : ''}>${o.name}${o.login ? ` (${o.login})` : ''}</option>`)}</select>
      <select class="select sm" id="ac-src" aria-label="Origem"><option value="">Todas as origens</option>${Object.entries(SOURCE).map(([k, [l]]) => html`<option value="${k}" ${state.source === k ? 'selected' : ''}>${l}</option>`)}</select>
      <select class="select sm" id="ac-st" aria-label="Envio"><option value="">Todos os envios</option><option value="pendentes" ${state.status === 'pendentes' ? 'selected' : ''}>Pendentes ou com erro</option><option value="enviado" ${state.status === 'enviado' ? 'selected' : ''}>Na planilha</option></select>
      <div class="grow"></div><input class="input sm" id="ac-q" placeholder="Buscar login, obs, responsável…" value="${state.q}" style="min-width:220px">
    </div>
    <div id="ac-list"></div>`);
  const reload = () => load(el, ctx);
  [['#ac-from', 'from'], ['#ac-to', 'to'], ['#ac-op', 'operator_id'], ['#ac-src', 'source'], ['#ac-st', 'status']].forEach(([s, k]) => { $(s).onchange = (e) => { state[k] = e.target.value; reload(); }; });
  $('#ac-q').addEventListener('input', debounce((e) => { state.q = e.target.value; reload(); }, 300));
  $('#ac-new')?.addEventListener('click', () => newAction(el, ctx));
  $('#ac-sync')?.addEventListener('click', async (e) => {
    const btnEl = e.currentTarget;
    busy(btnEl, true, 'Enviando');
    try { const r = await api.post('/actions/sync'); toast(r.skipped ? 'O envio para a planilha está desligado (Configurações).' : r.failed ? `${r.sent} enviada(s), ${r.failed} com erro: ${r.error}` : `${r.sent} linha(s) enviada(s) para a planilha.`, r.failed || r.skipped ? 'err' : 'ok', 6000); ctx.refreshMeta(); reload(); }
    catch (ex) { toast(ex.message, 'err'); }
    busy(btnEl, false);
  });
  await load(el, ctx);
}

async function load(el, ctx) {
  const box = $('#ac-list', el);
  box.style.opacity = '.5';
  data = await api.get(`/actions${qs(state)}`);
  if (!ctx.isCurrent()) return;
  box.style.opacity = '';
  const { rows, sheet } = data;
  const errors = rows.filter((r) => r.sync_status === 'erro').length;
  $('#ac-banner', el).innerHTML = String(!sheet.configured
    ? html`<div class="banner warn">${icon('alert')}<div>A planilha online ainda não está conectada. As ações ficam registradas aqui e são enviadas quando o admin configurar em <a href="#/configuracoes">Configurações › Planilha de ações</a>.</div></div>`
    : !sheet.enabled ? html`<div class="banner info">${icon('info')}<div>O envio para a planilha está desligado em Configurações. As ações continuam registradas aqui.</div></div>`
      : errors ? html`<div class="banner warn">${icon('alert')}<div><b>${errors} linha(s) não foram para a planilha.</b> Elas são reenviadas automaticamente; use “Reenviar pendentes” para tentar agora.</div></div>`
        : html`<div class="banner ok">${icon('checkCircle')}<div>Conectado à planilha online. Cada ação registrada vai para ela em seguida, uma linha por ação.</div></div>`);
  if (!rows.length) { box.innerHTML = String(emptyState('list', 'Nenhuma ação no filtro', 'Feedbacks, análises e calibragens aparecem aqui assim que são registrados.')); return; }
  const canEdit = ctx.can('admin', 'qualidade');
  box.innerHTML = String(html`<div class="card"><div class="table-wrap"><table class="tbl">
    <thead><tr><th>Data</th><th>Login</th><th>Segmento</th><th>Tema</th><th>Ação</th><th>Obs</th><th>Responsável</th><th>Origem</th><th>Planilha</th><th></th></tr></thead>
    <tbody>${rows.map((r) => html`<tr>
      <td class="nowrap">${fmtDate(r.action_date)}</td>
      <td><b>${r.login || '—'}</b><div class="tiny muted">${r.operator_name || ''}</div></td>
      <td class="small">${r.segment_label || html`<span class="muted">—</span>`}</td>
      <td class="small">${r.theme || '—'}</td><td class="small nowrap">${r.action}</td>
      <td class="small" style="max-width:360px"><div style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden" title="${r.obs || ''}">${r.obs || ''}</div></td>
      <td class="tiny">${r.responsible || '—'}</td>
      <td>${r.evaluation_id ? html`<a class="chip ${SOURCE[r.source]?.[1] || ''}" href="#/atendimentos/${r.evaluation_id}">${SOURCE[r.source]?.[0] || r.source}</a>` : html`<span class="chip ${SOURCE[r.source]?.[1] || ''}">${SOURCE[r.source]?.[0] || r.source}</span>`}</td>
      <td><span class="chip ${SYNC[r.sync_status][1]}" title="${r.sync_error || (r.synced_at ? `Enviada ${fmtDate(r.synced_at, true)}` : '')}">${icon(SYNC[r.sync_status][2])}${SYNC[r.sync_status][0]}</span></td>
      <td class="right">${canEdit && !['enviado', 'enviando'].includes(r.sync_status) ? html`<button class="btn-icon" data-del="${r.id}" aria-label="Excluir">${icon('trash')}</button>` : ''}</td>
    </tr>`)}</tbody></table></div></div>
    <p class="tiny muted mt">${rows.length} linha(s)${rows.length >= 500 ? ' · mostrando as 500 mais recentes; use os filtros para ver outras' : ''}.</p>`);
  $$('[data-del]', box).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Excluir ação', 'A linha sai do histórico e não será enviada para a planilha.', { ok: 'Excluir', danger: true }))) return;
    try { await api.del(`/actions/${b.dataset.del}`); toast('Ação excluída.'); load(el, ctx); } catch (ex) { toast(ex.message, 'err'); }
  }));
}

function newAction(el, ctx) {
  const ops = ctx.store.meta.operators.filter((o) => o.active !== false);
  const teams = [...new Set(ops.map((o) => o.team).filter(Boolean))].sort();
  const leaders = [...new Set(ops.map((o) => o.supervisor_name).filter(Boolean))].sort();
  const picked = new Set();
  const today = new Date().toLocaleDateString('en-CA');
  modal({
    title: 'Registrar ação',
    wide: true,
    body: html`<p class="t2" style="margin-top:0">Para ações feitas fora da plataforma (acompanhamento in loco, treinamento, simulador, reunião…). Cada operador selecionado vira uma linha na planilha.</p>
      <div class="grid g-2">
        <div class="field"><label for="na-action">Ação *</label><select class="select" id="na-action">${data.actions.map((a) => html`<option>${a}</option>`)}</select></div>
        <div class="field"><label for="na-theme">Tema *</label><select class="select" id="na-theme">${data.themes.map((t) => html`<option>${t}</option>`)}</select></div>
        <div class="field"><label for="na-date">Data *</label><input class="input" type="date" id="na-date" value="${today}"></div>
        <div class="field"><label for="na-seg">Segmento</label><select class="select" id="na-seg"><option value="">Automático (pela monitoria mais recente do operador)</option>${data.segments.map((s) => html`<option>${s}</option>`)}</select></div>
      </div>
      <div class="field"><label for="na-obs">Observação</label><input class="input" id="na-obs" maxlength="300" placeholder="Ex.: Acompanhamento in loco com ofensores"></div>
      <div class="field"><span class="lbl">Operadores * <span class="muted" id="na-count">(0 selecionados)</span></span>
        <div class="row" style="gap:8px;margin-bottom:8px">
          <input class="input sm" id="na-find" placeholder="Buscar nome ou login…" style="flex:1;min-width:180px">
          ${teams.length > 1 ? html`<select class="select sm" id="na-team"><option value="">Todas as equipes</option>${teams.map((t) => html`<option>${t}</option>`)}</select>` : ''}
          ${leaders.length ? html`<select class="select sm" id="na-lead"><option value="">Todos os líderes</option>${leaders.map((t) => html`<option>${t}</option>`)}</select>` : ''}
          <button type="button" class="btn sm ghost" id="na-all">Marcar visíveis</button><button type="button" class="btn sm ghost" id="na-none">Limpar</button>
        </div>
        <div id="na-ops" class="stack" style="gap:4px;max-height:260px;overflow:auto;padding:6px;border:1px solid var(--border);border-radius:12px"></div></div>`,
    foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="na-ok">${icon('check')}Registrar</button>`,
    onMount: (m, close) => {
      const visible = () => {
        const q = $('#na-find', m).value.trim().toLowerCase(), team = $('#na-team', m)?.value || '', lead = $('#na-lead', m)?.value || '';
        return ops.filter((o) => (!q || `${o.name} ${o.login || ''}`.toLowerCase().includes(q)) && (!team || o.team === team) && (!lead || o.supervisor_name === lead));
      };
      const paint = () => {
        const list = visible();
        $('#na-ops', m).innerHTML = String(list.length ? html`${list.slice(0, 400).map((o) => html`<label class="check small"><input type="checkbox" value="${o.id}" ${picked.has(o.id) ? 'checked' : ''}><span><b>${o.name}</b> <span class="muted">${o.login || o.registration || ''}${o.supervisor_name ? ` · ${o.supervisor_name}` : ''}</span></span></label>`)}` : html`<span class="small muted">Nenhum operador no filtro.</span>`);
        $$('#na-ops input', m).forEach((i) => i.addEventListener('change', () => { const id = Number(i.value); i.checked ? picked.add(id) : picked.delete(id); count(); }));
      };
      const count = () => { $('#na-count', m).textContent = `(${picked.size} selecionado${picked.size === 1 ? '' : 's'})`; };
      $('#na-find', m).addEventListener('input', debounce(paint, 150));
      $('#na-team', m)?.addEventListener('change', paint);
      $('#na-lead', m)?.addEventListener('change', paint);
      $('#na-all', m).onclick = () => { visible().forEach((o) => picked.add(o.id)); paint(); count(); };
      $('#na-none', m).onclick = () => { picked.clear(); paint(); count(); };
      paint();
      $('#na-ok', m).onclick = async (x) => {
        const btnEl = x.currentTarget;
        if (!picked.size) { toast('Selecione ao menos um operador.', 'err'); return; }
        busy(btnEl, true, 'Registrando');
        try {
          const r = await api.post('/actions', { operator_ids: [...picked], action: $('#na-action', m).value, theme: $('#na-theme', m).value, action_date: $('#na-date', m).value, segment_label: $('#na-seg', m).value, obs: $('#na-obs', m).value.trim() });
          close();
          toast(`${r.created} ação(ões) registrada(s)${r.sync?.sent ? ` · ${r.sync.sent} na planilha` : ''}${r.sync?.failed ? ` · ${r.sync.failed} com erro no envio` : ''}.`, r.sync?.failed ? 'err' : 'ok', 5000);
          ctx.refreshMeta(); load(el, ctx);
        } catch (ex) { toast(ex.message, 'err'); busy(btnEl, false); }
      };
    },
  });
}

export const hasUnsavedChanges = () => !!document.querySelector('.modal #na-ops input:checked');

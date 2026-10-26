import { api, qs } from '../api.js';
import { html, icon, $, $$, fmtScore, avatar, sparkline, deltaTag, band, emptyState, modal, toast, busy, debounce, PRODUCT_SHORT } from '../ui.js';
import { filterBar, bindFilterBar } from './dashboard.js';
import { palette } from '../charts.js';

const state = { product: '', segment: '', team: '', q: '', sort: 'media' };
const opInfo = (o) => [o.supervisor_name && `Líder ${o.supervisor_name}`, o.team].filter(Boolean).join(' · ') || 'Sem equipe';

export async function render(el, _p, ctx) {
  const { store, can } = ctx;
  el.innerHTML = String(html`
    <div class="page-head"><div><h2>Operadores</h2><p>Desempenho individual, evolução por quinzena e situação dos feedbacks.</p></div><div class="grow"></div>
      ${can('admin', 'qualidade') ? html`<button class="btn primary" id="new-op">${icon('plus')}Novo operador</button>` : ''}</div>
    ${filterBar(store, state, { extra: html`<div class="grow"></div><input class="input sm" id="o-q" placeholder="Buscar operador…" value="${state.q}">
      <select class="select sm" id="o-sort"><option value="media">Maior média</option><option value="evolucao">Maior evolução</option><option value="pendentes">Mais feedbacks pendentes</option><option value="nome">Nome (A–Z)</option></select>` })}
    <div id="ops"></div>`);
  $('#o-sort').value = state.sort;
  const reload = () => load(el, ctx);
  bindFilterBar(el, store, state, reload);
  $('#o-q').addEventListener('input', debounce((e) => { state.q = e.target.value; draw(el, ctx); }, 200));
  $('#o-sort').onchange = (e) => { state.sort = e.target.value; draw(el, ctx); };
  $('#new-op')?.addEventListener('click', () => editOperator(null, ctx, reload));
  await load(el, ctx);
}

let data = null;
async function load(el, ctx) {
  data = await api.get(`/stats/overview${qs({ cycle_id: ctx.store.cycle, product: state.product, segment: state.segment, team: state.team })}`);
  if (!ctx.isCurrent()) return;
  draw(el, ctx);
}

function draw(el, ctx) {
  const c = palette();
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let ops = data.operators.filter((o) => !state.q || norm(o.name).includes(norm(state.q)));
  const sorters = { media: (a, b) => (b.avg ?? -1) - (a.avg ?? -1), evolucao: (a, b) => (b.delta ?? -999) - (a.delta ?? -999), pendentes: (a, b) => b.pending_feedback - a.pending_feedback, nome: (a, b) => a.name.localeCompare(b.name) };
  ops = ops.sort(sorters[state.sort]);
  const box = $('#ops', el);
  const without = ctx.store.meta.operators.filter((o) => !data.operators.some((x) => x.operator_id === o.id) && (!state.q || norm(o.name).includes(norm(state.q))));
  if (!ops.length && !without.length) { box.innerHTML = String(emptyState('users', 'Nenhum operador encontrado', 'Cadastre operadores ou importe monitorias.')); return; }
  box.innerHTML = String(html`<div class="op-grid">${ops.map((o) => html`
    <div class="card op-card" data-op="${o.operator_id}" tabindex="0">
      <div class="row" style="flex-wrap:nowrap">${avatar(o.name)}<div style="min-width:0;flex:1"><b class="ellipsis" style="display:block">${o.name}</b><span class="tiny muted">${opInfo(o)}</span></div>
        <div class="right"><b class="score-txt band-${band(o.avg)} num" style="font-size:22px;letter-spacing:-.03em">${fmtScore(o.avg)}</b><div>${deltaTag(o.delta)}</div></div></div>
      ${sparkline(o.series, { color: c.brand })}
      <div class="op-stats">
        <div><b class="num">${o.total}</b><span>monitorias</span></div>
        ${(o.products || []).slice(0, 2).map((p) => html`<div><b class="num">${fmtScore(o[p.toLowerCase()])}</b><span>${PRODUCT_SHORT[p]}</span></div>`)}
      </div>
      <div class="row mt" style="gap:6px">${o.pending_feedback ? html`<span class="chip warn">${icon('msgClock')}${o.pending_feedback} sem feedback</span>` : html`<span class="chip ok">${icon('checkCircle')}feedbacks em dia</span>`}
        ${o.sd > 15 ? html`<span class="chip outline" title="Desvio-padrão alto">oscilante</span>` : ''}</div>
    </div>`)}
    ${without.map((o) => html`<div class="card op-card" data-op="${o.id}" style="opacity:.7"><div class="row">${avatar(o.name)}<div><b>${o.name}</b><div class="tiny muted">${o.team || 'Sem equipe'} · sem monitorias no filtro</div></div></div></div>`)}
  </div>`);
  $$('[data-op]', box).forEach((card) => {
    card.addEventListener('click', () => ctx.navigate(`operadores/${card.dataset.op}`));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') ctx.navigate(`operadores/${card.dataset.op}`); });
  });
}

export function editOperator(op, ctx, done) {
  const sups = ctx.store.meta.supervisors;
  modal({
    title: op ? 'Editar operador' : 'Novo operador',
    body: html`<form id="op-form">
      <div class="field"><label for="op-name">Nome completo</label><input class="input" id="op-name" name="name" required value="${op?.name || ''}"></div>
      <div class="grid g-2">
        <div class="field"><label for="op-reg">Matrícula / login</label><input class="input" id="op-reg" name="registration" value="${op?.registration || ''}"></div>
        <div class="field"><label for="op-team">Equipe</label><input class="input" id="op-team" name="team" list="teams-dl" value="${op?.team || ''}"><datalist id="teams-dl">${ctx.store.meta.teams.map((t) => html`<option value="${t}">`)}</datalist></div>
      </div>
      <div class="field"><label for="op-sup">Supervisor responsável</label><select class="select" id="op-sup" name="supervisor_user_id"><option value="">— sem vínculo de acesso —</option>${sups.map((s) => html`<option value="${s.id}" ${op?.supervisor_user_id === s.id ? 'selected' : ''}>${s.display_name || s.name}</option>`)}</select>
        <span class="hint">O vínculo permite restringir a visão do supervisor à própria equipe (Configurações).</span></div>
      ${op ? html`<label class="switch"><input type="checkbox" name="active" ${op.active ? 'checked' : ''}> Operador ativo</label>` : ''}
    </form>`,
    foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="op-save">Salvar</button>`,
    onMount: (m, close) => {
      $('#op-save', m).onclick = async (e) => {
        const f = $('#op-form', m);
        if (!f.reportValidity()) return;
        const body = { name: f.name.value, registration: f.registration.value, team: f.team.value, supervisor_user_id: f.supervisor_user_id.value || null, active: op ? f.active.checked : true };
        busy(e.currentTarget, true);
        try { op ? await api.put(`/operators/${op.id}`, body) : await api.post('/operators', body); toast('Operador salvo.'); close(); await ctx.refreshMeta(); done?.(); }
        catch (ex) { toast(ex.message, 'err'); busy(e.currentTarget, false); }
      };
    },
  });
}

import { api, qs } from '../api.js';
import { downloadFeedbacks } from '../files.js';
import { html, icon, $, $$, fmtScore, fmtDate, avatar, productChip, emptyState, toast, busy, debounce, band, ROLE } from '../ui.js';
import { filterBar, bindFilterBar } from './dashboard.js';
import { evalCard, bindEvalCards } from './evaluations.js';

const state = { product: '', team: '', q: '', group: localStorage.getItem('px_fb_group') || 'operador' };

export async function render(el, [kind], ctx) {
  if (kind === 'aplicados') return renderApplied(el, ctx);
  return renderPending(el, ctx);
}

async function renderPending(el, ctx) {
  const { store } = ctx;
  ctx.setTitle('Feedbacks pendentes', 'Feedbacks');
  el.innerHTML = String(html`
    <div class="page-head"><div><h2>Feedbacks pendentes</h2><p>Monitorias que ainda não tiveram feedback registrado. Priorize falhas críticas e notas baixas.</p></div></div>
    ${filterBar(store, state, { extra: html`<div class="grow"></div><div class="seg" id="g-mode"><button data-v="operador" class="${state.group === 'operador' ? 'on' : ''}">Por operador</button><button data-v="prioridade" class="${state.group === 'prioridade' ? 'on' : ''}">Por prioridade</button></div>` })}
    <div id="pend"></div>`);
  const reload = () => load();
  bindFilterBar(el, store, state, reload);
  $$('#g-mode button').forEach((b) => b.addEventListener('click', () => { state.group = b.dataset.v; localStorage.setItem('px_fb_group', state.group); $$('#g-mode button').forEach((x) => x.classList.toggle('on', x === b)); load(); }));
  const load = async () => {
    const rows = await api.get(`/evaluations${qs({ cycle_id: store.cycle, product: state.product, team: state.team, feedback: 'pending', sort: 'nota_asc' })}`);
    if (!ctx.isCurrent()) return;
    const box = $('#pend', el);
    if (!rows.length) { box.innerHTML = String(emptyState('checkCircle', 'Tudo em dia!', 'Todas as monitorias do filtro já têm feedback aplicado.')); return; }
    const notReviewed = rows.filter((r) => r.status === 'pendente').length;
    const header = html`<div class="grid g-4 mb">
      ${tile('Sem feedback', rows.length, 'msgClock', 'warn')}${tile('Falhas críticas', rows.filter((r) => r.critical_fail).length, 'alert', 'bad')}
      ${tile('Nota abaixo de 70', rows.filter((r) => r.final_score != null && r.final_score < 70).length, 'trendDown', 'bad')}${tile('Aguardando revisão da Qualidade', notReviewed, 'edit', '')}</div>`;
    if (state.group === 'prioridade') {
      const prio = [...rows].sort((a, b) => (b.critical_fail - a.critical_fail) || ((a.final_score ?? 101) - (b.final_score ?? 101)));
      box.innerHTML = String(html`${header}<div class="ev-grid">${prio.map((e) => evalCard(e))}</div>`);
    } else {
      const groups = new Map();
      rows.forEach((r) => { const g = groups.get(r.operator_id) || { name: r.operator_name, team: r.team, id: r.operator_id, rows: [] }; g.rows.push(r); groups.set(r.operator_id, g); });
      const list = [...groups.values()].sort((a, b) => b.rows.length - a.rows.length);
      box.innerHTML = String(html`${header}${list.map((g) => html`<div class="card mb">
        <div class="card-head">${avatar(g.name)}<div><h3>${g.name}</h3><div class="sub">${g.team || ''} · ${g.rows.length} monitoria(s) sem feedback · menor nota ${fmtScore(Math.min(...g.rows.map((r) => r.final_score ?? 100)))}</div></div><div class="grow"></div><a class="btn sm ghost" href="#/operadores/${g.id}">Perfil ${icon('chevRight')}</a></div>
        <div class="card-body"><div class="ev-grid">${g.rows.map((e) => evalCard(e))}</div></div></div>`)}`);
    }
    bindEvalCards(box, (p) => { sessionStorage.setItem('px_ev_tab', 'feedback'); ctx.navigate(p); });
  };
  await load();
}

function tile(label, val, ic, tone) {
  const tones = { bad: 'background:var(--bad-soft);color:var(--bad-ink)', warn: 'background:var(--warn-soft);color:var(--warn-ink)' };
  return html`<div class="card kpi"><div class="k-label"><span class="k-ic" style="${tones[tone] || ''}">${icon(ic)}</span>${label}</div><div class="k-val num">${val}</div></div>`;
}

async function renderApplied(el, ctx) {
  const { store } = ctx;
  ctx.setTitle('Feedbacks aplicados', 'Feedbacks');
  const m = store.meta;
  const st = { operator_id: '', from: '', to: '' };
  el.innerHTML = String(html`
    <div class="page-head"><div><h2>Feedbacks aplicados</h2><p>Histórico completo do que foi passado a cada operador, por quem e quando.</p></div><div class="grow"></div>
      <button class="btn" id="fb-exp">${icon('download')}Exportar Excel</button></div>
    ${filterBar(store, state, { extra: html`
      <select class="select sm" id="fa-op"><option value="">Todos os operadores</option>${m.operators.map((o) => html`<option value="${o.id}">${o.name}</option>`)}</select>
      <input type="date" class="input sm" id="fa-from" aria-label="De"><input type="date" class="input sm" id="fa-to" aria-label="Até">
      <div class="grow"></div><input class="input sm" id="fa-q" placeholder="Buscar no conteúdo…">` })}
    <div id="fa-sum"></div><div id="fa-list"></div>`);
  const load = async () => {
    const rows = await api.get(`/feedbacks${qs({ cycle_id: store.cycle, product: state.product, team: state.team, operator_id: st.operator_id, from: st.from, to: st.to, q: state.q })}`);
    if (!ctx.isCurrent()) return;
    const box = $('#fa-list', el);
    const by = new Map(); rows.forEach((r) => by.set(r.applied_by_display || r.applied_by_name, (by.get(r.applied_by_display || r.applied_by_name) || 0) + 1));
    $('#fa-sum', el).innerHTML = String(html`<div class="grid g-4 mb">
      ${tile('Feedbacks aplicados', rows.length, 'msgCheck', '')}
      ${tile('Operadores atendidos', new Set(rows.map((r) => r.operator_id)).size, 'users', '')}
      ${tile('Com ciência do operador', rows.filter((r) => r.operator_ack).length, 'checkCircle', '')}
      ${tile('Com reavaliação agendada', rows.filter((r) => r.followup_date).length, 'calendar', '')}</div>`);
    if (!rows.length) { box.innerHTML = String(emptyState('msgCheck', 'Nenhum feedback encontrado', 'Os feedbacks registrados nos atendimentos aparecem aqui.')); return; }
    box.innerHTML = String(html`<div class="stack">${rows.map((f) => html`<div class="fb-card" style="cursor:pointer" data-ev="${f.evaluation_id}">
      <div class="fb-h">${avatar(f.operator_name)}<div class="grow"><b>${f.operator_name}</b> <span class="tiny muted">${f.team || ''}</span>
        <div class="tiny muted">${f.cycle_name || ''} · ligação ${fmtDate(f.call_date)} · ${f.protocol || ''}</div></div>
        ${productChip(f.product)}<span class="chip">nota <b class="score-txt band-${band(f.final_score)}" style="margin-left:4px">${fmtScore(f.final_score)}</b></span>
        <span class="chip ok">${icon('checkCircle')}${fmtDate(f.applied_at)}</span></div>
      <p class="small">${f.content}</p>
      <div class="row tiny muted mt-0" style="margin-top:10px">${icon('user')}<span>${f.applied_by_display || f.applied_by_name} · ${ROLE[f.applied_by_role] || ''}${f.modality ? ` · ${f.modality}` : ''}${f.operator_ack ? ' · operador ciente' : ''}${f.followup_date ? ` · reavaliar em ${fmtDate(f.followup_date)}` : ''}</span></div>
    </div>`)}</div>`);
    $$('[data-ev]', box).forEach((c) => c.addEventListener('click', () => { sessionStorage.setItem('px_ev_tab', 'feedback'); ctx.navigate(`atendimentos/${c.dataset.ev}`); }));
  };
  bindFilterBar(el, store, state, load);
  $('#fa-op').onchange = (e) => { st.operator_id = e.target.value; load(); };
  $('#fa-from').onchange = (e) => { st.from = e.target.value; load(); };
  $('#fa-to').onchange = (e) => { st.to = e.target.value; load(); };
  $('#fa-q').addEventListener('input', debounce((e) => { state.q = e.target.value; load(); }, 300));
  $('#fb-exp').onclick = async (e) => { busy(e.currentTarget, true); try { await downloadFeedbacks(await api.get('/export/feedbacks')); } catch (ex) { toast(ex.message, 'err'); } busy(e.currentTarget, false); };
  await load();
}

import { api, qs } from '../api.js';
import { html, icon, $, $$, fmtScore, fmtDate, fmtRel, avatar, productChip, emptyState, band, CONTEST } from '../ui.js';

// Contestações de monitoria: a supervisão abre no card; a Qualidade responde no próprio card
const TABS = [['aberta', 'Abertas'], ['respondidas', 'Respondidas'], ['', 'Todas']];
let tab = 'aberta';

export async function render(el, _p, ctx) {
  const quality = ctx.can('admin', 'qualidade');
  ctx.setTitle('Contestações', 'Feedbacks');
  el.innerHTML = String(html`
    <div class="page-head"><div><h2>Contestações</h2>
      <p>${quality ? 'Pedidos de revisão enviados pela supervisão. Abra o card, confira a análise e aceite (ajustando os itens) ou recuse, sempre com resposta.' : 'Monitorias que você pediu para a Qualidade revisar. Para contestar, abra o card do atendimento e use “Contestar monitoria”.'}</p></div></div>
    <div class="seg mb" id="ct-tabs">${TABS.map(([k, l]) => html`<button data-v="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`)}</div>
    <div id="ct-list"></div>`);
  $$('#ct-tabs button', el).forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.v; $$('#ct-tabs button', el).forEach((x) => x.classList.toggle('on', x === b)); load(el, ctx);
  }));
  await load(el, ctx);
}

async function load(el, ctx) {
  const box = $('#ct-list', el);
  box.style.opacity = '.5';
  let rows = await api.get(`/contests${qs({ status: tab === 'respondidas' ? '' : tab })}`);
  if (!ctx.isCurrent()) return;
  box.style.opacity = '';
  if (tab === 'respondidas') rows = rows.filter((r) => r.status === 'aceita' || r.status === 'recusada');
  if (!rows.length) {
    box.innerHTML = String(emptyState('flag', tab === 'aberta' ? 'Nenhuma contestação aberta' : 'Nenhuma contestação aqui', tab === 'aberta' ? 'Quando a supervisão contestar uma monitoria, ela aparece nesta lista.' : 'As contestações respondidas ficam registradas aqui.'));
    return;
  }
  box.innerHTML = String(html`<div class="stack">${rows.map((c) => html`<div class="fb-card" style="cursor:pointer" data-ev="${c.evaluation_id}" tabindex="0">
    <div class="fb-h">${avatar(c.operator_name)}<div class="grow"><b>${c.operator_name}</b> <span class="tiny muted">${c.supervisor_name ? `Líder ${c.supervisor_name}` : c.team || ''}</span>
      <div class="tiny muted">ligação ${fmtDate(c.call_date)} · ${c.protocol || ''} · nota <b class="score-txt band-${band(c.final_score)}">${fmtScore(c.final_score)}</b></div></div>
      ${productChip(c.product, c.segment)}<span class="chip ${CONTEST[c.status][1]}">${icon('flag')}${CONTEST[c.status][0]}</span></div>
    <p class="small" style="margin:8px 0 0">“${c.reason}”</p>
    ${c.criteria?.length ? html`<div class="row" style="gap:6px;margin-top:6px">${c.criteria.map((i) => html`<span class="chip outline">${i.code} · ${i.name}</span>`)}</div>` : ''}
    ${c.response ? html`<p class="small t2" style="margin:8px 0 0"><b>Resposta:</b> ${c.response}</p>` : ''}
    <div class="row tiny muted" style="margin-top:10px">${icon('user')}<span>Aberta por ${c.requested_by_display || c.requested_by_name || '—'} ${fmtRel(c.created_at)}${c.responded_at && c.status !== 'cancelada' ? ` · respondida por ${c.responded_by_display || c.responded_by_name} ${fmtRel(c.responded_at)}` : ''}</span></div>
  </div>`)}</div>`);
  $$('[data-ev]', box).forEach((card) => {
    const go = () => ctx.navigate(`atendimentos/${card.dataset.ev}`);
    card.addEventListener('click', go);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
}

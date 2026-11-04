import { api } from '../api.js';
import { html, icon, $, $$, emptyState } from '../ui.js';
import { lineChart } from '../charts.js';
import { CARTEIRA_INFO, userCarteiras, viewCarteira } from '../carteira.js';

// Nota de qualidade (Porto, Safra BS e Safra ADM e Call): a nota fechada de cada mês, trazida pelo report de
// qualidade da carteira (.html importado em Importar monitorias). Evolução mês a mês, supervisões, ranking dos
// operadores contra a meta, distribuição, contestações e ações da analista.
export const NOTA_CARTEIRAS = ['SAFRA BS', 'SAFRA ADM', 'PORTO'];
const st = { carteira: '', month: '' };
const f1 = (v, d = 2) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const delta = (a, b) => (a == null || b == null ? null : Math.round((a - b) * 100) / 100);
const tone = (v, goal = 80) => (v == null ? 'na' : v >= goal ? 'gold' : v === 0 ? 'zero' : v >= 50 ? 'mid' : 'low');
const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export async function render(el, _p, ctx) {
  ctx.setTitle('Nota de qualidade', 'Visão geral');
  const own = userCarteiras(ctx.store.user).filter((c) => NOTA_CARTEIRAS.includes(c));
  const view = viewCarteira(ctx.store.user);
  const allowed = view ? own.filter((c) => c === view) : own;
  if (!allowed.length) { el.innerHTML = String(emptyState('award', 'Nota de qualidade', 'Disponível para as carteiras Porto, Safra BS e Safra ADM e Call. Escolha uma delas no topo.')); return; }
  if (!allowed.includes(st.carteira)) { st.carteira = allowed[0]; st.month = ''; }
  el.innerHTML = '<div class="card card-pad">Carregando…</div>';
  const reports = (await api.get('/reports')).filter((r) => r.kind === 'nota_qualidade');
  if (!ctx.isCurrent()) return;
  const draw = () => {
    const list = reports.filter((r) => r.portfolio === st.carteira && r.data?.month).sort((a, b) => a.data.month.localeCompare(b.data.month));
    const tabs = allowed.length > 1 ? html`<div class="seg mb" role="tablist">${allowed.map((c) => html`<button class="${c === st.carteira ? 'on' : ''}" data-cart="${c}">${CARTEIRA_INFO[c].label}</button>`)}</div>` : '';
    const head = html`<div class="page-head"><div><h2>Nota de qualidade</h2><p>Nota fechada de cada mês da carteira ${CARTEIRA_INFO[st.carteira].label}, por supervisão e por operador, com as contestações e as ações da analista.</p></div><div class="grow"></div>
      ${ctx.can('admin', 'qualidade') ? html`<a class="btn" href="#/importar">${icon('upload')}Importar report do mês</a>` : ''}</div>`;
    if (!list.length) { el.innerHTML = String(html`${head}${tabs}${emptyState('award', 'Nenhum mês importado', `Importe o report de qualidade do mês (.html) da carteira ${CARTEIRA_INFO[st.carteira].label} em Importar monitorias.`)}`); bind(); return; }
    if (!list.some((r) => r.data.month === st.month)) st.month = list[list.length - 1].data.month;
    const cur = list.find((r) => r.data.month === st.month), d = cur.data;
    const idx = list.indexOf(cur), prevRep = list[idx - 1];
    const prev = prevRep?.data?.score ?? d.prev_score;
    const dv = delta(d.score, prev);
    const above = d.ranking.filter((x) => x.score >= (d.goal || 80)).length, zeros = d.ranking.filter((x) => x.score === 0).length;
    const ops = new Map((ctx.store.meta.operators || []).map((o) => [plain(o.name), o.id]));
    // Evolução: os meses importados e, antes do primeiro, o mês anterior que o próprio report traz
    const pts = list.map((r) => ({ label: r.data.month_label.split('/')[0].slice(0, 3), v: r.data.score, sups: r.data.supervisors }));
    if (list[0].data.prev_score != null) pts.unshift({ label: (list[0].data.prev_label || 'Anterior').slice(0, 3), v: list[0].data.prev_score, sups: list[0].data.supervisors.map((s) => ({ name: s.name, score: s.prev })) });
    el.innerHTML = String(html`${head}${tabs}
      <div class="row mb" style="gap:8px;flex-wrap:wrap">${list.slice().reverse().map((r) => html`<button class="chip ${r.data.month === st.month ? 'brand' : 'outline'}" data-month="${r.data.month}" style="cursor:pointer">${r.data.month_label}</button>`)}</div>
      <div class="nq-hero card">
        <div><span class="tiny muted">Nota fechada · ${d.month_label}</span><div class="nq-big num">${f1(d.score)}<small>pontos</small></div>
          ${dv != null ? html`<span class="chip ${dv >= 0 ? 'ok' : 'bad'}">${dv >= 0 ? '▲' : '▼'} ${f1(Math.abs(dv))} pts vs ${prevRep ? prevRep.data.month_label : d.prev_label || 'mês anterior'} (${f1(prev)})</span>` : ''}</div>
        <div class="nq-mini">
          <div><b class="num">${d.operators ?? d.ranking.length}</b><span>operadores</span></div>
          <div><b class="num">${f1(d.avg_operators, 1)}</b><span>média dos operadores</span></div>
          <div><b class="num nq-gold">${above}</b><span>com nota ≥ ${d.goal || 80}</span></div>
          <div><b class="num nq-zero">${zeros}</b><span>com nota zerada</span></div>
        </div>
      </div>
      ${d.reading ? html`<div class="card card-pad mt"><h3>Leitura do período</h3><p class="t2" style="line-height:1.6;margin:6px 0 0">${d.reading}</p>${d.summary ? html`<p class="small" style="margin:10px 0 0">${d.summary}</p>` : ''}</div>` : ''}
      <div class="grid g-2 mt">
        <div class="card card-pad"><h3>Evolução mensal</h3><p class="small t2">Nota da carteira e das supervisões em cada mês.</p><div style="height:240px"><canvas id="nq-evo"></canvas></div>${d.evolution_note ? html`<p class="small t2">${d.evolution_note}</p>` : ''}</div>
        <div class="card card-pad"><h3>Supervisões</h3><p class="small t2">Nota do mês; o traço é o mês anterior.</p>
          ${[...d.supervisors, { name: `${CARTEIRA_INFO[st.carteira].label} · carteira`, score: d.score, prev }].map((s) => html`<div class="nq-sup"><div class="row between"><span>${s.name}</span><span><b class="num">${f1(s.score)}</b> <small class="muted">${s.prev != null ? `antes ${f1(s.prev)}` : ''}</small></span></div>
            <div class="nq-trk"><i class="t-${tone(s.score, d.goal)}" style="width:${Math.min(100, s.score || 0)}%"></i>${s.prev != null ? html`<u style="left:${Math.min(100, s.prev)}%"></u>` : ''}<s style="left:${d.goal || 80}%"></s></div></div>`)}
          <p class="tiny muted">Linha pontilhada: meta de ${d.goal || 80} pontos.</p></div>
      </div>
      <div class="grid g-2 mt">
        <div class="card card-pad"><h3>Ranking dos operadores</h3><p class="small t2">Média final do mês. Dourado: nota ≥ ${d.goal || 80}; vermelho: nota zerada.</p>
          <div class="nq-rank">${d.ranking.map((x) => { const id = ops.get(plain(x.name)); return html`<div class="nq-or t-${tone(x.score, d.goal)}"><span class="rk">${x.rank}</span>${id ? html`<a class="nm" href="#/operadores/${id}">${x.name}</a>` : html`<span class="nm">${x.name}</span>`}
            <div class="nq-trk sm"><i style="width:${Math.min(100, x.score || 0)}%"></i><s style="left:${d.goal || 80}%"></s></div><b class="num">${f1(x.score, 1)}</b></div>`; })}</div></div>
        <div class="stack-col">
          <div class="card card-pad"><h3>Distribuição das notas</h3><div class="nq-dist">${d.dist.map((g, i) => html`<div class="t-${['gold', 'mid', 'low'][i] || 'mid'}"><b class="num">${g.n}</b><span>${g.label}</span><em>${g.pct}</em></div>`)}</div>${d.highlight ? html`<p class="small t2" style="margin:12px 0 0">${d.highlight}</p>` : ''}</div>
          <div class="card card-pad"><h3>Contestações</h3>
            <div class="nq-dist">${(d.contests?.status || []).map((g) => html`<div class="${/aceitas$/i.test(g.label) ? 't-gold' : /não aceita/i.test(g.label) ? 't-low' : 't-na'}"><b class="num">${g.n}</b><span>${g.label}</span><em>${g.pct}</em></div>`)}</div>
            ${d.contests?.accept_rate ? html`<p class="small" style="margin:10px 0 0">Aceite entre as analisadas: <b>${d.contests.accept_rate}</b></p>` : ''}
            ${d.contests?.compare ? html`<table class="tbl mt"><thead><tr>${d.contests.compare.cols.map((c) => html`<th>${c}</th>`)}</tr></thead><tbody>${d.contests.compare.rows.map((r) => html`<tr>${r.map((c) => html`<td>${c}</td>`)}</tr>`)}</tbody></table>` : ''}
            ${d.attention ? html`<div class="banner warn mt" style="margin-bottom:0">${icon('alert')}<span class="small">${d.attention}</span></div>` : ''}</div>
          ${d.actions?.length ? html`<div class="card card-pad"><h3>Ações realizadas</h3><div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px">${d.actions.map((a) => html`<span class="chip">${a}</span>`)}</div>${d.analyst ? html`<p class="tiny muted" style="margin:10px 0 0">Conduzidas pela analista ${d.analyst}.</p>` : ''}</div>` : ''}
        </div>
      </div>
      <p class="tiny muted mt">Fonte: ${cur.file_name || 'report de qualidade'} · importado por ${cur.created_by_name || '—'}. <a href="#/analises/${cur.id}">Ver o arquivo original</a></p>`);
    const sers = [{ label: 'Carteira', data: pts.map((p) => p.v), color: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#c8a45c', fill: true }];
    const names = [...new Set(pts.flatMap((p) => (p.sups || []).map((s) => s.name)))];
    const colors = ['#7c9cff', '#e07a5f', '#3aa6b9', '#9b7fd1'];
    names.forEach((n, i) => sers.push({ label: n, data: pts.map((p) => (p.sups || []).find((s) => s.name === n)?.score ?? null), color: colors[i % colors.length], dash: [5, 4] }));
    lineChart($('#nq-evo', el), pts.map((p) => p.label), sers, { min: 0, max: 100 });
    bind();
  };
  const bind = () => {
    $$('[data-cart]', el).forEach((b) => b.addEventListener('click', () => { st.carteira = b.dataset.cart; st.month = ''; draw(); }));
    $$('[data-month]', el).forEach((b) => b.addEventListener('click', () => { st.month = b.dataset.month; draw(); }));
  };
  draw();
}

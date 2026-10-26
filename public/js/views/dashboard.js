import { api, qs } from '../api.js';
import { html, raw, icon, $, $$, fmtScore, fmtPct, fmtInt, greeting, userName, deltaTag, avatar, sparkline, band, emptyState, esc, PRODUCT, PRODUCT_SHORT, SEGMENT, SEGMENTS_OF, ALERT } from '../ui.js';
import { lineChart, barChart, scatterChart, palette, legendHtml } from '../charts.js';

// Produtos com monitorias (a barra só mostra o que tem dado); sem dados ainda, mostra as carteiras PAN
const productsOf = (m) => (m.products?.length ? m.products.map((p) => p.product) : ['VEICULOS', 'CARTOES', 'CONSIGNADO']);
const segmentOptions = (m, product, segment) => {
  const segs = m.products?.find((p) => p.product === product)?.segments || (SEGMENTS_OF[product] || []).map((sg) => ({ segment: sg }));
  return html`<option value="">Todos os segmentos</option>${segs.map((x) => html`<option value="${x.segment}" ${segment === x.segment ? 'selected' : ''}>${SEGMENT[x.segment]}${x.total != null ? ` (${x.total})` : ''}</option>`)}`;
};

export function filterBar(store, { product = '', team = '', segment = '' } = {}, { showTeam = true, extra = '' } = {}) {
  const m = store.meta;
  return html`<div class="filters">
    <span class="muted">${icon('filter')}</span>
    <select class="select sm" id="f-cycle" aria-label="Quinzena">
      <option value="">Todas as quinzenas</option>
      ${m.cycles.map((c) => html`<option value="${c.id}" ${String(store.cycle) === String(c.id) ? 'selected' : ''}>${c.name}${c.status === 'aberto' ? ' · em andamento' : ''}</option>`)}
    </select>
    <div class="seg" id="f-product" role="group" aria-label="Produto">
      <button data-v="" class="${!product ? 'on' : ''}">Todos</button>
      ${productsOf(m).map((p) => html`<button data-v="${p}" class="${product === p ? 'on' : ''}">${PRODUCT_SHORT[p]}</button>`)}
    </div>
    <select class="select sm" id="f-segment" aria-label="Segmento" ${SEGMENTS_OF[product] ? '' : 'hidden'}>${segmentOptions(m, product, segment)}</select>
    ${showTeam && m.teams.length > 1 ? html`<select class="select sm" id="f-team" aria-label="Equipe"><option value="">Todas as equipes</option>${m.teams.map((t) => html`<option ${team === t ? 'selected' : ''}>${t}</option>`)}</select>` : ''}
    ${extra}
  </div>`;
}

export function bindFilterBar(root, store, state, reload) {
  $('#f-cycle', root)?.addEventListener('change', (e) => { store.cycle = e.target.value; localStorage.setItem('px_cycle', store.cycle); reload(); });
  $$('#f-product button', root).forEach((b) => b.addEventListener('click', () => {
    state.product = b.dataset.v; state.segment = '';
    $$('#f-product button', root).forEach((x) => x.classList.toggle('on', x === b));
    const sel = $('#f-segment', root);
    if (sel) { sel.hidden = !SEGMENTS_OF[state.product]; sel.innerHTML = String(segmentOptions(store.meta, state.product, '')); }
    reload();
  }));
  $('#f-segment', root)?.addEventListener('change', (e) => { state.segment = e.target.value; reload(); });
  $('#f-team', root)?.addEventListener('change', (e) => { state.team = e.target.value; reload(); });
}

const state = { product: '', team: '', segment: '' };

export async function render(el, _p, ctx) {
  const { store } = ctx;
  const u = store.user;
  const cycle = store.meta.cycles.find((c) => String(c.id) === String(store.cycle));
  ctx.setTitle('Painel', `${greeting()}, ${userName(u)}`);
  el.innerHTML = String(html`
    <div class="page-head">
      <div><h2>${greeting()}, <span class="gradient-text">${userName(u)}</span></h2>
      <p>${cycle ? html`Resultados da <b>${cycle.name}</b>` : 'Visão consolidada de todas as quinzenas'} · ${productsOf(store.meta).map((p) => PRODUCT[p]).join(', ')}</p></div>
      <div class="grow"></div>
      <a class="btn" href="#/relatorios">${icon('report')}Gerar dashboard</a>
      <a class="btn primary" href="#/atendimentos">${icon('headset')}Ver atendimentos</a>
    </div>
    ${filterBar(store, state)}
    <div id="dash"></div>`);
  bindFilterBar(el, store, state, () => load(el, ctx));
  await load(el, ctx);
}

async function load(el, ctx) {
  const { store } = ctx;
  const box = $('#dash', el);
  box.style.opacity = '.5';
  const f = { product: state.product, segment: state.segment, team: state.team };
  const d = await api.get(`/stats/overview${qs({ cycle_id: store.cycle, ...f })}`);
  // Para comparar com a quinzena anterior, sempre buscamos a evolução completa
  const full = store.cycle ? await api.get(`/stats/overview${qs(f)}`) : d;
  if (!ctx.isCurrent()) return;
  box.style.opacity = '';
  const k = d.kpis;
  if (!k.total) { box.innerHTML = String(emptyState('headset', 'Nenhuma monitoria neste filtro', 'Importe as monitorias da quinzena ou analise uma transcrição com IA.', html`<a class="btn primary" href="#/importar">${icon('upload')}Importar monitorias</a>`)); return; }
  const evo = full.evolution;
  const idx = store.cycle ? evo.findIndex((e) => String(e.cycle_id) === String(store.cycle)) : evo.length - 1;
  const prev = idx > 0 ? evo[idx - 1] : null;
  const cur = evo[idx];
  const dScore = cur && prev && cur.geral != null && prev.geral != null ? cur.geral - prev.geral : null;
  const dConf = cur && prev && cur.conformity != null && prev.conformity != null ? cur.conformity - prev.conformity : null;
  const c = palette();

  const insights = buildInsights(d, prev && store.cycle ? prev : null);
  const present = (d.segments || []).filter((x) => x.level === 'product').map((x) => x.product);
  const series = present.map((p) => ({ p, key: p.toLowerCase(), label: PRODUCT[p], color: c[p.toLowerCase()] }));
  const alerts = Object.entries(k.alerts || {}).filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
  const alertTotal = alerts.reduce((a, [, v]) => a + v, 0);

  box.innerHTML = String(html`
    <div class="grid g-6">
      ${kpi('gauge', 'Nota média final', fmtScore(k.avg_final), '', html`${dScore != null ? html`${deltaTag(dScore)} vs. quinzena anterior` : 'média das monitorias'}`, k.avg_final)}
      ${kpi('target', 'Aderência ao roteiro', fmtScore(k.adherence ?? k.conformity), '%', html`${dConf != null ? html`${deltaTag(dConf, ' p.p.')} conformidade vs. anterior` : 'itens feitos ÷ itens que cabiam'}`, k.adherence ?? k.conformity)}
      ${kpi('headset', 'Monitorias', fmtInt(k.total), '', html`${series.map((x) => html`<span class="chip p-${x.key}">${k['total_' + x.key]} ${PRODUCT_SHORT[x.p]}</span>`)}`)}
      ${kpi('msgCheck', 'Feedbacks aplicados', fmtScore(k.feedback_rate), '%', html`${k.feedback_applied} de ${k.total} · <a href="#/feedbacks/pendentes">${k.total - k.feedback_applied} pendentes</a>`, k.feedback_rate)}
      ${alertTotal || !k.critical_fails
        ? kpi('alert', 'Alertas de qualidade', fmtInt(alertTotal), '', html`${alerts.slice(0, 2).map(([a, v]) => `${v} ${ALERT[a][0].toLowerCase()}`).join(' · ') || 'nenhum alerta'}${k.critical_fails ? ` · ${k.critical_fails} falha(s) crítica(s)` : ''}`, null, 'bad')
        : kpi('alert', 'Falhas críticas', fmtInt(k.critical_fails), '', html`${fmtPct(k.total ? (k.critical_fails / k.total) * 100 : 0)} das monitorias zeradas`, null, 'bad')}
      ${kpi('users', 'Operadores avaliados', fmtInt(k.operators), '', 'com ao menos uma monitoria no recorte')}
    </div>

    ${segTable(d, series)}

    ${alerts.length ? html`<div class="card mt"><div class="card-head"><div><h3>Alertas de qualidade</h3><div class="sub">Pontos que pedem conversa com o operador, além da nota. Clique para ver as ligações.</div></div></div>
      <div class="card-body"><div class="grid g-4">${alerts.map(([a, v]) => html`<button class="insight click" data-alert="${a}" style="text-align:left"><span class="ic" style="background:var(--bad-soft);color:var(--bad-ink)">${icon('alert')}</span><div><b>${v} · ${ALERT[a][0]}</b><div class="t2 small">${ALERT[a][1]}</div></div></button>`)}</div></div></div>` : ''}

    ${insights.length ? html`<div class="grid g-3 mt">${insights.map((i) => html`<div class="insight"><span class="ic" style="background:${i.bg};color:${i.fg}">${icon(i.icon)}</span><div>${raw(i.html)}</div></div>`)}</div>` : ''}

    <div class="grid g-3 mt">
      <div class="card span-2">
        <div class="card-head"><div><h3>Evolução da nota por quinzena</h3><div class="sub">Nota média das monitorias em cada quinzena</div></div><div class="grow"></div>
          ${raw(legendHtml([{ label: 'Geral', color: c.geral, line: true }, ...(series.length > 1 ? series.map((x) => ({ label: x.label, color: x.color, line: true })) : [])]))}</div>
        <div class="card-body"><div class="chart-box"><canvas id="ch-evo" role="img" aria-label="Evolução da nota por quinzena"></canvas></div></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Distribuição das notas</h3><div class="sub">Quantidade de monitorias por faixa</div></div></div>
        <div class="card-body"><div class="chart-box"><canvas id="ch-dist" role="img" aria-label="Distribuição das notas"></canvas></div></div>
      </div>
    </div>

    <div class="grid mt">
      <div class="card">
        <div class="card-head"><div><h3>Mapa de desempenho dos operadores</h3><div class="sub">Média × consistência (desvio-padrão). Ideal: à direita e embaixo.</div></div></div>
        <div class="card-body"><div class="chart-box tall"><canvas id="ch-opmap" role="img" aria-label="Mapa de desempenho dos operadores"></canvas></div></div>
      </div>
    </div>

    <div class="grid g-2 mt">
      <div class="card">
        <div class="card-head"><div><h3>Critérios mais ofensores</h3><div class="sub">Índice de falha (NC + metade dos parciais)</div></div><div class="grow"></div>
          <span class="chip bad">${icon('alert')}crítico</span></div>
        <div class="card-body"><div class="chart-box tall"><canvas id="ch-crit" role="img" aria-label="Critérios mais ofensores"></canvas></div></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Ranking de operadores</h3><div class="sub">Nota média, tendência e feedbacks</div></div><div class="grow"></div><a class="btn sm ghost" href="#/operadores">Ver todos ${icon('chevRight')}</a></div>
        <div class="card-body" style="padding-top:8px"><div class="table-wrap" style="max-height:380px;overflow:auto">
          <table class="tbl"><thead><tr><th>#</th><th>Operador</th><th class="right">Média</th><th>Tendência</th><th class="right">Δ</th><th class="right">Feedback</th></tr></thead>
          <tbody>${d.operators.map((o, i) => html`<tr class="click" data-op="${o.operator_id}">
            <td><span class="rank ${i < 3 ? 'r' + (i + 1) : ''}">${i + 1}</span></td>
            <td><div class="who">${avatar(o.name, 'sm')}<div><b>${o.name}</b><span>${o.team || ''} · ${o.total} monit.</span></div></div></td>
            <td class="right"><b class="score-txt band-${band(o.avg)} num">${fmtScore(o.avg)}</b></td>
            <td style="width:84px">${sparkline(full.operators.find((x) => x.operator_id === o.operator_id)?.series || o.series, { w: 80, h: 26, color: c.brand })}</td>
            <td class="right">${deltaTag(o.delta)}</td>
            <td class="right"><span class="bar-inline" style="width:44px"><i style="width:${o.feedback_rate}%;background:${c.ok}"></i></span> <span class="tiny num">${fmtScore(o.feedback_rate, 0)}%</span></td>
          </tr>`)}</tbody></table></div></div>
      </div>
    </div>

    ${d.teams.length > 1 ? html`<div class="card mt"><div class="card-head"><h3>Equipes</h3></div><div class="card-body"><div class="grid g-4">${d.teams.map((t) => html`
      <div class="insight"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${icon('users')}</span><div><b>${t.team}</b><div class="t2 small">Média <b class="score-txt band-${band(t.avg)}">${fmtScore(t.avg)}</b> · ${t.total} monit. · ${fmtScore(t.feedback_rate, 0)}% feedback</div></div></div>`)}</div></div></div>` : ''}
  `);

  $$('[data-op]', box).forEach((tr) => tr.addEventListener('click', () => ctx.navigate(`operadores/${tr.dataset.op}`)));
  // Linha da tabela por produto/segmento aplica o filtro no próprio painel
  $$('[data-seg-p]', box).forEach((tr) => tr.addEventListener('click', () => {
    state.product = tr.dataset.segP; state.segment = tr.dataset.segS || '';
    const bar = $('.filters', el);
    bar.outerHTML = String(filterBar(store, state));
    bindFilterBar(el, store, state, () => load(el, ctx));
    load(el, ctx);
  }));
  $$('[data-alert]', box).forEach((b) => b.addEventListener('click', () => {
    sessionStorage.setItem('px_eval_preset', JSON.stringify({ product: state.product, segment: state.segment, alert: b.dataset.alert }));
    ctx.navigate('atendimentos');
  }));

  const labels = evo.map((e) => e.cycle.replace(' Quinzena', ' Q'));
  lineChart($('#ch-evo'), labels, [
    { label: 'Geral', data: evo.map((e) => e.geral), color: c.geral, fill: true },
    ...(series.length > 1 ? series.map((x) => ({ label: x.label, data: evo.map((e) => e[x.key]), color: x.color })) : []),
  ], { min: Math.max(0, Math.min(40, ...evo.map((e) => e.geral).filter((v) => v != null).map((v) => Math.floor(v / 10) * 10 - 10))) });

  barChart($('#ch-dist'), d.distribution.map((x) => x.label), [{ label: 'Monitorias', data: d.distribution.map((x) => x.count) }],
    { colors: [c.bad, c.warn, c.warn, c.refin, c.ok] });

  const maxSd = Math.max(10, ...d.operators.map((o) => o.sd || 0));
  scatterChart($('#ch-opmap'), [{ label: 'Operadores', color: c.brand, radius: 8, data: d.operators.filter((o) => o.avg != null).map((o) => ({ x: o.avg, y: o.sd, label: o.name, opId: o.operator_id })) }],
    { xLabel: 'Nota média', yLabel: 'Desvio-padrão (menor = mais consistente)', xmin: Math.max(0, Math.floor(Math.min(...d.operators.map((o) => o.avg ?? 100)) / 10) * 10 - 5), xmax: 100, ymin: 0, ymax: Math.ceil(maxSd / 5) * 5 + 5,
      tooltip: (ctx2) => ` ${ctx2.raw.label}: média ${fmtScore(ctx2.raw.x)} · desvio ${fmtScore(ctx2.raw.y)}`, onClick: (p) => ctx.navigate(`operadores/${p.opId}`) });

  const minB = Math.min(5, Math.max(1, ...d.criteria.map((x) => x.base || 0)));
  const top = d.criteria.filter((x) => x.base >= minB).slice(0, 9);
  barChart($('#ch-crit'), top.map((x) => `${x.code} · ${x.name}`), [{ label: 'Índice de falha', data: top.map((x) => x.fail_rate) }],
    { horizontal: true, suffix: '%', colors: top.map((x) => (x.critical ? c.bad : c.warn)) });
}

// Visão apartada: Veículos, Cartões (Clean Curto / Clean Longo) e Consignado (Público / Privado)
function segTable(d, series) {
  const rows = d.segments || [];
  if (!rows.length || (rows.length === 1 && rows[0].level === 'product' && !SEGMENTS_OF[rows[0].product])) return '';
  return html`<div class="card mt"><div class="card-head"><div><h3>Por produto e segmento</h3><div class="sub">Clique em uma linha para filtrar o painel. Aderência = itens feitos ÷ itens que cabiam na ligação, como nos dashboards PAN.</div></div></div>
    <div class="card-body" style="padding-top:6px"><div class="table-wrap"><table class="tbl seg-table"><thead><tr><th>Produto / segmento</th><th class="right">Monitorias</th><th class="right">Operadores</th><th class="right">Nota média</th><th class="right">Aderência</th><th class="right">Feedback</th><th class="right">Com alerta</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr class="click lvl-${r.level}" data-seg-p="${r.product}" data-seg-s="${r.segment || ''}" style="--pc:${series.find((x) => x.p === r.product)?.color || 'var(--brand)'}">
      <td class="lvl-${r.level}">${r.level === 'product' ? html`<span class="dot"></span>${PRODUCT[r.product]}` : SEGMENT[r.segment]}</td>
      <td class="right num">${fmtInt(r.total)}</td><td class="right num">${r.total ? fmtInt(r.operators) : '—'}</td>
      <td class="right"><b class="score-txt band-${band(r.avg)} num">${fmtScore(r.avg)}</b></td>
      <td class="right num">${fmtPct(r.adherence)}</td>
      <td class="right num">${r.total ? fmtPct(r.feedback_rate) : '—'}</td><td class="right num">${r.total ? fmtInt(r.alerts) : '—'}</td></tr>`)}</tbody></table></div></div></div>`;
}

function kpi(ic, label, val, suffix, foot, meter = null, tone = '') {
  const tones = { bad: 'background:var(--bad-soft);color:var(--bad-ink)', warn: 'background:var(--warn-soft);color:var(--warn-ink)' };
  return html`<div class="card kpi"><div class="glow"></div>
    <div class="k-label"><span class="k-ic" style="${tones[tone] || ''}">${icon(ic)}</span>${label}</div>
    <div class="k-val num">${val}<small>${suffix}</small></div>
    ${meter != null ? html`<div class="meter"><i style="width:${Math.max(0, Math.min(100, meter))}%"></i></div>` : ''}
    <div class="k-foot">${foot}</div></div>`;
}

function buildInsights(d, prev) {
  const out = [];
  const ops = d.operators.filter((o) => o.avg != null);
  if (ops.length) {
    const best = ops[0];
    out.push({ icon: 'award', bg: 'var(--ok-soft)', fg: 'var(--ok-ink)', html: `<b>Destaque:</b> ${esc(best.name)} lidera com média <b>${fmtScore(best.avg)}</b>.` });
  }
  const movers = d.operators.filter((o) => o.delta != null).sort((a, b) => b.delta - a.delta);
  if (movers.length && movers[0].delta > 0) out.push({ icon: 'trendUp', bg: 'var(--info-soft)', fg: 'var(--info-ink)', html: `<b>Maior evolução:</b> ${esc(movers[0].name)} subiu <b>${fmtScore(movers[0].delta)}</b> pontos na última quinzena.` });
  // Ignora critérios com poucas ligações na base (ex.: 1 de 1 falhou = 100%)
  const minBase = Math.min(5, Math.max(1, ...d.criteria.map((c) => c.base || 0)));
  const worst = d.criteria.find((c) => c.base >= minBase);
  if (worst) out.push({ icon: 'target', bg: 'var(--warn-soft)', fg: 'var(--warn-ink)', html: `<b>Foco de melhoria:</b> “${esc(worst.name)}” tem <b>${fmtScore(worst.fail_rate)}%</b> de falha.` });
  void prev;
  return out.slice(0, 3);
}

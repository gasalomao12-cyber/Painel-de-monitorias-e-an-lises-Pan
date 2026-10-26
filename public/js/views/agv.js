import { api, qs } from '../api.js';
import { html, raw, icon, $, $$, toast, modal, busy, fmtScore, fmtPct, fmtInt, fmtDate, deltaTag, band, emptyState, PRODUCT, PRODUCT_SHORT, ALERT } from '../ui.js';
import { lineChart, barChart, radarChart, palette, legendHtml } from '../charts.js';
import { parseSheetFile } from '../files.js';
import { mapCalls, readDashboard } from './import.js';

// Divisão AGV: ligações das campanhas em que a assistente virtual (AGV) transfere para o operador,
// avaliadas no roteiro AGV. Os dados vêm enxutos da API e os recortes são montados aqui, na hora.
const state = { product: '', campaign: '', team: '', from: '', to: '', dim: 'product', a: '', b: '' };
let data = null;

const DIMS = [
  ['product', 'Carteira'], ['campaign', 'Campanha'], ['team', 'Equipe'], ['supervisor', 'Supervisor'],
  ['operator', 'Operador'], ['cycle', 'Quinzena'], ['week', 'Semana'], ['day', 'Dia'],
];
const TIME_DIMS = ['cycle', 'week', 'day'];
const OUTCOME_ORDER = ['Acordo com boleto', 'Promessa sem boleto', 'Retorno combinado', 'Sem acordo', 'Sem negociação com o titular', 'Final cortado'];
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const ddmm = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');
function monday(d) {
  const x = new Date(`${d}T12:00:00`);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}
// Chave e rótulo de cada ligação em cada dimensão do comparativo
function keyOf(e, dim) {
  switch (dim) {
    case 'product': return [e.product, PRODUCT[e.product] || e.product];
    case 'campaign': return [e.campaign || '—', e.campaign || 'Sem campanha'];
    case 'team': return [e.team || '—', e.team || 'Sem equipe'];
    case 'supervisor': return [e.supervisor || '—', e.supervisor || 'Sem supervisor'];
    case 'operator': return [String(e.operator_id), e.operator];
    case 'cycle': return [String(e.cycle_id || '—'), e.cycle || 'Sem quinzena'];
    case 'week': { const m = e.date ? monday(e.date) : '—'; return [m, e.date ? `Semana de ${ddmm(m)}` : 'Sem data']; }
    default: return [e.date || '—', e.date ? fmtDate(e.date) : 'Sem data'];
  }
}

// Indicadores de um conjunto de ligações: aderência (itens feitos ÷ itens que cabiam), por pergunta e desfecho
function summarize(evs) {
  const codes = data.codes;
  const q = Object.fromEntries(codes.map((c) => [c, { C: 0, P: 0, NC: 0, NA: 0, sC: 0, sBase: 0, fixed: 0 }]));
  let done = 0, base = 0, fixed = 0, items = 0;
  const analyzed = [];
  for (const e of evs) {
    const its = data.byEval.get(e.id);
    if (!its || !Object.values(its).some((r) => r[0])) continue;
    analyzed.push(e);
    for (const c of codes) {
      const r = its[c];
      if (!r || !r[0]) continue;
      const x = q[c];
      x[r[0]]++; items++;
      if (r[0] !== 'NA') { base++; done += r[0] === 'C' ? 1 : r[0] === 'P' ? 0.5 : 0; }
      if (r[1] && r[1] !== 'NA') { x.sBase++; if (r[1] === 'C') x.sC++; }
      if (r[2]) { x.fixed++; fixed++; }
    }
  }
  const per = Object.fromEntries(codes.map((c) => {
    const x = q[c], b = x.C + x.P + x.NC;
    return [c, { ...x, base: b, conf: b ? Math.round(((x.C + x.P * 0.5) / b) * 1000) / 10 : null, speech: pct(x.sC, x.sBase) }];
  }));
  const outcomes = {};
  for (const e of analyzed) if (e.outcome) outcomes[e.outcome] = (outcomes[e.outcome] || 0) + 1;
  const withOutcome = analyzed.filter((e) => e.outcome).length;
  const scores = analyzed.map((e) => e.score).filter((v) => v != null);
  return {
    total: evs.length, analyzed: analyzed.length, pending: evs.length - analyzed.length,
    adherence: base ? Math.round((done / base) * 1000) / 10 : null, per, outcomes, withOutcome,
    noDeal: pct(analyzed.filter((e) => e.outcome === 'Sem acordo').length, withOutcome),
    avg: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
    fixed, items, operators: new Set(analyzed.map((e) => e.operator_id)).size,
    alerts: Object.entries(analyzed.reduce((a, e) => { for (const x of e.alerts || []) a[x] = (a[x] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]),
  };
}

function groups(evs, dim) {
  const map = new Map();
  for (const e of evs) {
    const [k, label] = keyOf(e, dim);
    if (!map.has(k)) map.set(k, { key: k, label, evs: [], first: e.cycle_start || e.date || '' });
    map.get(k).evs.push(e);
  }
  const out = [...map.values()].map((g) => ({ ...g, s: summarize(g.evs) }));
  return TIME_DIMS.includes(dim) ? out.sort((a, b) => String(a.key === '—' ? 'z' : dim === 'cycle' ? a.first : a.key).localeCompare(String(b.key === '—' ? 'z' : dim === 'cycle' ? b.first : b.key)))
    : out.sort((a, b) => (b.s.adherence ?? -1) - (a.s.adherence ?? -1) || b.s.total - a.s.total);
}

// Períodos para o "A × B": quinzenas, semanas e dias que têm ligações
function periods(evs) {
  const cyc = new Map(), wk = new Set(), dy = new Set();
  for (const e of evs) {
    if (e.cycle_id) cyc.set(String(e.cycle_id), { name: e.cycle, start: e.cycle_start || '' });
    if (e.date) { wk.add(monday(e.date)); dy.add(e.date); }
  }
  return {
    cycles: [...cyc.entries()].sort((a, b) => a[1].start.localeCompare(b[1].start)).map(([id, c]) => [`c:${id}`, c.name]),
    weeks: [...wk].sort().map((w) => [`w:${w}`, `Semana de ${ddmm(w)}`]),
    days: [...dy].sort().map((d) => [`d:${d}`, fmtDate(d)]),
  };
}
const inPeriod = (e, p) => {
  const [t, v] = [p.slice(0, 1), p.slice(2)];
  if (t === 'c') return String(e.cycle_id) === v;
  if (t === 'w') return e.date && monday(e.date) === v;
  return e.date === v;
};

const heat = (v) => (v == null ? 'h-na' : v >= 85 ? 'h-ok' : v >= 65 ? 'h-warn' : 'h-bad');

export async function render(el, _p, ctx) {
  const { store } = ctx;
  const quality = ctx.can('admin', 'qualidade');
  ctx.setTitle('Análises AGV', 'Visão geral');
  el.innerHTML = String(html`
    <div class="page-head">
      <div><h2>Análises <span class="gradient-text">AGV</span></h2>
      <p>Ligações das campanhas AGV: a assistente virtual atende e transfere para o operador. Cada ligação é avaliada no roteiro AGV, só pelo que o operador fez depois da transferência.</p></div>
      <div class="grow"></div>
      <button class="btn" id="agv-list">${icon('headset')}Ver ligações AGV</button>
      ${quality ? html`<button class="btn primary" id="agv-import">${icon('upload')}Importar ligações e speech</button>` : ''}
    </div>
    <div class="filters" id="agv-filters"></div>
    <div id="agv-body"></div>`);
  $('#agv-list').onclick = () => {
    sessionStorage.setItem('px_eval_preset', JSON.stringify({ channel: 'AGV', product: state.product, campaign: state.campaign }));
    ctx.navigate('atendimentos');
  };
  $('#agv-import')?.addEventListener('click', () => openImport(el, ctx));
  await load(el, ctx);
}

function drawFilters(el, ctx) {
  const { store } = ctx;
  const m = store.meta;
  const prods = [...new Set(data.allProducts)];
  const box = $('#agv-filters', el);
  box.innerHTML = String(html`
    <span class="muted">${icon('filter')}</span>
    <select class="select sm" id="a-cycle" aria-label="Quinzena"><option value="">Todas as quinzenas</option>
      ${m.cycles.map((c) => html`<option value="${c.id}" ${String(store.cycle) === String(c.id) ? 'selected' : ''}>${c.name}</option>`)}</select>
    <div class="seg" id="a-product" role="group" aria-label="Carteira"><button data-v="" class="${!state.product ? 'on' : ''}">Todas</button>
      ${prods.map((p) => html`<button data-v="${p}" class="${state.product === p ? 'on' : ''}">${PRODUCT_SHORT[p] || p}</button>`)}</div>
    <select class="select sm" id="a-campaign" aria-label="Campanha"><option value="">Todas as campanhas</option>
      ${(m.agv?.campaigns || []).map((c) => html`<option ${state.campaign === c ? 'selected' : ''}>${c}</option>`)}</select>
    ${m.teams.length > 1 ? html`<select class="select sm" id="a-team" aria-label="Equipe"><option value="">Todas as equipes</option>${m.teams.map((t) => html`<option ${state.team === t ? 'selected' : ''}>${t}</option>`)}</select>` : ''}
    <label class="small t2 row" style="gap:6px">De <input class="input sm" type="date" id="a-from" value="${state.from}"></label>
    <label class="small t2 row" style="gap:6px">até <input class="input sm" type="date" id="a-to" value="${state.to}"></label>`);
  const reload = () => load(el, ctx);
  $('#a-cycle', box).onchange = (e) => { store.cycle = e.target.value; localStorage.setItem('px_cycle', store.cycle); state.a = state.b = ''; reload(); };
  $$('#a-product button', box).forEach((b) => b.addEventListener('click', () => { state.product = b.dataset.v; reload(); }));
  $('#a-campaign', box).onchange = (e) => { state.campaign = e.target.value; reload(); };
  $('#a-team', box)?.addEventListener('change', (e) => { state.team = e.target.value; reload(); });
  $('#a-from', box).onchange = (e) => { state.from = e.target.value; state.a = state.b = ''; reload(); };
  $('#a-to', box).onchange = (e) => { state.to = e.target.value; state.a = state.b = ''; reload(); };
}

async function load(el, ctx) {
  const { store } = ctx;
  const body = $('#agv-body', el);
  body.style.opacity = '.5';
  const d = await api.get(`/agv/data${qs({ cycle_id: store.cycle, product: state.product, campaign: state.campaign, team: state.team, from: state.from, to: state.to })}`);
  if (!ctx.isCurrent()) return;
  body.style.opacity = '';
  const byEval = new Map();
  for (const [id, code, fin, sp, adj] of d.items) {
    if (!byEval.has(id)) byEval.set(id, {});
    byEval.get(id)[code] = [fin, sp, adj];
  }
  const keep = data?.allProducts && (state.product || state.campaign) ? data.allProducts : null;
  data = { ...d, byEval, name: Object.fromEntries(d.criteria.map((c) => [c.code, c.name])), allProducts: keep || [...new Set(d.evals.map((e) => e.product))] };
  drawFilters(el, ctx);
  draw(el, ctx);
}

function draw(el, ctx) {
  const body = $('#agv-body', el);
  const evs = data.evals;
  if (!evs.length) {
    body.innerHTML = String(emptyState('zap', 'Nenhuma ligação AGV neste filtro',
      'Importe a lista de ligações do discador (.csv) e o relatório do speech "PAN TESTE DE PERGUNTAS AGV" (.xlsx). As campanhas com AGV no nome entram aqui sozinhas.',
      ctx.can('admin', 'qualidade') ? html`<button class="btn primary" id="agv-empty-import">${icon('upload')}Importar ligações e speech</button>` : ''));
    $('#agv-empty-import', body)?.addEventListener('click', () => openImport(el, ctx));
    return;
  }
  const s = summarize(evs);
  const c = palette();
  const codes = data.codes;
  const colorOf = { VEICULOS: c.veiculos, CARTOES: c.cartoes, CONSIGNADO: c.consignado, REFIN: c.refin, ENTREGA: c.entrega };
  const fixedRules = s.fixed;

  body.innerHTML = String(html`
    <div class="grid g-6">
      ${kpi('headset', 'Ligações AGV', fmtInt(s.total), '', html`${fmtInt(s.analyzed)} analisadas${s.pending ? html` · <b>${fmtInt(s.pending)}</b> aguardando` : ''}`)}
      ${kpi('target', 'Aderência ao roteiro AGV', fmtScore(s.adherence), '%', 'itens feitos ÷ itens que cabiam', s.adherence)}
      ${kpi('alert', 'Terminaram sem acordo', fmtScore(s.noDeal), '%', html`${fmtInt(s.outcomes['Sem acordo'] || 0)} de ${fmtInt(s.withOutcome)} com desfecho`, null, 'bad')}
      ${kpi('users', 'Operadores', fmtInt(s.operators), '', html`nota média <b class="score-txt band-${band(s.avg)}">${fmtScore(s.avg)}</b>`)}
      ${kpi('alert', 'Sem proposta com valor', fmtScore(pct(s.per.PRP.NC, s.per.PRP.base)), '%', html`${fmtInt(s.per.PRP.NC)} de ${fmtInt(s.per.PRP.base)} ligações com negociação`, null, 'bad')}
      ${kpi('alert', 'Alertas', fmtInt(s.alerts.reduce((a, [, v]) => a + v, 0)), '', s.alerts.slice(0, 2).map(([a, v]) => `${v} ${(ALERT[a]?.[0] || a).toLowerCase()}`).join(' · ') || 'nenhum alerta', null, 'bad')}
    </div>

    <div class="card mt" id="agv-compare">
      <div class="card-head"><div><h3>Comparativo</h3><div class="sub">Aderência e conformidade de cada pergunta do roteiro AGV no recorte escolhido. Verde ≥ 85%, amarelo ≥ 65%, vermelho abaixo.</div></div><div class="grow"></div>
        <div class="seg" id="agv-dim" role="group" aria-label="Comparar por">${DIMS.map(([k, l]) => html`<button data-v="${k}" class="${state.dim === k ? 'on' : ''}">${l}</button>`)}</div></div>
      <div class="card-body" id="agv-cmp-body"></div>
    </div>

    <div class="card mt">
      <div class="card-head"><div><h3>Período A × período B</h3><div class="sub">Quanto cada pergunta subiu ou caiu entre dois períodos (quinzenas, semanas ou dias).</div></div></div>
      <div class="card-body" id="agv-ab"></div>
    </div>

    <div class="grid g-2 mt">
      <div class="card">
        <div class="card-head"><div><h3>Perguntas do roteiro AGV</h3><div class="sub">Conformidade de cada pergunta no recorte, já com as correções feitas na revisão.</div></div>
        <div class="card-body"><div class="chart-box tall"><canvas id="ch-agv-q" role="img" aria-label="Conformidade por pergunta"></canvas></div></div>
      </div>
      <div class="card"><div class="card-head"><div><h3>Evolução diária</h3><div class="sub">Aderência ao roteiro AGV por dia da ligação.</div></div><div class="grow"></div><span id="agv-evo-legend"></span></div>
        <div class="card-body"><div class="chart-box tall"><canvas id="ch-agv-evo" role="img" aria-label="Evolução diária da aderência"></canvas></div></div></div>
    </div>

    ${data.other_roteiro ? html`<p class="tiny muted mt">${fmtInt(data.other_roteiro)} ligação(ões) AGV foram avaliadas em outro roteiro (dashboards de Veículos) e aparecem só no confronto AGV × Convencional.</p>` : ''}
    ${data.channels.length ? html`<div class="card mt"><div class="card-head"><div><h3>AGV × Convencional</h3><div class="sub">Mesma carteira e mesmos filtros. Cada canal é medido no próprio roteiro: o AGV avalia o operador só depois da transferência.</div></div></div>
      <div class="card-body" style="padding-top:6px"><div class="table-wrap"><table class="tbl"><thead><tr><th>Carteira</th><th>Canal</th><th class="right">Monitorias</th><th class="right">Operadores</th><th class="right">Nota média</th><th class="right">Aderência</th></tr></thead>
      <tbody>${data.channels.map((r) => html`
        <tr><td rowspan="2"><b>${PRODUCT[r.product]}</b></td><td><span class="chip brand">AGV</span></td>${chanCells(r.agv)}</tr>
        <tr><td><span class="chip outline">Convencional</span></td>${chanCells(r.conv)}</tr>
        <tr class="delta-row"><td></td><td class="tiny muted">diferença</td><td></td><td></td>
          <td class="right">${r.agv.avg != null && r.conv.avg != null ? deltaTag(r.agv.avg - r.conv.avg) : '—'}</td>
          <td class="right">${r.agv.adherence != null && r.conv.adherence != null ? deltaTag(r.agv.adherence - r.conv.adherence, ' p.p.') : '—'}</td></tr>`)}</tbody></table></div></div></div>` : ''}
  `);

  $$('#agv-dim button', body).forEach((b) => b.addEventListener('click', () => {
    state.dim = b.dataset.v; $$('#agv-dim button', body).forEach((x) => x.classList.toggle('on', x === b)); drawCompare(body, ctx);
  }));
  drawCompare(body, ctx);
  drawAB(body);

  const qs2 = codes.filter((k) => s.per[k].base);
  barChart($('#ch-agv-q', body), qs2.map((k) => `${k} · ${data.name[k]}`), [
    { label: 'Conformidade', data: qs2.map((k) => s.per[k].conf), color: c.brand },
  ], { horizontal: true, max: 100, suffix: '%', colors: qs2.map((k) => (s.per[k].conf >= 85 ? c.ok : s.per[k].conf >= 65 ? c.warn : c.bad)) });

  const days = groups(evs, 'day').filter((g) => g.key !== '—');
  const prods = [...new Set(evs.map((e) => e.product))];
  const series = [{ label: 'Todas', data: days.map((g) => g.s.adherence), color: c.geral, fill: true }];
  if (prods.length > 1) for (const p of prods) series.push({ label: PRODUCT[p], data: days.map((g) => summarize(g.evs.filter((e) => e.product === p)).adherence), color: colorOf[p] || c.brand });
  $('#agv-evo-legend', body).innerHTML = legendHtml(series.map((x) => ({ label: x.label, color: x.color, line: true })));
  lineChart($('#ch-agv-evo', body), days.map((g) => ddmm(g.key)), series, { min: 0, suffix: '%' });
}

function chanCells(g) {
  return html`<td class="right num">${fmtInt(g.total)}</td><td class="right num">${fmtInt(g.operators)}</td>
    <td class="right"><b class="score-txt band-${band(g.avg)} num">${fmtScore(g.avg)}</b></td><td class="right num">${fmtPct(g.adherence)}</td>`;
}

function drawCompare(body, ctx) {
  const box = $('#agv-cmp-body', body);
  const c = palette();
  const codes = data.codes;
  const rows = groups(data.evals, state.dim);
  const total = summarize(data.evals);
  const outs = OUTCOME_ORDER.filter((o) => rows.some((g) => g.s.outcomes[o]));
  const extra = [...new Set(rows.flatMap((g) => Object.keys(g.s.outcomes)))].filter((o) => !OUTCOME_ORDER.includes(o));
  const allOut = [...outs, ...extra];
  const outColor = { 'Acordo com boleto': c.ok, 'Promessa sem boleto': c.refin, 'Retorno combinado': c.speech, 'Sem acordo': c.warn, 'Sem negociação com o titular': c.na, 'Final cortado': c.bad };
  const shown = rows.slice(0, 25);
  box.innerHTML = String(html`
    <div class="table-wrap" style="max-height:460px;overflow:auto"><table class="tbl heat"><thead><tr>
      <th>${DIMS.find(([k]) => k === state.dim)[1]}</th><th class="right">Ligações</th><th class="right">Aderência</th>
      ${codes.map((k) => html`<th class="right" title="${data.name[k]}">${k}</th>`)}</tr></thead>
    <tbody>${rows.map((g) => html`<tr class="${state.dim === 'operator' ? 'click' : ''}" data-op="${state.dim === 'operator' ? g.key : ''}">
      <td><b>${g.label}</b>${g.s.pending ? html` <span class="tiny muted">(${g.s.pending} aguardando)</span>` : ''}</td>
      <td class="right num">${fmtInt(g.s.analyzed)}</td>
      <td class="right"><b class="score-txt band-${band(g.s.adherence)} num">${fmtPct(g.s.adherence)}</b></td>
      ${codes.map((k) => html`<td class="right num ${heat(g.s.per[k].conf)}" title="${data.name[k]}: ${g.s.per[k].C} de ${g.s.per[k].base}">${g.s.per[k].base ? fmtScore(g.s.per[k].conf, 0) : '—'}</td>`)}</tr>`)}
      <tr class="total-row"><td><b>Total</b></td><td class="right num">${fmtInt(total.analyzed)}</td><td class="right"><b class="num">${fmtPct(total.adherence)}</b></td>
      ${codes.map((k) => html`<td class="right num">${total.per[k].base ? fmtScore(total.per[k].conf, 0) : '—'}</td>`)}</tr>
    </tbody></table></div>
    <p class="tiny muted" style="margin:8px 0 0">${codes.map((k) => `${k} = ${data.name[k]}`).join(' · ')}</p>
    <div class="grid g-2 mt">
      <div><h4 style="margin:0 0 8px">Aderência por ${DIMS.find(([k]) => k === state.dim)[1].toLowerCase()}</h4><div class="chart-box ${shown.length > 8 ? 'tall' : ''}"><canvas id="ch-agv-cmp" role="img" aria-label="Aderência por grupo"></canvas></div></div>
      <div><div class="row between" style="margin-bottom:8px"><h4 style="margin:0">Desfecho das ligações</h4>${raw(legendHtml(allOut.map((o) => ({ label: o, color: outColor[o] || c.brand }))))}</div>
        <div class="chart-box ${shown.length > 8 ? 'tall' : ''}"><canvas id="ch-agv-out" role="img" aria-label="Desfecho por grupo"></canvas></div></div>
    </div>
    ${rows.length > shown.length ? html`<p class="tiny muted">Gráficos mostram os ${shown.length} primeiros; a tabela tem todos.</p>` : ''}`);
  $$('[data-op]', box).forEach((tr) => tr.dataset.op && tr.addEventListener('click', () => ctx.navigate(`operadores/${tr.dataset.op}`)));
  const horizontal = !TIME_DIMS.includes(state.dim) || shown.length > 10;
  barChart($('#ch-agv-cmp', box), shown.map((g) => g.label), [{ label: 'Aderência', data: shown.map((g) => g.s.adherence) }],
    { horizontal, max: 100, suffix: '%', colors: shown.map((g) => (g.s.adherence == null ? c.na : g.s.adherence >= 85 ? c.ok : g.s.adherence >= 65 ? c.warn : c.bad)) });
  barChart($('#ch-agv-out', box), shown.map((g) => g.label), allOut.map((o) => ({
    label: o, color: outColor[o] || c.brand, data: shown.map((g) => pct(g.s.outcomes[o] || 0, g.s.withOutcome)),
  })), { horizontal, stacked: true, max: 100, suffix: '%' });
}

function drawAB(body) {
  const box = $('#agv-ab', body);
  const c = palette();
  const p = periods(data.evals);
  const opts = [...p.cycles, ...p.weeks, ...p.days];
  const pickDefault = () => {
    for (const list of [p.cycles, p.weeks, p.days]) if (list.length >= 2) return [list[list.length - 2][0], list[list.length - 1][0]];
    return [opts[0]?.[0] || '', opts[0]?.[0] || ''];
  };
  if (!opts.some(([k]) => k === state.a) || !opts.some(([k]) => k === state.b)) [state.a, state.b] = pickDefault();
  const sel = (id, v) => html`<select class="select sm" id="${id}" style="width:auto;min-width:200px">
    ${p.cycles.length ? html`<optgroup label="Quinzenas">${p.cycles.map(([k, l]) => html`<option value="${k}" ${v === k ? 'selected' : ''}>${l}</option>`)}</optgroup>` : ''}
    ${p.weeks.length ? html`<optgroup label="Semanas">${p.weeks.map(([k, l]) => html`<option value="${k}" ${v === k ? 'selected' : ''}>${l}</option>`)}</optgroup>` : ''}
    ${p.days.length ? html`<optgroup label="Dias">${p.days.map(([k, l]) => html`<option value="${k}" ${v === k ? 'selected' : ''}>${l}</option>`)}</optgroup>` : ''}</select>`;
  const A = summarize(data.evals.filter((e) => inPeriod(e, state.a)));
  const B = summarize(data.evals.filter((e) => inPeriod(e, state.b)));
  const d = (x, y, suf = ' p.p.') => (x != null && y != null ? deltaTag(y - x, suf) : html`<span class="muted">—</span>`);
  box.innerHTML = String(html`
    <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px"><span class="chip" style="background:${c.speech};color:#fff">A</span>${sel('ab-a', state.a)}
      <span class="muted">${icon('arrowRight')}</span><span class="chip" style="background:${c.brand};color:#fff">B</span>${sel('ab-b', state.b)}</div>
    <div class="grid g-2"><div class="table-wrap"><table class="tbl"><thead><tr><th></th><th class="right">A</th><th class="right">B</th><th class="right">Δ</th></tr></thead><tbody>
      <tr><td>Ligações analisadas</td><td class="right num">${fmtInt(A.analyzed)}</td><td class="right num">${fmtInt(B.analyzed)}</td><td class="right">${d(A.analyzed, B.analyzed, '')}</td></tr>
      <tr><td><b>Aderência</b></td><td class="right num">${fmtPct(A.adherence)}</td><td class="right num"><b>${fmtPct(B.adherence)}</b></td><td class="right">${d(A.adherence, B.adherence)}</td></tr>
      ${data.codes.map((k) => html`<tr><td title="${data.name[k]}"><span class="tiny muted">${k}</span> ${data.name[k]}</td>
        <td class="right num">${A.per[k].base ? fmtPct(A.per[k].conf) : '—'}</td><td class="right num">${B.per[k].base ? fmtPct(B.per[k].conf) : '—'}</td>
        <td class="right">${d(A.per[k].base ? A.per[k].conf : null, B.per[k].base ? B.per[k].conf : null)}</td></tr>`)}
    </tbody></table></div>
    <div class="chart-box tall"><canvas id="ch-agv-ab" role="img" aria-label="Período A e período B por pergunta"></canvas></div></div>`);
  radarChart($('#ch-agv-ab', box), data.codes, [
    { label: 'A', data: data.codes.map((k) => A.per[k].conf), color: c.speech, dash: [5, 4] },
    { label: 'B', data: data.codes.map((k) => B.per[k].conf), color: c.brand },
  ]);
  $('#ab-a', box).onchange = (e) => { state.a = e.target.value; drawAB(body); };
  $('#ab-b', box).onchange = (e) => { state.b = e.target.value; drawAB(body); };
}

function kpi(ic, label, val, suffix, foot, meter = null, tone = '') {
  const tones = { bad: 'background:var(--bad-soft);color:var(--bad-ink)', warn: 'background:var(--warn-soft);color:var(--warn-ink)' };
  return html`<div class="card kpi"><div class="glow"></div>
    <div class="k-label"><span class="k-ic" style="${tones[tone] || ''}">${icon(ic)}</span>${label}</div>
    <div class="k-val num">${val}<small>${suffix}</small></div>
    ${meter != null ? html`<div class="meter"><i style="width:${Math.max(0, Math.min(100, meter))}%"></i></div>` : ''}
    <div class="k-foot">${foot}</div></div>`;
}

// ------------------------------------------------------------------ Relatório do speech AGV (.xlsx)
// Cabeçalhos do relatório "PAN TESTE DE PERGUNTAS AGV": cada pergunta é reconhecida pela linha da pergunta
const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const QUESTIONS = [
  ['DESF', 'como a negociacao terminou'], ['CFA', 'repetiu o valor e a data'], ['CSQ', 'o que acontece se o cliente nao pagar'],
  ['BEN', 'citou algum beneficio'], ['ATR', 'o que esta em atraso'], ['SMO', 'motivo do atraso'], ['SQQ', 'quando ou quanto'],
  ['PRP', 'forma de pagamento com valor'], ['ALT', 'ofereceu outra condicao'], ['APR', 'proprio nome e a empresa'],
];
const SUMMARIES = [['ident', 'itens obrigatorios'], ['neg', 'etapas da negociacao'], ['fin', 'oferta de beneficios']];
const questionLine = (h) => plain(String(h).split('\n').map((l) => l.replace(/^"+|"+$/g, '').trim()).find((l) => l.endsWith('?')) || '');
const callIdOf = (name) => { const m = String(name).match(/_(\d{6,})\.\w+$/) || String(name).match(/^(\d{6,})_/); return m ? m[1] : null; };
function isoOf(v) {
  if (v instanceof Date) { const p = (n) => String(n).padStart(2, '0'); return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}T${p(v.getHours())}:${p(v.getMinutes())}`; }
  const m = String(v || '').match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${(m[4] || '0').padStart(2, '0')}:${m[5] || '00'}`;
  return String(v || '').slice(0, 16);
}
export function mapSpeechReport(rows) {
  if (!rows.length) return null;
  const heads = Object.keys(rows[0]);
  const find = (...names) => heads.find((h) => names.includes(plain(h)));
  const fileCol = find('nm_arquivo', 'nome do arquivo', 'arquivo');
  const q = {};
  for (const h of heads) {
    const line = questionLine(h);
    const hit = line && QUESTIONS.find(([, key]) => line.includes(key));
    if (hit && !q[hit[0]]) q[hit[0]] = h;
  }
  const sm = Object.fromEntries(SUMMARIES.map(([k, key]) => [k, heads.find((h) => !questionLine(h) && plain(h).includes(key))]));
  if (!fileCol || Object.keys(q).length < 5) return null;
  const idCol = find('audio_id'), atCol = find('dt_cadastro', 'data'), repCol = find('relatorio_nome', 'relatorio');
  const latest = new Map();
  for (const r of rows) {
    const call_id = callIdOf(r[fileCol]);
    if (!call_id) continue;
    const row = {
      call_id, file: String(r[fileCol] || ''), audio_id: idCol ? String(r[idCol] ?? '') : '', at: atCol ? isoOf(r[atCol]) : '', report: repCol ? String(r[repCol] || '') : '',
      answers: Object.fromEntries(Object.entries(q).map(([k, h]) => [k, r[h] == null ? '' : String(r[h]).trim()])),
      summaries: Object.fromEntries(Object.entries(sm).filter(([, h]) => h).map(([k, h]) => [k, r[h] == null ? '' : String(r[h]).trim()])),
    };
    const prev = latest.get(call_id);
    if (!prev || row.at >= prev.at) latest.set(call_id, row);
  }
  return { rows: [...latest.values()], evaluations: rows.length, questions: Object.keys(q) };
}

export const AGV_DASH_KIND = { dash_agv: 'Teste do speech AGV (por gerência)', dash_agv_cmp: 'Comparativo AGV' };
// Envia um dashboard AGV em lotes; devolve o total de novas, completadas e ignoradas
export async function sendAgvDashboard(d, onProgress) {
  const t = { created: 0, updated: 0, skipped: [], operators_created: 0 };
  for (let i = 0; i < d.calls.length; i += 100) {
    onProgress?.(`${d.name}: ${Math.min(i + 100, d.calls.length)} de ${d.calls.length}…`);
    const r = await api.post('/import/agv-dashboard', { kind: d.kind, calls: d.calls.slice(i, i + 100), meta: d.meta, filename: d.name, batch: i / 100 + 1, last: i + 100 >= d.calls.length });
    t.created += r.created; t.updated += r.updated; t.operators_created += r.operators_created; t.skipped.push(...r.skipped);
  }
  return t;
}

function openImport(el, ctx) {
  const files = { calls: null, speech: null, dash: [] };
  const m = modal({
    title: 'Importar ligações AGV e o relatório do speech', wide: true,
    body: html`<p class="small t2" style="margin-top:0">Envie tudo junto ou um de cada vez: a <b>lista de ligações do discador</b> (.csv, com IdContato, Campanha, Login…) cria as ligações com operador e carteira; o <b>relatório do speech</b> (.xlsx “PAN TESTE DE PERGUNTAS AGV”) preenche as respostas de cada pergunta; os <b>dashboards AGV</b> (.html por gerência ou comparativo) trazem a leitura já revisada, que vale mais que a resposta crua do speech. As campanhas com AGV no nome entram no roteiro AGV.</p>
      <label class="drop" id="agv-drop" style="padding:22px"><input type="file" id="agv-files" accept=".csv,.txt,.xlsx,.html,.htm" multiple hidden>
        <div class="ic">${icon('upload')}</div><h4>Arraste os arquivos ou clique</h4><p class="muted small" style="margin:0">.csv do discador, .xlsx do speech e .html dos dashboards AGV</p></label>
      <div id="agv-files-list" class="stack mt"></div>
      <div class="hl info mt">${icon('info')}<div><b>Regras de coerência aplicadas na entrada</b><div class="t2 small">Sem negociação com o titular → perguntas da negociação viram N/A · confirmação de valor e data só com acordo com boleto · consequências não cabem quando houve acordo · outra condição só depois de uma proposta · acordo com boleto conta como proposta feita. A resposta original do speech fica guardada e cada correção aparece no card com o motivo.</div></div></div>
      <div id="agv-result" class="mt"></div>`,
    foot: html`<button class="btn ghost" data-close>Fechar</button><button class="btn primary" id="agv-go" disabled>${icon('upload')}Importar</button>`,
  });
  const root = m.el || document;
  const list = $('#agv-files-list', root);
  const go = $('#agv-go', root);
  const drawList = () => {
    list.innerHTML = String(html`
      ${files.calls ? html`<div class="insight"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${icon('list')}</span><div><b>${files.calls.name}</b><div class="t2 small">${fmtInt(files.calls.rows.length)} ligações do discador · ${fmtInt(files.calls.rows.filter((r) => /AGV/i.test(r.campaign || '')).length)} de campanhas AGV</div></div></div>` : ''}
      ${files.dash.map((d) => html`<div class="insight"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${icon('report')}</span><div><b>${d.name}</b><div class="t2 small">${AGV_DASH_KIND[d.kind]}${d.meta?.nome ? ` · gerência ${d.meta.nome}` : ''} · ${fmtInt(d.calls.length)} ligações</div></div></div>`)}
      ${files.speech ? html`<div class="insight"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${icon('sparkles')}</span><div><b>${files.speech.name}</b><div class="t2 small">${fmtInt(files.speech.evaluations)} avaliações do speech de ${fmtInt(files.speech.rows.length)} ligações (vale a mais recente de cada) · ${files.speech.questions.length} perguntas reconhecidas</div></div></div>` : ''}`);
    go.disabled = !files.calls && !files.speech && !files.dash.length;
  };
  const add = async (fl) => {
    for (const f of fl) {
      try {
        if (/\.html?$/i.test(f.name)) {
          const d = await readDashboard(f);
          if (!AGV_DASH_KIND[d.kind]) throw new Error('é um dashboard de monitoria, não AGV. Importe-o em "Importar monitorias".');
          files.dash = [...files.dash.filter((x) => x.name !== d.name), d];
          continue;
        }
        const rows = await parseSheetFile(f);
        const calls = mapCalls(rows);
        if (calls) { files.calls = { name: f.name, rows: calls }; continue; }
        const sp = mapSpeechReport(rows);
        if (sp) { files.speech = { name: f.name, ...sp }; continue; }
        toast(`${f.name}: não reconheci como lista do discador nem como relatório do speech AGV.`, 'err', 7000);
      } catch (ex) { toast(`${f.name}: ${ex.message}`, 'err', 7000); }
    }
    drawList();
  };
  const drop = $('#agv-drop', root);
  $('#agv-files', root).onchange = (e) => add([...e.target.files]);
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => add([...e.dataTransfer.files]));
  go.onclick = async (e) => {
    const btnEl = e.currentTarget;
    busy(btnEl, true, 'Importando');
    const res = $('#agv-result', root);
    const lines = [];
    try {
      if (files.calls) {
        const t = { created: 0, updated: 0, skipped: 0, operators_created: 0 };
        const rows = files.calls.rows;
        for (let i = 0; i < rows.length; i += 200) {
          res.textContent = `Ligações do discador: ${Math.min(i + 200, rows.length)} de ${rows.length}…`;
          const r = await api.post('/import/calls', { calls: rows.slice(i, i + 200), filename: files.calls.name, batch: i / 200 + 1, last: i + 200 >= rows.length });
          for (const k of Object.keys(t)) t[k] += r[k] || 0;
        }
        lines.push(html`<div class="insight"><span class="ic" style="background:var(--ok-soft);color:var(--ok-ink)">${icon('checkCircle')}</span><div><b>Discador</b><div class="t2 small">${t.created} ligação(ões) nova(s) · ${t.updated} completada(s) · ${t.skipped} já existiam${t.operators_created ? ` · ${t.operators_created} operador(es) cadastrado(s)` : ''}</div></div></div>`);
        files.calls = null;
      }
      for (const d of files.dash) {
        const t = await sendAgvDashboard(d, (msg) => { res.textContent = msg; });
        lines.push(html`<div class="insight"><span class="ic" style="background:var(--ok-soft);color:var(--ok-ink)">${icon('checkCircle')}</span><div><b>${d.name}</b><div class="t2 small">${t.created} ligação(ões) nova(s) · ${t.updated} completada(s) com a leitura revisada${t.operators_created ? ` · ${t.operators_created} operador(es) cadastrado(s)` : ''}${t.skipped.length ? ` · ${t.skipped.length} ignorada(s): ${t.skipped.slice(0, 4).map((x) => `${x.id} (${x.reason})`).join(', ')}` : ''}</div></div></div>`);
      }
      files.dash = [];
      if (files.speech) {
        const t = { updated: 0, unchanged: 0, corrected: 0, unmatched: [], skipped: [], rules: {} };
        const rows = files.speech.rows;
        for (let i = 0; i < rows.length; i += 100) {
          res.textContent = `Relatório do speech: ${Math.min(i + 100, rows.length)} de ${rows.length}…`;
          const r = await api.post('/import/speech-agv', { rows: rows.slice(i, i + 100), filename: files.speech.name, batch: i / 100 + 1, last: i + 100 >= rows.length });
          t.updated += r.updated; t.unchanged += r.unchanged; t.corrected += r.corrected; t.unmatched.push(...r.unmatched); t.skipped.push(...r.skipped);
          for (const [k, v] of Object.entries(r.rules || {})) t.rules[k] = (t.rules[k] || 0) + v;
        }
        lines.push(html`<div class="insight"><span class="ic" style="background:var(--ok-soft);color:var(--ok-ink)">${icon('checkCircle')}</span><div><b>Speech AGV</b><div class="t2 small">${t.updated} ligação(ões) avaliada(s)${t.unchanged ? ` · ${t.unchanged} já tinham avaliação mais nova` : ''} · ${t.corrected} resposta(s) corrigida(s) pelas regras de coerência</div>
          ${Object.keys(t.rules).length ? html`<ul class="small t2" style="margin:6px 0 0;padding-left:18px">${Object.entries(t.rules).sort((a, b) => b[1] - a[1]).map(([k, v]) => html`<li>${v} × ${k}</li>`)}</ul>` : ''}</div></div>`);
        if (t.unmatched.length) lines.push(html`<div class="insight"><span class="ic" style="background:var(--warn-soft);color:var(--warn-ink)">${icon('alert')}</span><div><b>${t.unmatched.length} ligação(ões) sem cadastro</b><div class="t2 small">Não estão na lista do discador importada. Importe o .csv do discador do mesmo período e envie o relatório de novo. IDs: ${t.unmatched.slice(0, 12).join(', ')}${t.unmatched.length > 12 ? '…' : ''}</div></div></div>`);
        const why = Object.entries(t.skipped.reduce((a, x) => { a[x.reason] = (a[x.reason] || 0) + 1; return a; }, {}));
        if (why.length) lines.push(html`<div class="insight"><span class="ic" style="background:var(--info-soft);color:var(--info-ink)">${icon('info')}</span><div><b>${t.skipped.length} não alterada(s)</b><div class="t2 small">${why.map(([k, v]) => `${v} ${k}`).join(' · ')}</div></div></div>`);
        files.speech = null;
      }
      res.innerHTML = String(html`<div class="stack">${lines}</div>`);
      drawList();
      toast('Importação concluída.', 'ok');
      await ctx.refreshMeta();
      if (ctx.isCurrent()) await load(el, ctx);
    } catch (ex) {
      toast(ex.message, 'err', 8000);
      res.innerHTML = String(html`<div class="stack">${lines}</div>`);
    }
    busy(btnEl, false);
    go.disabled = !files.calls && !files.speech && !files.dash.length;
  };
}

// Renderizador do report de qualidade (capa + páginas A4 paisagem)
import { api, qs } from './api.js';
import { html, raw, icon, pxLogo, $, $$, esc, fmtScore, fmtInt, fmtDate, fmtPct, avatar, band, BAND_LABEL, PRODUCT, PRODUCT_SHORT, SEGMENT, SEGMENTS_OF, ALERT, productLabel as prodSegLabel, deltaTag, productChip } from './ui.js';
import { lineChart, barChart, scatterChart, doughnut, radarChart, palette, legendHtml } from './charts.js';

const P = new URLSearchParams(location.search);
const cfg = {
  type: P.get('type') || 'geral', cycles: (P.get('cycles') || '').split(',').filter(Boolean), product: P.get('product') || '', segment: P.get('segment') || '', team: P.get('team') || '',
  operator_id: P.get('operator_id') || '', theme: P.get('theme') || 'dark', title: P.get('title') || '', subtitle: P.get('subtitle') || '',
  sections: (P.get('sections') || 'capa,resumo,evolucao,dispersao,criterios,ranking,destaques,speech').split(','),
};
document.documentElement.dataset.theme = cfg.theme;
const has = (s) => cfg.sections.includes(s);
const pages = [];
const charts = [];
let pageNo = 0;
let D = null, FULL = null, OP = null, BYP = null;

const TYPE_LABEL = { geral: 'Report de Qualidade', comparativo: 'Comparativo de Quinzenas', produto: 'Comparativo por Produto', individual: 'Report Individual' };

function periodLabel() {
  const cs = D.selected_cycles;
  if (!cs.length) return 'Todas as quinzenas';
  if (cs.length === 1) return cs[0].name;
  return `${cs[0].name} → ${cs[cs.length - 1].name}`;
}
// Produtos com monitorias no recorte (na ordem Veículos, Cartões, Consignado, Refin, Entrega)
const prods = (d) => (d.segments || []).filter((x) => x.level === 'product').map((x) => x.product);
const pSeries = (d) => { const c = palette(); return prods(d).map((p) => ({ p, key: p.toLowerCase(), label: PRODUCT[p], short: PRODUCT_SHORT[p], color: c[p.toLowerCase()] })); };
const productLabel = () => (cfg.product ? (cfg.segment ? prodSegLabel(cfg.product, cfg.segment) : PRODUCT[cfg.product]) : (prods(D).map((p) => PRODUCT[p]).join(', ') || 'Todos os produtos'));
const countsLabel = (k, d) => pSeries(d).map((x) => `${fmtInt(k['total_' + x.key])} ${x.short}`).join(' · ');

function page(kicker, title, body, { cls = '' } = {}) {
  pageNo++;
  pages.push(String(html`<section class="page ${cls}">
    <div class="page-h">${pxLogo(30)}<div class="t"><div class="k">${kicker}</div><h2>${title}</h2></div>
      <div class="meta">${periodLabel()}<br>${productLabel()}${cfg.team ? ` · ${cfg.team}` : ''}</div></div>
    <div class="body">${body}</div>
    <div class="page-f"><span>${D.company} · Monitorias &amp; Feedbacks${cfg.subtitle ? ` · ${cfg.subtitle}` : ''}${D.report_footer ? ` · ${D.report_footer}` : ''}</span><span>Gerado por ${D.generated_by} em ${fmtDate(D.generated_at, true)} · página ${pageNo + 1}</span></div>
  </section>`));
}
function chart(id, fn, cls = '') { charts.push([id, fn]); return html`<div class="chart-box ${cls}"><canvas id="${id}"></canvas></div>`; }
function kpi(label, val, suffix, foot, ic, tone = '') {
  const tones = { bad: 'background:var(--bad-soft);color:var(--bad-ink)', warn: 'background:var(--warn-soft);color:var(--warn-ink)', ok: 'background:var(--ok-soft);color:var(--ok-ink)' };
  return html`<div class="card kpi"><div class="k-label"><span class="k-ic" style="${tones[tone] || ''}">${icon(ic)}</span>${label}</div><div class="k-val num">${val}<small>${suffix}</small></div><div class="k-foot">${foot}</div></div>`;
}
const shortCycle = (n) => String(n).replace(' Quinzena', ' Q');
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out.length ? out : [[]]; };
const heat = (v) => {
  if (v == null) return 'background:var(--surface-2);color:var(--muted)';
  const b = band(v);
  return { excelente: 'background:var(--ok-soft);color:var(--ok-ink)', bom: 'background:var(--info-soft);color:var(--info-ink)', atencao: 'background:var(--warn-soft);color:var(--warn-ink)', critico: 'background:var(--bad-soft);color:var(--bad-ink)' }[b];
};

// --------------------------------------------------------------- Capa
function cover(title, sub, big) {
  pages.push(String(html`<section class="page cover"><div class="mesh"></div><div class="grid-lines"></div><div class="in">
    <div class="brand">${pxLogo(54)}<div>${D.company}<small>Monitorias &amp; Feedbacks</small></div></div>
    <div class="kicker">${TYPE_LABEL[cfg.type]}</div>
    <h1>${title}</h1>
    <div class="sub">${sub}</div>
    <div class="chips"><span>${periodLabel()}</span><span>${productLabel()}</span>${cfg.team ? html`<span>${cfg.team}</span>` : ''}${cfg.subtitle ? html`<span>${cfg.subtitle}</span>` : ''}</div>
    <div class="foot"><div class="big">${big.map(([v, l]) => html`<div><b>${v}</b><span>${l}</span></div>`)}</div>
      <div style="text-align:right">Elaborado por ${D.generated_by}<br>${fmtDate(D.generated_at, true)}</div></div>
  </div></section>`));
}

// --------------------------------------------------------------- Insights automáticos
function insights(d, evo) {
  const out = [];
  const k = d.kpis;
  const last = evo[evo.length - 1], prev = evo[evo.length - 2];
  if (last && prev && last.geral != null && prev.geral != null) {
    const dv = last.geral - prev.geral;
    out.push(['trendUp', dv >= 0 ? 'ok' : 'bad', `A nota média ${dv >= 0 ? 'subiu' : 'caiu'} <b>${fmtScore(Math.abs(dv))}</b> ponto(s) de ${esc(shortCycle(prev.cycle))} para ${esc(shortCycle(last.cycle))} (${fmtScore(prev.geral)} → <b>${fmtScore(last.geral)}</b>).`]);
  }
  const ps = (d.segments || []).filter((x) => x.level === 'product' && x.avg != null);
  if (ps.length > 1 && !cfg.product) out.push(['scale', 'info', `Nota média por produto: ${ps.map((x) => `${PRODUCT[x.product]} <b>${fmtScore(x.avg)}</b>`).join(' · ')}.`]);
  for (const p of ps.filter((x) => SEGMENTS_OF[x.product])) {
    const segs = (d.segments || []).filter((x) => x.product === p.product && x.level === 'segment' && x.total && x.segment !== 'none');
    if (segs.length) out.push(['layers', 'info', `${PRODUCT[p.product]}: ${segs.map((x) => `${SEGMENT[x.segment]} <b>${fmtScore(x.avg)}</b> (${x.total})`).join(' · ')}.`]);
  }
  const al = Object.entries(k.alerts || {}).filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
  if (al.length) out.push(['alert', 'bad', `Alertas de qualidade: ${al.slice(0, 3).map(([a, v]) => `<b>${v}</b> ${ALERT[a][0].toLowerCase()}`).join(' · ')}.`]);
  const ops = d.operators.filter((o) => o.avg != null);
  if (ops.length) out.push(['award', 'ok', `Destaque: <b>${esc(ops[0].name)}</b> com média ${fmtScore(ops[0].avg)}${ops[1] ? `, seguido de ${esc(ops[1].name)} (${fmtScore(ops[1].avg)})` : ''}.`]);
  const low = ops.filter((o) => o.avg < 70);
  if (low.length) out.push(['alert', 'bad', `<b>${low.length}</b> operador(es) abaixo de 70: ${low.slice(0, 4).map((o) => esc(o.name)).join(', ')}${low.length > 4 ? ` e mais ${low.length - 4}` : ''}. Prioridade de acompanhamento.`]);
  const minBase = Math.min(5, Math.max(1, ...d.criteria.map((c) => c.base || 0)));
  const crit = d.criteria.filter((c) => c.base >= minBase);
  if (crit[0]) out.push(['target', 'warn', `Critério mais ofensor: <b>${esc(crit[0].name)}</b> (${fmtScore(crit[0].fail_rate)}% de falha)${crit[1] ? `, seguido de ${esc(crit[1].name)} (${fmtScore(crit[1].fail_rate)}%)` : ''}.`]);
  if (k.evals_adjusted) out.push(['edit', 'info', `<b>${k.evals_adjusted}</b> monitoria(s) (${fmtPct((k.evals_adjusted / k.total) * 100)}) tiveram a análise do speech corrigida antes do feedback — ${k.items_adjusted} critério(s) ajustado(s).`]);
  out.push(['msgCheck', k.feedback_rate >= 90 ? 'ok' : 'warn', `Feedbacks aplicados em <b>${fmtPct(k.feedback_rate)}</b> das monitorias (${k.feedback_applied} de ${k.total}).`]);
  return out;
}
function insightList(list) {
  const tone = { ok: ['var(--ok-soft)', 'var(--ok-ink)'], bad: ['var(--bad-soft)', 'var(--bad-ink)'], warn: ['var(--warn-soft)', 'var(--warn-ink)'], info: ['var(--info-soft)', 'var(--info-ink)'] };
  return html`<div class="ins-list">${list.map(([ic, t, txt]) => html`<div class="ins"><span class="ic" style="background:${tone[t][0]};color:${tone[t][1]}">${icon(ic)}</span><div>${raw(txt)}</div></div>`)}</div>`;
}

// --------------------------------------------------------------- Seções
function secResumo(d, evo) {
  const k = d.kpis, c = palette();
  const st = [k.feedback_applied, k.reviewed - k.feedback_applied, k.total - k.reviewed];
  page('Resumo executivo', 'Principais números do período', html`
    <div class="grid g-6">
      ${kpi('Nota média final', fmtScore(k.avg_final), '', html`Speech original: <b>${fmtScore(k.avg_speech)}</b>`, 'gauge')}
      ${kpi('Aderência ao roteiro', fmtScore(k.adherence ?? k.conformity), '%', 'itens feitos ÷ itens que cabiam', 'target')}
      ${kpi('Monitorias', fmtInt(k.total), '', countsLabel(k, d), 'headset')}
      ${kpi('Feedbacks aplicados', fmtScore(k.feedback_rate), '%', `${k.feedback_applied} de ${k.total}`, 'msgCheck', 'ok')}
      ${Object.values(k.alerts || {}).some(Boolean)
        ? kpi('Alertas de qualidade', fmtInt(Object.values(k.alerts).reduce((a, b) => a + b, 0)), '', Object.entries(k.alerts).filter(([, v]) => v).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([a, v]) => `${v} ${ALERT[a][0].toLowerCase()}`).join(' · '), 'alert', 'bad')
        : kpi('Falhas críticas', fmtInt(k.critical_fails), '', 'monitorias zeradas', 'alert', 'bad')}
      ${kpi('Análises corrigidas', fmtInt(k.evals_adjusted), '', `${k.items_adjusted} critérios ajustados`, 'edit', 'warn')}
    </div>
    <div class="row-fill" style="grid-template-columns: 1.5fr 1fr">
      <div class="card fill"><div class="card-head"><h3>Leitura do período</h3></div><div class="card-body">${insightList(insights(d, evo).slice(0, 6))}</div></div>
      <div class="card fill"><div class="card-head"><h3>Status das monitorias</h3></div><div class="card-body">
        ${raw(legendHtml([{ label: `Feedback aplicado (${st[0]})`, color: c.ok }, { label: `Revisada (${st[1]})`, color: c.refin }, { label: `Pendente (${st[2]})`, color: c.warn }]))}
        ${chart('c-status', () => doughnut($('#c-status'), ['Feedback aplicado', 'Revisada', 'Pendente'], st, [c.ok, c.refin, c.warn]))}</div></div>
    </div>`);
}

// Visão apartada por produto e segmento (Clean Curto/Longo, Público/Privado)
function secSegmentos(d) {
  const rows = d.segments || [];
  if (!rows.length) return;
  const ser = pSeries(d);
  const bars = rows.filter((r) => r.total && (r.level === 'segment' || !SEGMENTS_OF[r.product]));
  const c = palette();
  page('Produtos e segmentos', 'Resultados apartados por carteira', html`
    <div class="row-fill" style="grid-template-columns: 1.25fr 1fr">
      <div class="card fill"><div class="card-body"><table class="tbl seg-table"><thead><tr><th>Produto / segmento</th><th class="right">Monit.</th><th class="right">Operadores</th><th class="right">Nota</th><th class="right">Aderência</th><th class="right">Feedback</th><th class="right">Alertas</th></tr></thead>
        <tbody>${rows.map((r) => html`<tr class="lvl-${r.level}" style="--pc:${ser.find((x) => x.p === r.product)?.color || 'var(--brand)'}"><td class="lvl-${r.level}">${r.level === 'product' ? html`<span class="dot"></span>${PRODUCT[r.product]}` : SEGMENT[r.segment]}</td>
          <td class="right num">${fmtInt(r.total)}</td><td class="right num">${r.total ? fmtInt(r.operators) : '—'}</td><td class="right"><b class="num score-txt band-${band(r.avg)}">${fmtScore(r.avg)}</b></td>
          <td class="right num">${fmtPct(r.adherence)}</td><td class="right num">${r.total ? fmtPct(r.feedback_rate) : '—'}</td><td class="right num">${r.total ? fmtInt(r.alerts) : '—'}</td></tr>`)}</tbody></table>
        <p class="tiny muted" style="margin:8px 0 0">Aderência = itens do roteiro feitos ÷ itens que cabiam, somando todas as ligações (mesma conta dos dashboards PAN). Nota = média das notas por ligação.</p></div></div>
      <div class="card fill"><div class="card-head"><h3>Nota média por segmento</h3></div><div class="card-body">
        ${chart('c-seg', () => barChart($('#c-seg'), bars.map((r) => (r.level === 'segment' ? `${PRODUCT_SHORT[r.product]} · ${SEGMENT[r.segment]}` : PRODUCT[r.product])), [{ label: 'Nota média', data: bars.map((r) => r.avg) }],
          { horizontal: true, max: 100, colors: bars.map((r) => ser.find((x) => x.p === r.product)?.color || c.brand) }))}</div></div>
    </div>`);
}

function secEvolucao(evo, d) {
  const c = palette();
  const rows = evo.slice(-8);
  const ser = pSeries(d).slice(0, 3);
  page('Evolução', 'Nota por quinzena e comparativo', html`
    <div class="row-fill" style="grid-template-columns: 1.35fr 1fr">
      <div class="card fill"><div class="card-head"><h3>Evolução da nota média</h3><div class="grow"></div>${raw(legendHtml([{ label: 'Geral', color: c.geral, line: true }, ...(ser.length > 1 ? ser.map((x) => ({ label: x.short, color: x.color, line: true })) : []), { label: 'Speech', color: c.speech, line: true, dash: true }]))}</div>
        <div class="card-body">${chart('c-evo', () => lineChart($('#c-evo'), rows.map((e) => shortCycle(e.cycle)), [
          { label: 'Geral', data: rows.map((e) => e.geral), color: c.geral, fill: true }, ...(ser.length > 1 ? ser.map((x) => ({ label: x.label, data: rows.map((e) => e[x.key]), color: x.color })) : []),
          { label: 'Speech', data: rows.map((e) => e.speech), color: c.speech, dash: [5, 4] }], { min: 30 }))}</div></div>
      <div class="card fill"><div class="card-head"><h3>Comparativo por quinzena</h3></div><div class="card-body">
        <table class="tbl"><thead><tr><th>Quinzena</th><th class="right">Monit.</th><th class="right">Geral</th>${ser.map((x) => html`<th class="right">${x.short}</th>`)}<th class="right">Conf.</th><th class="right">Feedback</th></tr></thead>
        <tbody>${rows.map((e, i) => html`<tr style="${d.selected_cycles.some((s) => s.id === e.cycle_id) ? 'background:var(--brand-soft)' : ''}"><td><b>${shortCycle(e.cycle)}</b></td><td class="right num">${e.total}</td>
          <td class="right num"><b>${fmtScore(e.geral)}</b> ${i ? deltaTag(e.geral != null && rows[i - 1].geral != null ? e.geral - rows[i - 1].geral : null) : ''}</td>
          ${ser.map((x) => html`<td class="right num">${fmtScore(e[x.key])}</td>`)}<td class="right num">${fmtPct(e.conformity)}</td><td class="right num">${fmtPct(e.feedback_rate)}</td></tr>`)}</tbody></table>
      </div></div>
    </div>`);
}

function secDispersao(d) {
  const c = palette();
  const maxSd = Math.max(10, ...d.operators.map((o) => o.sd || 0));
  const minAvg = Math.max(0, Math.floor(Math.min(...d.operators.map((o) => o.avg ?? 100)) / 10) * 10 - 5);
  page('Dispersão', 'Distribuição e consistência das notas', html`
    <div class="row-fill" style="grid-template-columns: 1fr 1fr">
      <div class="card fill"><div class="card-head"><h3>Nota original × nota final</h3><div class="grow"></div>${raw(legendHtml(pSeries(d).map((x) => ({ label: x.label, color: x.color }))))}</div>
        <div class="card-body"><div class="tiny muted" style="margin-bottom:4px">Acima da diagonal: nota corrigida para cima na revisão; abaixo: para baixo.</div>
        ${chart('c-sc', () => scatterChart($('#c-sc'), pSeries(d).map((x, i) => (
          { label: x.label, color: x.color, data: d.scatter.filter((p) => p.product === x.p).map((p) => ({ ...p, label: p.operator })), style: ['circle', 'rectRounded', 'triangle', 'rectRot', 'star'][i % 5] })),
          { xLabel: 'Nota do speech / 1ª leitura', yLabel: 'Nota final', diagonal: true }))}</div></div>
      <div class="card fill"><div class="card-head"><h3>Mapa de desempenho por operador</h3></div>
        <div class="card-body"><div class="tiny muted" style="margin-bottom:4px">Média × desvio-padrão. Quanto mais à direita e embaixo, melhor e mais consistente.</div>
        ${chart('c-map', () => scatterChart($('#c-map'), [{ label: 'Operadores', color: c.brand, radius: 7, data: d.operators.filter((o) => o.avg != null).map((o) => ({ x: o.avg, y: o.sd, label: o.name })) }],
          { xLabel: 'Nota média', yLabel: 'Desvio-padrão', xmin: minAvg, xmax: 100, ymin: 0, ymax: Math.ceil(maxSd / 5) * 5 + 5, tooltip: (x) => ` ${x.raw.label}: ${fmtScore(x.raw.x)} · desvio ${fmtScore(x.raw.y)}` }))}</div></div>
    </div>
    <div class="card"><div class="card-head"><h3>Faixas de nota</h3></div><div class="card-body" style="display:grid;grid-template-columns:repeat(5,1fr);gap:4mm">
      ${d.distribution.map((x) => html`<div style="text-align:center;padding:8px;border-radius:10px;background:var(--surface-2)"><div class="tiny muted strong">${x.label}</div><b style="font-size:22px">${x.count}</b><div class="tiny muted">${fmtPct(d.kpis.total ? (x.count / d.kpis.total) * 100 : 0)}</div></div>`)}</div></div>`);
}

function secCriterios(d) {
  const c = palette();
  const crit = d.criteria.filter((x) => x.base);
  const top = crit.slice(0, 9);
  page('Critérios', 'Pontos de atenção do formulário', html`
    <div class="row-fill" style="grid-template-columns: 1fr 1.15fr">
      <div class="card fill"><div class="card-head"><h3>Mais ofensores (índice de falha)</h3><div class="grow"></div>${raw(legendHtml([{ label: 'Crítico', color: c.bad }, { label: 'Não crítico', color: c.warn }]))}</div>
        <div class="card-body">${chart('c-crit', () => barChart($('#c-crit'), top.map((x) => `${x.code} · ${x.name}`), [{ label: 'Índice de falha', data: top.map((x) => x.fail_rate) }], { horizontal: true, suffix: '%', colors: top.map((x) => (x.critical ? c.bad : c.warn)) }))}</div></div>
      <div class="card fill"><div class="card-head"><h3>Resultado por critério</h3></div><div class="card-body" style="overflow:hidden">
        <table class="tbl"><thead><tr><th>Critério</th><th>Produto</th><th class="right">C</th><th class="right">P</th><th class="right">NC</th><th class="right">Conform.</th><th class="right">Ajustes</th></tr></thead>
        <tbody>${crit.slice(0, 16).map((x) => html`<tr><td><b>${x.code}</b> ${x.name}${x.critical ? html` <span class="chip bad" style="padding:0 6px">crítico</span>` : ''}</td><td class="tiny">${{ AMBOS: 'Refin/Entrega', REFIN: 'Refin', ENTREGA: 'Entrega', VEICULOS: 'Veículos', SEM_GARANTIA: 'Sem Garantia', CARTOES: 'Cartões', CONSIGNADO: 'Consignado' }[x.product] || x.product}</td>
          <td class="right num">${x.C}</td><td class="right num">${x.P}</td><td class="right num">${x.NC}</td><td class="right"><span class="chip" style="${heat(x.conformity)}">${fmtPct(x.conformity)}</span></td><td class="right num">${x.adjusted}</td></tr>`)}</tbody></table>
      </div></div>
    </div>`);
}

function rankingTable(ops, cyclesCols = null) {
  return html`<table class="tbl"><thead><tr><th>#</th><th>Operador</th><th>Equipe</th><th class="right">Monit.</th>${cyclesCols ? cyclesCols.map((cc) => html`<th class="right">${shortCycle(cc.name)}</th>`) : html`<th class="right">Refin</th><th class="right">Entrega</th>`}<th class="right">Média</th><th class="right">Δ</th><th class="right">Feedback</th><th>Faixa</th></tr></thead>
    <tbody>${ops.map((o) => html`<tr><td><span class="rank ${o.rank <= 3 ? 'r' + o.rank : ''}">${o.rank}</span></td><td><div class="who">${avatar(o.name, 'sm')}<b>${o.name}</b></div></td><td class="tiny">${o.team || ''}</td><td class="right num">${o.total}</td>
      ${cyclesCols ? cyclesCols.map((cc) => html`<td class="right num" style="${heat(o.byCycle?.[cc.id])}">${fmtScore(o.byCycle?.[cc.id])}</td>`) : html`<td class="right num">${fmtScore(o.refin)}</td><td class="right num">${fmtScore(o.entrega)}</td>`}
      <td class="right"><b class="num score-txt band-${band(o.avg)}">${fmtScore(o.avg)}</b></td><td class="right">${deltaTag(o.delta)}</td><td class="right num">${fmtScore(o.feedback_rate, 0)}%</td><td><span class="chip" style="${heat(o.avg)}">${BAND_LABEL[band(o.avg)]}</span></td></tr>`)}</tbody></table>`;
}

function secRanking(d, cyclesCols = null) {
  const ops = d.operators.map((o, i) => ({ ...o, rank: i + 1 }));
  if (cyclesCols) {
    for (const o of ops) {
      o.byCycle = {};
      for (const pc of D.per_cycle) { const x = pc.operators.find((y) => y.operator_id === o.operator_id); o.byCycle[pc.cycle.id] = x ? x.avg : null; }
      const first = o.byCycle[cyclesCols[0].id], last = o.byCycle[cyclesCols[cyclesCols.length - 1].id];
      o.delta = first != null && last != null ? Math.round((last - first) * 10) / 10 : null;
    }
  }
  const parts = ops.length <= 16 ? [ops] : chunk(ops, 16);
  const showPodium = ops.length >= 3 && ops.length <= 11 && !cyclesCols;
  parts.forEach((part, i) => {
    const podium = i === 0 && showPodium ? html`<div class="podium">${ops.slice(0, 3).map((o, k) => html`<div class="p"><span class="rank r${k + 1}">${k + 1}</span><div style="margin-top:6px"><b>${o.name}</b></div><b class="s score-txt band-${band(o.avg)}">${fmtScore(o.avg)}</b><span class="tiny muted">${o.total} monitorias · ${fmtScore(o.feedback_rate, 0)}% feedback</span></div>`)}</div>` : '';
    page('Operadores', `Ranking de operadores${parts.length > 1 ? ` (${i + 1}/${parts.length})` : ''}`, html`${podium}<div class="card fill"><div class="card-body">${rankingTable(part, cyclesCols)}</div></div>`);
  });
}

function secDestaques(d) {
  const tbl = (rows) => html`<table class="tbl"><thead><tr><th>Operador</th><th>Produto</th><th>Data</th><th class="right">Speech</th><th class="right">Final</th><th>Feedback</th></tr></thead><tbody>${rows.map((e) => html`<tr><td><b>${e.operator_name}</b></td><td>${productChip(e.product)}</td><td>${fmtDate(e.call_date)}</td><td class="right num">${fmtScore(e.speech_score)}</td><td class="right"><b class="num score-txt band-${band(e.final_score)}">${fmtScore(e.final_score)}</b></td><td>${e.status === 'feedback_aplicado' ? html`<span class="chip ok">aplicado</span>` : html`<span class="chip warn">pendente</span>`}</td></tr>`)}</tbody></table>`;
  page('Destaques', 'Melhores atendimentos, pontos de atenção e feedbacks', html`
    <div class="grid g-2">
      <div class="card"><div class="card-head"><h3>${icon('award')} Melhores atendimentos</h3></div><div class="card-body">${tbl(d.highlights)}</div></div>
      <div class="card"><div class="card-head"><h3>${icon('alert')} Atendimentos que exigem atenção</h3></div><div class="card-body">${tbl(d.lowlights)}</div></div>
    </div>
    <div class="card fill"><div class="card-head"><h3>Feedbacks recentes</h3></div><div class="card-body" style="display:grid;grid-template-columns:1fr 1fr;gap:3mm;overflow:hidden">
      ${d.feedbacks.slice(0, 6).map((f) => html`<div class="ins"><span class="ic" style="background:var(--ok-soft);color:var(--ok-ink)">${icon('msgCheck')}</span><div><b>${f.operator_name}</b> <span class="tiny muted">· ${fmtDate(f.applied_at)} · nota ${fmtScore(f.final_score)}</span><div class="t2" style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${f.content}</div></div></div>`)}
      ${d.feedbacks.length ? '' : html`<div class="muted small">Nenhum feedback registrado no período.</div>`}</div></div>`);
}

function secSpeech(d) {
  const k = d.kpis, c = palette();
  const adj = [...d.criteria].filter((x) => x.adjusted).sort((a, b) => b.adjusted - a.adjusted).slice(0, 8);
  page('Qualidade do speech', 'O que a revisão corrigiu antes do feedback', html`
    <div class="grid g-4">
      ${kpi('Nota média do speech', fmtScore(k.avg_speech), '', 'antes da revisão', 'headset')}
      ${kpi('Nota média final', fmtScore(k.avg_final), '', html`${deltaTag(k.avg_final != null && k.avg_speech != null ? k.avg_final - k.avg_speech : null)} após ajustes`, 'gauge')}
      ${kpi('Monitorias corrigidas', fmtInt(k.evals_adjusted), '', `${fmtPct(k.total ? (k.evals_adjusted / k.total) * 100 : 0)} do total`, 'edit', 'warn')}
      ${kpi('Assertividade do speech', fmtScore(k.speech_accuracy), '%', 'critérios mantidos sem ajuste', 'target', 'ok')}
    </div>
    <div class="row-fill" style="grid-template-columns: 1.2fr 1fr">
      <div class="card fill"><div class="card-head"><h3>Critérios mais corrigidos na revisão</h3></div><div class="card-body">
        ${adj.length ? chart('c-adj', () => barChart($('#c-adj'), adj.map((x) => `${x.code} · ${x.name}`), [{ label: 'Ajustes', data: adj.map((x) => x.adjusted) }], { horizontal: true, colors: adj.map(() => c.brand) })) : html`<p class="muted">Nenhum ajuste no período.</p>`}</div></div>
      <div class="card fill"><div class="card-head"><h3>Por que isso importa</h3></div><div class="card-body">${insightList([
        ['shield', 'info', 'Cada ajuste tem motivo registrado e autor, garantindo rastreabilidade do que mudou em relação ao speech.'],
        ['msgCheck', 'ok', 'Feedbacks são aplicados com base na análise revisada, evitando cobrar o operador por leituras equivocadas da ferramenta.'],
        ['sparkles', 'warn', 'As correções recorrentes indicam onde o speech precisa de calibração (vocabulário, separação de falas, ruído).'],
      ])}</div></div>
    </div>`);
}

// --------------------------------------------------------------- Tipos
function buildGeral() {
  const evo = FULL.evolution;
  if (has('capa')) cover(cfg.title || (D.selected_cycles.length === 1 ? `Monitorias de Qualidade · ${D.selected_cycles[0].name}` : 'Monitorias de Qualidade'), `Resultados das monitorias de ${productLabel()}, com análises revisadas e feedbacks aplicados.`,
    [[fmtScore(D.kpis.avg_final), 'Nota média'], [fmtPct(D.kpis.adherence ?? D.kpis.conformity), 'Aderência'], [fmtInt(D.kpis.total), 'Monitorias'], [fmtPct(D.kpis.feedback_rate), 'Feedbacks']]);
  if (has('resumo')) secResumo(D, evo);
  if (has('segmentos')) secSegmentos(D);
  if (has('evolucao')) secEvolucao(evo, D);
  if (has('dispersao')) secDispersao(D);
  if (has('criterios')) secCriterios(D);
  if (has('ranking')) secRanking(D);
  if (has('destaques')) secDestaques(D);
  if (has('speech')) secSpeech(D);
}

function buildComparativo() {
  const pcs = D.per_cycle;
  const c = palette();
  const first = pcs[0], last = pcs[pcs.length - 1];
  const dv = (a, b) => (a != null && b != null ? Math.round((b - a) * 10) / 10 : null);
  if (has('capa')) cover(cfg.title || `Comparativo: ${shortCycle(first.cycle.name)} × ${shortCycle(last.cycle.name)}`, `Como evoluíram as monitorias de ${productLabel()} entre ${pcs.length} quinzenas.`,
    [[fmtScore(first.kpis.avg_final), shortCycle(first.cycle.name)], [fmtScore(last.kpis.avg_final), shortCycle(last.cycle.name)], [`${dv(first.kpis.avg_final, last.kpis.avg_final) > 0 ? '+' : ''}${fmtScore(dv(first.kpis.avg_final, last.kpis.avg_final))}`, 'Variação']]);
  if (has('resumo')) {
    const metrics = [['Nota média', 'avg_final'], ['Aderência (%)', 'adherence'], ...pSeries(D).map((x) => [x.label, `avg_${x.key}`]), ['Feedbacks (%)', 'feedback_rate'], ['Monitorias', 'total'], ['Falhas críticas', 'critical_fails'], ['Análises corrigidas', 'evals_adjusted']];
    page('Comparativo', 'Indicadores lado a lado', html`
      <div class="row-fill" style="grid-template-columns: 1fr 1fr">
        <div class="card fill"><div class="card-head"><h3>Indicadores por quinzena</h3></div><div class="card-body">
          <table class="tbl"><thead><tr><th>Indicador</th>${pcs.map((p) => html`<th class="right">${shortCycle(p.cycle.name)}</th>`)}<th class="right">Variação</th></tr></thead>
          <tbody>${metrics.map(([l, key]) => html`<tr><td><b>${l}</b></td>${pcs.map((p) => html`<td class="right num">${key === 'total' || key === 'critical_fails' || key === 'evals_adjusted' ? fmtInt(p.kpis[key]) : fmtScore(p.kpis[key])}</td>`)}
            <td class="right">${['critical_fails'].includes(key) ? deltaTag(dv(last.kpis[key], first.kpis[key]) == null ? null : -dv(last.kpis[key], first.kpis[key]) * -1) : deltaTag(dv(first.kpis[key], last.kpis[key]))}</td></tr>`)}</tbody></table>
          <div class="mt">${insightList(insights(D, pcs.map((p) => ({ cycle: p.cycle.name, geral: p.kpis.avg_final }))).slice(0, 3))}</div></div></div>
        <div class="card fill"><div class="card-head"><h3>Nota média por produto</h3><div class="grow"></div>${raw(legendHtml([{ label: 'Geral', color: c.geral }, ...pSeries(D).map((x) => ({ label: x.short, color: x.color }))]))}</div>
          <div class="card-body">${chart('c-cmp', () => barChart($('#c-cmp'), pcs.map((p) => shortCycle(p.cycle.name)), [
            { label: 'Geral', data: pcs.map((p) => p.kpis.avg_final), color: c.geral }, ...pSeries(D).map((x) => ({ label: x.label, data: pcs.map((p) => p.kpis[`avg_${x.key}`]), color: x.color }))], { max: 100 }))}</div></div>
      </div>`);
  }
  if (has('evolucao')) secEvolucao(FULL.evolution, D);
  if (has('criterios')) {
    const crits = D.criteria.filter((x) => x.base).slice(0, 15);
    page('Critérios', 'Conformidade por critério em cada quinzena', html`<div class="card fill"><div class="card-body"><table class="tbl heat"><thead><tr><th>Critério</th>${pcs.map((p) => html`<th class="center">${shortCycle(p.cycle.name)}</th>`)}<th class="right">Variação</th></tr></thead>
      <tbody>${crits.map((cr) => { const vals = pcs.map((p) => p.criteria.find((x) => x.criterion_id === cr.criterion_id)?.conformity ?? null); return html`<tr><td><b>${cr.code}</b> ${cr.name}${cr.critical ? html` <span class="chip bad" style="padding:0 6px">crítico</span>` : ''}</td>${vals.map((v) => html`<td class="h num" style="${heat(v)}">${fmtPct(v)}</td>`)}<td class="right">${deltaTag(dv(vals[0], vals[vals.length - 1]), ' p.p.')}</td></tr>`; })}</tbody></table></div></div>`);
  }
  if (has('dispersao')) secDispersao(D);
  if (has('ranking')) secRanking(D, pcs.map((p) => p.cycle));
  if (has('destaques')) secDestaques(D);
  if (has('speech')) secSpeech(D);
}

// Grupos do comparativo: os produtos do recorte ou, com um produto escolhido, os segmentos dele
async function loadGroups(base) {
  const c = palette();
  const segRows = (D.segments || []).filter((x) => x.total);
  let groups;
  if (cfg.product && SEGMENTS_OF[cfg.product] && !cfg.segment) {
    const tones = [c[cfg.product.toLowerCase()], c.geral, c.entrega];
    groups = segRows.filter((x) => x.level === 'segment' && x.product === cfg.product)
      .map((x, i) => ({ label: SEGMENT[x.segment], color: tones[i % tones.length], q: { ...base, segment: x.segment } }));
  } else {
    groups = segRows.filter((x) => x.level === 'product').map((x) => ({ label: PRODUCT[x.product], color: c[x.product.toLowerCase()], q: { ...base, product: x.product, segment: '' } }));
  }
  groups = groups.slice(0, 3);
  for (const g of groups) g.data = await api.get(`/stats/overview${qs(g.q)}`);
  return groups;
}

function buildProduto() {
  const G = BYP, c = palette();
  const names = G.map((g) => g.label).join(' × ');
  const cols = `repeat(${Math.max(1, G.length)}, 1fr)`;
  if (has('capa')) cover(cfg.title || names || 'Comparativo por produto', `Comparativo de ${names}: notas, aderência ao roteiro, critérios ofensores e operadores.`,
    [...G.map((g) => [fmtScore(g.data.kpis.avg_final), g.label]), [fmtInt(D.kpis.total), 'Monitorias']]);
  if (G.length < 2) {
    page('Produtos', 'Comparativo indisponível', html`<div class="card fill"><div class="card-body"><p class="t2">O recorte tem só ${G.length ? `“${G[0].label}”` : 'nenhum grupo com monitorias'}. Para comparar, deixe o produto em “Todos” ou escolha um produto com segmentos (Cartões ou Consignado).</p></div></div>`);
    return;
  }
  if (has('resumo')) {
    const row = (l, key, f = fmtScore) => html`<tr><td><b>${l}</b></td>${G.map((g) => html`<td class="right num">${f(g.data.kpis[key])}</td>`)}</tr>`;
    page('Produtos', `Indicadores · ${names}`, html`<div class="row-fill" style="grid-template-columns: 1fr 1fr">
      <div class="card fill"><div class="card-body"><table class="tbl"><thead><tr><th>Indicador</th>${G.map((g) => html`<th class="right">${g.label}</th>`)}</tr></thead><tbody>
        ${row('Nota média final', 'avg_final')}${row('Aderência ao roteiro (%)', 'adherence')}${row('Nota média original', 'avg_speech')}${row('Conformidade (%)', 'conformity')}
        ${row('Monitorias', 'total', fmtInt)}${row('Operadores', 'operators', fmtInt)}${row('Feedbacks (%)', 'feedback_rate')}${row('Análises corrigidas', 'evals_adjusted', fmtInt)}
      </tbody></table><div class="mt">${insightList(insights(D, FULL.evolution).slice(0, 3))}</div></div></div>
      <div class="card fill"><div class="card-head"><h3>Nota média e aderência</h3><div class="grow"></div>${raw(legendHtml(G.map((g) => ({ label: g.label, color: g.color }))))}</div>
        <div class="card-body">${chart('c-pe', () => barChart($('#c-pe'), ['Nota média', 'Aderência (%)', 'Feedbacks (%)'],
          G.map((g) => ({ label: g.label, data: [g.data.kpis.avg_final, g.data.kpis.adherence, g.data.kpis.feedback_rate], color: g.color })), { max: 100 }))}</div></div></div>`);
  }
  if (has('criterios')) {
    const t = (X, id, col) => { const top = X.criteria.filter((x) => x.base).slice(0, 8); return chart(id, () => barChart($(`#${id}`), top.map((x) => `${x.code} · ${x.name}`), [{ label: 'Índice de falha', data: top.map((x) => x.fail_rate) }], { horizontal: true, suffix: '%', colors: top.map(() => col) })); };
    page('Critérios', 'Mais ofensores por grupo', html`<div class="row-fill" style="grid-template-columns: ${cols}">
      ${G.map((g, i) => html`<div class="card fill"><div class="card-head"><h3>${g.label}</h3></div><div class="card-body">${t(g.data, `c-cr${i}`, g.color)}</div></div>`)}</div>`);
  }
  if (has('dispersao')) secDispersao(D);
  if (has('ranking')) {
    const mini = (X) => html`<table class="tbl"><thead><tr><th>#</th><th>Operador</th><th class="right">Monit.</th><th class="right">Média</th></tr></thead><tbody>${X.operators.slice(0, 14).map((o, i) => html`<tr><td><span class="rank ${i < 3 ? 'r' + (i + 1) : ''}">${i + 1}</span></td><td><b>${o.name}</b></td><td class="right num">${o.total}</td><td class="right"><b class="num score-txt band-${band(o.avg)}">${fmtScore(o.avg)}</b></td></tr>`)}</tbody></table>`;
    page('Operadores', 'Ranking por grupo', html`<div class="row-fill" style="grid-template-columns: ${cols}">
      ${G.map((g) => html`<div class="card fill"><div class="card-head"><h3>${g.label}</h3></div><div class="card-body">${mini(g.data)}</div></div>`)}</div>`);
  }
  if (has('destaques')) secDestaques(D);
  if (has('speech')) secSpeech(D);
  void c;
}

function buildIndividual() {
  const op = OP.operator, k = OP.kpis, c = palette();
  if (has('capa')) cover(cfg.title || op.name, `Report individual de qualidade · ${op.team || 'sem equipe'}${op.supervisor_name ? ` · supervisão ${op.supervisor_name}` : ''}`,
    [[fmtScore(k.avg_final), 'Nota média'], [fmtScore(OP.team_avg), 'Média da equipe'], [fmtInt(k.total), 'Monitorias'], [fmtPct(k.feedback_rate), 'Feedbacks']]);
  const teamMap = new Map(OP.team_evolution.map((t) => [t.cycle_id, t.geral]));
  if (has('resumo') || has('evolucao')) {
    page('Desempenho', `${op.name}`, html`
      <div class="grid g-4">
        ${kpi('Nota média', fmtScore(k.avg_final), '', html`equipe ${fmtScore(OP.team_avg)} ${deltaTag(k.avg_final != null && OP.team_avg != null ? k.avg_final - OP.team_avg : null)}`, 'gauge')}
        ${kpi('Aderência ao roteiro', fmtScore(k.adherence ?? k.conformity), '%', `${k.items_conform}/${k.items_total} itens conformes`, 'target')}
        ${kpi('Monitorias', fmtInt(k.total), '', countsLabel(k, OP), 'headset')}
        ${kpi('Feedbacks', fmtScore(k.feedback_rate, 0), '%', `${k.feedback_applied} aplicados`, 'msgCheck', 'ok')}
      </div>
      <div class="row-fill" style="grid-template-columns: 1.4fr 1fr">
        <div class="card fill"><div class="card-head"><h3>Evolução × média da equipe</h3><div class="grow"></div>${raw(legendHtml([{ label: op.name.split(' ')[0], color: c.brand, line: true }, { label: 'Equipe', color: c.speech, line: true, dash: true }]))}</div>
          <div class="card-body">${chart('c-ie', () => lineChart($('#c-ie'), OP.evolution.map((e) => shortCycle(e.cycle)), [{ label: op.name.split(' ')[0], data: OP.evolution.map((e) => e.geral), color: c.brand, fill: true }, { label: 'Equipe', data: OP.evolution.map((e) => teamMap.get(e.cycle_id) ?? null), color: c.speech, dash: [5, 4] }], { min: 30 }))}</div></div>
        <div class="card fill"><div class="card-head"><h3>Perfil no roteiro</h3></div><div class="card-body">${chart('c-ir', () => { const by = {}; OP.criteria.filter((x) => x.base).forEach((x) => { by[x.product] = (by[x.product] || 0) + x.base; }); const main = Object.entries(by).sort((a, b) => b[1] - a[1])[0]?.[0]; const rc = OP.criteria.filter((x) => x.base && x.product === main); return radarChart($('#c-ir'), rc.map((x) => x.code), [{ label: 'Conformidade', data: rc.map((x) => x.conformity), color: c.brand }]); })}</div></div>
      </div>`);
  }
  if (has('criterios')) {
    const crit = OP.criteria.filter((x) => x.base).sort((a, b) => a.conformity - b.conformity);
    page('Critérios', 'Onde desenvolver', html`<div class="row-fill" style="grid-template-columns: 1fr 1fr">
      <div class="card fill"><div class="card-body">${chart('c-ic', () => barChart($('#c-ic'), crit.slice(0, 10).map((x) => `${x.code} · ${x.name}`), [{ label: 'Conformidade', data: crit.slice(0, 10).map((x) => x.conformity) }], { horizontal: true, max: 100, suffix: '%', colors: crit.slice(0, 10).map((x) => (x.conformity < 60 ? c.bad : x.conformity < 80 ? c.warn : c.ok)) }))}</div></div>
      <div class="card fill"><div class="card-body"><table class="tbl"><thead><tr><th>Critério</th><th class="right">C</th><th class="right">P</th><th class="right">NC</th><th class="right">Conform.</th></tr></thead><tbody>${crit.slice(0, 15).map((x) => html`<tr><td><b>${x.code}</b> ${x.name}</td><td class="right num">${x.C}</td><td class="right num">${x.P}</td><td class="right num">${x.NC}</td><td class="right"><span class="chip" style="${heat(x.conformity)}">${fmtPct(x.conformity)}</span></td></tr>`)}</tbody></table></div></div></div>`);
  }
  if (has('destaques')) {
    const evs = OP.evaluations.filter((e) => !cfg.cycles.length || cfg.cycles.includes(String(e.cycle_id))).slice(0, 12);
    page('Histórico', 'Monitorias e feedbacks do período', html`<div class="row-fill" style="grid-template-columns: 1.1fr 1fr">
      <div class="card fill"><div class="card-head"><h3>Monitorias</h3></div><div class="card-body"><table class="tbl"><thead><tr><th>Data</th><th>Produto</th><th class="right">Speech</th><th class="right">Final</th><th>Feedback</th></tr></thead><tbody>${evs.map((e) => html`<tr><td>${fmtDate(e.call_date)}</td><td>${productChip(e.product, e.segment)}</td><td class="right num">${fmtScore(e.speech_score)}</td><td class="right"><b class="num score-txt band-${band(e.final_score)}">${fmtScore(e.final_score)}</b></td><td>${e.status === 'feedback_aplicado' ? html`<span class="chip ok">aplicado</span>` : html`<span class="chip warn">pendente</span>`}</td></tr>`)}</tbody></table></div></div>
      <div class="card fill"><div class="card-head"><h3>Feedbacks aplicados</h3></div><div class="card-body" style="overflow:hidden"><div class="ins-list">${OP.feedbacks.slice(0, 5).map((f) => html`<div class="ins"><span class="ic" style="background:var(--ok-soft);color:var(--ok-ink)">${icon('msgCheck')}</span><div><b>${fmtDate(f.applied_at)}</b> <span class="tiny muted">· ${f.applied_by_display || f.applied_by_name}</span><div class="t2" style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${f.content}</div></div></div>`)}${OP.feedbacks.length ? '' : html`<p class="muted small">Nenhum feedback registrado.</p>`}</div></div></div></div>`);
  }
}

// --------------------------------------------------------------- Exportação
async function downloadHtml() {
  const cssText = (await Promise.all(['css/app.css', 'css/report.css'].map((u) => fetch(u).then((r) => r.text())))).join('\n');
  const clone = document.documentElement.cloneNode(true);
  $$('canvas', document).forEach((cv) => {
    const target = clone.querySelector(`#${cv.id}`);
    if (!target) return;
    const img = document.createElement('img');
    img.src = cv.toDataURL('image/png');
    img.style.width = '100%'; img.style.height = '100%'; img.style.objectFit = 'contain';
    target.replaceWith(img);
  });
  clone.querySelectorAll('script, .r-toolbar, link[rel=stylesheet][href^="css/"]').forEach((n) => n.remove());
  const st = document.createElement('style'); st.textContent = cssText + '\nbody{padding-top:20px}';
  clone.querySelector('head').appendChild(st);
  const blob = new Blob(['<!doctype html>\n' + clone.outerHTML], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(document.title || 'report').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase()}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

function fit() {
  const w = 297 * 3.7795 + 40;
  document.querySelector('.pages').style.setProperty('--fit', Math.min(1, window.innerWidth / w).toFixed(3));
}

async function main() {
  const root = document.getElementById('report');
  try {
    const base = { cycle_id: cfg.cycles.join(','), product: cfg.product, segment: cfg.segment, team: cfg.team };
    D = await api.get(`/reports/data${qs({ ...base, operator_id: cfg.type === 'individual' ? cfg.operator_id : '' })}`);
    FULL = await api.get(`/stats/overview${qs({ product: cfg.product, segment: cfg.segment, team: cfg.team })}`);
    if (cfg.type === 'produto') BYP = await loadGroups(base);
    if (cfg.type === 'individual') OP = await api.get(`/stats/operator/${cfg.operator_id}${qs({ cycle_id: base.cycle_id })}`);
  } catch (e) {
    root.innerHTML = `<div class="empty" style="color:#fff"><h4>Não foi possível gerar o report</h4><p>${esc(e.status === 401 ? 'Faça login na plataforma e gere o report novamente.' : e.message)}</p></div>`;
    return;
  }
  if (!D.kpis.total) { root.innerHTML = '<div class="empty" style="color:#fff"><h4>Sem monitorias no recorte selecionado</h4><p>Ajuste as quinzenas ou filtros e gere novamente.</p></div>'; return; }
  ({ geral: buildGeral, comparativo: buildComparativo, produto: buildProduto, individual: buildIndividual }[cfg.type] || buildGeral)();
  document.title = `${TYPE_LABEL[cfg.type]} · ${cfg.type === 'individual' ? OP.operator.name : periodLabel()}`;
  root.innerHTML = String(html`
    <div class="r-toolbar">${pxLogo(30)}<b>${document.title}</b><span class="grow"></span>
      <span class="small" style="opacity:.7">${pages.length} página(s)</span>
      <button class="btn sm" id="r-theme">${icon(cfg.theme === 'dark' ? 'sun' : 'moon')}${cfg.theme === 'dark' ? 'Versão clara' : 'Versão escura'}</button>
      <button class="btn sm" id="r-html">${icon('download')}Baixar HTML</button>
      <button class="btn sm primary" id="r-print">${icon('printer')}Imprimir / PDF</button></div>
    <div class="pages">${raw(pages.join(''))}</div>`);
  for (const [, fn] of charts) { try { fn(); } catch (e) { console.error(e); } }
  fit(); window.addEventListener('resize', fit);
  $('#r-print').onclick = () => window.print();
  $('#r-html').onclick = downloadHtml;
  $('#r-theme').onclick = () => { const p = new URLSearchParams(location.search); p.set('theme', cfg.theme === 'dark' ? 'light' : 'dark'); location.search = p.toString(); };
}
main();
void avatar;

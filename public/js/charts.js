// Fábrica de gráficos (Chart.js) com o tema da plataforma.
// Cores categóricas em ordem fixa e validadas para daltonismo; status reservados para C/P/NC.
const Chart = window.Chart;
const live = new Map();

// Com a escala da interface (CSS zoom), a posição do mouse precisa ser recalculada
// a partir do retângulo real do gráfico; sem isso o tooltip pega o ponto vizinho.
if (Chart && !Chart.registry.plugins.get('pxZoomFix')) {
  Chart.register({
    id: 'pxZoomFix',
    beforeEvent(chart, args) {
      const n = args.event?.native;
      if (!n || n.clientX == null) return;
      const r = chart.canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      args.event.x = ((n.clientX - r.left) / r.width) * chart.width;
      args.event.y = ((n.clientY - r.top) / r.height) * chart.height;
      const a = chart.chartArea;
      args.inChartArea = !!a && args.event.x >= a.left && args.event.x <= a.right && args.event.y >= a.top && args.event.y <= a.bottom;
    },
  });
}

export function cssVar(name, el = document.documentElement) {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

export function palette() {
  return {
    refin: cssVar('--s-refin'), entrega: cssVar('--s-entrega'), geral: cssVar('--s-geral'), speech: cssVar('--s-speech'), veiculos: cssVar('--s-veiculos'), cartoes: cssVar('--s-cartoes'), consignado: cssVar('--s-consignado'),
    ok: cssVar('--ok'), warn: cssVar('--warn'), bad: cssVar('--bad'), na: cssVar('--na'),
    text: cssVar('--text'), text2: cssVar('--text-2'), muted: cssVar('--muted'), grid: cssVar('--grid'), axis: cssVar('--axis'),
    surface: cssVar('--surface'), brand: cssVar('--brand'),
  };
}

function base(c) {
  return {
    responsive: true, maintainAspectRatio: false, animation: window.__PX_REPORT ? false : { duration: 650, easing: 'easeOutQuart' },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: c.surface, titleColor: c.text, bodyColor: c.text2, borderColor: c.axis, borderWidth: 1,
        padding: 12, cornerRadius: 12, boxPadding: 6, usePointStyle: true, titleFont: { weight: '700' },
        callbacks: {},
      },
    },
    scales: {
      x: { grid: { display: false }, border: { color: c.axis }, ticks: { color: c.muted, font: { size: 11 }, maxRotation: 0, autoSkipPadding: 12 } },
      y: { grid: { color: c.grid }, border: { display: false }, ticks: { color: c.muted, font: { size: 11 }, padding: 6 } },
    },
  };
}

function mount(canvas, config) {
  if (!Chart || !canvas) return null;
  const prev = live.get(canvas);
  if (prev) prev.destroy();
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  const ch = new Chart(canvas, config);
  live.set(canvas, ch);
  return ch;
}

export function destroyAll() { for (const ch of live.values()) ch.destroy(); live.clear(); }

const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }));

export function lineChart(canvas, labels, series, { min, max = 100, suffix = '' } = {}) {
  const c = palette(), o = base(c);
  o.scales.y.suggestedMin = min ?? undefined; o.scales.y.max = max;
  o.scales.y.ticks.callback = (v) => `${v}${suffix}`;
  o.plugins.tooltip.callbacks.label = (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}${suffix}`;
  return mount(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: series.map((s) => ({
        label: s.label, data: s.data, borderColor: s.color, backgroundColor: s.fill ? hexA(s.color, 0.12) : s.color,
        fill: !!s.fill, tension: 0.35, borderWidth: 2, borderDash: s.dash || [], spanGaps: true,
        pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: s.color, pointBorderColor: c.surface, pointBorderWidth: 2,
      })),
    },
    options: o,
  });
}

export function barChart(canvas, labels, series, { horizontal = false, max, suffix = '', stacked = false, colors } = {}) {
  const c = palette(), o = base(c);
  o.indexAxis = horizontal ? 'y' : 'x';
  o.interaction = { mode: 'nearest', intersect: true, axis: horizontal ? 'y' : 'x' };
  const val = horizontal ? 'x' : 'y', cat = horizontal ? 'y' : 'x';
  o.scales[val] = { ...o.scales.y, max, stacked, ticks: { ...o.scales.y.ticks, callback: (v) => `${v}${suffix}` } };
  o.scales[cat] = { ...o.scales.x, stacked, grid: { display: false }, ticks: { ...o.scales.x.ticks, autoSkip: false, callback(v) { const l = this.getLabelForValue(v); return String(l).length > 28 ? String(l).slice(0, 27) + '…' : l; } } };
  o.plugins.tooltip.callbacks.label = (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.parsed[val])}${suffix}`;
  return mount(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: series.map((s, i) => ({
        label: s.label, data: s.data, backgroundColor: colors && i === 0 ? colors : s.color,
        borderRadius: stacked ? 0 : 5, borderSkipped: 'start', borderColor: c.surface, borderWidth: stacked ? { [horizontal ? 'right' : 'top']: 2 } : 0,
        maxBarThickness: 26, categoryPercentage: 0.72, barPercentage: 0.9,
      })),
    },
    options: o,
  });
}

export function scatterChart(canvas, groups, { xLabel, yLabel, diagonal = false, xmin = 0, xmax = 100, ymin = 0, ymax = 100, onClick, tooltip } = {}) {
  const c = palette(), o = base(c);
  o.interaction = { mode: 'nearest', intersect: true };
  o.scales.x = { ...o.scales.x, type: 'linear', min: xmin, max: xmax, grid: { color: c.grid }, title: { display: !!xLabel, text: xLabel, color: c.muted, font: { size: 11, weight: '600' } } };
  o.scales.y = { ...o.scales.y, min: ymin, max: ymax, title: { display: !!yLabel, text: yLabel, color: c.muted, font: { size: 11, weight: '600' } } };
  o.plugins.tooltip.callbacks.label = tooltip || ((ctx) => ` ${ctx.raw.label || ctx.dataset.label}: ${fmt(ctx.parsed.x)} → ${fmt(ctx.parsed.y)}`);
  if (onClick) o.onClick = (_e, els, chart) => { if (els[0]) onClick(chart.data.datasets[els[0].datasetIndex].data[els[0].index]); };
  const datasets = groups.map((g) => ({
    label: g.label, data: g.data, backgroundColor: hexA(g.color, 0.7), borderColor: c.surface, borderWidth: 2,
    pointRadius: g.radius || 6, pointHoverRadius: (g.radius || 6) + 2, pointStyle: g.style || 'circle',
  }));
  if (diagonal) datasets.push({ type: 'line', label: 'Sem ajuste', data: [{ x: xmin, y: ymin }, { x: Math.min(xmax, ymax), y: Math.min(xmax, ymax) }], borderColor: c.axis, borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0, tooltip: { enabled: false } });
  return mount(canvas, { type: 'scatter', data: { datasets }, options: o });
}

export function doughnut(canvas, labels, data, colors, { cutout = '72%' } = {}) {
  const c = palette();
  return mount(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: c.surface, borderWidth: 3, hoverOffset: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: window.__PX_REPORT ? false : undefined, cutout, plugins: { legend: { display: false }, tooltip: base(c).plugins.tooltip } },
  });
}

export function radarChart(canvas, labels, series) {
  const c = palette();
  return mount(canvas, {
    type: 'radar',
    data: { labels, datasets: series.map((s) => ({ label: s.label, data: s.data, borderColor: s.color, backgroundColor: hexA(s.color, 0.15), borderWidth: 2, pointRadius: 3, pointBackgroundColor: s.color, borderDash: s.dash || [] })) },
    options: {
      responsive: true, maintainAspectRatio: false, animation: window.__PX_REPORT ? false : undefined,
      plugins: { legend: { display: false }, tooltip: base(c).plugins.tooltip },
      scales: { r: { min: 0, max: 100, grid: { color: c.grid }, angleLines: { color: c.grid }, pointLabels: { color: c.text2, font: { size: 11 } }, ticks: { display: false, stepSize: 25 } } },
    },
  });
}

export function hexA(hex, a) {
  const h = String(hex).replace('#', '').trim();
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const escH = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
export function legendHtml(items) {
  return `<div class="legend">${items.map((i) => `<span><i class="${i.line ? 'line' : ''}" style="background:${i.color}${i.dash ? ';background:repeating-linear-gradient(90deg,' + i.color + ' 0 4px,transparent 4px 7px)' : ''}"></i>${escH(i.label)}</span>`).join('')}</div>`;
}

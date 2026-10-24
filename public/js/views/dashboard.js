import { api, qs } from '../api.js';
import { html, raw, icon, $, $$, fmtScore, fmtPct, fmtInt, greeting, userName, deltaTag, avatar, sparkline, band, emptyState, esc } from '../ui.js';
import { lineChart, barChart, scatterChart, palette, legendHtml } from '../charts.js';

export function filterBar(store, { product = '', team = '' } = {}, { showTeam = true, extra = '' } = {}) {
  const m = store.meta;
  return html`<div class="filters">
    <span class="muted">${icon('filter')}</span>
    <select class="select sm" id="f-cycle" aria-label="Quinzena">
      <option value="">Todas as quinzenas</option>
      ${m.cycles.map((c) => html`<option value="${c.id}" ${String(store.cycle) === String(c.id) ? 'selected' : ''}>${c.name}${c.status === 'aberto' ? ' · em andamento' : ''}</option>`)}
    </select>
    <div class="seg" id="f-product" role="group" aria-label="Produto">
      <button data-v="" class="${!product ? 'on' : ''}">Todos</button>
      <button data-v="REFIN" class="${product === 'REFIN' ? 'on' : ''}">Refinanciamento</button>
      <button data-v="ENTREGA" class="${product === 'ENTREGA' ? 'on' : ''}">Entrega Amigável</button>
    </div>
    ${showTeam && m.teams.length > 1 ? html`<select class="select sm" id="f-team" aria-label="Equipe"><option value="">Todas as equipes</option>${m.teams.map((t) => html`<option ${team === t ? 'selected' : ''}>${t}</option>`)}</select>` : ''}
    ${extra}
  </div>`;
}

export function bindFilterBar(root, store, state, reload) {
  $('#f-cycle', root)?.addEventListener('change', (e) => { store.cycle = e.target.value; localStorage.setItem('px_cycle', store.cycle); reload(); });
  $$('#f-product button', root).forEach((b) => b.addEventListener('click', () => {
    state.product = b.dataset.v; $$('#f-product button', root).forEach((x) => x.classList.toggle('on', x === b)); reload();
  }));
  $('#f-team', root)?.addEventListener('change', (e) => { state.team = e.target.value; reload(); });
}

const state = { product: '', team: '' };

export async function render(el, _p, ctx) {
  const { store } = ctx;
  const u = store.user;
  const cycle = store.meta.cycles.find((c) => String(c.id) === String(store.cycle));
  ctx.setTitle('Painel', `${greeting()}, ${userName(u)}`);
  el.innerHTML = String(html`
    <div class="page-head">
      <div><h2>${greeting()}, <span class="gradient-text">${userName(u)}</span></h2>
      <p>${cycle ? html`Resultados da <b>${cycle.name}</b>` : 'Visão consolidada de todas as quinzenas'} · Refinanciamento e Entrega Amigável</p></div>
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
  const d = await api.get(`/stats/overview${qs({ cycle_id: store.cycle, product: state.product, team: state.team })}`);
  // Para comparar com a quinzena anterior, sempre buscamos a evolução completa
  const full = store.cycle ? await api.get(`/stats/overview${qs({ product: state.product, team: state.team })}`) : d;
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

  box.innerHTML = String(html`
    <div class="grid g-6">
      ${kpi('gauge', 'Nota média final', fmtScore(k.avg_final), '', html`${dScore != null ? html`${deltaTag(dScore)} vs. quinzena anterior` : html`Speech: <b>${fmtScore(k.avg_speech)}</b>`}`, k.avg_final)}
      ${kpi('target', 'Conformidade', fmtScore(k.conformity), '%', html`${dConf != null ? html`${deltaTag(dConf, ' p.p.')} vs. anterior` : `${fmtInt(k.items_conform)} de ${fmtInt(k.items_total)} itens`}`, k.conformity)}
      ${kpi('headset', 'Monitorias', fmtInt(k.total), '', html`<span class="chip refin">${k.total_refin} Refin</span><span class="chip entrega">${k.total_entrega} Entrega</span>`)}
      ${kpi('msgCheck', 'Feedbacks aplicados', fmtScore(k.feedback_rate), '%', html`${k.feedback_applied} de ${k.total} · <a href="#/feedbacks/pendentes">${k.total - k.feedback_applied} pendentes</a>`, k.feedback_rate)}
      ${kpi('alert', 'Falhas críticas', fmtInt(k.critical_fails), '', html`${fmtPct(k.total ? (k.critical_fails / k.total) * 100 : 0)} das monitorias zeradas`, null, 'bad')}
      ${kpi('edit', 'Ajustes no speech', fmtInt(k.evals_adjusted), '', html`${fmtPct(k.total ? (k.evals_adjusted / k.total) * 100 : 0)} das análises corrigidas`, null, 'warn')}
    </div>

    ${insights.length ? html`<div class="grid g-3 mt">${insights.map((i) => html`<div class="insight"><span class="ic" style="background:${i.bg};color:${i.fg}">${icon(i.icon)}</span><div>${raw(i.html)}</div></div>`)}</div>` : ''}

    <div class="grid g-3 mt">
      <div class="card span-2">
        <div class="card-head"><div><h3>Evolução da nota por quinzena</h3><div class="sub">Nota final média (após ajustes) × nota original do speech</div></div><div class="grow"></div>
          ${raw(legendHtml([{ label: 'Geral', color: c.geral, line: true }, { label: 'Refinanciamento', color: c.refin, line: true }, { label: 'Entrega Amigável', color: c.entrega, line: true }, { label: 'Speech (original)', color: c.speech, line: true, dash: true }]))}</div>
        <div class="card-body"><div class="chart-box"><canvas id="ch-evo" role="img" aria-label="Evolução da nota por quinzena"></canvas></div></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Distribuição das notas</h3><div class="sub">Quantidade de monitorias por faixa</div></div></div>
        <div class="card-body"><div class="chart-box"><canvas id="ch-dist" role="img" aria-label="Distribuição das notas"></canvas></div></div>
      </div>
    </div>

    <div class="grid g-2 mt">
      <div class="card">
        <div class="card-head"><div><h3>Dispersão: speech × nota final</h3><div class="sub">Pontos acima da linha tiveram a nota corrigida para cima após revisão. Clique para abrir.</div></div><div class="grow"></div>
          ${raw(legendHtml([{ label: 'Refinanciamento', color: c.refin }, { label: 'Entrega Amigável', color: c.entrega }]))}</div>
        <div class="card-body"><div class="chart-box tall"><canvas id="ch-scatter" role="img" aria-label="Dispersão entre nota do speech e nota final"></canvas></div></div>
      </div>
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

  const labels = evo.map((e) => e.cycle.replace(' Quinzena', ' Q'));
  lineChart($('#ch-evo'), labels, [
    { label: 'Geral', data: evo.map((e) => e.geral), color: c.geral, fill: true },
    { label: 'Refinanciamento', data: evo.map((e) => e.refin), color: c.refin },
    { label: 'Entrega Amigável', data: evo.map((e) => e.entrega), color: c.entrega },
    { label: 'Speech (original)', data: evo.map((e) => e.speech), color: c.speech, dash: [5, 4] },
  ], { min: 40 });

  barChart($('#ch-dist'), d.distribution.map((x) => x.label), [{ label: 'Monitorias', data: d.distribution.map((x) => x.count) }],
    { colors: [c.bad, c.warn, c.warn, c.refin, c.ok] });

  const go = (p) => p.id && ctx.navigate(`atendimentos/${p.id}`);
  scatterChart($('#ch-scatter'), [
    { label: 'Refinanciamento', color: c.refin, data: d.scatter.filter((p) => p.product === 'REFIN').map((p) => ({ ...p, label: p.operator })) },
    { label: 'Entrega Amigável', color: c.entrega, data: d.scatter.filter((p) => p.product === 'ENTREGA').map((p) => ({ ...p, label: p.operator })), style: 'rectRounded' },
  ], { xLabel: 'Nota do speech', yLabel: 'Nota final (após revisão)', diagonal: true, onClick: go });

  const maxSd = Math.max(10, ...d.operators.map((o) => o.sd || 0));
  scatterChart($('#ch-opmap'), [{ label: 'Operadores', color: c.brand, radius: 8, data: d.operators.filter((o) => o.avg != null).map((o) => ({ x: o.avg, y: o.sd, label: o.name, opId: o.operator_id })) }],
    { xLabel: 'Nota média', yLabel: 'Desvio-padrão (menor = mais consistente)', xmin: Math.max(0, Math.floor(Math.min(...d.operators.map((o) => o.avg ?? 100)) / 10) * 10 - 5), xmax: 100, ymin: 0, ymax: Math.ceil(maxSd / 5) * 5 + 5,
      tooltip: (ctx2) => ` ${ctx2.raw.label}: média ${fmtScore(ctx2.raw.x)} · desvio ${fmtScore(ctx2.raw.y)}`, onClick: (p) => ctx.navigate(`operadores/${p.opId}`) });

  const top = d.criteria.filter((x) => x.base).slice(0, 9);
  barChart($('#ch-crit'), top.map((x) => `${x.code} · ${x.name}`), [{ label: 'Índice de falha', data: top.map((x) => x.fail_rate) }],
    { horizontal: true, suffix: '%', colors: top.map((x) => (x.critical ? c.bad : c.warn)) });
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
  const worst = d.criteria.find((c) => c.base);
  if (worst) out.push({ icon: 'target', bg: 'var(--warn-soft)', fg: 'var(--warn-ink)', html: `<b>Foco de melhoria:</b> “${esc(worst.name)}” tem <b>${fmtScore(worst.fail_rate)}%</b> de falha.` });
  void prev;
  return out.slice(0, 3);
}

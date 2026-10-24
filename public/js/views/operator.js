import { api, qs } from '../api.js';
import { html, icon, $, fmtScore, fmtDate, avatar, deltaTag, band, emptyState, productChip } from '../ui.js';
import { lineChart, radarChart, barChart, palette, legendHtml } from '../charts.js';
import { evalCard, bindEvalCards } from './evaluations.js';
import { editOperator } from './operators.js';
import { raw } from '../ui.js';

export async function render(el, [id], ctx) {
  const d = await api.get(`/stats/operator/${id}${qs({ cycle_id: ctx.store.cycle })}`);
  const all = ctx.store.cycle ? await api.get(`/stats/operator/${id}`) : d;
  if (!ctx.isCurrent()) return;
  const op = d.operator, k = d.kpis, c = palette();
  const me = all.operators[0] || {};
  ctx.setTitle(op.name, 'Operadores');
  const cyc = ctx.store.meta.cycles.find((x) => String(x.id) === String(ctx.store.cycle));
  const crit = d.criteria.filter((x) => x.base).sort((a, b) => a.conformity - b.conformity);
  el.innerHTML = String(html`
    <div class="row mb"><a class="btn sm ghost" href="#/operadores">${icon('chevLeft')}Operadores</a><div style="flex:1"></div>
      <a class="btn sm" href="#/relatorios?op=${op.id}" id="rep">${icon('report')}Relatório individual</a>
      ${ctx.can('admin', 'qualidade') ? html`<button class="btn sm" id="edit">${icon('edit')}Editar</button>` : ''}</div>
    <div class="card card-pad">
      <div class="row" style="gap:18px">${avatar(op.name, 'lg')}
        <div style="flex:1;min-width:200px"><h2 style="margin:0;font-size:24px;letter-spacing:-.03em">${op.name}</h2>
          <div class="facts"><span>Equipe <b>${op.team || '—'}</b></span><span>Matrícula <b>${op.registration || '—'}</b></span><span>Supervisor <b>${op.supervisor_name || '—'}</b></span><span>Período <b>${cyc ? cyc.name : 'todas as quinzenas'}</b></span></div></div>
        <div class="grid g-4" style="flex:2;min-width:320px">
          ${stat('Nota média', fmtScore(k.avg_final), `equipe ${fmtScore(d.team_avg)}`, band(k.avg_final))}
          ${stat('Conformidade', `${fmtScore(k.conformity)}%`, `${k.items_conform}/${k.items_total} itens`)}
          ${stat('Monitorias', k.total, `${k.total_refin} Refin · ${k.total_entrega} Entrega`)}
          ${stat('Feedbacks', `${fmtScore(k.feedback_rate, 0)}%`, `${k.feedback_applied} aplicados`)}
        </div></div>
    </div>
    <div class="grid g-3 mt">
      <div class="card span-2"><div class="card-head"><div><h3>Evolução por quinzena</h3><div class="sub">Operador × média da equipe ${op.team ? `(${op.team})` : ''}</div></div><div class="grow"></div>
        ${raw(legendHtml([{ label: op.name.split(' ')[0], color: c.brand, line: true }, { label: 'Média da equipe', color: c.speech, line: true, dash: true }]))}</div>
        <div class="card-body"><div class="chart-box"><canvas id="op-evo"></canvas></div></div></div>
      <div class="card"><div class="card-head"><div><h3>Perfil por critério</h3><div class="sub">% de conformidade</div></div></div>
        <div class="card-body"><div class="chart-box"><canvas id="op-radar"></canvas></div></div></div>
    </div>
    <div class="grid g-2 mt">
      <div class="card"><div class="card-head"><div><h3>Critérios a desenvolver</h3><div class="sub">Do menor para o maior índice de conformidade</div></div></div>
        <div class="card-body"><div class="chart-box tall"><canvas id="op-crit"></canvas></div></div></div>
      <div class="card"><div class="card-head"><div><h3>Histórico de feedbacks</h3><div class="sub">${d.feedbacks.length} registro(s)</div></div></div>
        <div class="card-body" style="max-height:400px;overflow:auto">${d.feedbacks.length ? html`<div class="timeline">${d.feedbacks.map((f) => html`<div class="tl-item ok">
          <div class="what">${fmtDate(f.applied_at)} · ${f.applied_by_display || f.applied_by_name} ${f.modality ? html`<span class="tiny muted">· ${f.modality}</span>` : ''}</div>
          <div class="when">${f.cycle_name || ''} · ${productChip(f.product)} nota ${fmtScore(f.final_score)}</div>
          <p class="small t2" style="margin:6px 0 0;white-space:pre-wrap">${f.content}</p></div>`)}</div>` : emptyState('msgCheck', 'Nenhum feedback ainda', 'Os feedbacks aplicados aparecem aqui.')}</div></div>
    </div>
    <h3 class="mt-lg" style="margin-bottom:12px">Monitorias</h3>
    <div class="ev-grid" id="op-evals">${d.evaluations.filter((e) => !ctx.store.cycle || String(e.cycle_id) === String(ctx.store.cycle)).map((e) => evalCard(e))}</div>`);

  bindEvalCards($('#op-evals'), ctx.navigate);
  $('#rep').addEventListener('click', (e) => { e.preventDefault(); sessionStorage.setItem('px_report_op', op.id); ctx.navigate('relatorios'); });
  $('#edit')?.addEventListener('click', () => editOperator(op, ctx, () => render(el, [id], ctx)));

  const evo = all.evolution;
  const teamMap = new Map(all.team_evolution.map((t) => [t.cycle_id, t.geral]));
  lineChart($('#op-evo'), evo.map((e) => e.cycle.replace(' Quinzena', ' Q')), [
    { label: op.name.split(' ')[0], data: evo.map((e) => e.geral), color: c.brand, fill: true },
    { label: 'Média da equipe', data: evo.map((e) => teamMap.get(e.cycle_id) ?? null), color: c.speech, dash: [5, 4] },
  ], { min: 30 });
  const radarCrit = d.criteria.filter((x) => x.base && x.product === 'AMBOS');
  radarChart($('#op-radar'), radarCrit.map((x) => x.code), [{ label: 'Conformidade', data: radarCrit.map((x) => x.conformity), color: c.brand }]);
  barChart($('#op-crit'), crit.slice(0, 10).map((x) => `${x.code} · ${x.name}`), [{ label: 'Conformidade', data: crit.slice(0, 10).map((x) => x.conformity) }],
    { horizontal: true, max: 100, suffix: '%', colors: crit.slice(0, 10).map((x) => (x.conformity < 60 ? c.bad : x.conformity < 80 ? c.warn : c.ok)) });
  void me; void deltaTag;
}

function stat(label, value, foot, b = '') {
  return html`<div style="background:var(--surface-2);border-radius:12px;padding:12px"><div class="tiny muted strong">${label}</div><div class="num ${b ? 'score-txt band-' + b : ''}" style="font-size:22px;font-weight:800;letter-spacing:-.03em">${value}</div><div class="tiny muted">${foot}</div></div>`;
}

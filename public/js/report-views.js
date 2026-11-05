// Telas dos reports lidos de imagem (Copiloto, Qualidade e contestações, Ações do mês).
// Usadas na página da análise e na revisão antes de guardar.
import { html, raw, icon } from './ui.js';

const nf = (v, d = 1) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: Number.isInteger(Number(v)) ? 0 : d, maximumFractionDigits: d }));
const pc = (v, d = 1) => (v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })}%`);
const sc = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const sign = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${sc(v)}`);
const W = (v, max) => `${Math.max(0, Math.min(100, max ? (Number(v || 0) / max) * 100 : 0)).toFixed(1)}%`;
const band = (v) => (v == null ? 'na' : v < 50 ? 'bad' : v < 70 ? 'warn' : 'ok');

export const IMAGE_MODELS = { copiloto: 'Report Copiloto', contestacoes: 'Qualidade e contestações', acoes_mes: 'Report de ações' };
export const isImageModel = (d) => !!IMAGE_MODELS[d?.model];

const kpiRow = (items) => html`<div class="rp-kpis c4">${items.map((k, i) => html`<div class="card rp-kpi ${i === 0 ? 'lead' : ''}"><span class="rp-kl">${k.label}</span><b class="num">${k.value}</b>${k.sub ? html`<span class="rp-ks">${k.sub}</span>` : ''}</div>`)}</div>`;
const secHead = (n, title, sub = '') => html`<div class="rp-sh"><span class="rp-n">${String(n).padStart(2, '0')}</span><div><h3>${title}</h3>${sub ? html`<div class="sub">${sub}</div>` : ''}</div></div>`;
const notes = (d) => (d.notes ? html`<div class="banner warn mt">${icon('alert')}<span class="small"><b>Conferir:</b> ${d.notes}</span></div>` : '');

// ---------------------------------------------------------------- Copiloto
function copiloto(d) {
  const months = d.months || [];
  const logins = [...new Set(months.flatMap((m) => m.operators.map((o) => o.login)))];
  return html`
    ${kpiRow(d.kpis || [])}
    ${d.highlights ? html`<div class="card card-pad rp-hl mb">${icon('sparkles')}<div><b>Destaques</b><p>${d.highlights}</p></div></div>` : ''}
    <div class="grid g-2 mb">${months.map((m, i) => html`<div class="card card-pad">${secHead(i + 1, m.label, `% de preenchimentos de cada operador no mês · total ${nf(m.total)}`)}
      ${m.operators.map((o, k) => html`<div class="rp-hbar"><b class="lb">${o.login}</b><div class="trk"><i class="${k === 0 || o.n === m.operators[0].n ? 'top' : ''}" style="--w:${W(o.pct, 100)}"></i></div><span class="num">${pc(o.pct)}</span><em class="num">${nf(o.n)}</em></div>`)}</div>`)}</div>
    ${months.length > 1 ? html`<div class="card mb"><div class="card-head"><h3>Evolução por operador</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Operador</th>${months.slice().reverse().map((m) => html`<th class="c">${m.label}</th>`)}<th class="c">Variação</th></tr></thead>
      <tbody>${logins.map((l) => { const v = months.slice().reverse().map((m) => m.operators.find((o) => o.login === l)?.n ?? 0); const dv = v[v.length - 1] - v[v.length - 2]; return html`<tr><td><b>${l}</b></td>${v.map((x) => html`<td class="c num">${x || '—'}</td>`)}<td class="c"><span class="chip ${dv > 0 ? 'ok' : dv < 0 ? 'bad' : ''}">${dv > 0 ? '+' : ''}${dv}</span></td></tr>`; })}</tbody></table></div></div>` : ''}
    ${notes(d)}`;
}

// ---------------------------------------------------------------- Qualidade e contestações
function contestacoes(d) {
  const delta = d.media_antes != null && d.media_depois != null ? Math.round((d.media_depois - d.media_antes) * 10) / 10 : null;
  const sem = d.semanas || [];
  const pares = d.pares || [];
  const tot = (d.concluidas || 0) + (d.em_analise || 0) + (d.nao_contestadas || 0);
  const items = d.itens || [];
  const maxItem = (j) => Math.max(0, ...(d.ofensores || []).map((o) => o.itens[j] || 0));
  return html`
    <div class="rp-kpis c5">
      <div class="card rp-kpi lead"><span class="rp-kl">Impacto na média geral</span><b class="num">${sc(d.media_antes)} <span class="rp-arr">→</span> ${sc(d.media_depois)}</b><span class="chip brand" style="align-self:flex-start">${sign(delta)} pts após as contestações</span></div>
      <div class="card rp-kpi"><span class="rp-kl">Monitorias</span><b class="num">${nf(d.monitorias)}</b><span class="rp-ks">${nf(d.com_acordo)} com acordo (${pc(d.com_acordo_pct)})</span></div>
      <div class="card rp-kpi"><span class="rp-kl">Contestadas</span><b class="num">${nf(d.contestadas)}</b><span class="rp-ks">${nf(d.concluidas)} concluídas · ${nf(d.em_analise)} em análise</span></div>
      <div class="card rp-kpi"><span class="rp-kl">Revertidas</span><b class="num">${nf(d.revertidas)}<small>/${nf(d.concluidas)}</small></b><div class="rp-mini"><i style="--w:${W(d.revertidas, d.concluidas)}"></i></div><span class="rp-ks">${pc(d.revertidas_pct, 0)} das concluídas com nota alterada</span></div>
      <div class="card rp-kpi"><span class="rp-kl">Pontos recuperados</span><b class="num rp-gain">${d.pontos_recuperados == null ? '—' : `+${nf(d.pontos_recuperados)}`}</b><span class="rp-ks">soma das notas revertidas nas contestações concluídas</span></div>
    </div>
    <div class="grid g-3 mb rp-c3">
      <div class="card card-pad">${secHead(1, 'Notas fechadas por semana')}<div class="rp-leg"><span><i class="g"></i>Antes</span><span><i class="b"></i>Final</span></div>
        <div class="rp-cols">${sem.map((s) => html`<div class="rp-col"><div class="rp-pair"><div class="g" style="--h:${W(s.antes, 100)}"><span>${sc(s.antes)}</span></div><div class="b" style="--h:${W(s.final, 100)}"><span>${sc(s.final)}</span></div></div>
          <b>${s.label}</b><small>${s.periodo}</small><span class="chip outline">${nf(s.monitorias)} monit.</span><span class="chip outline">${nf(s.contestacoes)} contest.</span></div>`)}</div></div>
      <div class="card card-pad">${secHead(2, 'Nota antes × pós contestação', `${nf(pares.length || d.concluidas)} contestações concluídas`)}
        <div class="rp-ba"><b class="num">${sc(d.contestadas_antes)} <span class="rp-arr">→</span> <span class="rp-gain">${sc(d.contestadas_depois)}</span></b>
          <div class="rp-chipset"><span class="chip brand">Variação ${sign(d.contestadas_antes != null && d.contestadas_depois != null ? Math.round((d.contestadas_depois - d.contestadas_antes) * 10) / 10 : null)} pts</span><span class="chip outline">Em análise ${nf(d.em_analise)}</span></div></div>
        ${pares.length ? html`<div class="rp-pairs">${pares.map((p) => html`<div class="rp-pp" title="${p.antes != null ? `Antes ${nf(p.antes)} · ` : ''}Depois ${nf(p.depois)}"><i class="g" style="--h:${W(p.antes, 100)}"></i><i class="b" style="--h:${W(p.depois, 100)}"></i><span>${nf(p.depois)}</span></div>`)}</div>
          <p class="tiny muted" style="margin:8px 0 0">Cada par é uma contestação concluída: cinza = antes · cor = depois.</p>` : ''}</div>
      <div class="card card-pad">${secHead(3, 'Quantidade de contestadas')}
        <div class="rp-qt"><div><b class="num">${nf(d.monitorias)}</b><span>Monitorias no período</span></div>
          ${d.ouvidas != null ? html`<div><b class="num">~${nf(d.ouvidas)}</b><span>Ouvidas pela qualidade (projeção)${d.ouvidas_nota ? html`<small>${d.ouvidas_nota}</small>` : ''}</span></div>` : ''}
          <div class="hl"><b class="num">${nf(d.contestadas)}</b><span>Contestadas de fato<small>${nf(d.concluidas)} concluídas · ${nf(d.em_analise)} em análise</small></span></div></div>
        ${tot ? html`<div class="rp-stack"><i class="a" style="--w:${W(d.concluidas, tot)}">${nf(d.concluidas)}</i><i class="b" style="--w:${W(d.em_analise, tot)}">${nf(d.em_analise)}</i><i class="c" style="--w:${W(d.nao_contestadas, tot)}">${nf(d.nao_contestadas)}</i></div>
          <div class="rp-leg"><span><i class="b"></i>Concluídas</span><span><i class="m"></i>Em análise</span><span><i class="g"></i>Não contestadas</span></div>` : ''}
        <div class="rp-rates"><div><span>Contestação</span><b class="num">${pc(d.taxa_contestacao, 0)}</b></div><div><span>Reversão</span><b class="num rp-ok">${pc(d.taxa_reversao, 0)}</b></div></div></div>
    </div>
    ${(d.ofensores || []).length ? html`<div class="card mb"><div class="card-head"><div><h3>Top ${d.ofensores.length} ofensores e itens não conformes</h3><div class="sub">Menor nota média (mín. 5 monitorias) · quantidade de "não conforme" por item</div></div></div>
      <div class="tbl-wrap"><table class="tbl rp-of"><thead><tr><th>#</th><th>Operador</th><th class="c">Monit.</th><th class="c">Média</th><th class="c">Zeradas</th><th class="c">Abaixo de 70</th><th class="c">Contest.</th><th class="c">Ações</th>
        ${items.map((it) => html`<th class="c it">${it.nome}${it.na_operacao != null ? html`<small>${nf(it.na_operacao)} na operação</small>` : ''}</th>`)}<th class="c">Total</th></tr></thead>
      <tbody>${d.ofensores.map((o) => html`<tr><td><span class="rp-rk">${nf(o.rank)}</span></td><td><b>${o.nome}</b></td><td class="c num">${nf(o.monitorias)}</td>
        <td class="c"><span class="rp-score ${band(o.media)}">${sc(o.media)}</span></td><td class="c num ${o.zeradas ? 'rp-bad' : ''}">${nf(o.zeradas)}</td>
        <td class="c num">${nf(o.abaixo_70)}${o.abaixo_70_pct != null ? html` <small class="muted">(${pc(o.abaixo_70_pct, 0)})</small>` : ''}</td><td class="c num">${nf(o.contestacoes)}</td><td class="c num">${nf(o.acoes)}</td>
        ${o.itens.map((v, j) => html`<td class="c">${v == null ? html`<span class="muted">—</span>` : html`<span class="rp-cell ${v && v === maxItem(j) ? 'max' : ''}">${v}</span>`}</td>`)}<td class="c"><b class="num">${nf(o.total_itens)}</b></td></tr>`)}</tbody></table></div>
      ${d.source ? html`<p class="tiny muted card-pad" style="padding-top:8px">${d.source}</p>` : ''}</div>` : ''}
    ${notes(d)}`;
}

// ---------------------------------------------------------------- Ações do mês
const ACT_COLORS = ['var(--brand)', '#8B7DFF', '#22C3EE', '#5B6B9A', '#14B88A', '#F5B23A', '#FF7A72', '#9AA4BF'];
function acoes(d) {
  const r = 46, c = 2 * Math.PI * r, ad = d.aderencia ?? 0;
  const lo = 50, hi = 100, pos = (v) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%`;
  const falta = d.nota != null && d.meta != null ? Math.round((d.meta - d.nota) * 10) / 10 : null;
  const max = Math.max(1, ...(d.realizadas || []).map((x) => x.n || 0));
  return html`
    <div class="rp-kpis c5">
      <div class="card rp-kpi lead row-k"><div class="rp-ring"><svg viewBox="0 0 110 110" aria-hidden="true"><circle cx="55" cy="55" r="${r}" class="bg"/><circle cx="55" cy="55" r="${r}" class="fg" stroke-dasharray="${(ad / 100) * c} ${c}"/></svg><b class="num">${pc(d.aderencia, 0)}</b></div>
        <div><span class="rp-kl">Aderência geral</span><span class="rp-ks"><b>${nf(d.concluidas)}</b> de <b>${nf(d.planejadas)}</b> ações do cronograma concluídas</span></div></div>
      <div class="card rp-kpi"><span class="rp-kl">Ações planejadas</span><b class="num">${nf(d.planejadas)}</b><span class="rp-ks">${d.tipos != null ? `${nf(d.tipos)} tipos de ação` : ''}</span></div>
      <div class="card rp-kpi"><span class="rp-kl">Concluídas</span><b class="num rp-ok">${nf(d.concluidas)}</b><span class="rp-ks">dentro do cronograma</span></div>
      <div class="card rp-kpi"><span class="rp-kl">Pendentes</span><b class="num rp-warn">${nf(d.pendentes)}</b><span class="rp-ks">não realizadas no mês</span></div>
      <div class="card rp-kpi"><span class="rp-kl">Dias úteis</span><b class="num">${nf(d.dias_uteis)}</b><span class="rp-ks">${d.dias_uteis_nota}</span></div>
    </div>
    <div class="grid g-2 mb">
      <div class="card card-pad">${secHead(2, 'Nota de qualidade do mês')}
        <div class="rp-note"><b class="num">${sc(d.nota)}</b>${d.meta != null ? html`<span>meta <b>${sc(d.meta)}</b></span>` : ''}</div>
        <div class="rp-gauge"><div class="trk"><i style="--w:${pos(d.nota ?? lo)}"></i></div>${d.meta != null ? html`<span class="mk" style="left:${pos(d.meta)}"><em>Meta ${sc(d.meta)}</em></span>` : ''}<div class="sc">${[50, 60, 70, 80, 90, 100].map((v) => html`<span>${v}</span>`)}</div></div>
        <div class="rp-chipset">${falta != null ? (falta > 0 ? html`<span class="chip warn">Faltaram ${sc(falta)} pts para a meta</span>` : html`<span class="chip ok">Meta atingida</span>`) : ''}${d.nota != null && d.meta ? html`<span class="chip brand">${pc(Math.round((d.nota / d.meta) * 1000) / 10)} da meta atingida</span>` : ''}</div>
        ${d.nota_comentario ? html`<p class="small t2" style="margin:12px 0 0">${d.nota_comentario}</p>` : ''}</div>
      <div class="card card-pad">${secHead(3, 'Ações realizadas no mês', `${nf(d.total_realizadas)} ações`)}
        ${(d.realizadas || []).map((x, i) => html`<div class="rp-hbar"><b class="lb">${x.acao}</b><div class="trk"><i style="--w:${W(x.n, max)};background:${ACT_COLORS[i % ACT_COLORS.length]}"></i></div><span class="num">${nf(x.n)}</span><em class="num">${pc(x.pct)}</em></div>`)}
        <div class="rp-dist">${(d.realizadas || []).map((x, i) => html`<i style="--w:${W(x.n, d.total_realizadas)};background:${ACT_COLORS[i % ACT_COLORS.length]}" title="${x.acao} · ${nf(x.n)}"></i>`)}</div></div>
    </div>
    ${notes(d)}`;
}

export function imageReportBody(d) {
  if (d.model === 'copiloto') return copiloto(d);
  if (d.model === 'contestacoes') return contestacoes(d);
  if (d.model === 'acoes_mes') return acoes(d);
  return raw('');
}

// Página original guardada junto com os dados: a própria imagem
export const imageHtml = (title, dataUrl) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${String(title).replace(/[<&]/g, '')}</title><style>body{margin:0;background:#0b1020;display:grid;place-items:start center}img{max-width:100%;height:auto;display:block}</style></head><body><img src="${dataUrl}" alt=""></body></html>`;

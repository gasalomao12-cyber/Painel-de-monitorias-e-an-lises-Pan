import { api } from '../api.js';
import { html, raw, icon, $, toast, modal, emptyState, confirmDialog, fmtDate } from '../ui.js';
import { CARTEIRA_INFO } from '../carteira.js';
import { imageReportBody, isImageModel, IMAGE_MODELS } from '../report-views.js';
import { bindImageDrop, IMAGE_ACCEPT } from '../report-image.js';

// Análises da carteira: relatórios trazidos em HTML (conversão e eficiência, speech Safra Pay…), com os dados
// extraídos na tela e o arquivo original para consulta. Cada carteira vê só as suas.
const KIND = { conversao: 'Conversão e eficiência', speech_safra: 'Análise de speech', nota_qualidade: 'Nota de qualidade', relatorio: 'Relatório' };
const kindOf = (r) => (isImageModel(r.data) ? IMAGE_MODELS[r.data.model] : r.data?.model === 'operadores_nota' ? 'Report de operadores' : KIND[r.kind] || r.kind);
const pctNum = (v) => { const m = String(v ?? '').match(/-?\d+(?:[.,]\d+)?/); return m ? Number(m[0].replace(',', '.')) : null; };
const bandOf = (p) => (p == null ? 'na' : p >= 70 ? 'ok' : p >= 45 ? 'warn' : 'bad');
const bar = (label, value, extra = '', p = pctNum(value)) => html`<div class="an-bar"><span class="lb">${label}</span><div class="trk"><i class="b-${bandOf(p)}" style="width:${Math.max(0, Math.min(100, p ?? 0))}%"></i></div><b class="num">${value ?? '—'}</b>${extra ? html`<em>${extra}</em>` : ''}</div>`;

export async function render(el, params, ctx) {
  const id = Number(params?.[0]) || null;
  if (id) return renderOne(el, id, ctx);
  ctx.setTitle('Análises da carteira', 'Visão geral');
  el.innerHTML = String(html`<div class="page-head"><div><h2>Análises da carteira</h2><p>Relatórios trazidos para a plataforma (conversão e eficiência, análises de speech, reports em imagem), com a leitura de cada login. Cada carteira vê só as suas.</p></div><div class="grow"></div>
    ${ctx.can('admin', 'qualidade') ? html`<label class="btn" id="an-img-btn">${icon('image')}Anexar imagem do report<input type="file" id="an-img" accept="${IMAGE_ACCEPT}" hidden></label><a class="btn primary" href="#/importar">${icon('upload')}Importar análise</a>` : ''}</div><div id="an-list"><div class="card card-pad">Carregando…</div></div>`);
  if ($('#an-img', el)) bindImageDrop(ctx, $('#an-img', el), $('#an-list', el));
  const rows = await api.get('/reports');
  if (!ctx.isCurrent()) return;
  const box = $('#an-list', el);
  if (!rows.length) { box.innerHTML = String(emptyState('report', 'Nenhuma análise ainda', 'Importe um relatório (.html) em Importar monitorias ou anexe a imagem de um report. Ele aparece aqui para a sua carteira.')); return; }
  box.innerHTML = String(html`<div class="an-grid">${rows.map((r) => html`<a class="card an-card" href="#/analises/${r.id}">
      <div class="row between"><span class="chip">${kindOf(r)}</span><span class="chip outline">${CARTEIRA_INFO[r.portfolio]?.label || r.portfolio}</span></div>
      <h3>${r.title}</h3><div class="sub">${[r.period, r.data?.reading?.length ? `${r.data.reading.length} login(s) com ${r.data?.model === 'operadores_nota' ? 'parecer' : 'leitura'}` : '', r.data?.logins?.length ? `${r.data.logins.length} logins` : ''].filter(Boolean).join(' · ')}</div>
      <div class="an-kpis">${(r.data?.kpis || []).slice(0, 3).map((k) => html`<div><b class="num">${k.value}</b><span>${k.label}</span></div>`)}</div>
      <div class="tiny muted">Importada por ${r.created_by_name || '—'} em ${fmtDate(r.created_at)}${r.file_name ? ` · ${r.file_name}` : ''}</div></a>`)}</div>`);
}

async function renderOne(el, id, ctx) {
  ctx.setTitle('Análise da carteira', 'Análises da carteira');
  const rows = await api.get('/reports');
  if (!ctx.isCurrent()) return;
  const r = rows.find((x) => x.id === id);
  if (!r) { el.innerHTML = String(emptyState('report', 'Análise não encontrada', 'Ela pode ter sido excluída ou ser de outra carteira.')); return; }
  const d = r.data || {};
  const head = html`<div class="page-head"><div><a class="small t2" href="#/analises">${icon('chevLeft')}Análises da carteira</a><h2>${r.title}</h2>
      <p>${[CARTEIRA_INFO[r.portfolio]?.label || r.portfolio, kindOf(r), r.period].filter(Boolean).join(' · ')}</p></div><div class="grow"></div>
    <button class="btn" id="an-orig">${icon(isImageModel(d) ? 'image' : 'eye')}${isImageModel(d) ? 'Ver imagem original' : 'Ver arquivo original'}</button>
    ${ctx.can('admin', 'qualidade') ? html`<button class="btn ghost danger" id="an-del">${icon('trash')}Excluir</button>` : ''}</div>`;
  const kpis = !isImageModel(d) && (d.kpis || []).length ? html`<div class="grid g-4 mb">${(d.score && typeof d.score === 'object' ? [d.score, ...d.kpis] : d.kpis).slice(0, 6).map((k) => html`<div class="card kpi"><div class="k-label">${k.label}</div><div class="k-val num">${k.value}</div>${k.sub ? html`<div class="tiny muted" style="margin-top:8px">${k.sub}${k.tag ? ` · ${k.tag}` : ''}</div>` : ''}</div>`)}</div>` : '';
  let body = '';
  if (isImageModel(d)) {
    body = imageReportBody(d);
  } else if (d.model === 'operadores_nota') {
    body = opReport(d, ctx);
  } else if (r.kind === 'nota_qualidade') {
    body = html`<div class="card card-pad"><p style="margin:0">Nota fechada de <b>${d.month_label}</b>: <b class="num">${String(d.score ?? '—').replace('.', ',')}</b> pontos · ${d.ranking?.length || 0} operadores.</p><a class="btn primary mt" href="#/nota-qualidade">${icon('target')}Abrir em Nota de qualidade</a></div>`;
  } else if (r.kind === 'speech_safra') {
    body = html`<div class="grid g-2">
      <div class="card card-pad"><h3>Critérios</h3><p class="small t2">Percentual de ligações em que o critério foi identificado.</p>${(d.criteria || []).map((c) => bar(c.label, c.value == null ? '—' : `${String(c.value).replace('.', ',')}%`))}</div>
      <div class="card card-pad"><h3>Logins</h3><p class="small t2">Aderência média por login (do maior para o menor).</p><div class="an-scroll">${(d.logins || []).map((l) => bar(l.login, l.value == null ? '—' : `${String(l.value).replace('.', ',')}%`, `${l.calls} lig.`))}</div></div>
      <div class="card card-pad"><h3>Finalização</h3>${(d.outcomes || []).map((o) => html`<div class="row between small" style="padding:6px 0;border-bottom:1px solid var(--border)"><span>${o.label}</span><b>${o.n}</b></div>`)}</div>
      <div class="card card-pad"><h3>Atendimentos</h3><p class="small t2">Cada ligação desta análise virou um atendimento, com os 11 critérios do roteiro Safra Pay, e entra nos feedbacks pendentes de cada operador.</p><a class="btn" href="#/atendimentos">${icon('headset')}Ver atendimentos</a></div>
    </div>`;
  } else {
    const t = d.table;
    body = html`
      ${d.lead || d.kick ? html`<div class="card card-pad mb an-lead">${d.kick ? html`<span class="chip">${d.kick}</span>` : ''}<p>${d.lead}</p></div>` : ''}
      ${(d.sections || []).filter((s) => s.text).slice(0, 1).map((s) => html`<div class="card card-pad mb"><h3>${s.title}</h3><p class="t2" style="line-height:1.6">${s.text}</p></div>`)}
      ${t ? html`<div class="card mb"><div class="card-head"><h3>Visão por login</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr>${t.cols.map((c) => html`<th>${c}</th>`)}</tr></thead>
        <tbody>${t.rows.map((row, i) => html`<tr class="${i === t.rows.length - 1 || /demais/i.test(row[0]) ? 'an-tot' : ''}">${row.map((c) => html`<td>${c}</td>`)}</tr>`)}</tbody></table></div>${t.note ? html`<p class="tiny muted card-pad" style="padding-top:8px">${t.note}</p>` : ''}</div>` : ''}
      <div class="grid g-2">
        ${(d.stages || []).map((g) => html`<div class="card card-pad"><h3>${g.group}</h3><p class="tiny muted">Logins analisados × demais operadores</p>${g.items.map((it) => bar(it.label, it.value, it.compare ? `demais ${it.compare}` : ''))}</div>`)}
        ${(d.dists || []).map((g) => html`<div class="card card-pad"><h3>${g.label}</h3>${g.items.map((it) => html`<div class="row between small" style="padding:6px 0;border-bottom:1px solid var(--border)"><span>${it.label}</span><b>${it.value}</b></div>`)}${g.note ? html`<p class="small t2" style="margin-top:10px">${g.note}</p>` : ''}</div>`)}
      </div>
      ${(d.findings || []).length ? html`<h3 style="margin:22px 0 10px">Ofensores e oportunidades</h3><div class="grid g-3">${d.findings.map((f) => html`<div class="card card-pad"><div class="row between"><b>${f.name}</b><span class="chip ${/boa/i.test(f.tag) ? 'ok' : 'bad'}">${f.tag}</span></div>${f.fields.map((x) => html`<p class="small" style="margin:8px 0 0"><span class="tiny muted">${x.label}</span><br>${x.text}</p>`)}</div>`)}</div>` : ''}
      ${(d.reading || []).length ? html`<h3 style="margin:22px 0 10px">Leitura por login</h3><p class="small t2" style="margin-top:-4px">A leitura de cada login também aparece no cartão do operador em Feedbacks pendentes.</p><div class="grid g-3">${d.reading.map((x) => html`<div class="card card-pad"><b>${x.login}</b><p class="small" style="margin:6px 0">${x.text}</p>${x.action ? html`<div class="banner info" style="margin:0">${icon('target')}<span class="small">${x.action}</span></div>` : ''}</div>`)}</div>` : ''}
      ${(d.plan || []).length ? html`<h3 style="margin:22px 0 10px">Plano de ação</h3><div class="grid g-3">${d.plan.map((p) => html`<div class="card card-pad"><span class="chip">${p.num}</span><h4 style="margin:8px 0 4px">${p.title}</h4><p class="small t2" style="margin:0">${p.text}</p>${p.indicator ? html`<p class="tiny muted" style="margin:8px 0 0">Indicador: ${p.indicator}</p>` : ''}</div>`)}</div>` : ''}`;
  }
  el.innerHTML = String(html`${head}${kpis}${body}`);
  if (d.model === 'operadores_nota') bindOpReport(el);
  $('#an-orig', el).onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      const { html: src } = await api.get(`/reports/${id}/html`);
      if (!src) { toast('O arquivo original não foi guardado.', 'err'); return; }
      const { close } = modal({ title: r.title, wide: true, cls: 'an-modal', body: html`<iframe class="an-frame" title="${r.title}" sandbox="${r.kind === 'speech_safra' ? 'allow-scripts' : ''}"></iframe>`, foot: html`<button class="btn" data-close>Fechar</button>` });
      const fr = document.querySelector('.an-modal .an-frame');
      if (fr) fr.srcdoc = src; else close();
    } catch (ex) { toast(ex.message, 'err'); } finally { b.disabled = false; }
  };
  $('#an-del', el)?.addEventListener('click', async () => {
    if (!await confirmDialog('Excluir esta análise?', 'A análise sai de Análises da carteira e a leitura dos logins deixa de aparecer nos feedbacks. Os atendimentos importados continuam.', { ok: 'Excluir', danger: true })) return;
    try { await api.del(`/reports/${id}`); toast('Análise excluída.'); ctx.navigate('analises'); } catch (ex) { toast(ex.message, 'err'); }
  });
}

// ---------------------------------------------------------------- report de operadores (pareceres individuais)
const TURNO = { 'MANHÃ': ['Manhã', '#F5B23A'], TARDE: ['Tarde', '#4F8CFF'], INTEGRAL: ['Integral', '#14B8C9'] };
const turnoOf = (t) => TURNO[t] || [t ? t[0] + t.slice(1).toLowerCase() : '—', '#8B93A7'];
function donut(ops) {
  const total = ops.length || 1, r = 52, c = 2 * Math.PI * r;
  let off = 0;
  const parts = Object.keys(TURNO).concat([...new Set(ops.map((o) => o.turno))].filter((t) => !TURNO[t])).map((t) => ({ t, list: ops.filter((o) => o.turno === t) })).filter((x) => x.list.length);
  const arcs = parts.map((x) => { const len = (x.list.length / total) * c; const a = `<circle cx="64" cy="64" r="${r}" fill="none" stroke="${turnoOf(x.t)[1]}" stroke-width="16" stroke-dasharray="${Math.max(0, len - 3)} ${c - len + 3}" stroke-dashoffset="${-off}"/>`; off += len; return a; }).join('');
  return html`<div class="rn-donut"><div class="rn-ring"><svg viewBox="0 0 128 128" width="128" height="128" aria-hidden="true" style="transform:rotate(-90deg)"><circle cx="64" cy="64" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="16"/>${raw(arcs)}</svg><div><b class="num">${ops.length}</b><span>operadores</span></div></div>
    <div class="rn-leg">${parts.map((x) => html`<div><i style="background:${turnoOf(x.t)[1]}"></i><span><b>${turnoOf(x.t)[0]} · ${x.list.length}</b><small>${x.list.map((o) => o.login).join(', ')}</small></span><em class="num">${Math.round((x.list.length / total) * 100)}%</em></div>`)}</div></div>`;
}
function opReport(d) {
  const ops = d.ops || [], th = d.themes || {};
  const keys = [...(d.theme_order || []).filter((k) => th[k]), ...Object.keys(th).filter((k) => !(d.theme_order || []).includes(k))];
  const base = ops.filter((o) => o.tipo !== 'positivo').length || 1;
  const themes = keys.map((k) => ({ k, list: ops.filter((o) => o.temas.includes(k)) })).sort((a, b) => b.list.length - a.list.length);
  const turnos = [...new Set(ops.map((o) => o.turno).filter(Boolean))];
  const c = d.considerations;
  return html`
    <div class="card card-pad mb rn-lead">
      ${d.eyebrow ? html`<span class="chip">${d.eyebrow}</span>` : ''}
      <p>${d.lead}</p>
      ${(d.method || []).length ? html`<div class="rn-method">${d.method.map((m, i) => html`<div class="rn-step"><span class="rn-n">${String(i + 1).padStart(2, '0')}</span><b>${m.title}</b>${m.text ? html`<p>${m.text}</p>` : ''}${m.chips.length ? html`<div class="row" style="gap:6px;flex-wrap:wrap">${m.chips.map((x) => html`<span class="chip outline">${x}</span>`)}</div>` : ''}</div>`)}</div>` : ''}
    </div>
    <div class="grid g-2 mb">
      <div class="card card-pad"><h3>Operadores por turno</h3>${donut(ops)}</div>
      <div class="card card-pad"><h3>Recorrência dos pontos de melhoria</h3><p class="tiny muted" style="margin-top:-4px">Base: ${base} operador(es) com ponto de melhoria; um operador pode estar em mais de um tema.</p>
        ${themes.map((x) => { const p = Math.round((x.list.length / base) * 100); return html`<div class="rn-theme"><div class="row between"><b class="small">${th[x.k].nome}</b><span class="small num">${x.list.length} de ${base} · ${p}%</span></div><div class="rn-trk"><i style="--w:${p}%"></i></div><div class="rn-ops">${x.list.map((o) => html`<span>${o.login}</span>`)}</div></div>`; })}</div>
    </div>
    <div class="card mb"><div class="card-head"><div><h3>Matriz de atenção</h3><div class="sub">Onde cada operador concentra as oportunidades de melhoria.</div></div></div>
      <div class="tbl-wrap"><table class="tbl rn-mx"><thead><tr><th>Operador</th><th>Turno</th>${keys.map((k) => html`<th class="c">${th[k].curto}</th>`)}<th class="c">Destaque</th></tr></thead>
      <tbody>${ops.map((o) => html`<tr><td><b>${o.login}</b>${o.mat ? html`<span class="tiny muted"> · ${o.mat}</span>` : ''}</td><td><span class="rn-turno" style="--c:${turnoOf(o.turno)[1]}">${turnoOf(o.turno)[0]}</span></td>
        ${keys.map((k) => html`<td class="c">${o.temas.includes(k) ? html`<i class="rn-dot bad" title="Ponto de melhoria"></i>` : html`<span class="muted">·</span>`}</td>`)}
        <td class="c">${o.tipo === 'positivo' ? html`<i class="rn-dot ok" title="Destaque positivo"></i>` : html`<span class="muted">·</span>`}</td></tr>`)}</tbody></table></div>
      <div class="row small t2" style="gap:16px;padding:10px 16px 14px"><span><i class="rn-dot bad"></i> Ponto de melhoria</span><span><i class="rn-dot ok"></i> Destaque positivo</span></div></div>
    <div class="row between" style="margin:22px 0 10px;flex-wrap:wrap;gap:10px"><h3 style="margin:0">Pareceres individuais</h3>
      <div class="seg" id="rn-f"><button class="on" data-f="">Todos</button>${turnos.map((t) => html`<button data-f="${t}">${turnoOf(t)[0]}</button>`)}</div></div>
    <p class="small t2" style="margin-top:-4px">O parecer de cada login também aparece no cartão do operador em Feedbacks pendentes e entra na sugestão do plano de ação.</p>
    <div class="grid g-3 rn-cards">${ops.map((o) => html`<div class="card card-pad rn-card ${o.tipo === 'positivo' ? 'pos' : ''}" data-turno="${o.turno}">
        <div class="row" style="gap:10px"><span class="rn-av">${o.login.slice(0, 2).toUpperCase()}</span><div class="grow"><b>${o.login}</b><div class="tiny muted">${o.mat ? `Matrícula ${o.mat}` : ''}</div></div><span class="rn-turno" style="--c:${turnoOf(o.turno)[1]}">${turnoOf(o.turno)[0]}</span></div>
        <span class="chip ${o.tipo === 'positivo' ? 'ok' : 'warn'}" style="align-self:flex-start">${o.tipo === 'positivo' ? 'Destaque positivo' : 'Ponto de melhoria'}</span>
        <p class="small" style="margin:0;line-height:1.55">${o.texto}</p>
        ${o.nota ? html`<span class="chip outline" style="align-self:flex-start">${o.nota}</span>` : ''}
        <div class="row" style="gap:5px;flex-wrap:wrap">${o.temas.map((k) => html`<span class="rn-tag">${th[k]?.curto || k}</span>`)}</div>
      </div>`)}</div>
    ${c ? html`<div class="grid g-2" style="margin-top:22px">
      <div class="card card-pad rn-cons"><h3>${c.title || 'Considerações gerais'}</h3><p class="t2" style="line-height:1.6">${c.text}</p><div class="row" style="gap:8px;flex-wrap:wrap">${(c.pillars || []).map((x) => html`<span class="chip">${icon('target')}${x}</span>`)}</div></div>
      <div class="card card-pad"><h3>${c.focus_title || 'Competências a fortalecer'}</h3><div class="rn-focus">${(c.focus || []).map((x) => html`<div class="${x.length > 40 ? 'wide' : ''}">${icon('check')}<span>${x}</span></div>`)}</div></div>
    </div>` : ''}`;
}
function bindOpReport(el) {
  const btns = [...el.querySelectorAll('#rn-f button')];
  btns.forEach((b) => b.addEventListener('click', () => {
    btns.forEach((x) => x.classList.toggle('on', x === b));
    el.querySelectorAll('.rn-card').forEach((c) => { c.hidden = !!b.dataset.f && c.dataset.turno !== b.dataset.f; });
  }));
  requestAnimationFrame(() => el.querySelectorAll('.rn-trk i').forEach((i) => i.classList.add('in')));
}

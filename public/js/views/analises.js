import { api } from '../api.js';
import { html, icon, $, toast, modal, emptyState, confirmDialog, fmtDate } from '../ui.js';
import { CARTEIRA_INFO } from '../carteira.js';

// Análises da carteira: relatórios trazidos em HTML (conversão e eficiência, speech Safra Pay…), com os dados
// extraídos na tela e o arquivo original para consulta. Cada carteira vê só as suas.
const KIND = { conversao: 'Conversão e eficiência', speech_safra: 'Análise de speech', nota_qualidade: 'Nota de qualidade', relatorio: 'Relatório' };
const pctNum = (v) => { const m = String(v ?? '').match(/-?\d+(?:[.,]\d+)?/); return m ? Number(m[0].replace(',', '.')) : null; };
const bandOf = (p) => (p == null ? 'na' : p >= 70 ? 'ok' : p >= 45 ? 'warn' : 'bad');
const bar = (label, value, extra = '', p = pctNum(value)) => html`<div class="an-bar"><span class="lb">${label}</span><div class="trk"><i class="b-${bandOf(p)}" style="width:${Math.max(0, Math.min(100, p ?? 0))}%"></i></div><b class="num">${value ?? '—'}</b>${extra ? html`<em>${extra}</em>` : ''}</div>`;

export async function render(el, params, ctx) {
  const id = Number(params?.[0]) || null;
  if (id) return renderOne(el, id, ctx);
  ctx.setTitle('Análises da carteira', 'Visão geral');
  el.innerHTML = String(html`<div class="page-head"><div><h2>Análises da carteira</h2><p>Relatórios trazidos para a plataforma (conversão e eficiência, análises de speech), com a leitura de cada login. Cada carteira vê só as suas.</p></div><div class="grow"></div>
    ${ctx.can('admin', 'qualidade') ? html`<a class="btn primary" href="#/importar">${icon('upload')}Importar análise</a>` : ''}</div><div id="an-list"><div class="card card-pad">Carregando…</div></div>`);
  const rows = await api.get('/reports');
  if (!ctx.isCurrent()) return;
  const box = $('#an-list', el);
  if (!rows.length) { box.innerHTML = String(emptyState('report', 'Nenhuma análise ainda', 'Importe um relatório (.html) em Importar monitorias. Ele aparece aqui para a sua carteira.')); return; }
  box.innerHTML = String(html`<div class="an-grid">${rows.map((r) => html`<a class="card an-card" href="#/analises/${r.id}">
      <div class="row between"><span class="chip">${KIND[r.kind] || r.kind}</span><span class="chip outline">${CARTEIRA_INFO[r.portfolio]?.label || r.portfolio}</span></div>
      <h3>${r.title}</h3><div class="sub">${[r.period, r.data?.reading?.length ? `${r.data.reading.length} login(s) com leitura` : '', r.data?.logins?.length ? `${r.data.logins.length} logins` : ''].filter(Boolean).join(' · ')}</div>
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
      <p>${[CARTEIRA_INFO[r.portfolio]?.label || r.portfolio, KIND[r.kind], r.period].filter(Boolean).join(' · ')}</p></div><div class="grow"></div>
    <button class="btn" id="an-orig">${icon('eye')}Ver arquivo original</button>
    ${ctx.can('admin', 'qualidade') ? html`<button class="btn ghost danger" id="an-del">${icon('trash')}Excluir</button>` : ''}</div>`;
  const kpis = (d.kpis || []).length ? html`<div class="grid g-4 mb">${(d.score && typeof d.score === 'object' ? [d.score, ...d.kpis] : d.kpis).slice(0, 6).map((k) => html`<div class="card kpi"><div class="k-label">${k.label}</div><div class="k-val num">${k.value}</div>${k.sub ? html`<div class="tiny muted" style="margin-top:8px">${k.sub}${k.tag ? ` · ${k.tag}` : ''}</div>` : ''}</div>`)}</div>` : '';
  let body = '';
  if (r.kind === 'nota_qualidade') {
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

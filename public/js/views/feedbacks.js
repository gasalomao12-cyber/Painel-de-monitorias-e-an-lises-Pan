import { api, qs } from '../api.js';
import { downloadFeedbacks } from '../files.js';
import { html, icon, $, $$, fmtScore, fmtDate, avatar, productChip, emptyState, toast, busy, debounce, band, ROLE, modal } from '../ui.js';
import { multiSelect, bindMultiSelect } from '../ui.js';
import { filterBar, bindFilterBar } from './dashboard.js';
import { formalizeBeedoo } from '../beedoo.js';

const state = { product: '', segment: '', team: '', q: '', group: localStorage.getItem('px_fb_group') || 'operador' };

export async function render(el, [kind], ctx) {
  if (kind === 'aplicados') return renderApplied(el, ctx);
  return renderPending(el, ctx);
}

const SHEET_THEMES = ['Conversão', 'Eficiência', 'Tabulação', 'Formação inicial', 'Abordagem', 'Checklist', 'Produto', 'Oferta', 'Processo', 'PIX'];
const MODALITIES = ['Presencial', 'Remoto (Teams)', 'Por telefone', 'Chat corporativo'];
const ALERT_LABEL = { conduta: 'Conduta', sigilo: 'Sigilo', oferta_perdida: 'Oferta perdida', sem_proposta: 'Sem proposta', postura: 'Postura', audio_ruim: 'Áudio ruim', sem_speech: 'Sem speech' };
const localDT = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const themeFor = (o) => (o.alerts?.oferta_perdida ? 'Oferta' : o.alerts?.conduta || o.alerts?.postura ? 'Abordagem' : 'Conversão');
const pst = { q: '', open: new Set(), showExcluded: false };

// Feedbacks pendentes: um cartão por operador e um feedback único para todos os atendimentos auditados dele
async function renderPending(el, ctx) {
  const { store } = ctx;
  ctx.setTitle('Feedbacks pendentes', 'Feedbacks');
  el.innerHTML = String(html`
    <div class="page-head"><div><h2>Feedbacks pendentes</h2><p>Um feedback por operador, com base em todos os atendimentos auditados dele. Operadores remanejados ou desligados podem sair da lista.</p></div></div>
    ${filterBar(store, state, { extra: html`<div class="grow"></div><input class="input sm" id="fp-q" placeholder="Buscar operador ou login…" value="${pst.q}" style="min-width:220px">` })}
    <div id="pend"></div>`);
  let data = null;
  const draw = () => {
    const box = $('#pend', el);
    if (!data) return;
    const k = String(pst.q || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const match = (o) => !k || `${o.operator_name} ${o.login || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(k);
    const ops = data.operators.filter(match);
    const ex = data.excluded.filter(match);
    const totalEv = data.operators.reduce((s, o) => s + o.total, 0);
    const header = html`<div class="grid g-4 mb">
      ${tile('Operadores a receber feedback', data.operators.length, 'users', 'warn')}${tile('Atendimentos auditados', totalEv, 'headset', '')}
      ${tile('Operadores com falha crítica', data.operators.filter((o) => o.critical).length, 'alert', 'bad')}${tile('Fora da lista', data.excluded.length, 'userCog', '')}</div>`;
    const card = (o, excluded = false) => html`<div class="card fbp-card ${excluded ? 'is-out' : ''}" data-op="${o.operator_id}">
      <div class="fbp-head">${avatar(o.operator_name)}<div class="grow" style="min-width:0"><h3>${o.operator_name}</h3>
        <div class="sub">${[o.login, o.team, o.supervisor_name && `líder ${o.supervisor_name}`].filter(Boolean).join(' · ')}</div></div>
        <span class="chip">${o.portfolio}</span></div>
      <div class="fbp-nums">
        <div><b class="num">${o.total}</b><span>atendimento(s) auditado(s)</span></div>
        <div><b class="num score-txt band-${band(o.avg_final)}">${fmtScore(o.avg_final)}</b><span>nota média</span></div>
        <div><b class="num score-txt band-${band(o.min_final)}">${fmtScore(o.min_final)}</b><span>menor nota</span></div>
        <div class="d"><b class="num">${o.last_call ? fmtDate(o.last_call) : '—'}</b><span>último atendimento</span></div>
      </div>
      ${o.worst.length ? html`<div class="fbp-worst"><span class="tiny muted">Pontos para conversar</span><div class="row" style="gap:6px;flex-wrap:wrap">${o.worst.map((w) => html`<span class="chip ${w.critical ? 'bad' : 'warn'}">${w.name}<b style="margin-left:4px">${w.nc}${w.p ? ` + ${w.p}½` : ''}</b></span>`)}</div></div>` : html`<p class="small t2" style="margin:0">Sem pontos de melhoria: bom momento para um feedback de reconhecimento.</p>`}
      ${(o.reading || []).slice(0, 2).map((x) => html`<div class="fbp-read"><b>${x.title}${x.period ? ` · ${x.period}` : ''}</b><span>${x.text}</span>${x.action ? html`<span><b style="text-transform:none;letter-spacing:0">Ação:</b> ${x.action}</span>` : ''}</div>`)}
      ${Object.keys(o.alerts || {}).length ? html`<div class="row" style="gap:6px;flex-wrap:wrap">${Object.entries(o.alerts).map(([a, n]) => html`<span class="chip bad">${ALERT_LABEL[a] || a} · ${n}</span>`)}</div>` : ''}
      ${excluded ? html`<div class="banner info">${icon('info')}<div>Fora da lista desde ${fmtDate(o.excluded.at)}${o.excluded.by ? ` por ${o.excluded.by}` : ''}: <b>${o.excluded.reason}</b></div></div>` : ''}
      ${pst.open.has(o.operator_id) ? html`<div class="fbp-evs">${o.evaluations.map((e) => html`<a class="fbp-ev" href="#/atendimentos/${e.id}">
        <span class="num">${fmtDate(e.call_date)}${e.call_time ? ` ${e.call_time}` : ''}</span><span class="grow fbp-ev-t">${e.protocol || `#${e.id}`} ${productChip(e.product, e.segment)} ${e.channel === 'AGV' ? html`<span class="chip">AGV</span>` : ''}</span>
        <b class="score-txt band-${band(e.final_score)}">${fmtScore(e.final_score)}</b></a>`)}</div>` : ''}
      <div class="fbp-foot">
        <button class="btn sm ghost" data-toggle="${o.operator_id}">${icon('list')}${pst.open.has(o.operator_id) ? 'Esconder' : 'Ver'} atendimentos</button>
        <div class="grow"></div>
        ${excluded ? html`<button class="btn sm" data-restore="${o.operator_id}">${icon('undo')}Voltar para a lista</button>`
          : html`<button class="btn sm ghost danger" data-out="${o.operator_id}">${icon('userCog')}Tirar da lista</button><button class="btn sm primary" data-apply="${o.operator_id}">${icon('msgCheck')}Aplicar feedback</button>`}
      </div></div>`;
    box.innerHTML = String(html`${header}
      ${ops.length ? html`<div class="fbp-grid">${ops.map((o) => card(o))}</div>` : emptyState('checkCircle', data.operators.length ? 'Nenhum operador com esse nome' : 'Tudo em dia!', data.operators.length ? 'Ajuste a busca.' : 'Nenhum operador com atendimento pendente de feedback no filtro.')}
      ${data.excluded.length ? html`<div class="card mt"><button class="card-head fbp-ex-tg" id="fp-ex" style="width:100%;border:0;background:none;cursor:pointer;text-align:left;color:inherit">
          <div><h3>Fora da lista de feedbacks (${data.excluded.length})</h3><div class="sub">Remanejados, desligados ou afastados. Os atendimentos continuam no histórico.</div></div><div class="grow"></div>${icon('chevDown')}</button>
        ${pst.showExcluded ? html`<div class="card-body"><div class="fbp-grid">${ex.map((o) => card(o, true))}</div></div>` : ''}</div>` : ''}`);
    $$('[data-toggle]', box).forEach((b) => b.addEventListener('click', () => { const id = Number(b.dataset.toggle); if (pst.open.has(id)) pst.open.delete(id); else pst.open.add(id); draw(); }));
    $$('[data-apply]', box).forEach((b) => b.addEventListener('click', () => applyFeedback(data.operators.find((o) => o.operator_id === Number(b.dataset.apply)), ctx, load)));
    $$('[data-out]', box).forEach((b) => b.addEventListener('click', () => excludeOperator(data.operators.find((o) => o.operator_id === Number(b.dataset.out)), data.reasons, ctx, load)));
    $$('[data-restore]', box).forEach((b) => b.addEventListener('click', async () => {
      try { await api.post(`/operators/${b.dataset.restore}/feedback-exclusion`, { restore: true }); toast('Operador voltou para a lista de feedbacks.'); ctx.refreshMeta(); load(); } catch (ex2) { toast(ex2.message, 'err'); }
    }));
    $('#fp-ex', box)?.addEventListener('click', () => { pst.showExcluded = !pst.showExcluded; draw(); });
  };
  const load = async () => {
    data = await api.get(`/feedbacks/pending${qs({ product: state.product, segment: state.segment, team: state.team })}`);
    if (!ctx.isCurrent()) return;
    draw();
  };
  bindFilterBar(el, store, state, load);
  $('#fp-q', el).addEventListener('input', debounce((e) => { pst.q = e.target.value; draw(); }, 200));
  await load();
}

function applyFeedback(o, ctx, reload) {
  if (!o) return;
  const dates = o.evaluations.map((e) => e.call_date).filter(Boolean).sort();
  modal({
    title: `Feedback para ${o.operator_name}`, wide: true,
    body: html`<form id="fo-form">
      <div class="banner info">${icon('info')}<div>Um único feedback para <b>${o.total} atendimento(s) auditado(s)</b>${dates.length ? ` de ${fmtDate(dates[0])} a ${fmtDate(dates[dates.length - 1])}` : ''} · nota média <b>${fmtScore(o.avg_final)}</b>. Todos ficam com o feedback aplicado e a planilha de ações recebe uma linha só.</div></div>
      <div class="field"><label>Atendimentos incluídos</label><div class="fbp-pick">${o.evaluations.map((e) => html`<label class="check"><input type="checkbox" name="ev" value="${e.id}" checked>
        <span>${fmtDate(e.call_date)} · ${e.protocol || `#${e.id}`} · nota <b class="score-txt band-${band(e.final_score)}">${fmtScore(e.final_score)}</b>${e.channel === 'AGV' ? ' · AGV' : ''}</span></label>`)}</div></div>
      <div class="grid g-3">
        <div class="field"><label for="fo-at">Data e hora do feedback</label><input class="input" id="fo-at" name="applied_at" type="datetime-local" required value="${localDT()}"></div>
        <div class="field"><label for="fo-mod">Modalidade</label><select class="select" id="fo-mod" name="modality">${MODALITIES.map((x) => html`<option>${x}</option>`)}</select></div>
        <div class="field"><label for="fo-fu">Reavaliar em</label><input class="input" id="fo-fu" name="followup_date" type="date"></div>
      </div>
      <div class="field"><label for="fo-theme">Tema na planilha de ações</label><select class="select" id="fo-theme" name="sheet_theme">${SHEET_THEMES.map((t) => html`<option ${t === themeFor(o) ? 'selected' : ''}>${t}</option>`)}</select></div>
      <div class="field"><div class="row between"><label for="fo-content">O que foi passado ao operador *</label><button type="button" class="btn sm ghost" id="fo-sug">${icon('sparkles')}Preencher com sugestão</button></div>
        <textarea class="textarea" id="fo-content" name="content" required minlength="10" style="min-height:120px" placeholder="Ex.: Ouvimos juntos três ligações; reforcei a sondagem antes da oferta…"></textarea></div>
      <div class="grid g-2">
        <div class="field"><label for="fo-str">Pontos fortes reconhecidos</label><textarea class="textarea" id="fo-str" name="strengths" style="min-height:76px"></textarea></div>
        <div class="field"><label for="fo-imp">Pontos de melhoria</label><textarea class="textarea" id="fo-imp" name="improvements" style="min-height:76px"></textarea></div>
      </div>
      <div class="field"><label for="fo-plan">Plano de ação combinado</label><textarea class="textarea" id="fo-plan" name="action_plan" style="min-height:70px"></textarea></div>
      <label class="check"><input type="checkbox" name="operator_ack" checked> Operador ciente do feedback</label>
    </form>`,
    foot: html`<button class="btn ghost" data-close>Cancelar</button><div class="grow"></div><label class="check small" title="Depois de salvar, abre a revisão da mensagem para o chat do Beedoo do operador"><input type="checkbox" id="fo-bd" ${localStorage.getItem('px_fo_bd') === '0' ? '' : 'checked'}> Formalizar no Beedoo em seguida</label><button class="btn success" id="fo-save">${icon('checkCircle')}Salvar feedback aplicado</button>`,
    onMount: (m, close) => {
      const fm = $('#fo-form', m);
      const ids = () => $$('[name="ev"]:checked', m).map((c) => Number(c.value));
      $('#fo-sug', m).onclick = async (e) => {
        const btnEl = e.currentTarget; busy(btnEl, true);
        let mat = { items: [] };
        try { mat = await api.get(`/operators/${o.operator_id}/feedback-material${qs({ ids: ids().join(',') })}`); } catch { /* sugestão só com os critérios */ }
        busy(btnEl, false);
        const uniq = (l) => [...new Set(l.map((x) => String(x || '').trim()).filter(Boolean))];
        const strengths = uniq(mat.items.flatMap((i) => String(i.strengths || '').split(/;\s*/))).slice(0, 4);
        const tips = uniq(mat.items.map((i) => i.improvements)).slice(0, 3);
        const worst = o.worst.slice(0, 4).map((w) => w.name.toLowerCase());
        if (!fm.content.value.trim()) fm.content.value = `Feedback com base em ${ids().length} atendimento(s) auditado(s)${dates.length ? ` de ${fmtDate(dates[0])} a ${fmtDate(dates[dates.length - 1])}` : ''}, nota média ${fmtScore(o.avg_final)}. ${worst.length ? `Conversamos sobre: ${worst.join(', ')}.` : 'Reconhecemos o bom desempenho nos atendimentos.'}`;
        if (!fm.strengths.value.trim()) fm.strengths.value = strengths.join('; ');
        const reads = (o.reading || []).map((x) => x.action).filter(Boolean);
        if (!fm.improvements.value.trim()) fm.improvements.value = [worst.length ? `Reforçar: ${worst.join(', ')}.` : '', ...tips].filter(Boolean).join(' ');
        if (!fm.action_plan.value.trim() && reads.length) fm.action_plan.value = reads.join(' ');
        toast('Campos vazios preenchidos com a sugestão. Revise antes de salvar.');
      };
      $('#fo-save', m).onclick = async (e) => {
        if (!fm.reportValidity()) return;
        if (!ids().length) { toast('Marque pelo menos um atendimento.', 'err'); return; }
        const btnEl = e.currentTarget; busy(btnEl, true, 'Salvando');
        try {
          const r = await api.post(`/operators/${o.operator_id}/feedback`, {
            evaluation_ids: ids(), applied_at: new Date(fm.applied_at.value).toISOString(), modality: fm.modality.value, followup_date: fm.followup_date.value,
            content: fm.content.value, strengths: fm.strengths.value, improvements: fm.improvements.value, action_plan: fm.action_plan.value, operator_ack: fm.operator_ack.checked, sheet_theme: fm.sheet_theme.value,
          });
          const toBd = $('#fo-bd', m)?.checked; try { localStorage.setItem('px_fo_bd', toBd ? '1' : '0'); } catch { /* sem armazenamento */ }
          close(); toast(`Feedback aplicado a ${o.operator_name} (${r.evaluations} atendimento(s)).`); ctx.refreshMeta(); reload();
          if (toBd && r.batch_id) formalizeBeedoo({ kind: 'feedback', batch_id: r.batch_id });
        } catch (ex) { toast(ex.message, 'err'); busy(btnEl, false); }
      };
    },
  });
}

function excludeOperator(o, reasons, ctx, reload) {
  if (!o) return;
  modal({
    title: `Tirar ${o.operator_name} da lista`,
    body: html`<p class="t2" style="margin-top:0">O operador deixa de aparecer nos feedbacks pendentes. Os ${o.total} atendimento(s) continuam no histórico e ele pode voltar para a lista a qualquer momento.</p>
      <div class="field"><label for="fx-r">Motivo</label><select class="select" id="fx-r">${reasons.map((r) => html`<option>${r}</option>`)}</select></div>
      <div class="field"><label for="fx-n">Observação</label><input class="input" id="fx-n" placeholder="Ex.: foi para a equipe da Meire em 03/11"></div>`,
    foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn danger" id="fx-go">${icon('userCog')}Tirar da lista</button>`,
    onMount: (m, close) => {
      $('#fx-go', m).onclick = async (e) => {
        const btnEl = e.currentTarget; busy(btnEl, true);
        try { await api.post(`/operators/${o.operator_id}/feedback-exclusion`, { reason: $('#fx-r', m).value, note: $('#fx-n', m).value }); close(); toast(`${o.operator_name} saiu da lista de feedbacks.`); ctx.refreshMeta(); reload(); }
        catch (ex) { toast(ex.message, 'err'); busy(btnEl, false); }
      };
    },
  });
}

function tile(label, val, ic, tone) {
  const tones = { bad: 'background:var(--bad-soft);color:var(--bad-ink)', warn: 'background:var(--warn-soft);color:var(--warn-ink)' };
  return html`<div class="card kpi"><div class="k-label"><span class="k-ic" style="${tones[tone] || ''}">${icon(ic)}</span>${label}</div><div class="k-val num">${val}</div></div>`;
}

async function renderApplied(el, ctx) {
  const { store } = ctx;
  ctx.setTitle('Feedbacks aplicados', 'Feedbacks');
  const m = store.meta;
  const st = { operator_id: '', from: '', to: '' };
  const canBd = ctx.can('admin', 'qualidade');
  el.innerHTML = String(html`
    <div class="page-head"><div><h2>Feedbacks aplicados</h2><p>Histórico completo do que foi passado a cada operador, por quem e quando.</p></div><div class="grow"></div>
      <button class="btn" id="fb-exp">${icon('download')}Exportar Excel</button></div>
    ${filterBar(store, state, { extra: html`
      ${multiSelect({ id: 'fa-op', allLabel: 'Todos os operadores', noun: 'operadores', options: m.operators.map((o) => [o.id, o.name]), selected: [] })}
      <input type="date" class="input sm" id="fa-from" aria-label="De"><input type="date" class="input sm" id="fa-to" aria-label="Até">
      <div class="grow"></div><input class="input sm" id="fa-q" placeholder="Buscar no conteúdo…">` })}
    <div id="fa-sum"></div><div id="fa-list"></div>`);
  const load = async () => {
    const rows = await api.get(`/feedbacks${qs({ cycle_id: store.cycle, product: state.product, segment: state.segment, team: state.team, operator_id: st.operator_id, from: st.from, to: st.to, q: state.q })}`);
    if (!ctx.isCurrent()) return;
    const box = $('#fa-list', el);
    // Feedback aplicado a vários atendimentos de uma vez (mesmo lote) conta e aparece uma vez só
    const seen = new Map();
    for (const r of rows) { const k = r.batch_id || `f${r.id}`; const g = seen.get(k); if (g) g._n.push(r); else seen.set(k, { ...r, _n: [r] }); }
    const cards = [...seen.values()];
    for (const f of cards) { const sc = f._n.map((x) => x.final_score).filter((v) => v != null); f.final_score = sc.length ? sc.reduce((a, v) => a + Number(v), 0) / sc.length : f.final_score; }
    $('#fa-sum', el).innerHTML = String(html`<div class="grid g-4 mb">
      ${tile('Feedbacks aplicados', cards.length, 'msgCheck', '')}
      ${tile('Operadores atendidos', new Set(rows.map((r) => r.operator_id)).size, 'users', '')}
      ${tile('Com ciência do operador', cards.filter((r) => r.operator_ack).length, 'checkCircle', '')}
      ${tile('Com reavaliação agendada', cards.filter((r) => r.followup_date).length, 'calendar', '')}</div>`);
    if (!rows.length) { box.innerHTML = String(emptyState('msgCheck', 'Nenhum feedback encontrado', 'Os feedbacks registrados nos atendimentos aparecem aqui.')); return; }
    box.innerHTML = String(html`<div class="stack">${cards.map((f) => html`<div class="fb-card" style="cursor:pointer" data-ev="${f.evaluation_id}">
      <div class="fb-h">${avatar(f.operator_name)}<div class="grow"><b>${f.operator_name}</b> <span class="tiny muted">${f.team || ''}</span>
        <div class="tiny muted">${f._n.length > 1 ? `${f._n.length} atendimentos · ${f._n.map((x) => x.protocol).filter(Boolean).slice(0, 4).join(', ')}${f._n.length > 4 ? '…' : ''}` : `${f.cycle_name || ''} · ligação ${fmtDate(f.call_date)} · ${f.protocol || ''}`}</div></div>
        ${productChip(f.product, f.segment)}<span class="chip">${f._n.length > 1 ? 'nota média' : 'nota'} <b class="score-txt band-${band(f.final_score)}" style="margin-left:4px">${fmtScore(f.final_score)}</b></span>
        <span class="chip ok">${icon('checkCircle')}${fmtDate(f.applied_at)}</span></div>
      <p class="small">${f.content}</p>
      <div class="row tiny muted mt-0" style="margin-top:10px">${icon('user')}<span>${f.applied_by_display || f.applied_by_name} · ${ROLE[f.applied_by_role] || ''}${f.modality ? ` · ${f.modality}` : ''}${f.operator_ack ? ' · operador ciente' : ''}${f.followup_date ? ` · reavaliar em ${fmtDate(f.followup_date)}` : ''}</span>
        ${canBd ? html`<div class="grow"></div><button class="btn sm" data-bd="${f.id}" title="Revisar e enviar a formalização no chat do Beedoo do operador">${icon('send')}Formalizar no Beedoo</button>` : ''}</div>
    </div>`)}</div>`);
    $$('[data-ev]', box).forEach((c) => c.addEventListener('click', (e) => { if (e.target.closest('[data-bd]')) return; sessionStorage.setItem('px_ev_tab', 'feedback'); ctx.navigate(`atendimentos/${c.dataset.ev}`); }));
    $$('[data-bd]', box).forEach((b) => b.addEventListener('click', () => formalizeBeedoo({ kind: 'feedback', feedback_id: b.dataset.bd })));
  };
  bindFilterBar(el, store, state, load);
  bindMultiSelect(el, 'fa-op', (v) => { st.operator_id = v.join('|'); load(); });
  $('#fa-from').onchange = (e) => { st.from = e.target.value; load(); };
  $('#fa-to').onchange = (e) => { st.to = e.target.value; load(); };
  $('#fa-q').addEventListener('input', debounce((e) => { state.q = e.target.value; load(); }, 300));
  $('#fb-exp').onclick = async (e) => {
    const btnEl = e.currentTarget;
    busy(btnEl, true); try { await downloadFeedbacks(await api.get('/export/feedbacks')); } catch (ex) { toast(ex.message, 'err'); } busy(btnEl, false); };
  await load();
}

import { api, qs } from '../api.js';
import {
  html, raw, icon, $, $$, esc, fmtScore, fmtDate, fmtDur, fmtRel, avatar, productChip, scoreRing, deltaTag, resChip, toast, modal, busy,
  confirmDialog, RESULT, ROLE, userName, emptyState, parseDate, PRODUCT, SEGMENT, SEGMENTS_OF, ALERT, origLabel, CONTEST,
} from '../ui.js';
import { readTranscriptFile } from '../files.js';

const PARTIAL = 0.5;
function previewScore(items, pick) {
  let total = 0, pts = 0, crit = false, n = 0;
  for (const it of items) {
    const r = pick(it);
    if (!r || r === 'NA') continue;
    const w = it.weight == null || it.weight === '' ? 1 : Number(it.weight);
    if (!(w > 0)) { if (r === 'NC' && it.critical) crit = true; continue; }
    total += w; n++;
    if (r === 'C') pts += w; else if (r === 'P') pts += w * PARTIAL; else if (r === 'NC' && it.critical) crit = true;
  }
  if (!n) return null;
  return crit ? 0 : Math.round((pts / total) * 1000) / 10;
}

const ACTIONS = {
  atendimento_criado: 'Monitoria registrada', analise_ajustada: 'Análise ajustada', analise_validada: 'Análise validada sem alterações',
  ajustes_revertidos: 'Ajustes revertidos para o speech', link_audio_alterado: 'Link do áudio alterado', transcricao_anexada: 'Transcrição anexada',
  ia_analise: 'Análise automática executada', ia_erro: 'Falha na análise automática', ia_sugestoes_aplicadas: 'Sugestões da IA aplicadas',
  feedback_aplicado: 'Feedback aplicado', feedback_editado: 'Feedback editado', feedback_removido: 'Feedback removido', dados_editados: 'Dados da monitoria editados',
  importacao_dashboard: 'Importada do dashboard', contestacao_aberta: 'Contestação aberta', contestacao_respondida: 'Contestação respondida', contestacao_cancelada: 'Contestação cancelada',
};

let ev = null, draft = new Map(), tab = 'analise';

export async function render(el, [id], ctx) {
  ev = await api.get(`/evaluations/${id}`);
  draft = new Map();
  tab = sessionStorage.getItem('px_ev_tab') || 'analise';
  sessionStorage.removeItem('px_ev_tab');
  if (!ctx.isCurrent()) return;
  draw(el, ctx);
}

function draw(el, ctx) {
  const { can, store } = ctx;
  const e = ev;
  ctx.setTitle(e.operator_name, `Atendimentos › ${e.protocol || '#' + e.id}`);
  const fb = e.feedbacks[0];
  const delta = e.final_score != null && e.speech_score != null ? e.final_score - e.speech_score : null;
  const editor = can('admin', 'qualidade');
  const isAdmin = can('admin');
  const openContest = (e.contests || []).find((c) => c.status === 'aberta');
  const steps = [
    ['Monitoria registrada', true],
    ['Análise revisada', e.status !== 'pendente'],
    ['Feedback aplicado', e.status === 'feedback_aplicado'],
  ];
  el.innerHTML = String(html`
    <div class="row mb"><a class="btn sm ghost" href="#/atendimentos">${icon('chevLeft')}Voltar aos atendimentos</a><div class="grow" style="flex:1"></div>
      ${can('admin') ? html`<button class="btn sm danger" id="del-ev">${icon('trash')}Excluir</button>` : ''}</div>

    ${contestBanners(e, ctx)}
    ${fb ? html`<div class="banner ok">${icon('checkCircle')}<div><b>Feedback aplicado ao operador</b> em ${fmtDate(fb.applied_at, true)} por ${fb.applied_by_display || fb.applied_by_name}${fb.modality ? ` · ${fb.modality}` : ''}${fb.operator_ack ? ' · operador ciente' : ''}.</div></div>` : ''}

    <div class="card" style="${e.status === 'feedback_aplicado' ? 'border-color:color-mix(in srgb, var(--ok) 45%, transparent)' : ''}">
      <div class="detail-head">
        ${avatar(e.operator_name, 'lg')}
        <div style="min-width:0">
          <div class="row" style="gap:8px">${productChip(e.product, e.segment)}${editor && SEGMENTS_OF[e.product] ? html`<button class="btn sm ghost" id="edit-seg" title="Alterar o segmento">${icon('edit')}Segmento</button>` : ''}${(e.alerts || []).map((a) => html`<span class="chip alert ${a === 'audio_ruim' || a === 'sem_speech' ? 'warn' : ''}" title="${ALERT[a]?.[1] || ''}">${icon('alert')}${ALERT[a]?.[0] || a}</span>`)}${e.cycle_name ? html`<span class="chip outline">${icon('calendar')}${e.cycle_name}</span>` : ''}${e.critical_fail ? html`<span class="chip bad">${icon('alert')}Falha crítica</span>` : ''}</div>
          <h2 class="mt-0" style="margin-top:8px">${e.operator_name}</h2>
          <div class="facts">
            <span>Equipe <b>${e.team || '—'}</b></span><span>${e.login ? html`Login <b>${e.login}</b>` : html`Matrícula <b>${e.registration || '—'}</b>`}</span><span>Líder <b>${e.supervisor_name || '—'}</b></span>
            <span>Data <b>${fmtDate(e.call_date)}${e.call_time ? ` às ${e.call_time}` : ''}</b></span><span>${e.source ? 'ID da ligação' : 'Protocolo'} <b>${e.protocol || '—'}</b></span>${e.contract ? html`<span>Contrato <b>${e.contract}</b></span>` : ''}
            <span>Cliente <b>${e.customer || '—'}</b></span><span>Duração <b>${fmtDur(e.duration_sec)}</b></span>
          </div>
        </div>
        <div class="score-compare">
          <div class="center">${scoreRing(e.speech_score, '', '')}<div class="tiny muted mt-0" style="margin-top:6px">${origLabel(e)}</div></div>
          <span class="arrow">${icon('arrowRight')}</span>
          <div class="center">${scoreRing(e.final_score, 'lg', 'final')}<div class="tiny mt-0" style="margin-top:6px">${delta && Math.abs(delta) >= 0.1 ? deltaTag(delta) : html`<span class="muted">sem ajuste de nota</span>`}</div></div>
        </div>
      </div>
      <div style="padding:0 22px 20px">
        <div class="steps">${steps.map(([l, d]) => html`<div class="step ${d ? 'done' : ''}"><i>${d ? icon('check') : ''}</i>${l}</div>`)}</div>
        ${audioBar(e, can('admin'))}
        ${callDetails(e)}
        <div class="row mt">
          ${editor ? html`<button class="btn ${e.status === 'feedback_aplicado' ? '' : 'success'}" data-goto="feedback">${icon('msgCheck')}${e.status === 'feedback_aplicado' ? 'Ver / registrar feedback' : 'Aplicar feedback'}</button>`
            : html`<button class="btn" data-goto="feedback">${icon('msgCheck')}Ver feedbacks${e.feedbacks.length ? ` (${e.feedbacks.length})` : ''}</button>`}
          ${can('supervisor', 'admin') && !openContest ? html`<button class="btn ${editor ? '' : 'primary'}" id="btn-contest">${icon('flag')}Contestar monitoria</button>` : ''}
          ${editor ? html`<button class="btn" id="btn-transcript">${icon('file')}${e.transcript ? 'Substituir transcrição' : 'Anexar transcrição'}</button>` : ''}
          ${isAdmin ? html`<button class="btn" id="btn-audio" title="Transcrever o áudio da ligação com o Azure Speech">${icon('audio')}Transcrever áudio</button>` : ''}
          ${isAdmin ? html`<button class="btn primary" id="btn-ai" ${e.transcript ? '' : raw('disabled title="Anexe a transcrição primeiro"')}>${icon('sparkles')}${e.ai_status === 'concluida' ? 'Reanalisar com IA' : 'Analisar com IA'}</button>` : ''}
          ${e.reviewer ? html`<span class="small muted">Revisado por <b>${e.reviewer.display_name || e.reviewer.name}</b> ${fmtRel(e.reviewed_at)}</span>` : ''}
        </div>
      </div>
    </div>

    <div class="tabs mt" role="tablist">
      ${tabBtn('analise', 'list', 'Análise', e.items.length)}
      ${tabBtn('transcricao', isAdmin ? 'sparkles' : 'file', isAdmin ? 'Transcrição & IA' : 'Transcrição', isAdmin && e.ai_status === 'concluida' ? 'IA' : e.transcript ? '1' : '')}
      ${tabBtn('feedback', 'msgCheck', 'Feedback', e.feedbacks.length || '')}
      ${tabBtn('historico', 'refresh', 'Histórico', e.history.length || '')}
    </div>
    <div id="tab-body"></div>`);

  $$('.tabs button', el).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(el, ctx); }));
  $$('[data-goto]', el).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.goto; draw(el, ctx); $('#tab-body').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  $('#del-ev', el)?.addEventListener('click', async () => {
    if (!(await confirmDialog('Excluir atendimento', 'A monitoria, os ajustes e os feedbacks registrados serão removidos. Esta ação não pode ser desfeita.', { ok: 'Excluir', danger: true }))) return;
    await api.del(`/evaluations/${e.id}`); toast('Atendimento excluído.'); ctx.refreshMeta(); ctx.navigate('atendimentos');
  });
  $('#btn-transcript', el)?.addEventListener('click', () => attachTranscript(el, ctx));
  $('#btn-audio', el)?.addEventListener('click', () => transcribeAudioFile(el, ctx));
  $('#btn-ai', el)?.addEventListener('click', (x) => runAI(el, ctx, x.currentTarget));
  $('#edit-audio', el)?.addEventListener('click', () => editAudio(el, ctx));
  $('#edit-seg', el)?.addEventListener('click', () => editSegment(el, ctx));
  $('#btn-contest', el)?.addEventListener('click', () => openContestForm(el, ctx));
  $$('[data-ct-answer]', el).forEach((b) => b.addEventListener('click', () => answerContest(el, ctx, Number(b.dataset.ctAnswer), b.dataset.decision)));
  $$('[data-ct-cancel]', el).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Cancelar contestação', 'A contestação será encerrada sem resposta da Qualidade.', { ok: 'Cancelar contestação', danger: true }))) return;
    try { ev = await api.put(`/contests/${b.dataset.ctCancel}`, { status: 'cancelada' }); toast('Contestação cancelada.'); ctx.refreshMeta(); draw(el, ctx); } catch (ex) { toast(ex.message, 'err'); }
  }));
  $$('[data-copy]', el).forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('Nome do arquivo copiado. Cole na busca da pasta de áudios.'); } catch { toast('Não foi possível copiar.', 'err'); }
  }));

  const body = $('#tab-body', el);
  if (tab === 'analise') drawAnalysis(body, el, ctx);
  else if (tab === 'transcricao') drawTranscript(body, el, ctx);
  else if (tab === 'feedback') drawFeedback(body, el, ctx);
  else drawHistory(body);
  void store;
}

const tabBtn = (id, ic, label, count) => html`<button role="tab" data-tab="${id}" class="${tab === id ? 'on' : ''}" aria-selected="${tab === id}">${icon(ic)}${label}${count !== '' && count != null ? html`<span class="chip">${count}</span>` : ''}</button>`;

function audioBar(e, isAdmin) {
  const own = !!e.audio_url;
  return html`<div class="audio-bar">
    <span class="ic">${icon('audio')}</span>
    <div class="grow"><b>Áudio da ligação</b><div class="url">${e.audio_link ? html`${own ? 'Link próprio deste atendimento' : 'Pasta da quinzena'} · ${e.audio_link}` : 'Nenhum link cadastrado para este atendimento ou quinzena.'}</div>
      ${e.audio_file ? html`<div class="url">Arquivo: <span class="file-name">${e.audio_file}</span></div>` : ''}</div>
    ${e.audio_file ? html`<button class="btn" data-copy="${e.audio_file}" title="Copiar o nome do arquivo para buscar na pasta">${icon('file')}Copiar nome</button>` : ''}
    ${e.audio_link ? html`<a class="btn primary" href="${e.audio_link}" target="_blank" rel="noopener">${icon('external')}Abrir no OneDrive</a>` : ''}
    ${isAdmin ? html`<button class="btn" id="edit-audio">${icon('edit')}${e.audio_link ? 'Editar link' : 'Adicionar link'}</button>` : ''}
  </div>`;
}

// ------------------------------------------------------------------ Contestação
// A supervisão contesta (motivo + itens); a Qualidade aceita e ajusta a análise, ou recusa, com resposta
function contestBanners(e, ctx) {
  const list = (e.contests || []).filter((c) => c.status !== 'cancelada' || c.requested_by === ctx.store.user.id);
  if (!list.length) return '';
  const quality = ctx.can('admin', 'qualidade');
  return html`${list.slice(0, 3).map((c) => html`<div class="banner ${c.status === 'aberta' ? 'warn' : c.status === 'aceita' ? 'ok' : c.status === 'recusada' ? 'bad' : 'info'}">${icon('flag')}
    <div style="flex:1;min-width:0"><b>${CONTEST[c.status][0]}</b> · por ${c.requested_by_display || c.requested_by_name || 'supervisão'} em ${fmtDate(c.created_at, true)}
      <div class="t2" style="margin-top:4px">“${c.reason}”</div>
      ${c.criteria?.length ? html`<div class="row" style="gap:6px;margin-top:6px">${c.criteria.map((i) => html`<span class="chip outline">${i.code} · ${i.name}</span>`)}</div>` : ''}
      ${c.response ? html`<div style="margin-top:8px"><b>Resposta da Qualidade</b> (${c.responded_by_display || c.responded_by_name}, ${fmtDate(c.responded_at, true)}): ${c.response}</div>` : ''}
      ${c.status === 'aberta' && quality ? html`<div class="row" style="gap:8px;margin-top:10px"><button class="btn sm success" data-ct-answer="${c.id}" data-decision="aceita">${icon('check')}Aceitar</button><button class="btn sm danger" data-ct-answer="${c.id}" data-decision="recusada">${icon('x')}Recusar</button><span class="tiny muted">Ao aceitar, ajuste os itens na aba Análise.</span></div>` : ''}
      ${c.status === 'aberta' && c.requested_by === ctx.store.user.id ? html`<div style="margin-top:8px"><button class="btn sm ghost" data-ct-cancel="${c.id}">Cancelar contestação</button></div>` : ''}
    </div></div>`)}`;
}

function openContestForm(el, ctx) {
  modal({
    title: 'Contestar monitoria',
    wide: true,
    body: html`<p class="t2" style="margin-top:0">Explique o que não confere na análise. A Qualidade recebe o pedido, revisa e responde aqui no card.</p>
      <div class="field"><label for="ct-reason">Motivo *</label><textarea class="textarea" id="ct-reason" style="min-height:110px" maxlength="3000" placeholder="Ex.: o operador confirmou o CPF em 0:12, mas o item ficou como não conforme."></textarea></div>
      <div class="field"><span class="lbl">Itens contestados (opcional)</span>
        <div class="stack" style="gap:6px;max-height:240px;overflow:auto">${ev.items.map((i) => html`<label class="check small"><input type="checkbox" value="${i.criterion_id}"> <b>${i.code}</b> ${i.name} <span class="muted">· ${RESULT[i.final_result] || '—'}</span></label>`)}</div></div>`,
    foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="ct-ok">${icon('flag')}Enviar contestação</button>`,
    onMount: (m, close) => {
      $('#ct-ok', m).onclick = async (x) => {
        const btnEl = x.currentTarget;
        const reason = $('#ct-reason', m).value.trim();
        if (reason.length < 15) { toast('Explique o motivo (mínimo 15 caracteres).', 'err'); return; }
        busy(btnEl, true, 'Enviando');
        try {
          ev = await api.post(`/evaluations/${ev.id}/contests`, { reason, criteria: $$('input[type=checkbox]:checked', m).map((i) => Number(i.value)) });
          close(); toast('Contestação enviada para a Qualidade.'); ctx.refreshMeta(); draw(el, ctx);
        } catch (ex) { toast(ex.message, 'err'); busy(btnEl, false); }
      };
    },
  });
}

function answerContest(el, ctx, id, decision) {
  const accept = decision === 'aceita';
  modal({
    title: accept ? 'Aceitar contestação' : 'Recusar contestação',
    body: html`<p class="t2" style="margin-top:0">${accept ? 'A resposta vai para quem contestou. Lembre de ajustar os itens na aba Análise para a nota ser recalculada.' : 'Explique por que a análise se mantém. A resposta vai para quem contestou.'}</p>
      <div class="field"><label for="ct-resp">Resposta *</label><textarea class="textarea" id="ct-resp" style="min-height:100px" maxlength="3000"></textarea></div>`,
    foot: html`<button class="btn ghost" data-close>Voltar</button><button class="btn ${accept ? 'success' : 'danger'}" id="ct-send">${accept ? 'Aceitar' : 'Recusar'}</button>`,
    onMount: (m, close) => {
      $('#ct-send', m).onclick = async (x) => {
        const btnEl = x.currentTarget;
        const response = $('#ct-resp', m).value.trim();
        if (response.length < 10) { toast('Escreva a resposta (mínimo 10 caracteres).', 'err'); return; }
        busy(btnEl, true);
        try {
          ev = await api.put(`/contests/${id}`, { status: decision, response });
          close(); toast(accept ? 'Contestação aceita. Ajuste os itens na aba Análise.' : 'Contestação recusada.'); ctx.refreshMeta();
          if (accept) tab = 'analise';
          draw(el, ctx);
        } catch (ex) { toast(ex.message, 'err'); busy(btnEl, false); }
      };
    },
  });
}

// Dados que vieram do dashboard (tabulação, desfecho, aptidão, conduta, sigilo...)
const HL_ICON = { bad: 'alert', warn: 'alert', ok: 'checkCircle', info: 'info' };
function callDetails(e) {
  const d = e.details;
  if (!d || (!d.facts?.length && !d.highlights?.length)) return '';
  return html`<div class="mt">
    ${d.facts?.length ? html`<dl class="facts-grid">${d.facts.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>` : ''}
    ${d.highlights?.length ? html`<div class="mt">${d.highlights.map((h) => html`<div class="hl ${h.kind}">${icon(HL_ICON[h.kind] || 'info')}<div><b>${h.title}</b><div class="t2">${h.text}</div></div></div>`)}</div>` : ''}
    ${d.origem ? html`<p class="tiny muted" style="margin:10px 0 0">Origem: ${d.origem}${d.periodo ? ` · ${d.periodo}` : ''}</p>` : ''}
  </div>`;
}

function editSegment(el, ctx) {
  const segs = SEGMENTS_OF[ev.product] || [];
  modal({
    title: `Segmento · ${PRODUCT[ev.product]}`,
    body: html`<p class="t2" style="margin-top:0">Separa a monitoria nos painéis e relatórios (ex.: Clean Curto × Clean Longo, Público × Privado).</p>
      <div class="field"><label for="sg-v">Segmento</label><select class="select" id="sg-v"><option value="">Segmento a definir</option>${segs.map((s) => html`<option value="${s}" ${ev.segment === s ? 'selected' : ''}>${SEGMENT[s]}</option>`)}</select></div>`,
    foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="sg-ok">Salvar</button>`,
    onMount: (m, close) => {
      $('#sg-ok', m).onclick = async (x) => {
        const btnEl = x.currentTarget;
        busy(btnEl, true);
        try { ev = await api.patch(`/evaluations/${ev.id}`, { segment: $('#sg-v', m).value }); close(); toast('Segmento atualizado.'); ctx.refreshMeta(); draw(el, ctx); }
        catch (ex) { toast(ex.message, 'err'); busy(btnEl, false); }
      };
    },
  });
}

// ------------------------------------------------------------------ Análise
function drawAnalysis(body, el, ctx) {
  const e = ev;
  const editor = ctx.can('admin', 'qualidade');
  const ai = e.ai;
  const cur = (it) => (draft.has(it.criterion_id) ? draft.get(it.criterion_id).final_result : it.final_result);
  body.innerHTML = String(html`
    ${ai ? html`<div class="card card-pad mb" style="background:var(--grad-soft);border-color:rgba(124,108,255,.25)">
      <div class="row"><span class="ai-sug" style="padding:0;border:0;background:none;display:inline"><span class="ai-ic" style="display:inline-grid">${icon('sparkles')}</span></span>
        <b>${ai.engine === 'dashboard' ? 'Parecer da monitoria (dashboard)' : 'Parecer da análise automática'}</b><span class="chip ${ai.engine === 'claude' ? 'brand' : 'outline'}">${ai.engine === 'claude' ? `IA · ${e.ai_model || 'Claude'}` : ai.engine === 'dashboard' ? 'Leitura da transcrição completa' : 'Heurística local (sem IA configurada)'}</span>
        <span class="tiny muted">${e.ai_ran_at ? fmtRel(e.ai_ran_at) : ''}</span></div>
      <p style="margin:10px 0 6px">${ai.summary}</p>
      ${ai.engine === 'dashboard' && ai.feedback?.strengths ? html`<p class="small t2" style="margin:0 0 6px"><b>Ponto forte:</b> ${ai.feedback.strengths}</p>` : ''}
      ${ai.engine === 'dashboard' && ai.feedback?.improvements ? html`<p class="small t2" style="margin:0"><b>Feedback sugerido:</b> ${ai.feedback.improvements}</p>` : ''}
      ${ai.customer_profile ? html`<p class="small t2" style="margin:0 0 6px"><b>Cliente:</b> ${ai.customer_profile}</p>` : ''}
      ${ai.discrepancy_overview ? html`<p class="small t2" style="margin:0"><b>Divergências com o speech:</b> ${ai.discrepancy_overview}</p>` : ''}
      ${ai.applied?.length ? html`<div class="banner info mt" style="margin-bottom:0">${icon('info')}<div><b>${ai.applied.length} correção(ões) aplicadas automaticamente</b> (confiança alta): ${ai.applied.map((a) => `${a.codigo} ${a.de || '—'}→${a.para}`).join(' · ')}. Você pode revisar e alterar qualquer item abaixo.</div></div>` : ''}
      ${editor && e.items.some((i) => i.ai_result && i.ai_result !== i.final_result) ? html`<div class="row mt"><button class="btn sm primary" id="ai-apply-all">${icon('check')}Aplicar todas as sugestões pendentes da IA</button></div>` : ''}
    </div>` : ''}
    ${!editor ? html`<div class="banner info">${icon('info')}<div>Análise validada pela Qualidade. Ajustes de critério são feitos pelo time de Qualidade — se discordar de algum ponto, registre no feedback ou use “Reportar bug”.</div></div>` : ''}
    <div class="crit-list">${e.items.map((it) => critRow(it, cur(it), editor))}</div>
    <div id="save-bar"></div>`);

  const refreshBar = () => {
    const bar = $('#save-bar', body);
    const changes = [...draft.entries()].filter(([cid, d]) => { const it = e.items.find((i) => i.criterion_id === cid); return it && (d.final_result !== it.final_result || (d.adjust_reason || '') !== (it.adjust_reason || '')); });
    const preview = previewScore(e.items, cur);
    if (!editor) { bar.innerHTML = ''; return; }
    bar.innerHTML = String(html`<div class="sticky-bar">
      <div><div class="tiny muted">Nota com os ajustes</div><div class="row" style="gap:8px"><b style="font-size:22px;letter-spacing:-.03em" class="num">${fmtScore(preview)}</b>${preview != null && e.final_score != null && Math.abs(preview - e.final_score) >= 0.1 ? deltaTag(preview - e.final_score) : ''}</div></div>
      <div class="grow small t2">${changes.length ? html`<b>${changes.length}</b> alteração(ões) não salvas` : e.status === 'pendente' ? 'Confira os critérios e valide a análise antes do feedback.' : 'Análise revisada. Altere qualquer critério se necessário.'}</div>
      ${e.items.some((i) => i.adjusted) ? html`<button class="btn sm ghost" id="revert">${icon('undo')}Reverter para ${origLabel(e) === 'Speech' ? 'o speech' : 'a 1ª leitura'}</button>` : ''}
      ${changes.length ? html`<button class="btn ghost" id="discard">Descartar</button><button class="btn primary" id="save">${icon('check')}Salvar ajustes</button>`
        : e.status === 'pendente' ? html`<button class="btn primary" id="validate">${icon('check')}Validar análise</button>` : ''}
    </div>`);
    $('#discard', bar)?.addEventListener('click', () => { draft.clear(); drawAnalysis(body, el, ctx); });
    $('#save', bar)?.addEventListener('click', (x) => save(x.currentTarget, el, ctx, changes));
    $('#validate', bar)?.addEventListener('click', (x) => save(x.currentTarget, el, ctx, []));
    $('#revert', bar)?.addEventListener('click', async () => {
      if (!(await confirmDialog('Reverter ajustes', 'Todos os critérios voltam ao resultado original do speech. Os motivos de ajuste registrados serão descartados.', { ok: 'Reverter', danger: true }))) return;
      ev = await api.post(`/evaluations/${e.id}/revert`); draft.clear(); toast('Ajustes revertidos.'); draw(el, ctx);
    });
  };

  $$('[data-crit]', body).forEach((row) => {
    const cid = Number(row.dataset.crit);
    const it = e.items.find((i) => i.criterion_id === cid);
    const setVal = (v) => {
      const d = draft.get(cid) || { final_result: it.final_result, adjust_reason: it.adjust_reason || '' };
      d.final_result = v; draft.set(cid, d);
      $$('.picker button', row).forEach((b) => b.classList.toggle('on', b.dataset.v === v));
      const needs = v !== it.speech_result;
      $('.reason', row).hidden = !needs;
      row.classList.toggle('changed', v !== it.final_result);
      if (needs) setTimeout(() => $('.reason input', row).focus(), 30);
      refreshBar();
    };
    $$('.picker button', row).forEach((b) => b.addEventListener('click', () => setVal(b.dataset.v)));
    $('[data-ai-apply]', row)?.addEventListener('click', () => {
      setVal(it.ai_result);
      const inp = $('.reason input', row);
      if (inp && !inp.value) { inp.value = `IA: ${it.ai_reason || 'conforme transcrição'}`; const d = draft.get(cid); d.adjust_reason = inp.value; }
      refreshBar();
    });
    $('.reason input', row)?.addEventListener('input', (x) => {
      const d = draft.get(cid) || { final_result: it.final_result, adjust_reason: it.adjust_reason || '' };
      d.adjust_reason = x.target.value; draft.set(cid, d); refreshBar();
    });
  });
  $('#ai-apply-all', body)?.addEventListener('click', async (x) => {
    const btnEl = x.currentTarget;
    busy(btnEl, true);
    try { ev = await api.post(`/evaluations/${e.id}/ai/apply`, {}); draft.clear(); toast('Sugestões aplicadas.'); draw(el, ctx); }
    catch (ex) { toast(ex.message, 'err'); busy(btnEl, false); }
  });
  refreshBar();
}

function critRow(it, value, editor) {
  const changed = value !== it.final_result;
  const needsReason = value !== it.speech_result;
  const reason = draft.get(it.criterion_id)?.adjust_reason ?? it.adjust_reason ?? '';
  const aiDiff = it.ai_result && it.ai_result !== value;
  const conf = it.ai_confidence != null ? Math.round(it.ai_confidence * 5) : 0;
  return html`<div class="crit ${changed ? 'changed' : ''} ${it.adjusted ? 'adjusted' : ''}" data-crit="${it.criterion_id}">
    <div class="crit-top">
      <div>
        <div class="crit-name"><span class="code">${it.code}</span><b>${it.name}</b>${it.critical ? html`<span class="chip bad">${icon('alert')}crítico</span>` : ''}${it.stage ? html`<span class="chip outline">${it.stage}</span>` : ''}<span class="tiny muted">${Number(it.weight) > 0 ? `peso ${String(it.weight).replace('.', ',')}` : 'fora da nota'}</span></div>
        <div class="crit-desc">${it.description || ''}</div>
      </div>
      <div class="crit-cols">
        <div class="col"><span class="lbl">${origLabel(ev)}</span>${resChip(it.speech_result)}</div>
        ${it.ai_result ? html`<div class="col"><span class="lbl">IA</span>${resChip(it.ai_result)}</div>` : ''}
        <div class="col"><span class="lbl">Resultado final</span>
          <div class="picker" role="radiogroup" aria-label="Resultado de ${it.name}" aria-disabled="${!editor}">
            ${['C', 'P', 'NC', 'NA'].map((v) => html`<button type="button" data-v="${v}" class="${v} ${value === v ? 'on' : ''}" title="${RESULT[v]}" aria-pressed="${value === v}">${v === 'NA' ? 'N/A' : v}</button>`)}
          </div></div>
      </div>
    </div>
    <div class="crit-extra">
      ${it.speech_note ? html`<div class="adj-note">${icon('headset')}<span><b>${ev.source === 'dash_sem_garantia' ? 'Na ligação' : 'Speech'}:</b> ${it.speech_note}</span></div>` : ''}
      ${it.ai_result && it.ai_result === value && it.ai_result === it.speech_result ? html`<div class="adj-note">${icon('sparkles')}<span><b>IA confirma.</b> ${it.ai_reason || ''}</span></div>` : ''}
      ${it.ai_result && !(it.ai_result === value && it.ai_result === it.speech_result) ? html`<div class="ai-sug"><span class="ai-ic">${icon('sparkles')}</span>
        <div><b>${it.ai_result === it.speech_result ? 'IA confirma o speech' : `IA sugere ${RESULT[it.ai_result]}`}</b> <span class="conf" title="Confiança ${Math.round((it.ai_confidence || 0) * 100)}%">${[1, 2, 3, 4, 5].map((k) => html`<i class="${k <= conf ? 'on' : ''}"></i>`)}</span>
          <div class="t2">${it.ai_reason || ''}</div>${it.ai_evidence ? html`<q>${it.ai_evidence}</q>` : ''}</div>
        ${editor && aiDiff ? html`<button class="btn sm" data-ai-apply>Usar sugestão</button>` : ''}</div>` : ''}
      ${it.adjusted && !changed ? html`<div class="adj-note">${icon('edit')}<span>Ajustado ${it.adjust_source === 'ia' ? 'automaticamente pela IA' : it.adjust_source === 'dashboard' ? 'na análise do dashboard' : `por ${it.adjusted_by_display || it.adjusted_by_name || 'analista'}`} ${it.adjusted_at ? fmtRel(it.adjusted_at) : ''} · de <b>${RESULT[it.speech_result] || '—'}</b> para <b>${RESULT[it.final_result]}</b>${it.adjust_reason ? html` — “${it.adjust_reason}”` : ''}</span></div>` : ''}
      <div class="reason" ${needsReason && editor ? '' : 'hidden'}><input class="input sm" placeholder="Motivo do ajuste (obrigatório) — ex.: speech não reconheceu a confirmação de CPF" value="${reason}" maxlength="500"></div>
    </div>
  </div>`;
}

async function save(btn, el, ctx, changes) {
  const items = changes.map(([cid, d]) => ({ criterion_id: cid, final_result: d.final_result, adjust_reason: d.adjust_reason }));
  const missing = items.find((i) => { const it = ev.items.find((x) => x.criterion_id === i.criterion_id); return i.final_result !== it.speech_result && !String(i.adjust_reason || '').trim(); });
  if (missing) { toast('Informe o motivo de cada ajuste em relação ao speech.', 'err'); $(`[data-crit="${missing.criterion_id}"] .reason input`)?.focus(); return; }
  busy(btn, true, 'Salvando');
  try {
    ev = await api.put(`/evaluations/${ev.id}/items`, { items });
    draft.clear();
    toast(items.length ? 'Ajustes salvos. A nota foi recalculada.' : 'Análise validada.');
    ctx.refreshMeta();
    draw(el, ctx);
  } catch (ex) { toast(ex.message, 'err'); busy(btn, false); }
}

// ------------------------------------------------------------------ Transcrição
function parseLines(text) {
  return String(text || '').split(/\n/).filter((l) => l.trim()).map((l) => {
    const m = l.match(/^\s*\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*(.*)$/);
    let ts = '', rest = l;
    if (m) { ts = m[1]; rest = m[2]; }
    const sp = rest.match(/^([^:]{2,30}):\s*(.*)$/);
    return { ts, speaker: sp ? sp[1].trim() : '', text: sp ? sp[2] : rest };
  });
}

function drawTranscript(body, el, ctx) {
  const e = ev;
  const editor = ctx.can('admin', 'qualidade');
  if (!e.transcript) {
    body.innerHTML = String(html`<div class="card card-pad">${emptyState('file', 'Nenhuma transcrição anexada', ctx.can('admin') ? 'Anexe a transcrição (.txt, .docx, .vtt, .srt ou .json) para a IA revisar a análise do speech e corrigir divergências.' : 'Anexe a transcrição (.txt, .docx, .vtt, .srt ou .json) para consultar a conversa ao revisar a análise.',
      editor ? html`<button class="btn primary" id="t-attach">${icon('upload')}Anexar transcrição</button>` : '')}</div>`);
    $('#t-attach', body)?.addEventListener('click', () => attachTranscript(el, ctx));
    return;
  }
  const lines = parseLines(e.transcript);
  const evid = e.items.map((i) => i.ai_evidence).filter(Boolean).map((s) => s.toLowerCase().replace(/^.*?:\s*/, '').slice(0, 60));
  const isOp = (s) => /operador|atendente|agente/i.test(s);
  body.innerHTML = String(html`<div class="grid g-3">
    <div class="card span-2">
      <div class="card-head"><div><h3>Transcrição</h3><div class="sub">${e.transcript_name || 'arquivo'} · ${lines.length} falas · trechos usados como evidência pela IA ficam destacados</div></div><div class="grow"></div>
        <input class="input sm" id="t-find" placeholder="Buscar na transcrição…" style="max-width:220px"></div>
      <div class="card-body"><div class="transcript" id="t-lines">${lines.map((l) => {
        const low = l.text.toLowerCase();
        const hit = evid.some((x) => x.length > 8 && low.includes(x.slice(0, 40)));
        return html`<div class="ln ${hit ? 'ev' : ''}"><span class="ts">${l.ts}</span><div>${l.speaker ? html`<span class="sp ${isOp(l.speaker) ? 'op' : 'cl'}">${l.speaker}</span>` : ''}<span class="tx">${l.text}</span></div></div>`;
      })}</div></div>
    </div>
    <div class="stack">
      ${!ctx.can('admin') ? (editor ? html`<div class="card card-pad"><button class="btn" id="t-replace">${icon('upload')}Substituir arquivo</button></div>` : '') : html`<div class="card card-pad">
        <h3 style="margin:0 0 6px;font-size:15px">Análise automática</h3>
        <p class="small t2" style="margin:0 0 12px">A IA lê a transcrição, avalia cada critério com evidências e corrige o que o speech interpretou de forma diferente. Itens ajustados manualmente por analistas nunca são sobrescritos.</p>
        ${e.ai_status === 'concluida' ? html`<div class="banner ok" style="margin-bottom:12px">${icon('checkCircle')}<div>Concluída ${fmtRel(e.ai_ran_at)} · ${e.items.filter((i) => i.ai_result && i.ai_result !== i.speech_result).length} divergência(s) com o speech.</div></div>` : ''}
        ${e.ai_status === 'erro' ? html`<div class="banner warn" style="margin-bottom:12px">${icon('alert')}<div>A última tentativa falhou. Tente novamente.</div></div>` : ''}
        <div class="stack"><button class="btn primary" id="t-ai">${icon('sparkles')}${e.ai_status === 'concluida' ? 'Reanalisar' : 'Analisar agora'}</button><button class="btn" id="t-replace">${icon('upload')}Substituir arquivo</button></div>
      </div>`}
      ${e.ai?.feedback ? html`<div class="card card-pad"><h3 style="margin:0 0 10px;font-size:15px">Sugestão de feedback</h3>
        <dl class="small" style="margin:0;display:grid;gap:8px">
          ${e.ai.feedback.strengths ? html`<div><dt class="muted strong">Pontos fortes</dt><dd style="margin:0">${e.ai.feedback.strengths}</dd></div>` : ''}
          ${e.ai.feedback.improvements ? html`<div><dt class="muted strong">Pontos de melhoria</dt><dd style="margin:0">${e.ai.feedback.improvements}</dd></div>` : ''}
          ${e.ai.feedback.action_plan ? html`<div><dt class="muted strong">Plano de ação</dt><dd style="margin:0">${e.ai.feedback.action_plan}</dd></div>` : ''}
        </dl><button class="btn sm mt" data-goto2="feedback">${icon('msgCheck')}Usar no feedback</button></div>` : ''}
    </div></div>`);
  $('#t-ai', body)?.addEventListener('click', (x) => runAI(el, ctx, x.currentTarget));
  $('#t-replace', body)?.addEventListener('click', () => attachTranscript(el, ctx));
  $('[data-goto2]', body)?.addEventListener('click', () => { tab = 'feedback'; sessionStorage.setItem('px_fb_prefill', 'ai'); draw(el, ctx); });
  $('#t-find', body).addEventListener('input', (x) => {
    const q = x.target.value.trim().toLowerCase();
    $$('#t-lines .ln', body).forEach((ln) => {
      const tx = $('.tx', ln); const t = tx.textContent;
      if (!q) { tx.innerHTML = esc(t); ln.hidden = false; return; }
      const i = t.toLowerCase().indexOf(q);
      ln.hidden = i < 0;
      tx.innerHTML = i < 0 ? esc(t) : `${esc(t.slice(0, i))}<mark>${esc(t.slice(i, i + q.length))}</mark>${esc(t.slice(i + q.length))}`;
    });
  });
}

function attachTranscript(el, ctx) {
  let file = null;
  modal({
    title: 'Anexar transcrição',
    wide: true,
    body: html`<label class="drop" id="tr-drop"><input type="file" id="tr-file" accept=".txt,.docx,.vtt,.srt,.json,.md" hidden>
        <div class="ic">${icon('upload')}</div><h4>Arraste o arquivo ou clique para escolher</h4><p class="muted small" style="margin:0" id="tr-name">.txt, .docx, .vtt, .srt ou .json</p></label>
      <div class="row mt mb" style="gap:8px"><hr class="sep" style="flex:1;margin:0"><span class="tiny muted">ou cole o texto</span><hr class="sep" style="flex:1;margin:0"></div>
      <textarea class="textarea" id="tr-text" style="min-height:180px" placeholder="[00:00] Operador: Bom dia...\n[00:05] Cliente: ..."></textarea>
      ${ctx.can('admin') ? html`<label class="check mt"><input type="checkbox" id="tr-run" checked> Executar a análise automática em seguida</label>` : ''}`,
    foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="tr-ok">${icon('check')}Anexar</button>`,
    onMount: (m, close) => {
      const drop = $('#tr-drop', m);
      const setFile = (f) => { file = f; $('#tr-name', m).textContent = f ? `${f.name} · ${(f.size / 1024).toFixed(0)} KB` : ''; };
      $('#tr-file', m).onchange = (x) => setFile(x.target.files[0]);
      ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (x) => { x.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (x) => { x.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', (x) => setFile(x.dataTransfer.files[0]));
      $('#tr-ok', m).onclick = async (x) => {
        const btnEl = x.currentTarget;
        const text = $('#tr-text', m).value;
        if (!file && !text.trim()) { toast('Escolha um arquivo ou cole o texto.', 'err'); return; }
        busy(btnEl, true, 'Enviando');
        try {
          const payload = file ? await readTranscriptFile(file) : { name: 'texto-colado.txt', text };
          ev = await api.post(`/evaluations/${ev.id}/transcript`, payload);
          close(); toast('Transcrição anexada.');
          tab = 'transcricao';
          if ($('#tr-run', m)?.checked) { draw(el, ctx); await runAI(el, ctx, $('#t-ai')); } else draw(el, ctx);
        } catch (ex) { toast(ex.message, 'err'); busy(btnEl, false); }
      };
    },
  });
}

// Áudio da ligação → Azure Speech → transcrição com operador e cliente separados → (opcional) análise com IA
function transcribeAudioFile(el, ctx) {
  const ready = ctx.store.meta.ai.speech;
  let file = null;
  modal({
    title: 'Transcrever o áudio da ligação',
    body: html`${ready ? '' : html`<div class="banner warn">${icon('alert')}<div>O Azure Speech ainda não está configurado. <a href="#/configuracoes">Cadastre a chave e a região em Configurações</a>.</div></div>`}
      <p class="t2" style="margin-top:0">Baixe o áudio da pasta da quinzena${ev.audio_file ? html` (arquivo <span class="file-name">${ev.audio_file}</span>)` : ''} e envie aqui. A transcrição separa operador e cliente e substitui a transcrição atual.</p>
      <label class="drop" id="au-drop"><input type="file" id="au-file" accept="audio/*,.wav,.mp3,.ogg,.opus,.m4a,.flac,.wma,.amr,.webm" hidden>
        <div class="ic">${icon('audio')}</div><h4>Arraste o áudio ou clique</h4><p class="muted small" style="margin:0" id="au-name">.wav, .mp3, .ogg, .m4a… até 100 MB</p></label>
      <label class="check mt"><input type="checkbox" id="au-run" checked> Analisar com IA em seguida</label>`,
    foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="au-ok" ${ready ? '' : 'disabled'}>${icon('audio')}Transcrever</button>`,
    onMount: (m, close) => {
      const drop = $('#au-drop', m);
      const setFile = (f) => { file = f; $('#au-name', m).textContent = f ? `${f.name} · ${(f.size / 1048576).toFixed(1)} MB` : ''; };
      $('#au-file', m).onchange = (x) => setFile(x.target.files[0]);
      ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (x) => { x.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (x) => { x.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', (x) => setFile(x.dataTransfer.files[0]));
      $('#au-ok', m).onclick = async (x) => {
        const btnEl = x.currentTarget;
        if (!file) { toast('Escolha o arquivo de áudio.', 'err'); return; }
        if (file.size > 100 * 1048576) { toast('Arquivo maior que 100 MB.', 'err'); return; }
        const analyze = $('#au-run', m).checked;
        busy(btnEl, true, analyze ? 'Transcrevendo e analisando…' : 'Transcrevendo…');
        try {
          ev = await api.upload(`/evaluations/${ev.id}/audio-transcribe${qs({ name: file.name, analyze: analyze ? 1 : '' })}`, file);
          close(); draft.clear(); toast(analyze ? 'Áudio transcrito e analisado.' : 'Áudio transcrito.');
          tab = analyze ? 'analise' : 'transcricao'; draw(el, ctx);
        } catch (ex) { toast(ex.message, 'err', 7000); busy(btnEl, false); }
      };
    },
  });
}

async function runAI(el, ctx, btn) {
  const aiOn = ctx.store.meta.ai.configured;
  busy(btn, true, aiOn ? 'Analisando com IA…' : 'Analisando…');
  const t0 = Date.now();
  try {
    ev = await api.post(`/evaluations/${ev.id}/analyze`);
    draft.clear();
    const div = ev.items.filter((i) => i.ai_result && i.ai_result !== i.speech_result).length;
    toast(`Análise concluída em ${Math.round((Date.now() - t0) / 1000)}s · ${div} divergência(s) com o speech.`);
    tab = 'analise';
    draw(el, ctx);
  } catch (ex) { toast(ex.message, 'err', 6000); busy(btn, false); ev = await api.get(`/evaluations/${ev.id}`); }
}

function editAudio(el, ctx) {
  modal({
    title: 'Link do áudio deste atendimento',
    body: html`<p class="t2" style="margin-top:0">Cole o link do OneDrive/SharePoint (arquivo ou pasta). Quem abrir o card será direcionado para ele.</p>
      <div class="field"><label for="au-url">Link</label><input class="input" id="au-url" type="url" value="${ev.audio_url || ''}" placeholder="https://..."></div>
      ${ev.cycle_audio_url ? html`<p class="small muted">Sem link próprio, o card usa a pasta da quinzena: <br><span style="word-break:break-all">${ev.cycle_audio_url}</span></p>` : ''}`,
    foot: html`${ev.audio_url ? html`<button class="btn danger" id="au-clear" style="margin-right:auto">Remover link próprio</button>` : ''}<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="au-ok">Salvar</button>`,
    onMount: (m, close) => {
      const send = async (url, b) => {
        busy(b, true);
        try { ev = await api.put(`/evaluations/${ev.id}/audio`, { audio_url: url }); close(); toast('Link do áudio atualizado.'); draw(el, ctx); }
        catch (ex) { toast(ex.message, 'err'); busy(b, false); }
      };
      $('#au-ok', m).onclick = (x) => send($('#au-url', m).value.trim(), x.currentTarget);
      $('#au-clear', m)?.addEventListener('click', (x) => send('', x.currentTarget));
    },
  });
}

// ------------------------------------------------------------------ Feedback
function suggestion(e) {
  const weak = e.items.filter((i) => i.final_result === 'NC' || i.final_result === 'P');
  const strong = e.items.filter((i) => i.final_result === 'C');
  if (sessionStorage.getItem('px_fb_prefill') === 'ai' && e.ai?.feedback) {
    sessionStorage.removeItem('px_fb_prefill');
  }
  const f = e.ai?.feedback;
  return {
    strengths: f?.strengths || strong.slice(0, 4).map((i) => i.name).join(', '),
    improvements: f?.improvements || weak.map((i) => `${i.name} (${i.final_result === 'NC' ? 'não conforme' : 'parcial'})`).join('; '),
    action_plan: f?.action_plan || (weak.length ? 'Ouvir o trecho da ligação junto com o operador, reforçar o roteiro dos pontos citados e reavaliar na próxima quinzena.' : 'Manter o padrão de atendimento e compartilhar a ligação como boa prática.'),
    content: weak.length
      ? `Feedback da monitoria de ${fmtDate(e.call_date)} (${PRODUCT[e.product] || e.product}, nota ${fmtScore(e.final_score)}). Alinhado com o operador: ${weak.map((i) => i.name).join(', ')}.`
      : `Feedback positivo da monitoria de ${fmtDate(e.call_date)} (nota ${fmtScore(e.final_score)}). Operador reconhecido pela aderência ao roteiro.`,
  };
}

function localDateTime(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function drawFeedback(body, el, ctx) {
  const e = ev;
  const me = ctx.store.user;
  // Supervisão acompanha os feedbacks; quem aplica é a Qualidade
  if (!ctx.can('admin', 'qualidade')) {
    body.innerHTML = String(html`<div class="card card-pad">${e.feedbacks.length
      ? html`<h3 style="margin:0 0 10px;font-size:15px">Feedbacks registrados</h3><div class="stack">${e.feedbacks.map((x) => fbCard(x, me))}</div>`
      : emptyState('msgClock', 'Feedback ainda não aplicado', 'A Qualidade registra aqui o feedback passado ao operador. Se discordar da análise, use “Contestar monitoria”.')}</div>`);
    return;
  }
  let editing = null;
  const paint = () => {
    const f = editing;
    const autofill = sessionStorage.getItem('px_fb_prefill') === 'ai';
    const pre = !f && autofill ? suggestion(e) : null;
    if (autofill) sessionStorage.removeItem('px_fb_prefill');
    body.innerHTML = String(html`<div class="grid g-3">
      <div class="card span-2"><div class="card-head"><div><h3>${f ? 'Editar feedback' : 'Registrar feedback aplicado'}</h3><div class="sub">Descreva o que foi passado ao operador. Ao salvar, o card fica verde para toda a equipe.</div></div></div>
        <div class="card-body">
          ${e.status === 'pendente' ? html`<div class="banner warn">${icon('alert')}<div>A análise ainda não foi validada pela Qualidade. Recomendamos revisar os critérios antes de aplicar o feedback, para não basear a conversa em uma leitura incorreta do speech.</div></div>` : ''}
          <form id="fb-form">
            <div class="grid g-3">
              <div class="field"><label for="fb-at">Data e hora do feedback</label><input class="input" id="fb-at" name="applied_at" type="datetime-local" required value="${f ? localDateTime(parseDate(f.applied_at)) : localDateTime()}"></div>
              <div class="field"><label for="fb-mod">Modalidade</label><select class="select" id="fb-mod" name="modality">${['Presencial', 'Remoto (Teams)', 'Por telefone', 'Chat corporativo'].map((x) => html`<option ${f?.modality === x ? 'selected' : ''}>${x}</option>`)}</select></div>
              <div class="field"><label for="fb-fu">Reavaliar em</label><input class="input" id="fb-fu" name="followup_date" type="date" value="${f?.followup_date || ''}"></div>
            </div>
            <div class="field"><div class="row between"><label for="fb-content">O que foi passado ao operador *</label><button type="button" class="btn sm ghost" id="fb-sug">${icon('sparkles')}Preencher com sugestão</button></div>
              <textarea class="textarea" id="fb-content" name="content" required minlength="10" style="min-height:120px" placeholder="Ex.: Ouvimos juntos o trecho da proposta; reforcei a obrigatoriedade de informar CET e valor total…">${f?.content || pre?.content || ''}</textarea></div>
            <div class="grid g-2">
              <div class="field"><label for="fb-str">Pontos fortes reconhecidos</label><textarea class="textarea" id="fb-str" name="strengths" style="min-height:76px">${f?.strengths || pre?.strengths || ''}</textarea></div>
              <div class="field"><label for="fb-imp">Pontos de melhoria</label><textarea class="textarea" id="fb-imp" name="improvements" style="min-height:76px">${f?.improvements || pre?.improvements || ''}</textarea></div>
            </div>
            <div class="field"><label for="fb-plan">Plano de ação combinado</label><textarea class="textarea" id="fb-plan" name="action_plan" style="min-height:70px">${f?.action_plan || pre?.action_plan || ''}</textarea></div>
            <label class="check"><input type="checkbox" name="operator_ack" ${f ? (f.operator_ack ? 'checked' : '') : 'checked'}> Operador ciente do feedback</label>
            <div class="row mt">
              ${f ? html`<button type="button" class="btn ghost" id="fb-cancel">Cancelar edição</button>` : ''}
              <div style="flex:1"></div>
              <button class="btn success lg" id="fb-save">${icon('checkCircle')}${f ? 'Salvar alterações' : 'Salvar feedback aplicado'}</button>
            </div>
          </form>
        </div></div>
      <div class="stack">
        <div class="card card-pad"><h3 style="margin:0 0 10px;font-size:15px">Pontos para conversar</h3>
          ${e.items.filter((i) => i.final_result === 'NC' || i.final_result === 'P').length
            ? html`<div class="stack">${e.items.filter((i) => i.final_result === 'NC' || i.final_result === 'P').map((i) => html`<div class="row" style="gap:8px;flex-wrap:nowrap;align-items:flex-start">${resChip(i.final_result)}<div class="small"><b>${i.name}</b>${i.adjusted ? html` <span class="chip brand" title="Resultado ajustado pela Qualidade">ajustado</span>` : ''}<div class="muted">${i.ai_evidence ? `“${i.ai_evidence}”` : i.description || ''}</div></div></div>`)}</div>`
            : html`<p class="small t2" style="margin:0">Nenhum ponto de melhoria — ótimo momento para um feedback de reconhecimento.</p>`}
        </div>
        ${e.feedbacks.length ? html`<div class="card card-pad"><h3 style="margin:0 0 10px;font-size:15px">Feedbacks registrados</h3><div class="stack">${e.feedbacks.map((x) => fbCard(x, me))}</div></div>` : ''}
      </div></div>`);
    $('#fb-sug', body).onclick = () => {
      const s = suggestion(e);
      const fm = $('#fb-form', body);
      if (!fm.content.value.trim()) fm.content.value = s.content;
      if (!fm.strengths.value.trim()) fm.strengths.value = s.strengths;
      if (!fm.improvements.value.trim()) fm.improvements.value = s.improvements;
      if (!fm.action_plan.value.trim()) fm.action_plan.value = s.action_plan;
      toast('Campos vazios preenchidos com a sugestão. Revise antes de salvar.');
    };
    $('#fb-cancel', body)?.addEventListener('click', () => { editing = null; paint(); });
    $$('[data-fb-edit]', body).forEach((b) => b.addEventListener('click', () => { editing = e.feedbacks.find((x) => x.id === Number(b.dataset.fbEdit)); paint(); body.scrollIntoView({ behavior: 'smooth' }); }));
    $$('[data-fb-del]', body).forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog('Remover feedback', 'O registro será removido. Se não houver outro feedback, o card volta a ficar pendente.', { ok: 'Remover', danger: true }))) return;
      ev = await api.del(`/evaluations/${e.id}/feedback/${b.dataset.fbDel}`); toast('Feedback removido.'); ctx.refreshMeta(); draw(el, ctx);
    }));
    $('#fb-form', body).addEventListener('submit', async (x) => {
      x.preventDefault();
      const fm = x.target;
      const data = { applied_at: new Date(fm.applied_at.value).toISOString(), modality: fm.modality.value, followup_date: fm.followup_date.value, content: fm.content.value, strengths: fm.strengths.value, improvements: fm.improvements.value, action_plan: fm.action_plan.value, operator_ack: fm.operator_ack.checked };
      busy($('#fb-save', body), true, 'Salvando');
      try {
        ev = f ? await api.put(`/evaluations/${e.id}/feedback/${f.id}`, data) : await api.post(`/evaluations/${e.id}/feedback`, data);
        toast(f ? 'Feedback atualizado.' : `Feedback aplicado a ${e.operator_name}! O card agora está verde.`);
        ctx.refreshMeta();
        draw(el, ctx);
      } catch (ex) { toast(ex.message, 'err'); busy($('#fb-save', body), false); }
    });
  };
  paint();
}

function fbCard(f, me) {
  const mine = me.role === 'admin' || f.applied_by === me.id;
  return html`<div class="fb-card">
    <div class="fb-h">${avatar(f.applied_by_display || f.applied_by_name || '?', 'sm')}<div class="grow"><b class="small">${f.applied_by_display || f.applied_by_name}</b> <span class="tiny muted">${ROLE[f.applied_by_role] || ''}</span><div class="tiny muted">${fmtDate(f.applied_at, true)}${f.modality ? ` · ${f.modality}` : ''}</div></div>
      ${f.operator_ack ? html`<span class="chip ok">${icon('check')}ciente</span>` : ''}
      ${mine ? html`<button class="btn-icon" data-fb-edit="${f.id}" aria-label="Editar">${icon('edit')}</button><button class="btn-icon" data-fb-del="${f.id}" aria-label="Remover">${icon('trash')}</button>` : ''}</div>
    <p class="small">${f.content}</p>
    ${f.improvements || f.action_plan ? html`<dl>${f.strengths ? html`<dt>Pontos fortes</dt><dd>${f.strengths}</dd>` : ''}${f.improvements ? html`<dt>Melhorias</dt><dd>${f.improvements}</dd>` : ''}${f.action_plan ? html`<dt>Plano de ação</dt><dd>${f.action_plan}</dd>` : ''}${f.followup_date ? html`<dt>Reavaliar em</dt><dd>${fmtDate(f.followup_date)}</dd>` : ''}</dl>` : ''}
  </div>`;
}

// ------------------------------------------------------------------ Histórico
function drawHistory(body) {
  const h = ev.history;
  if (!h.length) { body.innerHTML = String(emptyState('refresh', 'Sem histórico', 'As alterações feitas neste atendimento aparecerão aqui.')); return; }
  body.innerHTML = String(html`<div class="card card-pad"><div class="timeline">${h.map((x) => {
    const d = x.detail || {};
    const items = d.alteracoes || d.correcoes_aplicadas || [];
    return html`<div class="tl-item ${x.action === 'feedback_aplicado' ? 'ok' : ''}">
      <div class="what">${ACTIONS[x.action] || x.action}</div>
      <div class="when">${x.user_display || x.user_name || 'Sistema'} · ${fmtDate(x.created_at, true)}${d.motor ? ` · motor: ${d.motor === 'claude' ? 'IA' : 'heurística'}` : ''}${d.nota_final != null ? ` · nota ${fmtScore(d.nota_final)}` : ''}</div>
      ${items.length ? html`<ul>${items.map((a) => html`<li><b>${a.criterio || a.codigo}</b>: ${RESULT[a.de] || a.de || '—'} → ${RESULT[a.para] || a.para}${a.motivo ? ` — “${a.motivo}”` : ''}</li>`)}</ul>` : ''}
      ${x.action === 'link_audio_alterado' ? html`<ul><li style="word-break:break-all">${d.para || 'link removido'}${d.em_lote ? ' (em lote)' : ''}</li></ul>` : ''}
      ${d.erro ? html`<ul><li>${d.erro}</li></ul>` : ''}
    </div>`;
  })}</div></div>`);
  void raw; void userName;
}

// Evita que a atualização em tempo real descarte ajustes ou um feedback em edição
export function hasUnsavedChanges() {
  if (draft.size) return true;
  const fb = document.querySelector('#fb-form');
  return !!(fb && [...fb.querySelectorAll('textarea')].some((t) => t.value.trim() && t.value !== t.defaultValue));
}

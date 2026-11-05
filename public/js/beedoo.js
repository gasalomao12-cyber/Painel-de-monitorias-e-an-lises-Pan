// Formalizar no Beedoo: monta a mensagem pelo modelo, a pessoa ajusta na aba "Mensagem", confere tudo na
// aba "Revisão" e confirma. O agente PX Beedoo (no computador dela) envia pelo chat do Beedoo.
import { api, qs } from './api.js';
import { html, icon, $, $$, toast, modal, busy, fmtDate, avatar } from './ui.js';
import { attachEmoji } from './emoji.js';

export const BEEDOO_URL = 'https://paschoalotto.beedoo.io';
const KIND = { feedback: 'Feedback aplicado', monitoria: 'Resultado da monitoria', acao: 'Ação registrada' };
export const STATUS = {
  pendente: ['Na fila', 'warn', 'msgClock'], enviando: ['Enviando', 'brand', 'refresh'], enviado: ['Enviado', 'ok', 'checkCircle'],
  erro: ['Erro', 'bad', 'alert'], cancelado: ['Cancelado', 'outline', 'x'], manual: ['Enviado à mão', 'info', 'copy'],
};
// Mesmo preenchimento do servidor: {campo} vira o valor; linha com todos os campos vazios some
export function renderTpl(tpl, vals) {
  const lines = String(tpl).split('\n').flatMap((line) => {
    const keys = [...line.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
    if (keys.length && keys.every((k) => !String(vals[k] ?? '').trim())) return [];
    return [line.replace(/\{([a-z_]+)\}/g, (_, k) => String(vals[k] ?? ''))];
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
// A mensagem editada vira modelo: os dados desta ligação/operador voltam a ser {campos}
function derive(text, v) {
  let t = String(text);
  // Palavras curtas e comuns só viram campo no lugar onde aparecem no modelo
  if (v.carteira) t = t.split(`Qualidade ${v.carteira}`).join('Qualidade {carteira}');
  const SKIP = new Set(['modalidade', 'carteira']);
  const entries = Object.entries(v).filter(([k, x]) => !SKIP.has(k) && String(x ?? '').trim().length >= 3).map(([k, x]) => [k, String(x)]).sort((a, b) => b[1].length - a[1].length);
  for (const [k, x] of entries) t = t.split(x).join(`{${k}}`);
  return t;
}
// A mensagem editada vira modelo: os dados deste envio voltam a ser {campos}. As linhas do modelo atual
// que não apareceram porque estavam vazias neste envio (ex.: plano de ação) voltam no mesmo lugar.
export function toTemplate(message, vals, current = '') {
  const v = vals || {};
  const out = derive(message, v).split('\n');
  const tl = String(current).split('\n');
  const empty = (line) => { const ks = [...line.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]); return ks.length && ks.every((k) => !String(v[k] ?? '').trim()); };
  let lastKept = -1;
  const back = [];
  tl.forEach((line, i) => {
    if (!empty(line)) { lastKept = i; return; }
    if (out.includes(line)) return;
    const prev = lastKept >= 0 ? derive(tl[lastKept].replace(/\{([a-z_]+)\}/g, (_, k) => String(v[k] ?? '')), v) : null;
    let at = prev == null ? -1 : out.indexOf(prev);
    // linhas seguidas que estavam vazias entram uma depois da outra
    const chain = back.length && back[back.length - 1].i === i - 1 ? back[back.length - 1].at + 1 : -1;
    if (chain >= 0) at = chain - 1;
    if (at < 0) return;
    out.splice(at + 1, 0, line);
    back.push({ i, at: at + 1 });
  });
  return out.join('\n');
}
const SCOPE = { pessoal: 'seu modelo', geral: 'modelo geral', padrao: 'modelo padrão' };
export const statusChip = (s) => { const [l, c, ic] = STATUS[s] || [s, '', 'info']; return html`<span class="chip ${c}">${icon(ic)}${l}</span>`; };

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  }
}

// params: { kind:'feedback', batch_id | feedback_id } · { kind:'monitoria', evaluation_id } · { kind:'acao', action_id }
export async function formalizeBeedoo(params, { onSent } = {}) {
  let d;
  try { d = await api.get(`/beedoo/draft${qs(params)}`); } catch (ex) { toast(ex.message, 'err'); return; }
  let tab = 'mensagem';
  const st = { message: d.message, login: d.login || '', audio: (d.attachments || []).length > 0 };
  const lastSent = (d.previous || []).find((p) => ['enviado', 'manual', 'pendente', 'enviando'].includes(p.status));
  modal({
    title: 'Formalizar no Beedoo',
    wide: true,
    cls: 'bd-modal',
    body: html`
      <div class="bd-head">${avatar(d.operator_name)}<div class="grow"><b>${d.operator_name || 'Operador'}</b>
        <div class="tiny muted">${KIND[d.kind]} · ${d.vals?.carteira || d.portfolio}</div></div>
        <span class="chip ${d.agent_online ? 'ok' : 'warn'}">${icon(d.agent_online ? 'checkCircle' : 'alert')}${d.agent_online ? 'Agente conectado' : 'Agente desconectado'}</span></div>
      ${lastSent ? html`<div class="bd-warn">${icon('info')}<span>Já existe uma formalização deste ${d.kind === 'monitoria' ? 'atendimento' : d.kind === 'feedback' ? 'feedback' : 'registro'} (${STATUS[lastSent.status]?.[0].toLowerCase()} em ${fmtDate(lastSent.sent_at || lastSent.created_at, true)}). Confirmar envia de novo.</span></div>` : ''}
      <div class="tabs" role="tablist">
        <button data-bt="mensagem" class="on">${icon('edit')}1. Mensagem</button>
        <button data-bt="revisao">${icon('eye')}2. Revisão</button>
      </div>
      <div data-pane="mensagem">
        <div class="grid g-2" style="gap:12px">
          <div class="field"><label for="bd-login">Login do operador no Beedoo</label><input class="input" id="bd-login" value="${st.login}" placeholder="ex.: elacdsilva" autocomplete="off">
            <span class="hint">A mensagem vai para ${BEEDOO_URL.replace('https://', '')}/message/<b id="bd-lg">${st.login || 'login'}</b></span></div>
          <div class="field"><label>Anexo</label>
            ${(d.attachments || []).length ? html`<label class="check"><input type="checkbox" id="bd-audio" ${st.audio ? 'checked' : ''}>Anexar o áudio da ligação</label>
              <span class="hint" title="${d.attachments[0].file}">${d.attachments[0].file.length > 60 ? `${d.attachments[0].file.slice(0, 57)}…` : d.attachments[0].file} (da pasta de áudios configurada no agente)</span>`
            : html`<span class="hint">Sem anexo para este envio.</span>`}</div>
        </div>
        <div class="field"><label for="bd-msg">Mensagem <span class="muted" style="font-weight:500">· edite à vontade e coloque emojis: é exatamente o que o operador vai receber</span></label>
          <textarea class="input textarea" id="bd-msg" rows="14" style="font-family:inherit">${st.message}</textarea>
          <div class="bd-tplbar"><span class="hint" id="bd-count"></span><div class="grow"></div>
            <span class="tiny muted" id="bd-scope">Usando o ${SCOPE[d.template_scope] || 'modelo padrão'}</span>
            <button type="button" class="btn sm" id="bd-tpl-from" title="A formatação desta mensagem (emojis, ordem, textos fixos) passa a valer nos próximos envios">${icon('check')}Usar esta formatação nos próximos envios</button>
            <button type="button" class="btn sm ghost" id="bd-tpl-edit">${icon('edit')}Editar modelo</button></div>
          <div class="bd-tpl" id="bd-tpl" hidden>
            <div class="row between"><b class="small">Modelo de ${KIND[d.kind].toLowerCase()}</b><span class="tiny muted">{campo} vira o dado de cada envio · linha com campos vazios some</span></div>
            <div class="bd-fields">${(d.fields || []).map((f) => html`<button type="button" class="chip" data-field="${f}">{${f}}</button>`)}</div>
            <textarea class="input textarea" id="bd-tpl-t" rows="12" style="font-family:inherit"></textarea>
            <div class="row" style="gap:8px;flex-wrap:wrap">
              ${d.can_edit_all ? html`<select class="select sm" id="bd-tpl-scope" style="width:auto"><option value="me">Salvar só para mim</option><option value="all">Salvar para todos</option></select>` : html`<span class="tiny muted">Vale só para os seus envios.</span>`}
              <div class="grow"></div>
              <button type="button" class="btn sm ghost" id="bd-tpl-reset" title="Volta ao modelo geral (ou ao padrão da plataforma)">Voltar ao padrão</button>
              <button type="button" class="btn sm ghost" id="bd-tpl-cancel">Cancelar</button>
              <button type="button" class="btn sm primary" id="bd-tpl-save">${icon('check')}Salvar modelo</button>
            </div>
          </div>
      </div>
      <div data-pane="revisao" hidden></div>`,
    foot: html`<button class="btn ghost" data-close>Cancelar</button><div class="grow"></div>
      <button class="btn" id="bd-manual" title="Copia a mensagem e abre o chat do operador no Beedoo para você colar e enviar">${icon('copy')}Copiar e abrir no Beedoo</button>
      <button class="btn primary" id="bd-next">${icon('eye')}Revisar mensagem</button>
      <button class="btn success" id="bd-send" hidden>${icon('send')}Confirmar e enviar</button>`,
    onMount: (m, close) => {
      const msg = $('#bd-msg', m), lg = $('#bd-login', m);
      const sync = () => {
        st.message = msg.value; st.login = lg.value.trim().toLowerCase(); st.audio = !!$('#bd-audio', m)?.checked;
        $('#bd-lg', m).textContent = st.login || 'login';
        $('#bd-count', m).textContent = `${st.message.length} caracteres · ${st.message.split('\n').length} linhas`;
      };
      attachEmoji(msg);
      const tplBox = $('#bd-tpl', m), tplT = $('#bd-tpl-t', m);
      attachEmoji(tplT);
      const openTpl = (text) => { tplT.value = text; tplBox.hidden = false; tplT.focus(); tplBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
      $('#bd-tpl-from', m).onclick = () => { openTpl(toTemplate(msg.value, d.vals, d.template)); toast('Confira o modelo: os dados deste envio viraram {campos}. Depois clique em Salvar modelo.'); };
      $('#bd-tpl-edit', m).onclick = () => openTpl(d.template || '');
      $('#bd-tpl-cancel', m).onclick = () => { tplBox.hidden = true; };
      $$('[data-field]', m).forEach((b) => b.addEventListener('click', () => { const s0 = tplT.selectionStart ?? tplT.value.length; tplT.setRangeText(`{${b.dataset.field}}`, s0, tplT.selectionEnd ?? s0, 'end'); tplT.focus(); }));
      const saveTpl = async (btn, text) => {
        busy(btn, true);
        try {
          const scope = $('#bd-tpl-scope', m)?.value || 'me';
          const r = await api.put(`/beedoo/templates/${d.kind}`, { text, scope });
          d.template = r.text; d.template_scope = r.scope;
          msg.value = renderTpl(r.text, d.vals); sync();
          $('#bd-scope', m).textContent = `Usando o ${SCOPE[r.scope] || 'modelo padrão'}`;
          tplBox.hidden = true;
          toast(text ? (scope === 'all' ? 'Modelo salvo para todos: os próximos envios usam esta formatação.' : 'Modelo salvo: os seus próximos envios usam esta formatação.') : 'Modelo de volta ao padrão.');
        } catch (ex) { toast(ex.message, 'err'); }
        busy(btn, false);
      };
      $('#bd-tpl-save', m).onclick = (e) => saveTpl(e.currentTarget, tplT.value);
      $('#bd-tpl-reset', m).onclick = (e) => saveTpl(e.currentTarget, '');
      msg.addEventListener('input', sync); lg.addEventListener('input', sync); $('#bd-audio', m)?.addEventListener('change', sync); sync();
      const problems = () => [
        !st.login && 'Falta o login do operador no Beedoo.',
        st.message.trim().length < 5 && 'A mensagem está vazia.',
        /\{[a-z_]+\}/.test(st.message) && 'Ainda há um {campo} sem preencher na mensagem.',
      ].filter(Boolean);
      const drawReview = () => {
        const pr = problems();
        const att = st.audio && d.attachments?.length ? d.attachments[0] : null;
        $('[data-pane="revisao"]', m).innerHTML = String(html`
          <div class="bd-review">
            <div class="bd-facts">
              <div><span>Para</span><b>${d.operator_name || '—'}</b></div>
              <div><span>Login no Beedoo</span><b>${st.login || '—'}</b></div>
              <div><span>Tipo</span><b>${KIND[d.kind]}</b></div>
              <div><span>Carteira</span><b>${d.vals?.carteira || d.portfolio}</b></div>
              ${d.vals?.nota ? html`<div><span>Nota</span><b>${d.vals.nota}</b></div>` : ''}
              <div><span>Anexo</span><b>${att ? 'Áudio da ligação' : 'Nenhum'}</b></div>
              <div><span>Envio</span><b>${d.agent_online ? 'Agente PX Beedoo (agora)' : 'Fila do agente (sai quando ele abrir)'}</b></div>
            </div>
            <div class="bd-chat">
              <div class="bd-chat-h">${icon('msgCheck')}Prévia no chat do Beedoo</div>
              <div class="bd-bubble">${st.message}</div>
              ${att ? html`<div class="bd-bubble bd-file">${icon('file')}${att.file}</div>` : ''}
            </div>
          </div>
          ${pr.length ? html`<div class="bd-warn bad">${icon('alert')}<span>${pr.join(' ')}</span></div>`
            : !d.agent_online ? html`<div class="bd-warn">${icon('info')}<span>${d.has_agent ? 'Seu agente PX Beedoo está desligado agora (computador desligado ou agente fechado). A mensagem fica na fila e sai assim que ele voltar.' : 'Você ainda não conectou o agente PX Beedoo. A mensagem fica na fila; conecte em Envios ao Beedoo, ou use “Copiar e abrir no Beedoo”.'}</span></div>` : ''}`);
        $('#bd-send', m).disabled = pr.length > 0;
      };
      const show = (t) => {
        tab = t;
        $$('[data-bt]', m).forEach((b) => b.classList.toggle('on', b.dataset.bt === t));
        $('[data-pane="mensagem"]', m).hidden = t !== 'mensagem';
        $('[data-pane="revisao"]', m).hidden = t !== 'revisao';
        $('#bd-next', m).hidden = t !== 'mensagem';
        $('#bd-send', m).hidden = t !== 'revisao';
        if (t === 'revisao') { sync(); drawReview(); }
      };
      $$('[data-bt]', m).forEach((b) => b.addEventListener('click', () => show(b.dataset.bt)));
      $('#bd-next', m).onclick = () => show('revisao');
      const body = (mode) => ({ kind: d.kind, source_id: d.source_id, operator_id: d.operator_id, operator_name: d.operator_name, login: st.login, message: st.message, attachments: st.audio ? d.attachments : [], mode });
      $('#bd-send', m).onclick = async (e) => {
        if (tab !== 'revisao' || problems().length) return;
        const b = e.currentTarget; busy(b, true, 'Enviando');
        try {
          await api.post('/beedoo/messages', body());
          close(); toast(d.agent_online ? `Mensagem para ${d.operator_name} na fila do agente. Acompanhe em Envios ao Beedoo.` : 'Mensagem na fila. Ela sai quando o agente PX Beedoo abrir.');
          onSent?.();
        } catch (ex) { toast(ex.message, 'err'); busy(b, false); }
      };
      $('#bd-manual', m).onclick = async (e) => {
        sync();
        if (problems().length) { show('revisao'); return; }
        const b = e.currentTarget; busy(b, true);
        try {
          await copy(st.message);
          window.open(`${BEEDOO_URL}/message/${encodeURIComponent(st.login)}`, '_blank', 'noopener');
          await api.post('/beedoo/messages', body('manual'));
          close(); toast('Mensagem copiada. Cole (Ctrl V) no chat do Beedoo que abriu e envie.', 'ok', 6000);
          onSent?.();
        } catch (ex) { toast(ex.message, 'err'); busy(b, false); }
      };
    },
  });
}

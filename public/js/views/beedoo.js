import { api, qs, saveBlob } from '../api.js';
import { API_URL } from '../sb.js';
import { html, icon, $, $$, fmtDate, fmtRel, toast, modal, busy, emptyState, confirmDialog, avatar } from '../ui.js';
import { STATUS, statusChip, BEEDOO_URL } from '../beedoo.js';

// Envios ao Beedoo: a fila de mensagens confirmadas, o agente PX Beedoo e os modelos de mensagem
const KIND = { feedback: 'Feedback', monitoria: 'Monitoria', acao: 'Ação' };
const st = { status: '', tab: 'fila' };
let timer = null;

export async function render(el, _p, ctx) {
  ctx.setTitle('Envios ao Beedoo', 'Feedbacks');
  const isAdmin = ctx.store.user.role === 'admin';
  el.innerHTML = String(html`
    <div class="page-head"><div><h2>Envios ao Beedoo</h2><p>Formalização dos feedbacks, monitorias e ações no chat do Beedoo do operador. Você revisa e confirma na plataforma; o agente PX Beedoo envia.</p></div>
      <div class="grow"></div><button class="btn primary" id="bd-connect">${icon('plug')}Conectar agente</button></div>
    <div id="bd-agent"></div>
    <div class="tabs" role="tablist"><button data-t="fila" class="${st.tab === 'fila' ? 'on' : ''}">${icon('send')}Mensagens</button><button data-t="modelos" class="${st.tab === 'modelos' ? 'on' : ''}">${icon('edit')}Modelos de mensagem</button><button data-t="como" class="${st.tab === 'como' ? 'on' : ''}">${icon('info')}Como funciona</button></div>
    <div id="bd-body"></div>`);
  $$('[data-t]', el).forEach((b) => b.addEventListener('click', () => { st.tab = b.dataset.t; $$('[data-t]', el).forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
  $('#bd-connect', el).onclick = () => connect(load);

  let data = null;
  const load = async () => {
    try { data = await api.get(`/beedoo/messages${qs({ status: st.status })}`); } catch (ex) { toast(ex.message, 'err'); return; }
    if (!ctx.isCurrent()) return;
    drawAgent(); if (st.tab === 'fila') draw();
  };
  const drawAgent = () => {
    const on = data.agent_online;
    $('#bd-agent', el).innerHTML = String(html`<div class="bd-agent ${on ? 'on' : ''}">
      <span class="bd-dot"></span><div class="grow"><b>${on ? 'Agente PX Beedoo conectado' : data.agents.length ? 'Agente PX Beedoo desconectado' : 'Agente PX Beedoo ainda não conectado'}</b>
      <div class="tiny muted">${on ? `${data.agent_name || 'Seu computador'} · as mensagens confirmadas saem em segundos` : data.agent_seen ? `Visto pela última vez ${fmtRel(data.agent_seen)}. Ele abre sozinho quando o computador liga; se não abriu, dê dois cliques no iniciar_agente.bat.` : 'Clique em “Conectar agente” para baixar o agente e a sua chave. Enquanto isso, use “Copiar e abrir no Beedoo” na revisão.'}</div></div>
      ${['pendente', 'enviando', 'erro', 'enviado'].map((s) => html`<div class="bd-num"><b>${data.rows.filter((r) => r.status === s || (s === 'enviado' && r.status === 'manual')).length}</b><span>${STATUS[s][0]}</span></div>`)}
    </div>`);
  };
  const draw = () => {
    const box = $('#bd-body', el);
    if (st.tab === 'modelos') return drawTemplates(box, isAdmin);
    if (st.tab === 'como') return drawHelp(box);
    if (!data) return;
    box.innerHTML = String(html`
      <div class="filters"><span class="muted">${icon('filter')}</span>
        <select class="select sm" id="bd-st"><option value="">Todos os status</option>${Object.entries(STATUS).map(([k, [l]]) => html`<option value="${k}" ${st.status === k ? 'selected' : ''}>${l}</option>`)}</select>
        <div class="grow"></div><span class="small muted">${data.rows.length} mensagem(ns)</span></div>
      ${data.rows.length ? html`<div class="stack">${data.rows.map((r) => html`<div class="fb-card bd-row">
        <div class="fb-h">${avatar(r.operator_name || r.login)}<div class="grow"><b>${r.operator_name || r.login}</b> <span class="tiny muted">${r.login}</span>
          <div class="tiny muted">${KIND[r.kind] || r.kind} · confirmada ${fmtDate(r.created_at, true)}${r.sent_at ? ` · enviada ${fmtDate(r.sent_at, true)}` : ''}${r.attempts > 1 ? ` · ${r.attempts} tentativas` : ''}</div></div>
          ${statusChip(r.status)}</div>
        <p class="small bd-pre">${r.message.length > 320 ? `${r.message.slice(0, 320)}…` : r.message}</p>
        ${r.error ? html`<div class="bd-warn ${r.status === 'erro' ? 'bad' : ''}">${icon(r.status === 'erro' ? 'alert' : 'info')}<span>${r.error}</span></div>` : ''}
        <div class="row" style="margin-top:10px">
          <button class="btn sm ghost" data-view="${r.id}">${icon('eye')}Ver mensagem</button>
          <a class="btn sm ghost" href="${BEEDOO_URL}/message/${encodeURIComponent(r.login)}" target="_blank" rel="noopener">${icon('external')}Abrir chat no Beedoo</a>
          <div class="grow"></div>
          ${['erro', 'cancelado'].includes(r.status) ? html`<button class="btn sm" data-retry="${r.id}">${icon('refresh')}Tentar de novo</button>` : ''}
          ${['erro', 'pendente'].includes(r.status) ? html`<button class="btn sm ghost" data-manual="${r.id}">${icon('checkCircle')}Já enviei à mão</button><button class="btn sm ghost danger" data-cancel="${r.id}">${icon('x')}Cancelar</button>` : ''}
        </div></div>`)}</div>`
      : emptyState('send', 'Nenhuma mensagem ainda', 'Em Feedbacks aplicados, no atendimento ou no Controle de ações, clique em “Formalizar no Beedoo”.')}`);
    $('#bd-st', box).onchange = (e) => { st.status = e.target.value; load(); };
    const act = (sel, path, okMsg, ask) => $$(`[${sel}]`, box).forEach((b) => b.addEventListener('click', async () => {
      if (ask && !(await confirmDialog(ask[0], ask[1], { danger: true, ok: ask[2] }))) return;
      busy(b, true);
      try { await api.post(`/beedoo/messages/${b.getAttribute(sel)}/${path}`); toast(okMsg); load(); } catch (ex) { toast(ex.message, 'err'); busy(b, false); }
    }));
    act('data-retry', 'retry', 'Mensagem de volta na fila.');
    act('data-manual', 'manual', 'Marcada como enviada à mão.');
    act('data-cancel', 'cancel', 'Envio cancelado.', ['Cancelar envio', 'A mensagem sai da fila e não vai para o Beedoo.', 'Cancelar envio']);
    $$('[data-view]', box).forEach((b) => b.addEventListener('click', () => {
      const r = data.rows.find((x) => String(x.id) === b.dataset.view);
      modal({ title: `Mensagem para ${r.operator_name || r.login}`, body: html`<div class="bd-chat"><div class="bd-chat-h">${icon('msgCheck')}${r.login} · ${STATUS[r.status]?.[0]}</div><div class="bd-bubble">${r.message}</div>
        ${(r.attachments || []).map((a) => html`<div class="bd-bubble bd-file">${icon('file')}${a.file}</div>`)}</div>`, foot: html`<button class="btn" data-close>Fechar</button>` });
    }));
  };
  await load();
  clearInterval(timer);
  timer = setInterval(() => { if (!ctx.isCurrent() || !document.body.contains(el)) { clearInterval(timer); return; } if (st.tab === 'fila' && !document.querySelector('.overlay')) load(); }, 15000);
}

// Conectar: baixa o agente e gera a chave (aparece uma vez; a anterior deixa de valer)
function connect(reload) {
  modal({
    title: 'Conectar o agente PX Beedoo',
    wide: true,
    body: html`<ol class="bd-steps">
      <li><b>Baixe o agente</b> e salve os 3 arquivos numa pasta (ex.: Documentos\\PX Beedoo).
        <div class="row" style="margin-top:8px"><a class="btn sm" href="agente/px_beedoo_agente.py" download>${icon('download')}px_beedoo_agente.py</a><a class="btn sm" href="agente/iniciar_agente.bat" download>${icon('download')}iniciar_agente.bat</a><a class="btn sm ghost" href="agente/LEIA-ME.txt" download>${icon('download')}LEIA-ME.txt</a></div></li>
      <li><b>Tenha o Python 3</b> no computador (o agente usa o Edge que já está instalado).</li>
      <li><b>Gere a sua chave</b> e baixe o <code>px_beedoo.ini</code> na mesma pasta. ${''}
        <div class="field" style="margin:8px 0 0"><label for="bd-aud">Pasta dos áudios das ligações (opcional, para anexar o áudio na monitoria)</label><input class="input" id="bd-aud" placeholder="ex.: C:\\Users\\voce\\OneDrive - Paschoalotto\\Áudios"></div>
        <button class="btn primary" id="bd-key" style="margin-top:4px">${icon('key')}Gerar chave e baixar px_beedoo.ini</button>
        <div id="bd-keybox"></div></li>
      <li><b>Dê dois cliques no iniciar_agente.bat uma vez só.</b> Ele instala o que precisa e, se o Beedoo pedir, abre o Edge para você entrar com a conta Microsoft. A partir daí <b>abre sozinho, minimizado, sempre que você entra no Windows</b> e fica enviando; se parar, reabre sozinho. Esta página mostra “Agente conectado”.</li>
    </ol>`,
    foot: html`<button class="btn" data-close>Fechar</button>`,
    onMount: (m) => {
      $('#bd-key', m).onclick = async (e) => {
        const b = e.currentTarget; busy(b, true, 'Gerando');
        try {
          const { key } = await api.post('/beedoo/agent/key');
          const ini = `[px]\r\napi = ${API_URL}\r\nchave = ${key}\r\npasta_audios = ${$('#bd-aud', m).value.trim()}\r\nnavegador = msedge\r\n`;
          saveBlob(new Blob([ini], { type: 'text/plain' }), 'px_beedoo.ini');
          $('#bd-keybox', m).innerHTML = String(html`<div class="bd-warn">${icon('checkCircle')}<span>Chave gerada e <b>px_beedoo.ini</b> baixado. Ela é só sua e não aparece de novo; a chave anterior deixou de valer.</span></div>`);
          busy(b, false); reload();
        } catch (ex) { toast(ex.message, 'err'); busy(b, false); }
      };
    },
  });
}

async function drawTemplates(box, isAdmin) {
  box.innerHTML = '<div class="card"><span class="spinner"></span></div>';
  let t;
  try { t = await api.get('/beedoo/templates'); } catch (ex) { toast(ex.message, 'err'); return; }
  const NAME = { feedback: 'Feedback aplicado', monitoria: 'Resultado da monitoria', acao: 'Ação registrada' };
  box.innerHTML = String(html`<p class="small muted" style="margin-top:0">Cada envio começa por este modelo e pode ser editado na revisão. <code>{campo}</code> vira o valor; uma linha com campos vazios some.${isAdmin ? '' : ' Só o administrador altera os modelos.'}</p>
    <div class="grid g-3" style="gap:14px">${Object.entries(t).map(([k, v]) => html`<div class="card">
      <div class="row between"><b>${NAME[k]}</b>${v.custom ? html`<span class="chip info">personalizado</span>` : html`<span class="chip outline">padrão</span>`}</div>
      <textarea class="input textarea" data-tpl="${k}" rows="16" style="margin-top:10px;font-size:12.5px" ${isAdmin ? '' : 'readonly'}>${v.text}</textarea>
      <div class="tiny muted" style="margin:6px 0 10px">${v.fields.map((f) => `{${f}}`).join(' ')}</div>
      ${isAdmin ? html`<div class="row"><button class="btn sm primary" data-save="${k}">${icon('check')}Salvar</button><button class="btn sm ghost" data-reset="${k}">Voltar ao padrão</button></div>` : ''}
    </div>`)}</div>`);
  const save = async (k, text, b) => { busy(b, true); try { await api.put(`/beedoo/templates/${k}`, { text }); toast('Modelo salvo.'); drawTemplates(box, isAdmin); } catch (ex) { toast(ex.message, 'err'); busy(b, false); } };
  $$('[data-save]', box).forEach((b) => b.addEventListener('click', () => save(b.dataset.save, $(`[data-tpl="${b.dataset.save}"]`, box).value, b)));
  $$('[data-reset]', box).forEach((b) => b.addEventListener('click', () => save(b.dataset.reset, '', b)));
}

function drawHelp(box) {
  box.innerHTML = String(html`<div class="grid g-3" style="gap:14px">
    <div class="card"><div class="bd-n">1</div><b>Formalize</b><p class="small muted">Em Feedbacks aplicados, no atendimento (monitoria) ou no Controle de ações, clique em “Formalizar no Beedoo”. Ao aplicar um feedback, a revisão já abre em seguida.</p></div>
    <div class="card"><div class="bd-n">2</div><b>Revise e confirme</b><p class="small muted">A aba Mensagem traz o texto pronto pelo modelo; ajuste o que quiser. A aba Revisão mostra para quem vai, o login, o anexo e a prévia no chat. “Confirmar e enviar” coloca na fila.</p></div>
    <div class="card"><div class="bd-n">3</div><b>O agente envia</b><p class="small muted">O agente PX Beedoo abre sozinho com o Windows, envia pelo chat do Beedoo com a sua sessão e devolve o resultado aqui. Instale uma vez em “Conectar agente”. Sem o agente, “Copiar e abrir no Beedoo” copia a mensagem e abre o chat do operador.</p></div>
  </div>
  <p class="small muted">O Beedoo só abre de dentro da rede da Paschoalotto; por isso o envio sai do seu computador, não do servidor. O agente não guarda senha: a sessão do Beedoo fica no perfil do Edge que ele usa.</p>`);
}

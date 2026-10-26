import { api, qs } from '../api.js';
import { html, icon, $, $$, fmtDate, toast, modal, busy, confirmDialog, emptyState } from '../ui.js';
import { bulkAudio } from './evaluations.js';

const ST = { aberto: ['Em andamento', 'warn'], publicado: ['Publicado', 'ok'], encerrado: ['Encerrado', ''] };

export async function render(el, _p, ctx) {
  const cycles = ctx.store.meta.cycles;
  const counts = await api.get(`/evaluations${qs({ limit: 2000 })}`);
  if (!ctx.isCurrent()) return;
  const by = (id) => counts.filter((e) => e.cycle_id === id);
  el.innerHTML = String(html`
    <div class="page-head"><div><h2>Quinzenas &amp; pastas de áudio</h2><p>Controle total dos ciclos de monitoria e dos links do OneDrive. Mudou a pasta? Edite aqui e todos os cards da quinzena passam a apontar para o novo link.</p></div><div class="grow"></div>
      <button class="btn primary" id="c-new">${icon('plus')}Nova quinzena</button></div>
    <div class="banner info">${icon('info')}<div><b>Como funciona o link de áudio:</b> cada atendimento usa o <b>link próprio</b> (se houver) ou, na falta dele, a <b>pasta da quinzena</b>. Você pode definir links próprios no card do atendimento ou em lote na tela de Atendimentos.</div></div>
    ${cycles.length ? html`<div class="stack">${cycles.map((c) => {
      const ev = by(c.id); const own = ev.filter((e) => e.audio_url).length;
      return html`<div class="card card-pad" data-c="${c.id}">
        <div class="row" style="align-items:flex-start">
          <span class="k-ic" style="width:44px;height:44px;border-radius:13px;display:grid;place-items:center;background:var(--brand-soft);color:var(--brand)">${icon('calendar')}</span>
          <div style="flex:1;min-width:220px"><div class="row" style="gap:8px"><b style="font-size:16px">${c.name}</b><span class="chip ${ST[c.status][1]}">${ST[c.status][0]}</span></div>
            <div class="small muted">${fmtDate(c.start_date)} a ${fmtDate(c.end_date)} · ${ev.length} atendimento(s) · ${own} com link próprio${c.published_at ? ` · publicado em ${fmtDate(c.published_at)}` : ''}</div></div>
          <div class="row">
            ${c.status !== 'publicado' ? html`<button class="btn sm" data-pub="${c.id}">${icon('report')}Publicar report</button>` : ''}
            <button class="btn sm" data-edit="${c.id}">${icon('edit')}Editar</button>
            ${!ev.length ? html`<button class="btn-icon" data-del="${c.id}" aria-label="Excluir">${icon('trash')}</button>` : ''}
          </div>
        </div>
        <div class="audio-bar" style="margin-top:14px">
          <span class="ic">${icon('folder')}</span>
          <div class="grow"><b>Pasta de áudios da quinzena</b><div class="url">${c.audio_folder_url || 'Nenhuma pasta cadastrada'}</div></div>
          ${c.audio_folder_url ? html`<a class="btn sm" href="${c.audio_folder_url}" target="_blank" rel="noopener">${icon('external')}Abrir</a>` : ''}
          <button class="btn sm primary" data-folder="${c.id}">${icon('link')}${c.audio_folder_url ? 'Trocar link' : 'Adicionar link'}</button>
          ${ev.length ? html`<button class="btn sm" data-bulk="${c.id}" title="Gravar um link próprio em todos os atendimentos">${icon('layers')}Link em lote</button>` : ''}
        </div>
      </div>`;
    })}</div>` : emptyState('calendar', 'Nenhuma quinzena cadastrada', 'Crie a primeira quinzena para organizar os reports.')}`);

  const reload = async () => { await ctx.refreshMeta(); render(el, _p, ctx); };
  $('#c-new').onclick = () => editCycle(null, reload);
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => editCycle(cycles.find((c) => c.id === Number(b.dataset.edit)), reload)));
  $$('[data-folder]').forEach((b) => b.addEventListener('click', () => editFolder(cycles.find((c) => c.id === Number(b.dataset.folder)), reload)));
  $$('[data-bulk]').forEach((b) => b.addEventListener('click', () => bulkAudio(by(Number(b.dataset.bulk)).map((e) => e.id), reload)));
  $$('[data-pub]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Publicar report', 'A Qualidade e a Supervisão serão notificadas de que o report desta quinzena está disponível.', { ok: 'Publicar' }))) return;
    await api.put(`/cycles/${b.dataset.pub}`, { status: 'publicado' }); toast('Report publicado e equipe notificada.'); reload();
  }));
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Excluir quinzena', 'A quinzena será removida.', { ok: 'Excluir', danger: true }))) return;
    try { await api.del(`/cycles/${b.dataset.del}`); toast('Quinzena excluída.'); reload(); } catch (ex) { toast(ex.message, 'err'); }
  }));
}

function nextCycleDefaults() {
  const d = new Date();
  const y = d.getFullYear(), m = d.getMonth(), first = d.getDate() <= 15;
  const pad = (n) => String(n).padStart(2, '0');
  const last = new Date(y, m + 1, 0).getDate();
  const mon = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  return { name: `${first ? '1ª' : '2ª'} Quinzena · ${mon.charAt(0).toUpperCase() + mon.slice(1)}/${y}`, start_date: `${y}-${pad(m + 1)}-${first ? '01' : '16'}`, end_date: `${y}-${pad(m + 1)}-${first ? '15' : pad(last)}` };
}

function editCycle(c, done) {
  const v = c || nextCycleDefaults();
  modal({
    title: c ? 'Editar quinzena' : 'Nova quinzena',
    body: html`<form id="cy-form">
      <div class="field"><label for="cy-name">Nome</label><input class="input" id="cy-name" name="name" required value="${v.name}"></div>
      <div class="grid g-2"><div class="field"><label for="cy-s">Início</label><input class="input" type="date" id="cy-s" name="start_date" required value="${v.start_date}"></div>
        <div class="field"><label for="cy-e">Fim</label><input class="input" type="date" id="cy-e" name="end_date" required value="${v.end_date}"></div></div>
      <div class="field"><label for="cy-url">Link da pasta de áudios (OneDrive)</label><input class="input" type="url" id="cy-url" name="audio_folder_url" value="${v.audio_folder_url || ''}" placeholder="https://..."></div>
      <div class="field"><label for="cy-st">Status</label><select class="select" id="cy-st" name="status">${Object.entries(ST).map(([k, [l]]) => html`<option value="${k}" ${(v.status || 'aberto') === k ? 'selected' : ''}>${l}</option>`)}</select></div>
    </form>`,
    foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="cy-ok">Salvar</button>`,
    onMount: (m, close) => {
      $('#cy-ok', m).onclick = async (e) => {
        const btnEl = e.currentTarget;
        const f = $('#cy-form', m); if (!f.reportValidity()) return;
        const body = { name: f.name.value, start_date: f.start_date.value, end_date: f.end_date.value, audio_folder_url: f.audio_folder_url.value.trim(), status: f.status.value };
        busy(btnEl, true);
        try { c ? await api.put(`/cycles/${c.id}`, body) : await api.post('/cycles', body); toast('Quinzena salva.'); close(); done(); }
        catch (ex) { toast(ex.message, 'err'); busy(btnEl, false); }
      };
    },
  });
}

function editFolder(c, done) {
  modal({
    title: `Pasta de áudios · ${c.name}`,
    body: html`<p class="t2" style="margin-top:0">Cole o link de compartilhamento da pasta no OneDrive/SharePoint. Todos os atendimentos desta quinzena sem link próprio passam a abrir este endereço.</p>
      <div class="field"><label for="fd-url">Link da pasta</label><input class="input" id="fd-url" type="url" value="${c.audio_folder_url || ''}" placeholder="https://empresa-my.sharepoint.com/..."></div>
      ${c.audio_folder_url ? html`<p class="tiny muted">Link atual: <span style="word-break:break-all">${c.audio_folder_url}</span></p>` : ''}`,
    foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="fd-ok">Salvar link</button>`,
    onMount: (m, close) => {
      $('#fd-ok', m).onclick = async (e) => {
        const btnEl = e.currentTarget;
        busy(btnEl, true);
        try { await api.put(`/cycles/${c.id}`, { audio_folder_url: $('#fd-url', m).value.trim() }); toast('Pasta de áudios atualizada.'); close(); done(); }
        catch (ex) { toast(ex.message, 'err'); busy(btnEl, false); }
      };
    },
  });
}

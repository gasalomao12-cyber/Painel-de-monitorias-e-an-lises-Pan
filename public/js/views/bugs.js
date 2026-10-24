import { api } from '../api.js';
import { html, icon, $, $$, toast, modal, busy, fmtDate, fmtRel, emptyState, avatar } from '../ui.js';
import { openBugReport } from '../app.js';

const ST = { aberto: ['Aberto', 'warn'], em_analise: ['Em análise', 'info'], resolvido: ['Resolvido', 'ok'], descartado: ['Descartado', ''] };
const SEV = { baixa: ['Baixa', ''], media: ['Média', 'info'], alta: ['Alta', 'warn'], critica: ['Crítica', 'bad'] };

export async function render(el, _p, ctx) {
  const admin = ctx.can('admin');
  const bugs = await api.get('/bugs');
  if (!ctx.isCurrent()) return;
  ctx.setTitle(admin ? 'Bugs reportados' : 'Meus reports de bug');
  let filter = admin ? 'abertos' : 'todos';
  const draw = () => {
    const list = bugs.filter((b) => filter === 'todos' || (filter === 'abertos' ? ['aberto', 'em_analise'].includes(b.status) : b.status === filter));
    el.innerHTML = String(html`
      <div class="page-head"><div><h2>${admin ? 'Bugs reportados' : 'Meus reports de bug'}</h2><p>${admin ? 'Problemas enviados pelos usuários pelo botão “Reportar bug”.' : 'Acompanhe o andamento dos problemas que você reportou.'}</p></div><div class="grow"></div>
        <button class="btn primary" id="bg-new">${icon('bug')}Reportar bug</button></div>
      <div class="filters"><div class="seg" id="bg-f">${[['abertos', 'Em aberto'], ['resolvido', 'Resolvidos'], ['todos', 'Todos']].map(([k, l]) => html`<button data-v="${k}" class="${filter === k ? 'on' : ''}">${l}</button>`)}</div>
        <span class="small muted">${bugs.filter((b) => ['aberto', 'em_analise'].includes(b.status)).length} em aberto · ${bugs.length} no total</span></div>
      ${list.length ? html`<div class="stack">${list.map((b) => html`<div class="card card-pad">
        <div class="row" style="align-items:flex-start">
          <div style="flex:1;min-width:240px"><div class="row" style="gap:8px"><b>#${b.id} · ${b.title}</b><span class="chip ${SEV[b.severity][1]}">${SEV[b.severity][0]}</span><span class="chip ${ST[b.status][1]}">${ST[b.status][0]}</span></div>
            <div class="tiny muted" style="margin-top:4px">${admin ? html`${avatar(b.user_display || b.user_name || '?', 'sm')} ${b.user_display || b.user_name} · ` : ''}${fmtDate(b.created_at, true)} (${fmtRel(b.created_at)}) · página ${b.page || '—'}</div>
            <p class="small" style="white-space:pre-wrap;margin:10px 0 0">${b.description}</p>
            ${b.admin_notes ? html`<div class="banner info mt" style="margin-bottom:0">${icon('info')}<div><b>Retorno do administrador:</b> ${b.admin_notes}</div></div>` : ''}
            ${admin ? html`<div class="tiny muted mt">${b.user_agent || ''}</div>` : ''}</div>
          <div class="row">${b.has_screenshot ? html`<a class="btn sm" href="/api/bugs/${b.id}/screenshot" target="_blank" rel="noopener">${icon('image')}Ver print</a>` : ''}
            ${admin ? html`<button class="btn sm primary" data-b="${b.id}">${icon('edit')}Tratar</button>` : ''}</div>
        </div></div>`)}</div>` : emptyState('bug', 'Nada por aqui', admin ? 'Nenhum bug neste filtro. 🎉' : 'Você ainda não reportou problemas.')}`);
    $('#bg-new').onclick = () => openBugReport();
    $$('#bg-f button').forEach((x) => x.addEventListener('click', () => { filter = x.dataset.v; draw(); }));
    $$('[data-b]').forEach((x) => x.addEventListener('click', () => treat(bugs.find((b) => b.id === Number(x.dataset.b)), async () => { await ctx.refreshMeta(); render(el, _p, ctx); })));
  };
  draw();
}

function treat(b, done) {
  modal({
    title: `Bug #${b.id}`,
    body: html`<p class="t2" style="margin-top:0"><b>${b.title}</b></p>
      <div class="field"><label for="bt-st">Status</label><select class="select" id="bt-st">${Object.entries(ST).map(([k, [l]]) => html`<option value="${k}" ${b.status === k ? 'selected' : ''}>${l}</option>`)}</select></div>
      <div class="field"><label for="bt-n">Retorno para o usuário</label><textarea class="textarea" id="bt-n" placeholder="O que foi feito / previsão de correção">${b.admin_notes || ''}</textarea></div>`,
    foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="bt-ok">Salvar e notificar</button>`,
    onMount: (m, close) => {
      $('#bt-ok', m).onclick = async (e) => {
        busy(e.currentTarget, true);
        try { await api.put(`/bugs/${b.id}`, { status: $('#bt-st', m).value, admin_notes: $('#bt-n', m).value }); toast('Bug atualizado. O usuário foi notificado.'); close(); done(); }
        catch (ex) { toast(ex.message, 'err'); busy(e.currentTarget, false); }
      };
    },
  });
}

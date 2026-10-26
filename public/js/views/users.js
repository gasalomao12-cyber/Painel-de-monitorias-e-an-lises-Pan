import { api } from '../api.js';
import { html, icon, $, $$, toast, modal, busy, confirmDialog, avatar, fmtRel, ROLE } from '../ui.js';

const ROLE_DESC = {
  admin: 'Acesso total: usuários, quinzenas, links de áudio, critérios, configurações e bugs.',
  qualidade: 'Altera análises, aplica feedbacks, responde contestações, importa monitorias e gera reports. Sem acesso à IA.',
  supervisor: 'Consulta atendimentos e gráficos, aplica e registra feedbacks aos operadores.',
};

export async function render(el, _p, ctx) {
  const users = await api.get('/users');
  if (!ctx.isCurrent()) return;
  el.innerHTML = String(html`
    <div class="page-head"><div><h2>Usuários &amp; acessos</h2><p>Crie acessos para Qualidade e Supervisão. A senha temporária é trocada no primeiro login.</p></div><div class="grow"></div>
      <button class="btn primary" id="u-new">${icon('plus')}Novo acesso</button></div>
    <div class="grid g-3 mb">${Object.entries(ROLE).map(([k, v]) => html`<div class="insight"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${icon(k === 'admin' ? 'shield' : k === 'qualidade' ? 'edit' : 'users')}</span><div><b>${v}</b> <span class="chip">${users.filter((u) => u.role === k && u.active).length}</span><div class="small t2">${ROLE_DESC[k]}</div></div></div>`)}</div>
    <div class="card"><div class="table-wrap"><table class="tbl"><thead><tr><th>Usuário</th><th>E-mail (login)</th><th>Perfil</th><th>Status</th><th>Último acesso</th><th></th></tr></thead>
      <tbody>${users.map((u) => html`<tr style="${u.active ? '' : 'opacity:.55'}">
        <td><div class="who">${avatar(u.display_name || u.name, 'sm')}<div><b>${u.name}</b><span>${u.display_name ? `chamado de “${u.display_name}”` : ''}</span></div></div></td>
        <td class="small">${u.email}</td><td><span class="chip ${u.role === 'admin' ? 'brand' : u.role === 'qualidade' ? 'info' : ''}">${ROLE[u.role]}</span></td>
        <td>${u.active ? (u.must_change_password ? html`<span class="chip warn">Aguardando 1º acesso</span>` : html`<span class="chip ok">Ativo</span>`) : html`<span class="chip">Inativo</span>`}</td>
        <td class="small muted">${u.last_login ? fmtRel(u.last_login) : 'nunca'}</td>
        <td class="right nowrap"><button class="btn sm ghost" data-reset="${u.id}">${icon('key')}Resetar senha</button><button class="btn-icon" data-e="${u.id}" aria-label="Editar">${icon('edit')}</button></td></tr>`)}</tbody></table></div></div>`);
  const reload = () => render(el, _p, ctx);
  $('#u-new').onclick = () => edit(null, reload, ctx);
  $$('[data-e]').forEach((b) => b.addEventListener('click', () => edit(users.find((u) => u.id === b.dataset.e), reload, ctx)));
  $$('[data-reset]').forEach((b) => b.addEventListener('click', async () => {
    const u = users.find((x) => x.id === b.dataset.reset);
    if (!(await confirmDialog('Resetar senha', `Uma nova senha temporária será gerada para ${u.name}. As sessões abertas serão encerradas.`, { ok: 'Gerar senha' }))) return;
    const r = await api.post(`/users/${u.id}/reset-password`);
    showPassword(u.email, r.temp_password); reload();
  }));
}

function showPassword(email, pw) {
  modal({
    title: 'Senha temporária',
    body: html`<p class="t2" style="margin-top:0">Envie ao usuário por um canal seguro. Ela será trocada no primeiro acesso e <b>não será exibida novamente</b>.</p>
      <div class="field"><span class="lbl">E-mail de acesso</span><div class="copy-box"><span>${email}</span></div></div>
      <div class="field"><span class="lbl">Senha</span><div class="copy-box"><span id="pw-v">${pw}</span><button class="btn sm" id="pw-copy">${icon('copy')}Copiar</button></div></div>
      <p class="small muted">Endereço de acesso: <b>${location.origin}</b></p>`,
    foot: html`<button class="btn primary" data-close>Pronto</button>`,
    onMount: (m) => { $('#pw-copy', m).onclick = () => { navigator.clipboard?.writeText(`Acesso PX Monitorias\n${location.origin}\nE-mail: ${email}\nSenha temporária: ${pw}`); toast('Dados de acesso copiados.'); }; },
  });
}

function edit(u, done, ctx) {
  modal({
    title: u ? `Editar ${u.name}` : 'Novo acesso',
    body: html`<form id="u-form">
      <div class="field"><label for="u-name">Nome completo</label><input class="input" id="u-name" name="name" required value="${u?.name || ''}"></div>
      <div class="field"><label for="u-email">E-mail corporativo (usado no login)</label><input class="input" id="u-email" name="email" type="email" required value="${u?.email || ''}" placeholder="nome.sobrenome@paschoalotto.com.br"></div>
      <div class="field"><span class="lbl">Perfil de acesso</span><div class="stack" style="gap:8px">${Object.entries(ROLE).map(([k, v]) => html`<label class="theme-opt ${(u?.role || 'supervisor') === k ? 'on' : ''}" style="align-items:flex-start"><input type="radio" name="role" value="${k}" ${(u?.role || 'supervisor') === k ? 'checked' : ''} style="accent-color:var(--brand);margin-top:3px"><div><b>${v}</b><div class="tiny muted">${ROLE_DESC[k]}</div></div></label>`)}</div></div>
      ${u ? html`<label class="switch"><input type="checkbox" name="active" ${u.active ? 'checked' : ''} ${u.id === ctx.store.user.id ? 'disabled' : ''}> Acesso ativo</label>` : ''}
    </form>`,
    foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="u-ok">${u ? 'Salvar' : 'Criar acesso'}</button>`,
    onMount: (m, close) => {
      $$('input[name=role]', m).forEach((r) => r.addEventListener('change', () => $$('.theme-opt', m).forEach((o) => o.classList.toggle('on', o.contains(r) && r.checked || ($('input', o).checked)))));
      $('#u-ok', m).onclick = async (e) => {
        const f = $('#u-form', m); if (!f.reportValidity()) return;
        const body = { name: f.name.value, email: f.email.value, role: f.role.value };
        busy(e.currentTarget, true);
        try {
          if (u) { await api.put(`/users/${u.id}`, { ...body, active: f.active.checked }); toast('Usuário atualizado.'); close(); }
          else {
            const r = await api.post('/users', body); close();
            if (r.temp_password) showPassword(r.user.email, r.temp_password);
            else toast('Acesso liberado. Este e-mail já tinha conta no Supabase (ex.: simulador) — a pessoa entra com a senha que já usa.', 'ok', 7000);
          }
          await ctx.refreshMeta(); done();
        } catch (ex) { toast(ex.message, 'err'); busy(e.currentTarget, false); }
      };
    },
  });
}

import { api } from '../api.js';
import { html, icon, $, toast, busy, avatar, ROLE, fmtDate } from '../ui.js';
import { applyTheme } from '../app.js';
import { downloadWindowsShortcut } from '../desktop.js';

export async function render(el, _p, ctx) {
  const u = ctx.store.user;
  el.innerHTML = String(html`
    <div class="page-head"><div><h2>Meu perfil</h2><p>Como você aparece na plataforma e nos registros de feedback.</p></div></div>
    <div class="grid g-2">
      <form class="card card-pad" id="pf-form">
        <div class="row mb">${avatar(u.display_name || u.name, 'lg')}<div><b style="font-size:18px">${u.name}</b><div class="small muted">${u.email} · ${ROLE[u.role]} · desde ${fmtDate(u.created_at)}</div></div></div>
        <div class="field"><label for="pf-dn">Como gostaria de ser chamado(a)</label><input class="input" id="pf-dn" name="display_name" maxlength="40" required value="${u.display_name || ''}"></div>
        <div class="field"><span class="lbl">E-mail de acesso</span><div class="input" style="opacity:.7">${u.email}</div><span class="hint">Para trocar o e-mail, fale com o administrador.</span></div>
        <div class="field"><label for="pf-th">Tema</label><select class="select" id="pf-th" name="theme"><option value="dark" ${u.theme !== 'light' ? 'selected' : ''}>Escuro</option><option value="light" ${u.theme === 'light' ? 'selected' : ''}>Claro</option></select></div>
        <button class="btn primary" id="pf-save">${icon('check')}Salvar perfil</button>
      </form>
      <form class="card card-pad" id="pw-form">
        <h3 style="margin:0 0 14px;font-size:15px">${icon('lock')} Alterar senha</h3>
        <input type="email" name="username" value="${u.email}" autocomplete="username" hidden>
        <div class="field"><label for="pw-c">Senha atual</label><input class="input" id="pw-c" name="current" type="password" autocomplete="current-password" required></div>
        <div class="field"><label for="pw-n">Nova senha</label><input class="input" id="pw-n" name="next" type="password" autocomplete="new-password" required minlength="8"><span class="hint">Mínimo de 8 caracteres, com letras e números.</span></div>
        <div class="field"><label for="pw-k">Confirmar nova senha</label><input class="input" id="pw-k" type="password" autocomplete="new-password" required></div>
        <button class="btn" id="pw-save">${icon('key')}Atualizar senha</button>
      </form>
      <div class="card card-pad span-2" id="desk">
        <div class="row" style="align-items:flex-start;gap:18px">
          <img src="/icons/px-128.png" alt="Ícone PX" width="72" height="72" style="border-radius:18px;box-shadow:0 12px 30px -10px rgba(124,108,255,.7)">
          <div style="flex:1;min-width:260px"><h3 style="margin:0 0 4px;font-size:16px">Atalho na área de trabalho</h3>
            <p class="small t2" style="margin:0 0 12px">Abra a plataforma com um clique, em janela própria e com o ícone <b>PX</b> — igual ao simulador de negociação.</p>
            <div class="row"><button class="btn primary" id="dk-win">${icon('download')}Atalho para Windows</button>
              <button class="btn" id="dk-pwa">${icon('plus')}Instalar como aplicativo</button></div>
            <p class="tiny muted" style="margin:10px 0 0">Windows: baixe e dê dois cliques no arquivo .bat — o atalho “PX Monitorias” aparece na área de trabalho. Mac/Linux: use “Instalar como aplicativo” (Chrome ou Edge) para fixar o ícone PX no Dock/menu.</p></div>
        </div></div>
    </div>`);
  $('#dk-win').onclick = () => { downloadWindowsShortcut(); toast('Abra o arquivo baixado para criar o atalho.'); };
  $('#dk-pwa').onclick = async () => {
    const pr = ctx.store.installPrompt;
    if (pr) { pr.prompt(); const r = await pr.userChoice; if (r.outcome === 'accepted') toast('Aplicativo instalado!'); ctx.store.installPrompt = null; }
    else toast('Use o menu do navegador › “Instalar PX Monitorias” (ou “Apps › Instalar este site”). Requer HTTPS.', 'ok', 6000);
  };
  $('#pf-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    busy($('#pf-save'), true);
    try {
      const r = await api.patch('/auth/profile', { display_name: f.display_name.value, theme: f.theme.value });
      ctx.store.user = r.user; applyTheme(r.user.theme); toast('Perfil atualizado.');
      location.reload();
    } catch (ex) { toast(ex.message, 'err'); busy($('#pf-save'), false); }
  });
  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    if (f.next.value !== $('#pw-k').value) { toast('As senhas não conferem.', 'err'); return; }
    busy($('#pw-save'), true);
    try { await api.post('/auth/password', { current: f.current.value, next: f.next.value }); toast('Senha alterada.'); f.reset(); }
    catch (ex) { toast(ex.message, 'err'); }
    busy($('#pw-save'), false);
  });
}

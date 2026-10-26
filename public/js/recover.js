// Página aberta pelo link de recuperação de senha enviado pelo Supabase.
// O link traz a sessão de recuperação no endereço (#access_token=...&type=recovery).
import { html, icon, pxLogo, $, toast, busy } from './ui.js';
import { api } from './api.js';
import { sb } from './sb.js';

const app = document.getElementById('app');
const hp = new URLSearchParams(location.hash.replace(/^#/, ''));
const linkError = hp.get('error_description');
const home = () => { location.href = new URL('./', location.href).href; };

async function main() {
  // A sessão de recuperação vem no endereço; guardamos e limpamos a URL
  let ok = false;
  if (hp.get('access_token') && hp.get('refresh_token')) {
    const { error } = await sb.auth.setSession({ access_token: hp.get('access_token'), refresh_token: hp.get('refresh_token') });
    ok = !error;
  }
  history.replaceState(null, '', location.pathname);
  app.innerHTML = String(html`
  <div class="welcome"><div class="mesh"></div>
    <div class="welcome-card" style="max-width:480px">
      ${pxLogo(52)}
      <h1>Criar nova senha</h1>
      ${!ok ? html`<div class="banner warn mt">${icon('alert')}<div>${linkError || 'Link de recuperação inválido ou expirado.'} Solicite um novo link na tela de login.</div></div>
        <button class="btn primary lg block mt" id="rc-back">Voltar ao login</button>`
      : html`<p class="t2">Defina a senha que você vai usar para entrar. Mínimo de 8 caracteres, com letras e números.</p>
      <form id="rc-form" class="mt">
        <div class="field"><label for="rc-new">Nova senha</label><input class="input lg" id="rc-new" type="password" autocomplete="new-password" required minlength="8"></div>
        <div class="field"><label for="rc-conf">Confirme a nova senha</label><input class="input lg" id="rc-conf" type="password" autocomplete="new-password" required></div>
        <div id="rc-err" class="banner warn" hidden></div>
        <button class="btn primary lg block" id="rc-btn">${icon('lock')}Salvar e entrar</button>
      </form>`}
    </div></div>`);
  $('#rc-back')?.addEventListener('click', home);
  $('#rc-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = $('#rc-err'); box.hidden = true;
    const fail = (m) => { box.innerHTML = String(html`${icon('alert')}<span>${m}</span>`); box.hidden = false; busy($('#rc-btn'), false); };
    if ($('#rc-new').value !== $('#rc-conf').value) return fail('As senhas não conferem.');
    busy($('#rc-btn'), true, 'Salvando');
    try { await api.post('/auth/recover', { password: $('#rc-new').value }); toast('Senha criada! Entrando…'); setTimeout(home, 700); }
    catch (ex) { fail(ex.message); }
  });
}
main();

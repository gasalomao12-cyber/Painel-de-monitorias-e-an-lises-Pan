import { api } from '../api.js';
import { sb, recoveryUrl } from '../sb.js';
import { html, icon, pxLogo, $, $$, toast, busy, greeting, modal } from '../ui.js';
import { applyTheme } from '../app.js';
import { downloadWindowsShortcut } from '../desktop.js';

function pwToggle(root) {
  $$('[data-pw]', root).forEach((b) => b.addEventListener('click', () => {
    const inp = b.parentElement.querySelector('input');
    inp.type = inp.type === 'password' ? 'text' : 'password';
    b.innerHTML = String(icon(inp.type === 'password' ? 'eye' : 'eyeOff'));
  }));
}

const authMessage = (m = '') => (/banned/i.test(m) ? 'Seu acesso está desativado. Fale com o administrador.'
  : /confirm/i.test(m) ? 'Confirme seu e-mail antes de entrar.'
  : /rate limit|too many/i.test(m) ? 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'
  : /fetch|network/i.test(m) ? 'Sem conexão com o servidor. Verifique sua internet.'
  : 'E-mail ou senha inválidos.');

export function renderLogin(app, { onLogin, store, error = '' }) {
  document.title = 'Entrar · PX Monitorias';
  const remembered = localStorage.getItem('px_last_email') || '';
  app.innerHTML = String(html`
  <div class="auth">
    <section class="auth-hero">
      <div class="mesh"></div><div class="grain"></div>
      <div class="auth-brand">${pxLogo(46)}<div>PX Monitorias &amp; Feedbacks<small>${store.company}</small></div></div>
      <div>
        <h1>Qualidade que vira resultado.</h1>
        <p class="lead">Reports quinzenais de Refinanciamento e Entrega Amigável, análises revisadas com apoio de IA e feedbacks rastreáveis — tudo em um só lugar.</p>
        <div class="auth-feats">
          <div class="auth-feat"><b>${icon('sparkles')}Análise com IA</b>Corrige leituras equivocadas do speech a partir da transcrição.</div>
          <div class="auth-feat"><b>${icon('edit')}Ajuste de análise</b>O analista valida cada critério antes do feedback.</div>
          <div class="auth-feat"><b>${icon('msgCheck')}Feedback rastreável</b>Registro do que foi passado, por quem e quando.</div>
          <div class="auth-feat"><b>${icon('report')}Dashboards com capa</b>Visão geral e comparativos prontos para apresentar.</div>
        </div>
      </div>
      <div class="auth-foot">© ${new Date().getFullYear()} ${store.company} · Qualidade & Monitoria</div>
    </section>
    <section class="auth-panel">
      <div class="auth-card">
        <div class="auth-mobile-brand row">${pxLogo(44)}<b>PX Monitorias &amp; Feedbacks</b></div>
        <h2>${greeting()}! 👋</h2>
        <p class="sub">Entre com o acesso fornecido pela equipe de Qualidade.</p>
        <form id="login-form" autocomplete="on">
          <div class="field"><label for="l-user">E-mail corporativo</label><input class="input lg" id="l-user" name="email" type="email" autocomplete="username" required value="${remembered}" placeholder="nome.sobrenome@paschoalotto.com.br"></div>
          <div class="field"><label for="l-pass">Senha</label><div class="pw-wrap"><input class="input lg" id="l-pass" name="password" type="password" autocomplete="current-password" required placeholder="••••••••"><button type="button" class="btn-icon" data-pw aria-label="Mostrar senha">${icon('eye')}</button></div></div>
          <div class="row between mb"><label class="check"><input type="checkbox" id="l-remember" ${remembered ? 'checked' : ''}> Lembrar meu e-mail</label><button type="button" class="btn sm ghost" id="l-forgot">Esqueci minha senha</button></div>
          <div id="l-err" class="banner warn" ${error ? '' : 'hidden'}>${error ? html`${icon('alert')}<span>${error}</span>` : ''}</div>
          <button class="btn primary lg block" id="l-btn">Entrar ${icon('arrowRight')}</button>
        </form>
        <p class="tiny muted center mt">Ainda não tem acesso? Peça ao administrador da plataforma.</p>
        <p class="center" style="margin:6px 0 0"><button type="button" class="btn sm ghost" id="l-shortcut">${icon('download')}Criar atalho na área de trabalho</button></p>
      </div>
    </section>
  </div>`);
  pwToggle(app);
  const form = $('#login-form');
  $('#l-forgot').onclick = () => forgotPassword(form.email.value.trim());
  $('#l-shortcut').onclick = () => { downloadWindowsShortcut(); toast('Abra o arquivo baixado para criar o atalho PX na área de trabalho.', 'ok', 6000); };
  setTimeout(() => (remembered ? $('#l-pass') : $('#l-user')).focus(), 50);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#l-btn'), err = $('#l-err');
    err.hidden = true;
    busy(btn, true, 'Entrando');
    try {
      const { error: e } = await sb.auth.signInWithPassword({ email: form.email.value.trim().toLowerCase(), password: form.password.value });
      if (e) throw new Error(authMessage(e.message));
      if ($('#l-remember').checked) localStorage.setItem('px_last_email', form.email.value.trim()); else localStorage.removeItem('px_last_email');
      onLogin({ fresh: true });
    } catch (ex) {
      err.innerHTML = String(html`${icon('alert')}<span>${ex.message}</span>`); err.hidden = false;
      busy(btn, false);
      form.password.select();
    }
  });
}

export function renderChangePassword(app, { store, onDone, onLogout }) {
  document.title = 'Defina sua senha · PX Monitorias';
  app.innerHTML = String(html`
  <div class="welcome"><div class="mesh"></div>
    <div class="welcome-card" style="max-width:480px">
      ${pxLogo(52)}
      <h1>Defina sua senha</h1>
      <p class="t2">Por segurança, troque a senha temporária no primeiro acesso. Use pelo menos 8 caracteres, com letras e números.</p>
      <form id="pw-form" class="mt">
        <input type="email" name="username" value="${store.user.email}" autocomplete="username" hidden>
        <div class="field"><label for="p-cur">Senha atual (temporária)</label><div class="pw-wrap"><input class="input lg" id="p-cur" name="current" type="password" autocomplete="current-password" required><button type="button" class="btn-icon" data-pw aria-label="Mostrar senha">${icon('eye')}</button></div></div>
        <div class="field"><label for="p-new">Nova senha</label><div class="pw-wrap"><input class="input lg" id="p-new" name="next" type="password" autocomplete="new-password" required minlength="8"><button type="button" class="btn-icon" data-pw aria-label="Mostrar senha">${icon('eye')}</button></div>
          <div class="meter"><i id="p-meter" style="width:0"></i></div><span class="hint" id="p-hint">Força da senha</span></div>
        <div class="field"><label for="p-conf">Confirme a nova senha</label><input class="input lg" id="p-conf" type="password" autocomplete="new-password" required></div>
        <div id="p-err" class="banner warn" hidden></div>
        <button class="btn primary lg block" id="p-btn">${icon('lock')}Salvar e continuar</button>
        <button type="button" class="btn ghost block mt" id="p-out">Sair</button>
      </form>
    </div></div>`);
  pwToggle(app);
  const f = $('#pw-form');
  $('#p-new').addEventListener('input', (e) => {
    const v = e.target.value;
    const s = [v.length >= 8, /[a-z]/.test(v) && /[A-Z]/.test(v), /\d/.test(v), /[^A-Za-z0-9]/.test(v), v.length >= 12].filter(Boolean).length;
    $('#p-meter').style.width = `${s * 20}%`;
    $('#p-hint').textContent = ['Muito fraca', 'Fraca', 'Razoável', 'Boa', 'Forte', 'Excelente'][s];
  });
  $('#p-out').onclick = onLogout;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#p-err'); err.hidden = true;
    if (f.next.value !== $('#p-conf').value) { err.innerHTML = String(html`${icon('alert')}<span>As senhas não conferem.</span>`); err.hidden = false; return; }
    busy($('#p-btn'), true, 'Salvando');
    try { await api.post('/auth/password', { current: f.current.value, next: f.next.value }); toast('Senha atualizada!'); onDone(); }
    catch (ex) { err.innerHTML = String(html`${icon('alert')}<span>${ex.message}</span>`); err.hidden = false; busy($('#p-btn'), false); }
  });
}

export function renderWelcome(app, { store, onDone }) {
  document.title = 'Boas-vindas · PX Monitorias';
  const first = String(store.user.name || '').split(' ')[0];
  let theme = store.user.theme || 'dark';
  const role = store.user.role;
  const tour = {
    admin: [['folder', 'Controle total', 'Gerencie quinzenas, links das pastas de áudio, critérios e acessos.'], ['sparkles', 'IA na revisão', 'Anexe transcrições e deixe a IA corrigir o que o speech interpretou mal.'], ['report', 'Reports prontos', 'Gere dashboards com capa para apresentar os resultados.']],
    qualidade: [['edit', 'Ajuste a análise', 'Corrija critérios marcados errado pelo speech antes do feedback.'], ['sparkles', 'Análise com IA', 'Anexe transcrições e receba a análise com evidências.'], ['report', 'Reports quinzenais', 'Publique a visão geral e os comparativos.']],
    supervisor: [['headset', 'Atendimentos da equipe', 'Veja cada monitoria com a análise validada pela Qualidade.'], ['msgCheck', 'Aplique feedbacks', 'Registre o que foi passado — o card fica verde.'], ['trendUp', 'Acompanhe a evolução', 'Gráficos por operador e por quinzena.']],
  }[role];
  app.innerHTML = String(html`
  <div class="welcome"><div class="mesh"></div>
    <div class="welcome-card">
      <div class="welcome-steps"><i class="on"></i><i class="on"></i><i></i></div>
      <div class="row mt" style="gap:14px">${pxLogo(52)}<span class="chip brand">${icon('sparkles')}Primeiro acesso</span></div>
      <h1><span class="hello">Que bom ter você aqui${first ? ', ' + first : ''}!</span></h1>
      <p class="t2" style="margin:0">Esta é a sua central de Monitorias &amp; Feedbacks. Antes de começar, personalize sua experiência.</p>
      <form id="wl-form" class="mt-lg">
        <div class="field"><label for="w-name">Como você gostaria de ser chamado(a)?</label>
          <input class="input lg" id="w-name" name="display_name" maxlength="40" required value="${store.user.display_name || first}" placeholder="Ex.: Gabi, Dr. Paulo, Fer…">
          <span class="hint">É assim que vamos te cumprimentar no painel e nos registros de feedback.</span></div>
        <div class="field"><span class="lbl">Tema</span>
          <div class="theme-pick">
            <div class="theme-opt ${theme === 'dark' ? 'on' : ''}" data-theme-opt="dark" role="button" tabindex="0"><span class="sw d"></span><div><b>Escuro</b><div class="tiny muted">Ideal para longas jornadas</div></div></div>
            <div class="theme-opt ${theme === 'light' ? 'on' : ''}" data-theme-opt="light" role="button" tabindex="0"><span class="sw l"></span><div><b>Claro</b><div class="tiny muted">Ótimo para apresentar</div></div></div>
          </div></div>
        <div class="tour">${tour.map(([ic, t, d]) => html`<div><span class="ic">${icon(ic)}</span><b>${t}</b>${d}</div>`)}</div>
        <button class="btn primary lg block" id="w-btn">Começar ${icon('arrowRight')}</button>
      </form>
    </div></div>`);
  $$('[data-theme-opt]').forEach((el) => {
    const pick = () => { theme = el.dataset.themeOpt; applyTheme(theme); $$('[data-theme-opt]').forEach((x) => x.classList.toggle('on', x === el)); };
    el.addEventListener('click', pick);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  });
  $('#w-name').select();
  $('#wl-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    busy($('#w-btn'), true, 'Preparando');
    try {
      const r = await api.post('/auth/onboarding', { display_name: $('#w-name').value, theme });
      store.user = r.user;
      toast(`Tudo pronto, ${r.user.display_name}!`);
      onDone();
    } catch (ex) { toast(ex.message, 'err'); busy($('#w-btn'), false); }
  });
}

function forgotPassword(prefill) {
  modal({
    title: 'Recuperar senha',
    body: html`<p class="t2" style="margin-top:0">Informe seu e-mail corporativo. Se ele tiver acesso, você recebe um link para criar uma nova senha.</p>
      <div class="field"><label for="fg-email">E-mail</label><input class="input" id="fg-email" type="email" value="${prefill}" placeholder="nome.sobrenome@paschoalotto.com.br"></div>`,
    foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="fg-ok">${icon('arrowRight')}Enviar link</button>`,
    onMount: (m, close) => {
      $('#fg-ok', m).onclick = async (e) => {
        const btnEl = e.currentTarget;
        busy(btnEl, true, 'Enviando');
        const email = $('#fg-email', m).value.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('Informe um e-mail válido.', 'err'); busy(btnEl, false); return; }
        try {
          const { error: er } = await sb.auth.resetPasswordForEmail(email, { redirectTo: recoveryUrl() });
          if (er && /rate limit|too many/i.test(er.message)) throw new Error('Muitas solicitações. Aguarde alguns minutos e tente de novo.');
          close(); toast('Se o e-mail tiver acesso, o link de recuperação chega em instantes. Confira também o spam.', 'ok', 7000); }
        catch (ex) { toast(ex.message, 'err'); busy(btnEl, false); }
      };
    },
  });
}

import { api } from './api.js';
import { sb } from './sb.js';
import { html, raw, icon, pxLogo, $, $$, toast, modal, avatar, userName, ROLE, esc, busy, readFileAsBase64, fmtRel } from './ui.js';
import { destroyAll } from './charts.js';
import { renderLogin, renderChangePassword, renderWelcome } from './views/auth.js';

const app = document.getElementById('app');
export const store = { user: null, meta: null, company: 'Paschoalotto', cycle: localStorage.getItem('px_cycle') || '' };

// ---------------- Tema ----------------
export function applyTheme(t) {
  const theme = t || store.user?.theme || localStorage.getItem('px_theme') || 'dark';
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('px_theme', theme);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme === 'light' ? '#f4f6fb' : '#0a0e1a');
}
applyTheme(localStorage.getItem('px_theme'));

// ---------------- Navegação ----------------
const NAV = [
  { sec: 'Visão geral' },
  { id: 'painel', label: 'Painel', icon: 'dashboard' },
  { id: 'atendimentos', label: 'Atendimentos', icon: 'headset' },
  { id: 'operadores', label: 'Operadores', icon: 'users' },
  { sec: 'Qualidade', roles: ['admin', 'qualidade'] },
  { id: 'analise-ia', label: 'Análise com IA', icon: 'sparkles', roles: ['admin'] },
  { id: 'importar', label: 'Importar monitorias', icon: 'upload', roles: ['admin', 'qualidade'] },
  { sec: 'Feedbacks' },
  { id: 'feedbacks/pendentes', label: 'Feedbacks pendentes', icon: 'msgClock', count: 'pending_feedback' },
  { id: 'feedbacks/aplicados', label: 'Feedbacks aplicados', icon: 'msgCheck' },
  { id: 'contestacoes', label: 'Contestações', icon: 'flag', count: 'open_contests', hot: true },
  { sec: 'Relatórios' },
  { id: 'relatorios', label: 'Dashboards & reports', icon: 'report' },
  { sec: 'Administração' },
  { id: 'ciclos', label: 'Quinzenas & áudios', icon: 'folder', roles: ['admin'] },
  { id: 'criterios', label: 'Critérios de avaliação', icon: 'list', roles: ['admin'] },
  { id: 'usuarios', label: 'Usuários & acessos', icon: 'userCog', roles: ['admin'] },
  { id: 'bugs', label: 'Bugs reportados', icon: 'bug', count: 'open_bugs', hot: true },
  { id: 'auditoria', label: 'Auditoria', icon: 'shield', roles: ['admin'] },
  { id: 'configuracoes', label: 'Configurações', icon: 'settings', roles: ['admin'] },
];

const ROUTES = [
  [/^painel$/, () => import('./views/dashboard.js'), 'Painel'],
  [/^atendimentos$/, () => import('./views/evaluations.js'), 'Atendimentos'],
  [/^atendimentos\/(\d+)$/, () => import('./views/evaluation.js'), 'Atendimento'],
  [/^operadores$/, () => import('./views/operators.js'), 'Operadores'],
  [/^operadores\/(\d+)$/, () => import('./views/operator.js'), 'Operador'],
  [/^analise-ia$/, () => import('./views/ai.js'), 'Análise com IA', ['admin']],
  [/^contestacoes$/, () => import('./views/contests.js'), 'Contestações'],
  [/^importar$/, () => import('./views/import.js'), 'Importar monitorias', ['admin', 'qualidade']],
  [/^feedbacks\/(pendentes|aplicados)$/, () => import('./views/feedbacks.js'), 'Feedbacks'],
  [/^relatorios$/, () => import('./views/reports.js'), 'Dashboards & reports'],
  [/^ciclos$/, () => import('./views/cycles.js'), 'Quinzenas & áudios', ['admin']],
  [/^criterios$/, () => import('./views/criteria.js'), 'Critérios de avaliação', ['admin']],
  [/^usuarios$/, () => import('./views/users.js'), 'Usuários & acessos', ['admin']],
  [/^bugs$/, () => import('./views/bugs.js'), 'Bugs reportados'],
  [/^auditoria$/, () => import('./views/audit.js'), 'Auditoria', ['admin']],
  [/^configuracoes$/, () => import('./views/settings.js'), 'Configurações', ['admin']],
  [/^perfil$/, () => import('./views/profile.js'), 'Meu perfil'],
];

export const can = (...roles) => !!store.user && roles.includes(store.user.role);
export const navigate = (path) => { if (location.hash !== `#/${path}`) location.hash = `#/${path}`; else route(); };
export function setTitle(title, crumb = '') {
  const h = $('#page-title'); if (h) h.textContent = title;
  const c = $('#page-crumb'); if (c) c.textContent = crumb;
  document.title = `${title} · PX Monitorias`;
}

export async function refreshMeta() {
  store.meta = await api.get('/meta');
  updateCounts();
  return store.meta;
}

function updateCounts() {
  if (!store.meta) return;
  for (const n of NAV.filter((x) => x.count)) {
    const el = $(`[data-count="${n.count}"]`);
    if (!el) continue;
    const v = store.meta.counts[n.count] || 0;
    el.textContent = v; el.hidden = !v;
  }
  const dot = $('#notif-dot');
  if (dot) { const u = store.meta.counts.unread; dot.textContent = u > 9 ? '9+' : u; dot.hidden = !u; }
}

// Menu lateral: recolhe sozinho em telas estreitas; a escolha manual vale por tipo de tela
const sidebarKey = () => `px_sidebar_${document.documentElement.dataset.narrow === '1' ? 'narrow' : 'wide'}`;
function sidebarCollapsed() {
  const p = localStorage.getItem(sidebarKey());
  return p ? p === 'collapsed' : document.documentElement.dataset.narrow === '1';
}
// Posição de um elemento em coordenadas CSS da página (o zoom da interface muda a escala)
function anchorRect(el) {
  const z = window.PX_ZOOM?.get() || 1;
  const r = el.getBoundingClientRect();
  return { top: (r.top + window.scrollY) / z, bottom: (r.bottom + window.scrollY) / z, left: r.left / z, right: r.right / z, vw: window.innerWidth / z };
}
const zoomLabel = () => `${Math.round((window.PX_ZOOM?.get() || 1) * 100)}%`;

function shell() {
  const u = store.user;
  const collapsed = sidebarCollapsed();
  const navHtml = NAV.filter((n) => !n.roles || n.roles.includes(u.role)).map((n) => n.sec
    ? html`<div class="sb-sec">${n.sec}</div>`
    : html`<a class="sb-link" href="#/${n.id}" data-nav="${n.id}" title="${n.id === 'bugs' && u.role !== 'admin' ? 'Meus reports' : n.label}">${icon(n.icon)}<span>${n.id === 'bugs' && u.role !== 'admin' ? 'Meus reports de bug' : n.label}</span>${n.count ? html`<b class="count ${n.hot ? 'hot' : ''}" data-count="${n.count}" hidden></b>` : ''}</a>`);
  app.innerHTML = String(html`
  <div class="shell ${collapsed ? 'collapsed' : ''}" id="shell">
    <aside class="sidebar" aria-label="Menu principal">
      <div class="sb-head">
        ${pxLogo(40)}
        <div class="sb-title">Monitorias<br>&amp; Feedbacks<small>${store.company}</small></div>
        <button class="btn-icon sb-toggle" id="sb-toggle" aria-label="Recolher menu" title="Recolher menu">${icon('panel')}</button>
      </div>
      <nav class="sb-nav">${navHtml}</nav>
      <div class="sb-foot">
        <div class="me">
          <a href="#/perfil" class="row" style="text-decoration:none;flex:1;min-width:0;gap:10px" title="Meu perfil">
            ${avatar(userName(u))}
            <div class="meta"><b>${userName(u)}</b><span>${ROLE[u.role]}</span></div>
          </a>
          <button class="btn-icon" id="theme-btn" aria-label="Alternar tema" title="Alternar tema">${icon(document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun')}</button>
          <button class="btn-icon" id="logout-btn" aria-label="Sair" title="Sair">${icon('logout')}</button>
        </div>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="btn-icon mobile-only" id="nav-open" aria-label="Abrir menu">${icon('menu')}</button>
        <div style="min-width:0"><div class="crumb" id="page-crumb"></div><h1 id="page-title">PX</h1></div>
        <div class="grow"></div>
        <label class="search"><span class="sr-only">Buscar</span>${icon('search')}<input id="global-search" placeholder="Buscar operador, protocolo, página…" autocomplete="off"><kbd>Ctrl K</kbd></label>
        <button class="btn-icon zoom-btn" id="zoom-btn" title="Tamanho da tela" aria-label="Tamanho da tela">${icon('zoom')}<span id="zoom-label">${zoomLabel()}</span></button>
        <span class="live-dot" id="live-dot" data-on="0" title="Conectando…"><i></i><span>Ao vivo</span></span>
        <button class="btn-icon" id="notif-btn" aria-label="Notificações" title="Notificações">${icon('bell')}<b class="dot" id="notif-dot" hidden></b></button>
        <button class="btn sm ghost" id="bug-top" title="Reportar um problema">${icon('bug')}<span class="nowrap">Reportar bug</span></button>
      </header>
      <main class="content" id="view"></main>
    </div>
  </div>
  <button class="fab-bug" id="bug-fab" aria-label="Reportar bug">${icon('bug')}<span>Reportar bug</span></button>`);

  $('#sb-toggle').onclick = () => {
    const s = $('#shell'); s.classList.toggle('collapsed');
    localStorage.setItem(sidebarKey(), s.classList.contains('collapsed') ? 'collapsed' : 'open');
    setTimeout(() => window.dispatchEvent(new Event('resize')), 320);
  };
  $('#zoom-btn').onclick = (e) => openZoom(e.currentTarget);
  $('#nav-open').onclick = () => $('#shell').classList.add('nav-open');
  $('#shell').addEventListener('click', (e) => {
    if (e.target.id === 'shell' || e.target.closest('.sb-link')) $('#shell').classList.remove('nav-open');
  });
  $('#theme-btn').onclick = async () => {
    const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(t);
    $('#theme-btn').innerHTML = String(icon(t === 'light' ? 'moon' : 'sun'));
    store.user.theme = t;
    api.patch('/auth/profile', { theme: t }).catch(() => {});
    route();
  };
  $('#logout-btn').onclick = logout;
  $('#bug-fab').onclick = openBugReport;
  $('#bug-top').onclick = openBugReport;
  $('#notif-btn').onclick = (e) => openNotifications(e.currentTarget);
  $('#global-search').addEventListener('focus', (e) => { e.target.blur(); openPalette(); });
  updateCounts();
}

async function logout() {
  store.user = null; store.meta = null;
  await sb.auth.signOut().catch(() => {});
  location.hash = '';
  start();
}

let routeToken = 0;
let currentView = null;
export async function route(opts = {}) {
  if (!store.user) return;
  const path = location.hash.replace(/^#\/?/, '') || 'painel';
  const found = ROUTES.find(([re]) => re.test(path));
  if (!found) { navigate('painel'); return; }
  const [re, loader, title, roles] = found;
  if (roles && !roles.includes(store.user.role)) { toast('Seu perfil não tem acesso a esta área.', 'err'); navigate('painel'); return; }
  const params = path.match(re).slice(1);
  $$('.sb-link').forEach((a) => {
    const id = a.dataset.nav;
    a.classList.toggle('active', path === id || (path.startsWith(id + '/') && id !== 'feedbacks'));
  });
  const token = ++routeToken;
  const view = $('#view');
  const keepScroll = opts.silent ? window.scrollY : 0;
  if (opts.silent) {
    // Atualização em tempo real: renderiza fora da tela e troca sem piscar
    try {
      const mod = await loader();
      if (token !== routeToken) return;
      const tmp = document.createElement('main');
      tmp.className = view.className; tmp.id = 'view'; tmp.style.animation = 'none';
      destroyAll();
      view.replaceWith(tmp);
      await mod.render(tmp, params, { store, can, navigate, refreshMeta, setTitle, isCurrent: () => token === routeToken });
      currentView = mod;
      window.scrollTo({ top: keepScroll });
    } catch (err) { console.error(err); }
    return;
  }
  destroyAll();
  view.innerHTML = '<div class="grid g-4"><div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:120px"></div></div><div class="skeleton mt" style="height:340px"></div>';
  setTitle(title);
  try {
    const mod = await loader();
    if (token !== routeToken) return;
    view.style.animation = 'none'; void view.offsetWidth; view.style.animation = '';
    await mod.render(view, params, { store, can, navigate, refreshMeta, setTitle, isCurrent: () => token === routeToken });
    currentView = mod;
    window.scrollTo({ top: 0 });
  } catch (err) {
    console.error(err);
    if (token === routeToken) view.innerHTML = String(html`<div class="empty"><div class="ic">${icon('alert')}</div><h4>Não foi possível carregar esta página</h4><p>${err.message}</p><button class="btn" id="reload-btn">Recarregar</button></div>`);
    $('#reload-btn')?.addEventListener('click', () => location.reload());
  }
}

// ---------------- Bug report ----------------
export function openBugReport() {
  let shot = null;
  modal({
    title: 'Reportar um problema',
    body: html`
      <p class="t2" style="margin-top:0">Conte o que aconteceu. O administrador recebe o aviso na hora e você acompanha a resolução em <b>Meus reports</b>.</p>
      <form id="bug-form">
        <div class="field"><label for="b-title">Título</label><input class="input" id="b-title" name="title" maxlength="140" required placeholder="Ex.: Botão de salvar ajuste não responde"></div>
        <div class="field"><label for="b-desc">O que aconteceu?</label><textarea class="textarea" id="b-desc" name="description" required placeholder="Passos para reproduzir, o que esperava e o que aconteceu."></textarea></div>
        <div class="grid g-2">
          <div class="field"><label for="b-sev">Gravidade</label><select class="select" id="b-sev" name="severity">
            <option value="baixa">Baixa — detalhe visual</option><option value="media" selected>Média — atrapalha o uso</option><option value="alta">Alta — impede uma tarefa</option><option value="critica">Crítica — sistema indisponível</option></select></div>
          <div class="field"><label>Print da tela (opcional)</label><label class="btn" style="justify-content:flex-start">${icon('image')}<span id="b-shot-lbl">Anexar ou colar imagem</span><input type="file" accept="image/png,image/jpeg,image/webp" id="b-shot" hidden></label></div>
        </div>
        <p class="tiny muted">Página atual e navegador são enviados automaticamente: ${location.hash || '#/'}</p>
      </form>`,
    foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="b-send">${icon('bug')}Enviar report</button>`,
    onMount: (m, close) => {
      const setShot = async (file) => {
        if (!file) return;
        if (file.size > 3e6) { toast('Imagem acima de 3 MB.', 'err'); return; }
        shot = await readFileAsBase64(file);
        $('#b-shot-lbl', m).textContent = file.name || 'Imagem colada';
      };
      $('#b-shot', m).onchange = (e) => setShot(e.target.files[0]);
      m.addEventListener('paste', (e) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/')); if (f) setShot(f); });
      $('#b-send', m).onclick = async (e) => {
        const f = $('#bug-form', m);
        if (!f.reportValidity()) return;
        busy(e.currentTarget, true, 'Enviando');
        try {
          await api.post('/bugs', { title: f.title.value, description: f.description.value, severity: f.severity.value, page: location.hash, screenshot: shot });
          close(); toast('Report enviado. Obrigado por ajudar a melhorar a plataforma!');
          refreshMeta().catch(() => {});
        } catch (err) { toast(err.message, 'err'); busy(e.currentTarget, false); }
      };
    },
  });
}

// ---------------- Notificações ----------------
async function openNotifications(anchor) {
  const existing = $('.popover.notif');
  if (existing) { existing.remove(); return; }
  const list = await api.get('/notifications').catch(() => []);
  const pop = document.createElement('div');
  pop.className = 'popover notif';
  const r = anchorRect(anchor);
  pop.style.top = `${r.bottom + 8}px`;
  pop.style.right = `${Math.max(12, r.vw - r.right)}px`;
  pop.innerHTML = String(html`<div class="p-head"><span class="grow">Notificações</span>${list.some((n) => !n.read) ? html`<button class="btn sm ghost" id="n-read">Marcar como lidas</button>` : ''}</div>
    <div class="p-list">${list.length ? list.map((n) => html`<a class="p-item ${n.read ? '' : 'unread'}" href="${n.link || '#/painel'}"><b>${n.title}</b><div class="t2">${n.body || ''}</div><small>${fmtRel(n.created_at)}</small></a>`) : html`<div class="empty" style="padding:28px">Nada por aqui ainda.</div>`}</div>`);
  document.body.appendChild(pop);
  const close = (e) => { if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', close); } };
  setTimeout(() => document.addEventListener('mousedown', close), 0);
  pop.addEventListener('click', (e) => { if (e.target.closest('a')) pop.remove(); });
  $('#n-read', pop)?.addEventListener('click', async () => { await api.post('/notifications/read'); pop.remove(); refreshMeta(); });
}

// ---------------- Tamanho da tela (zoom) ----------------
const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.2, 1.3];
function openZoom(anchor) {
  const existing = $('.popover.zoom-pop');
  if (existing) { existing.remove(); return; }
  const pop = document.createElement('div');
  pop.className = 'popover zoom-pop';
  const r = anchorRect(anchor);
  pop.style.top = `${r.bottom + 8}px`;
  pop.style.right = `${Math.max(12, r.vw - r.right)}px`;
  const paint = () => {
    const pref = window.PX_ZOOM.pref();
    const cur = window.PX_ZOOM.get();
    pop.innerHTML = String(html`<div class="p-head"><span class="grow">Tamanho da tela</span></div>
      <div class="p-body">
        <div class="zrow"><button class="btn-icon" data-z="-" aria-label="Diminuir">${icon('minus')}</button><span class="zval">${Math.round(cur * 100)}%</span><button class="btn-icon" data-z="+" aria-label="Aumentar">${icon('plus')}</button></div>
        <div class="zsteps">${ZOOM_STEPS.map((z) => html`<button data-zv="${z}" class="${pref !== 'auto' && Number(pref) === z ? 'on' : ''}">${Math.round(z * 100)}%</button>`)}</div>
        <label class="switch"><input type="checkbox" id="z-auto" ${pref === 'auto' ? 'checked' : ''}> Ajustar automaticamente à tela</label>
        <p class="tiny muted" style="margin:0">No automático, a plataforma se adapta à resolução (notebook, monitor Full HD ou telas grandes). A escolha fica salva neste computador.</p>
      </div>`);
    const set = (v) => { window.PX_ZOOM.set(v); paint(); };
    $$('[data-zv]', pop).forEach((b) => b.addEventListener('click', () => set(b.dataset.zv)));
    $('[data-z="-"]', pop).onclick = () => set(ZOOM_STEPS.slice().reverse().find((z) => z < cur - 0.001) ?? ZOOM_STEPS[0]);
    $('[data-z="+"]', pop).onclick = () => set(ZOOM_STEPS.find((z) => z > cur + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]);
    $('#z-auto', pop).onchange = (e) => set(e.target.checked ? 'auto' : String(cur));
  };
  paint();
  document.body.appendChild(pop);
  const close = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', close); } };
  setTimeout(() => document.addEventListener('mousedown', close), 0);
}
// Ao trocar a escala (ou redimensionar a janela), atualiza o rótulo e o menu automático
window.addEventListener('px:zoom', () => {
  const l = $('#zoom-label'); if (l) l.textContent = zoomLabel();
  const s = $('#shell'); if (s) s.classList.toggle('collapsed', sidebarCollapsed());
  $('.popover.notif')?.remove();
});

// ---------------- Paleta de comandos (Ctrl+K) ----------------
function openPalette() {
  if ($('.overlay .palette')) return;
  const pages = NAV.filter((n) => n.id && (!n.roles || n.roles.includes(store.user.role))).map((n) => ({ label: n.label, icon: n.icon, href: `#/${n.id}`, kind: 'Página' }));
  pages.push({ label: 'Meu perfil', icon: 'user', href: '#/perfil', kind: 'Página' }, { label: 'Reportar bug', icon: 'bug', action: openBugReport, kind: 'Ação' });
  const ops = (store.meta?.operators || []).map((o) => ({ label: o.name, icon: 'user', href: `#/operadores/${o.id}`, kind: o.team || 'Operador' }));
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = String(html`<div class="modal palette"><input class="input" placeholder="Ir para página, operador ou protocolo…" aria-label="Buscar"><div class="p-res"></div></div>`);
  document.body.appendChild(ov);
  const input = $('input', ov), res = $('.p-res', ov);
  let items = [], sel = 0;
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const draw = () => {
    const q = norm(input.value.trim());
    items = [...pages, ...ops].filter((i) => !q || norm(i.label).includes(q)).slice(0, 12);
    if (q.length >= 3) items.push({ label: `Buscar atendimentos por "${input.value.trim()}"`, icon: 'search', href: `#/atendimentos?q=${encodeURIComponent(input.value.trim())}`, kind: 'Busca' });
    sel = Math.min(sel, Math.max(0, items.length - 1));
    res.innerHTML = items.map((i, k) => `<a href="${i.href || '#'}" class="${k === sel ? 'on' : ''}" data-k="${k}">${icon(i.icon)}<span style="flex:1">${esc(i.label)}</span><span class="tiny muted">${esc(i.kind)}</span></a>`).join('') || '<div class="empty" style="padding:20px">Nada encontrado.</div>';
  };
  const close = () => ov.remove();
  const go = (i) => { close(); if (i.action) i.action(); else if (i.href.includes('?')) { sessionStorage.setItem('px_eval_q', decodeURIComponent(i.href.split('?q=')[1])); navigate('atendimentos'); } else location.hash = i.href; };
  input.addEventListener('input', () => { sel = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    if (e.key === 'Enter' && items[sel]) { e.preventDefault(); go(items[sel]); }
    if (e.key === 'Escape') close();
  });
  res.addEventListener('click', (e) => { const a = e.target.closest('a'); if (a) { e.preventDefault(); go(items[Number(a.dataset.k)]); } });
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  draw(); input.focus();
}
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && store.user && store.user.onboarded && !store.user.must_change_password) { e.preventDefault(); openPalette(); }
});

// ---------------- Tempo real ----------------
// O banco avisa no canal "px-updates" quando algo muda; a tela atual recarrega sozinha
// (sem atrapalhar quem está digitando ou com uma janela aberta).
let rtChannel = null;
let pendingRefresh = false;
function setLive(on) {
  const el = $('#live-dot');
  if (el) { el.dataset.on = on ? '1' : '0'; el.title = on ? 'Conectado em tempo real' : 'Reconectando…'; }
}
function canRefreshNow() {
  if (document.hidden || $('.overlay') || $('.popover')) return false;
  const a = document.activeElement;
  if (a && a.closest && a.closest('#view') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return false;
  return !currentView?.hasUnsavedChanges?.();
}
const refreshSoon = (() => {
  let t;
  return () => { clearTimeout(t); t = setTimeout(applyRemoteChange, 900); };
})();
async function applyRemoteChange() {
  if (!store.user || !store.meta) return;
  await refreshMeta().catch(() => {});
  if (canRefreshNow()) { pendingRefresh = false; $('#live-pill')?.remove(); route({ silent: true }); }
  else showUpdatePill();
}
function showUpdatePill() {
  pendingRefresh = true;
  if ($('#live-pill')) return;
  const b = document.createElement('button');
  b.id = 'live-pill'; b.className = 'live-pill';
  b.innerHTML = String(html`${icon('refresh')}Há atualizações · recarregar`);
  b.onclick = () => { b.remove(); pendingRefresh = false; route({ silent: true }); };
  document.body.appendChild(b);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && pendingRefresh && canRefreshNow()) { pendingRefresh = false; $('#live-pill')?.remove(); refreshMeta().catch(() => {}); route({ silent: true }); } });
function subscribeRealtime() {
  if (rtChannel) return;
  rtChannel = sb.channel('px-updates')
    .on('broadcast', { event: 'change' }, () => refreshSoon())
    .subscribe((status) => setLive(status === 'SUBSCRIBED'));
}
function unsubscribeRealtime() {
  if (rtChannel) { sb.removeChannel(rtChannel); rtChannel = null; }
}

// ---------------- Inicialização ----------------
export async function start(opts = {}) {
  const boot = document.getElementById('boot');
  const { data } = await sb.auth.getSession();
  let loginError = '';
  store.user = null;
  if (data.session) {
    try {
      const me = await api.get(`/auth/me${opts.fresh ? '?login=1' : ''}`);
      store.company = me.company || store.company;
      store.user = me.user;
    } catch (e) {
      if (e.status === 403 || e.code === 'NO_PROFILE') { loginError = e.message; await sb.auth.signOut().catch(() => {}); }
      else if (e.status !== 401) loginError = e.message;
    }
  }
  boot?.classList.add('hide');
  if (!store.user) { unsubscribeRealtime(); renderLogin(app, { onLogin: start, store, error: loginError }); return; }
  applyTheme(store.user.theme);
  if (store.user.must_change_password) { renderChangePassword(app, { store, onDone: start, onLogout: logout }); return; }
  if (!store.user.onboarded) { renderWelcome(app, { store, onDone: start }); return; }
  await refreshMeta();
  shell();
  subscribeRealtime();
  route();
}
sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT' && store.user) { store.user = null; start(); } });

window.addEventListener('hashchange', route);
window.addEventListener('px:unauthorized', () => { if (store.user) { store.user = null; toast('Sua sessão expirou. Entre novamente.', 'err'); start(); } });
window.addEventListener('px:must-change-password', () => start());
setInterval(() => { if (store.user && store.meta && document.visibilityState === 'visible') refreshMeta().catch(() => {}); }, 60000);

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); store.installPrompt = e; });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

start();
void raw;

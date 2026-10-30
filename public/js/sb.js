// Login, sessão (renovada automaticamente) e tempo real no navegador.
// Dois modos, com a mesma interface para o resto das telas:
//  - Supabase (config.js com supabaseUrl): usa o supabase-js.
//  - Servidor próprio (config.js com mode: 'local'): fala com /auth/*, /realtime e /px-api do próprio servidor.
const cfg = window.PX_CONFIG;
export const LOCAL = cfg.mode === 'local';
export const API_URL = (cfg.apiUrl || `${cfg.supabaseUrl}/functions/v1/px-api`).replace(/\/$/, '');
const STORAGE_KEY = 'px-monitorias-auth';

function localClient() {
  const listeners = new Set();
  const emit = (ev, s) => listeners.forEach((cb) => { try { cb(ev, s); } catch { /* ouvinte com erro */ } });
  const load = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; } };
  const save = (s) => { try { if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); else localStorage.removeItem(STORAGE_KEY); } catch { /* sem storage */ } };
  const post = async (path, body) => {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await r.json().catch(() => ({}));
    return r.ok ? { data, error: null } : { data: null, error: { message: data.error || `Erro ${r.status}`, status: r.status } };
  };
  const expOf = (jwt) => { try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp; } catch { return 0; } };
  let refreshing = null;
  async function refresh(s) {
    if (!refreshing) {
      refreshing = post('auth/refresh', { refresh_token: s.refresh_token }).then(({ data, error }) => {
        refreshing = null;
        if (error) { if (error.status === 401) { save(null); emit('SIGNED_OUT', null); } return null; }
        save(data); emit('TOKEN_REFRESHED', data); return data;
      });
    }
    return refreshing;
  }
  const auth = {
    async getSession() {
      const s = load();
      if (!s) return { data: { session: null }, error: null };
      if ((s.expires_at || 0) - 60 > Date.now() / 1000) return { data: { session: s }, error: null };
      return { data: { session: await refresh(s) }, error: null };
    },
    async signInWithPassword({ email, password }) {
      const { data, error } = await post('auth/login', { email, password });
      if (error) return { data: null, error };
      save(data); emit('SIGNED_IN', data);
      return { data: { session: data, user: data.user }, error: null };
    },
    async signOut() {
      const s = load(); save(null);
      if (s?.refresh_token) await post('auth/logout', { refresh_token: s.refresh_token }).catch(() => {});
      emit('SIGNED_OUT', null);
      return { error: null };
    },
    async setSession({ access_token, refresh_token }) {
      const s = { access_token, refresh_token, expires_at: expOf(access_token), token_type: 'bearer' };
      if (!s.expires_at || s.expires_at < Date.now() / 1000) return { data: null, error: { message: 'Link expirado.' } };
      save(s); emit('SIGNED_IN', s);
      return { data: { session: s }, error: null };
    },
    async resetPasswordForEmail(email, { redirectTo } = {}) {
      const { error } = await post('auth/recover', { email, redirectTo });
      return { data: null, error: error && { ...error, code: error.status === 501 ? 'no_smtp' : undefined } };
    },
    onAuthStateChange(cb) { listeners.add(cb); return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }; },
  };

  // Tempo real: o servidor manda um aviso (Server-Sent Events) a cada mudança no banco
  function channel() {
    const handlers = [];
    let es = null, statusCb = () => {}, closed = false, retry = null;
    const open = async () => {
      if (closed) return;
      const { data } = await auth.getSession();
      if (!data.session || closed) { statusCb('CLOSED'); return; }
      es = new EventSource(`realtime?access_token=${encodeURIComponent(data.session.access_token)}`);
      es.addEventListener('ready', () => statusCb('SUBSCRIBED'));
      es.addEventListener('change', (e) => { let p = {}; try { p = JSON.parse(e.data); } catch { /* aviso sem dados */ } handlers.forEach((h) => h({ event: 'change', payload: p })); });
      es.onerror = () => { es?.close(); statusCb('CHANNEL_ERROR'); clearTimeout(retry); retry = setTimeout(open, 3000); };
    };
    const ch = {
      on(_type, _filter, cb) { handlers.push(cb); return ch; },
      subscribe(cb) { statusCb = cb || statusCb; open(); return ch; },
      close() { closed = true; clearTimeout(retry); es?.close(); },
    };
    return ch;
  }
  return { auth, channel, removeChannel: (ch) => ch.close() };
}

export const sb = LOCAL ? localClient() : window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    flowType: 'implicit',
    storageKey: STORAGE_KEY,
  },
});

export async function accessToken() {
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || null;
}

// Endereço da página de recuperação de senha (mesma pasta do site)
export const recoveryUrl = () => new URL('redefinir-senha.html', location.href.split('#')[0]).href;

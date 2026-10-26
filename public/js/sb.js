// Cliente do Supabase no navegador: login, sessão (renovada automaticamente) e tempo real.
const cfg = window.PX_CONFIG;
export const API_URL = (cfg.apiUrl || `${cfg.supabaseUrl}/functions/v1/px-api`).replace(/\/$/, '');

export const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    flowType: 'implicit',
    storageKey: 'px-monitorias-auth',
  },
});

export async function accessToken() {
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || null;
}

// Endereço da página de recuperação de senha (mesma pasta do site)
export const recoveryUrl = () => new URL('redefinir-senha.html', location.href.split('#')[0]).href;

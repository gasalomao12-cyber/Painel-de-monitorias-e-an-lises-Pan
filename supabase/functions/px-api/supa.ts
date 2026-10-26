// @ts-nocheck — clientes do Supabase dentro da Edge Function
// Nas Edge Functions o Supabase injeta SUPABASE_URL e as chaves automaticamente.
import { createClient } from 'npm:@supabase/supabase-js@2';

const env = (k) => Deno.env.get(k) || '';
const fromSet = (k) => { try { const o = JSON.parse(env(k) || '{}'); return o.default || Object.values(o)[0] || ''; } catch { return ''; } };

export const SUPABASE_URL = env('SUPABASE_URL').replace(/\/$/, '');
const SECRET = fromSet('SUPABASE_SECRET_KEYS') || env('SUPABASE_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');
export const PUBLISHABLE = fromSet('SUPABASE_PUBLISHABLE_KEYS') || env('SUPABASE_PUBLISHABLE_KEY') || env('SUPABASE_ANON_KEY');

// O @supabase/server lê estas variáveis para validar o JWT do usuário
if (!env('SUPABASE_JWKS') && !env('SUPABASE_JWKS_URL') && SUPABASE_URL) {
  try { Deno.env.set('SUPABASE_JWKS_URL', `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`); } catch { /* ambiente somente leitura */ }
}
if (!env('SUPABASE_SECRET_KEYS') && !env('SUPABASE_SECRET_KEY') && SECRET) { try { Deno.env.set('SUPABASE_SECRET_KEY', SECRET); } catch { /* idem */ } }
if (!env('SUPABASE_PUBLISHABLE_KEYS') && !env('SUPABASE_PUBLISHABLE_KEY') && PUBLISHABLE) { try { Deno.env.set('SUPABASE_PUBLISHABLE_KEY', PUBLISHABLE); } catch { /* idem */ } }

const serverAuth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
let adminClient = null;
export function admin() {
  if (!adminClient) adminClient = createClient(SUPABASE_URL, SECRET, { auth: serverAuth });
  return adminClient;
}

// Cliente com a chave publicável, só para conferir a senha atual na troca de senha
export function authClient() {
  return createClient(SUPABASE_URL, PUBLISHABLE, { auth: serverAuth });
}

export class DbError extends Error {
  constructor(error) {
    super(error.message || 'Erro no banco de dados');
    this.code = error.code;
  }
}

export async function must(query) {
  const { data, error } = await query;
  if (error) throw new DbError(error);
  return data;
}

export async function count(query) {
  const { count: n, error } = await query;
  if (error) throw new DbError(error);
  return n || 0;
}

// O PostgREST limita o número de linhas por resposta; busca em páginas
export async function fetchAll(build, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const rows = await must(build().range(from, from + pageSize - 1));
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

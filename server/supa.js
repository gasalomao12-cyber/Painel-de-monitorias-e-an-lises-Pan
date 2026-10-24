'use strict';
// Clientes do Supabase usados pelo servidor.
// - admin(): chave secreta (service_role), ignora RLS — único caminho de acesso aos dados px_*.
// - authClient(): chave publicável, usado só para login/refresh/recuperação de senha no Supabase Auth.
const { createAdminClient } = require('@supabase/server/core');
const { createClient } = require('@supabase/supabase-js');

const URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
if (URL && !process.env.SUPABASE_JWKS_URL && !process.env.SUPABASE_JWKS) {
  process.env.SUPABASE_JWKS_URL = `${URL}/auth/v1/.well-known/jwks.json`;
}

function checkEnv() {
  const missing = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY'].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`\n  ✖ Variáveis de ambiente ausentes: ${missing.join(', ')}`);
    console.error('    Copie .env.example para .env (ou configure no serviço de hospedagem) e preencha com os dados do projeto Supabase.\n');
    process.exit(1);
  }
}

let adminClient = null;
function admin() {
  if (!adminClient) adminClient = createAdminClient();
  return adminClient;
}

function authClient() {
  return createClient(URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'implicit' },
  });
}

class DbError extends Error {
  constructor(error) {
    super(error.message || 'Erro no banco de dados');
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

// Executa uma query do supabase-js e lança erro em vez de devolver { error }
async function must(query) {
  const { data, error } = await query;
  if (error) throw new DbError(error);
  return data;
}

async function count(query) {
  const { count: n, error } = await query;
  if (error) throw new DbError(error);
  return n || 0;
}

// O PostgREST limita o número de linhas por resposta; busca em páginas
async function fetchAll(build, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const rows = await must(build().range(from, from + pageSize - 1));
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

module.exports = { admin, authClient, must, count, fetchAll, checkEnv, DbError, SUPABASE_URL: URL };

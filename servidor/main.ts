// @ts-nocheck — PX Monitorias & Feedbacks: servidor próprio, sem Supabase.
// Um único programa (Deno) entrega as telas (pasta public/), a API, o login, o tempo real e os áudios,
// tudo sobre um PostgreSQL comum.
//
//   PX_DATABASE_URL=postgres://px:SENHA@127.0.0.1:5432/px_monitorias \
//   PX_JWT_SECRET=<64 caracteres aleatórios> \
//   deno run -A servidor/main.ts
//
// Variáveis: veja servidor/px.env.example.
import { handleApi } from '../supabase/functions/px-api/api.ts';
import { sql, signJwt, verifyJwt, checkPassword, checkFileUrl, ACCESS_TTL, secret } from '../supabase/functions/px-api/local.ts';

const env = (k, d = '') => Deno.env.get(k) || d;
if (!env('PX_DATABASE_URL')) { console.error('Defina PX_DATABASE_URL (ex.: postgres://px:senha@127.0.0.1:5432/px_monitorias).'); Deno.exit(1); }
secret(); // confere o PX_JWT_SECRET antes de subir

const PORT = Number(env('PX_PORT', '8080'));
const HOST = env('PX_HOST', '127.0.0.1');
const PUBLIC_DIR = new URL('../public/', import.meta.url).pathname.replace(/\/$/, '');
const STATIC_DIR = env('PX_PUBLIC_DIR', PUBLIC_DIR);
const REFRESH_DAYS = Number(env('PX_SESSION_DAYS', '30'));
const VERSION = env('PX_VERSION', String(Date.now()));

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const enc = new TextEncoder();
const sha256 = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))), (b) => b.toString(16).padStart(2, '0')).join('');
const randomToken = () => { const b = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

// ---------------------------------------------------------------- Login e sessão
async function session(user) {
  const refresh = randomToken();
  await sql().unsafe(`insert into public.px_auth_refresh (token_hash, user_id, expires_at) values ($1, $2, now() + ($3 || ' days')::interval)`, [await sha256(refresh), user.id, String(REFRESH_DAYS)]);
  await sql().unsafe('delete from public.px_auth_refresh where expires_at < now()');
  const access = await signJwt({ sub: user.id, email: user.email, role: 'authenticated' });
  return {
    access_token: access, refresh_token: refresh, token_type: 'bearer', expires_in: ACCESS_TTL, expires_at: Math.floor(Date.now() / 1000) + ACCESS_TTL,
    user: { id: user.id, email: user.email },
  };
}

// Proteção contra tentativa e erro: 10 falhas por e-mail+IP a cada 15 minutos bloqueiam novas tentativas
const attempts = new Map();
const WINDOW = 15 * 60 * 1000;
const recent = (key) => (attempts.get(key) || []).filter((t) => Date.now() - t < WINDOW);
const blocked = (key) => recent(key).length >= 10;
const failed = (key) => attempts.set(key, [...recent(key), Date.now()]);
function limited(key) { const b = blocked(key); failed(key); return b; }

async function authRoute(path, request, ip) {
  const body = await request.json().catch(() => ({}));
  if (path === '/auth/login') {
    const email = String(body.email || '').trim().toLowerCase();
    const key = `${email}|${ip}`;
    if (blocked(key)) return json(429, { error: 'Muitas tentativas. Aguarde alguns minutos.' });
    const u = await checkPassword(email, body.password);
    if (!u) { failed(key); return json(400, { error: 'E-mail ou senha incorretos.' }); }
    attempts.delete(key);
    await sql().unsafe('update public.px_auth_users set last_sign_in_at = now() where id = $1', [u.id]);
    return json(200, await session(u));
  }
  if (path === '/auth/refresh') {
    const h = await sha256(String(body.refresh_token || ''));
    const [row] = await sql().unsafe(`delete from public.px_auth_refresh where token_hash = $1 and expires_at > now() returning user_id`, [h]);
    if (!row) return json(401, { error: 'Sessão expirada. Entre novamente.' });
    const [u] = await sql().unsafe('select * from public.px_auth_users where id = $1 and (banned_until is null or banned_until < now())', [row.user_id]);
    if (!u) return json(401, { error: 'Acesso desativado.' });
    return json(200, await session(u));
  }
  if (path === '/auth/logout') {
    if (body.refresh_token) await sql().unsafe('delete from public.px_auth_refresh where token_hash = $1', [await sha256(String(body.refresh_token))]);
    return json(200, { ok: true });
  }
  if (path === '/auth/recover') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!env('SMTP_HOST')) return json(501, { error: 'O envio de e-mail não está configurado. Peça ao administrador da plataforma para resetar sua senha.' });
    if (limited(`recover|${ip}`)) return json(429, { error: 'Muitas tentativas. Aguarde alguns minutos.' });
    const [u] = await sql().unsafe('select * from public.px_auth_users where lower(email) = $1 and (banned_until is null or banned_until < now())', [email]);
    // Responde igual exista ou não o e-mail
    if (u) {
      const s = await session(u);
      const base = String(body.redirectTo || '').startsWith(env('PX_PUBLIC_URL', '__')) ? body.redirectTo : `${env('PX_PUBLIC_URL')}/redefinir-senha.html`;
      const link = `${base}#access_token=${s.access_token}&refresh_token=${s.refresh_token}&type=recovery`;
      await sendMail(u.email, 'PX Monitorias — redefinir senha',
        `Olá!\n\nRecebemos um pedido para redefinir a sua senha da PX Monitorias. Abra o link abaixo (vale por 1 hora):\n\n${link}\n\nSe não foi você, ignore este e-mail.`);
    }
    return json(200, { ok: true });
  }
  return json(404, { error: 'Rota não encontrada.' });
}

async function sendMail(to, subject, text) {
  const nodemailer = (await import('npm:nodemailer@6.9.16')).default;
  const t = nodemailer.createTransport({
    host: env('SMTP_HOST'), port: Number(env('SMTP_PORT', '587')), secure: env('SMTP_SECURE') === 'true',
    auth: env('SMTP_USER') ? { user: env('SMTP_USER'), pass: env('SMTP_PASS') } : undefined,
  });
  await t.sendMail({ from: env('SMTP_FROM', env('SMTP_USER')), to, subject, text });
}

// ---------------------------------------------------------------- Tempo real (Server-Sent Events)
const clients = new Set();
let listening = false;
async function listen() {
  if (listening) return;
  listening = true;
  await sql().listen('px_updates', (payload) => {
    const msg = enc.encode(`event: change\ndata: ${payload}\n\n`);
    for (const c of clients) { try { c.enqueue(msg); } catch { clients.delete(c); } }
  });
}
async function realtime(url) {
  const p = await verifyJwt(url.searchParams.get('access_token'));
  if (!p) return json(401, { error: 'Sessão expirada.' });
  await listen();
  let ctrl, ping;
  const stream = new ReadableStream({
    start(c) {
      ctrl = c; clients.add(c);
      c.enqueue(enc.encode('retry: 3000\nevent: ready\ndata: {}\n\n'));
      ping = setInterval(() => { try { c.enqueue(enc.encode(': ping\n\n')); } catch { clearInterval(ping); } }, 25000);
    },
    cancel() { clients.delete(ctrl); clearInterval(ping); },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
}

// ---------------------------------------------------------------- Arquivos estáticos
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', webmanifest: 'application/manifest+json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', ico: 'image/x-icon', webp: 'image/webp', woff2: 'font/woff2', pdf: 'application/pdf', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', gsm: 'audio/gsm' };
const typeOf = (p) => TYPES[p.split('.').pop().toLowerCase()] || 'application/octet-stream';

async function serveFile(full, request, extra = {}) {
  try {
    const st = await Deno.stat(full);
    if (!st.isFile) return null;
    const etag = `"${st.size}-${st.mtime?.getTime() || 0}"`;
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag } });
    const f = await Deno.open(full);
    return new Response(f.readable, { headers: { 'content-type': typeOf(full), 'content-length': String(st.size), etag, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', ...extra } });
  } catch { return null; }
}

// Configuração das telas no modo servidor próprio (substitui o config.js do Supabase)
const CONFIG_JS = `// Gerado pelo servidor próprio da PX Monitorias (sem Supabase)
window.PX_CONFIG = { mode: 'local', apiUrl: 'px-api' };
`;

// ---------------------------------------------------------------- Roteamento
Deno.serve({ port: PORT, hostname: HOST, onListen: () => console.log(`PX Monitorias no ar em http://${HOST}:${PORT}`) }, async (request, info) => {
  const url = new URL(request.url);
  const path = decodeURIComponent(url.pathname);
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || info.remoteAddr?.hostname || '';
  try {
    if (path.startsWith('/px-api/') || path === '/px-api') return await handleApi(request, '/px-api');
    if (path.startsWith('/auth/') && request.method === 'POST') return await authRoute(path, request, ip);
    if (path === '/realtime') return await realtime(url);
    if (path.startsWith('/files/')) {
      const full = await checkFileUrl(path.slice(7), url.searchParams.get('exp'), url.searchParams.get('sig'));
      return (full && await serveFile(full, request, { 'cache-control': 'private, max-age=600' })) || json(404, { error: 'Arquivo não encontrado ou link expirado.' });
    }
    if (path === '/config.js') return new Response(CONFIG_JS, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' } });
    if (path === '/version.json') return json(200, { v: VERSION, at: new Date(Number(VERSION) || Date.now()).toISOString() });
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'Método não permitido.' });
    // telas
    const rel = path.endsWith('/') ? `${path}index.html` : path;
    if (rel.split('/').includes('..')) return json(400, { error: 'Caminho inválido.' });
    return (await serveFile(`${STATIC_DIR}${rel}`, request)) || (await serveFile(`${STATIC_DIR}/index.html`, request)) || json(404, { error: 'Não encontrado.' });
  } catch (e) {
    console.error(e?.stack || e);
    return json(500, { error: 'Erro interno. Tente novamente ou reporte o bug.' });
  }
});

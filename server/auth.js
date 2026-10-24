'use strict';
// Sessão com Supabase Auth.
// O login acontece no servidor (signInWithPassword); os tokens do Supabase ficam em cookies httpOnly
// e cada requisição tem o JWT verificado pelo @supabase/server (JWKS do projeto). Quando o access token
// expira, o refresh token renova a sessão de forma transparente.
const crypto = require('crypto');
const { verifyCredentials } = require('@supabase/server/core');
const { admin, authClient, must } = require('./supa');

const SESSION_DAYS = Number(process.env.SESSION_DAYS || 7);
const AT = 'px_at';
const RT = 'px_rt';

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use letras e números na senha.';
  return null;
}

function tempPassword() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const d = '23456789';
  const r = (s) => s[crypto.randomInt(s.length)];
  return `Px${r(c)}${r(c)}${r(c)}${r(c)}${r(d)}${r(d)}${r(d)}${r(c)}`;
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieFlags(req) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

function setSessionCookies(req, res, session) {
  const maxAge = SESSION_DAYS * 86400;
  res.append('Set-Cookie', `${AT}=${encodeURIComponent(session.access_token)}; ${cookieFlags(req)}; Max-Age=${maxAge}`);
  res.append('Set-Cookie', `${RT}=${encodeURIComponent(session.refresh_token)}; ${cookieFlags(req)}; Max-Age=${maxAge}`);
}

function clearSessionCookies(req, res) {
  res.append('Set-Cookie', `${AT}=; ${cookieFlags(req)}; Max-Age=0`);
  res.append('Set-Cookie', `${RT}=; ${cookieFlags(req)}; Max-Age=0`);
}

async function verifyToken(token) {
  if (!token) return null;
  const { data, error } = await verifyCredentials({ token, apikey: null }, { auth: 'user' });
  if (error || !data?.userClaims?.id) return null;
  return data.userClaims.id;
}

async function loadProfile(id) {
  return must(admin().from('px_profiles').select('*').eq('id', id).maybeSingle());
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, email: u.email, name: u.name, display_name: u.display_name, role: u.role,
    must_change_password: !!u.must_change_password, onboarded: !!u.onboarded, active: !!u.active,
    theme: u.theme, created_at: u.created_at, last_login: u.last_login,
  };
}

async function authenticate(req, res, next) {
  try {
    const cookies = parseCookies(req.headers.cookie);
    let uid = await verifyToken(cookies[AT]);
    let token = cookies[AT];
    if (!uid && cookies[RT]) {
      const { data, error } = await authClient().auth.refreshSession({ refresh_token: cookies[RT] });
      if (!error && data?.session) {
        setSessionCookies(req, res, data.session);
        uid = data.session.user.id;
        token = data.session.access_token;
      } else {
        clearSessionCookies(req, res);
      }
    }
    if (uid) {
      const profile = await loadProfile(uid);
      if (profile && profile.active) { req.user = profile; req.accessToken = token; }
    }
    next();
  } catch (e) { next(e); }
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Seu perfil não tem permissão para esta ação.' });
    next();
  };
}

// Proteção simples contra força bruta (o Supabase também limita por IP)
const attempts = new Map();
function loginThrottle(key) {
  const a = attempts.get(key);
  return a && a.until > Date.now() ? Math.ceil((a.until - Date.now()) / 1000) : 0;
}
function loginFailed(key) {
  const now = Date.now();
  const a = attempts.get(key) || { n: 0, until: 0, first: now };
  if (now - a.first > 15 * 60e3) { a.n = 0; a.first = now; }
  a.n++;
  if (a.n >= 5) { a.until = now + 5 * 60e3; a.n = 0; a.first = now; }
  attempts.set(key, a);
}
function loginOk(key) { attempts.delete(key); }

// Localiza um usuário do Supabase Auth pelo e-mail (o projeto pode ter usuários de outros apps)
async function findAuthUserByEmail(email) {
  const target = String(email).toLowerCase();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin().auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => String(u.email).toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

module.exports = {
  validatePassword, tempPassword, setSessionCookies, clearSessionCookies, verifyToken, loadProfile, publicUser,
  authenticate, requireAuth, requireRole, loginThrottle, loginFailed, loginOk, findAuthUserByEmail,
};

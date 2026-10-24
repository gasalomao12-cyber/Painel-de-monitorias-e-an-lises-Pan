'use strict';
const crypto = require('crypto');
const { get, run } = require('./db');

const SESSION_DAYS = Number(process.env.SESSION_DAYS || 7);
const COOKIE = 'px_session';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const ref = Buffer.from(hash, 'hex');
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use letras e números na senha.';
  return null;
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', token, userId, expires);
  run("DELETE FROM sessions WHERE expires_at < ?", new Date().toISOString());
  return { token, expires };
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(req, res, token, expires) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expires).toUTCString()}${secure ? '; Secure' : ''}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, name: u.name, display_name: u.display_name, email: u.email,
    role: u.role, must_change_password: !!u.must_change_password, onboarded: !!u.onboarded,
    active: !!u.active, theme: u.theme, created_at: u.created_at, last_login: u.last_login,
  };
}

function authenticate(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const row = get(`SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`, token);
    if (row && row.active && row.expires_at > new Date().toISOString()) {
      req.user = row;
      req.sessionToken = token;
    }
  }
  next();
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

// Tentativas de login por IP+usuário (proteção simples contra força bruta)
const attempts = new Map();
function loginThrottle(key) {
  const now = Date.now();
  const a = attempts.get(key) || { n: 0, until: 0, first: now };
  if (a.until > now) return Math.ceil((a.until - now) / 1000);
  return 0;
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

module.exports = {
  hashPassword, verifyPassword, validatePassword, createSession, setSessionCookie, clearSessionCookie,
  authenticate, requireAuth, requireRole, publicUser, loginThrottle, loginFailed, loginOk, COOKIE,
};

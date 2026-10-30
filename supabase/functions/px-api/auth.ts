// @ts-nocheck — autenticação da API
// O login acontece no navegador (Supabase Auth). Cada chamada chega com o JWT em
// "Authorization: Bearer", validado aqui pelo @supabase/server com o JWKS do projeto.
import { verifyCredentials } from 'npm:@supabase/server@1.9.2/core';
import { admin, must } from './supa.ts';
import { LOCAL, verifyJwt } from './local.ts';

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use letras e números na senha.';
  return null;
}

export function tempPassword() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const d = '23456789';
  const rand = new Uint32Array(8);
  crypto.getRandomValues(rand);
  const r = (s, i) => s[rand[i] % s.length];
  return `Px${r(c, 0)}${r(c, 1)}${r(c, 2)}${r(c, 3)}${r(d, 4)}${r(d, 5)}${r(d, 6)}${r(c, 7)}`;
}

export async function verifyToken(token) {
  if (!token) return null;
  if (LOCAL) { const p = await verifyJwt(token); return p?.sub || null; }
  let res = null;
  try { res = await verifyCredentials({ token, apikey: null }, { auth: 'user' }); } catch (e) { res = { error: e }; }
  if (!res?.error && res?.data?.userClaims?.id) return res.data.userClaims.id;
  // Alternativa: o próprio Auth confere o token. Cobre o Supabase self-hosted (VM), que assina os
  // logins com chave simétrica (HS256) e não publica JWKS
  if (res?.error) {
    const { data: u } = await admin().auth.getUser(token);
    return u?.user?.id || null;
  }
  return null;
}

export async function loadProfile(id) {
  return must(admin().from('px_profiles').select('*').eq('id', id).maybeSingle());
}

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, email: u.email, name: u.name, display_name: u.display_name, role: u.role,
    must_change_password: !!u.must_change_password, onboarded: !!u.onboarded, active: !!u.active,
    theme: u.theme, created_at: u.created_at, last_login: u.last_login, portfolio: u.portfolio || null,
  };
}

export async function authenticate(req, _res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    const uid = await verifyToken(token);
    if (uid) {
      req.authUserId = uid;
      req.accessToken = token;
      const profile = await loadProfile(uid);
      if (profile && profile.active) req.user = profile;
    }
    next();
  } catch (e) { next(e); }
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    if (req.authUserId) return res.status(403).json({ error: 'Este e-mail não tem acesso à plataforma de monitorias (ou o acesso está desativado). Fale com o administrador.', code: 'NO_PROFILE' });
    return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
  }
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return requireAuth(req, res, next);
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Seu perfil não tem permissão para esta ação.' });
    next();
  };
}

// Localiza um usuário do Supabase Auth pelo e-mail (o projeto pode ter usuários de outros apps)
export async function findAuthUserByEmail(email) {
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

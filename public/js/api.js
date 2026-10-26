// Cliente HTTP da API (Edge Function px-api no Supabase)
import { API_URL, accessToken } from './sb.js';

export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

async function request(method, url, body, { raw = false, file = null } = {}) {
  const token = await accessToken();
  const headers = { apikey: window.PX_CONFIG.publishableKey };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (file) headers['Content-Type'] = file.type || 'application/octet-stream';
  else if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try { res = await fetch(`${API_URL}${url}`, { method, headers, body: file || (body !== undefined ? JSON.stringify(body) : undefined) }); }
  catch { throw new ApiError('Sem conexão com o servidor. Verifique sua internet.', 0); }
  if (raw && res.ok) return res;
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => ({})) : null;
  if (!res.ok) {
    const err = new ApiError(data?.error || data?.message || `Erro ${res.status}`, res.status, data?.code);
    if (res.status === 401 && !url.startsWith('/auth/')) window.dispatchEvent(new CustomEvent('px:unauthorized'));
    if (res.status === 428) window.dispatchEvent(new CustomEvent('px:must-change-password'));
    throw err;
  }
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b = {}) => request('POST', u, b),
  put: (u, b = {}) => request('PUT', u, b),
  patch: (u, b = {}) => request('PATCH', u, b),
  del: (u) => request('DELETE', u),
  blob: async (u) => (await request('GET', u, undefined, { raw: true })).blob(),
  // Envia um arquivo binário (ex.: áudio da ligação); dados extras vão na query string
  upload: (u, file) => request('POST', u, undefined, { file }),
};

export function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function saveBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

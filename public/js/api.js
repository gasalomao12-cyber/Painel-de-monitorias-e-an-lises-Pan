// Cliente HTTP da API
export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function request(method, url, body) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(`/api${url}`, opts); }
  catch { throw new ApiError('Sem conexão com o servidor. Verifique sua internet.', 0); }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => ({})) : null;
  if (!res.ok) {
    const err = new ApiError(data?.error || `Erro ${res.status}`, res.status);
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
};

export function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function download(url, filename) {
  const res = await fetch(`/api${url}`, { credentials: 'same-origin' });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new ApiError(d.error || 'Falha no download', res.status); }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

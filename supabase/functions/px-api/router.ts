// @ts-nocheck — roteador mínimo no estilo Express sobre Request/Response da Web.
// Permite manter as rotas da plataforma com a mesma forma (req, res, next) do servidor Node.

export class Router {
  stack = [];

  use(...fns) { for (const fn of fns) this.stack.push({ fn }); return this; }
  add(method, path, fns) {
    const keys = [];
    const re = new RegExp('^' + path.replace(/\/:(\w+)/g, (_m, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    for (const fn of fns) this.stack.push({ method, re, keys, fn });
    return this;
  }
  get(p, ...f) { return this.add('GET', p, f); }
  post(p, ...f) { return this.add('POST', p, f); }
  put(p, ...f) { return this.add('PUT', p, f); }
  patch(p, ...f) { return this.add('PATCH', p, f); }
  delete(p, ...f) { return this.add('DELETE', p, f); }

  async handle(req, res) {
    let i = 0;
    let routed = false;
    const run = async (err) => {
      while (i < this.stack.length) {
        const layer = this.stack[i++];
        const isErrorHandler = layer.fn.length === 4;
        if (layer.re) {
          if (layer.method !== req.method) continue;
          const m = req.path.match(layer.re);
          if (!m) continue;
          routed = true;
          req.params = Object.fromEntries(layer.keys.map((k, idx) => [k, decodeURIComponent(m[idx + 1])]));
        }
        if (err && !isErrorHandler) continue;
        if (!err && isErrorHandler) continue;
        // Diferente do Express, aguardamos a cadeia inteira: a resposta só sai quando a rota termina
        let pending = null;
        const next = (e) => { pending = run(e); return pending; };
        try {
          if (err) await layer.fn(err, req, res, next);
          else await layer.fn(req, res, next);
        } catch (e) {
          if (!pending) return run(e);
        }
        if (pending) await pending;
        return;
      }
      if (err) throw err;
      if (!res.finished) res.status(routed ? 405 : 404).json({ error: 'Rota não encontrada.' });
    };
    await run();
  }
}

export function makeRes() {
  const res = {
    statusCode: 200,
    headers: new Headers(),
    body: null,
    finished: false,
    status(code) { res.statusCode = code; return res; },
    setHeader(k, v) { res.headers.set(k, v); return res; },
    json(obj) { res.headers.set('Content-Type', 'application/json; charset=utf-8'); res.body = JSON.stringify(obj ?? null); res.finished = true; return res; },
    send(data) { res.body = data; res.finished = true; return res; },
    end() { res.finished = true; return res; },
  };
  return res;
}

export async function makeReq(request, basePath) {
  const url = new URL(request.url);
  let path = url.pathname;
  const idx = path.indexOf(basePath);
  path = idx >= 0 ? path.slice(idx + basePath.length) : path;
  if (!path.startsWith('/')) path = '/' + path;
  const headers = {};
  request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  let body = {};
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const text = await request.text();
    if (text) {
      try { body = JSON.parse(text); } catch { const e = new Error('JSON inválido.'); e.status = 400; throw e; }
    }
  }
  return {
    method: request.method, path, headers, body, params: {},
    query: Object.fromEntries(url.searchParams.entries()),
    ip: (headers['x-forwarded-for'] || '').split(',')[0].trim() || 'desconhecido',
  };
}

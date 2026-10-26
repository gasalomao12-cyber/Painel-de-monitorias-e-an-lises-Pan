// @ts-nocheck — Edge Function "px-api": toda a API da PX Monitorias & Feedbacks dentro do Supabase.
// URL: https://<projeto>.supabase.co/functions/v1/px-api/<rota>
import { router } from './routes.ts';
import { authenticate } from './auth.ts';
import { makeReq, makeRes } from './router.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Disposition',
  'Access-Control-Max-Age': '86400',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const res = makeRes();
  try {
    const req = await makeReq(request, '/px-api');
    if (req.path === '/healthz') {
      res.json({ ok: true });
    } else {
      await new Promise((resolve, reject) => authenticate(req, res, (e) => (e ? reject(e) : resolve(null))));
      await router.handle(req, res);
    }
  } catch (e) {
    console.error(e?.stack || e);
    res.status(e?.status || 500).json({ error: e?.status ? e.message : 'Erro interno. Tente novamente ou reporte o bug.' });
  }
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  res.headers.set('Cache-Control', 'no-store');
  return new Response(res.body, { status: res.statusCode, headers: res.headers });
});

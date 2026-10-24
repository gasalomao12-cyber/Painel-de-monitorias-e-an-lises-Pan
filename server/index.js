'use strict';
const path = require('path');
const fs = require('fs');

// Carrega .env local (em produção as variáveis vêm do serviço de hospedagem)
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { checkEnv } = require('./supa');
checkEnv();

const express = require('express');
const { loadSettings } = require('./db');
const { authenticate } = require('./auth');
const { seedBase, seedDemo } = require('./seed');
const routes = require('./routes');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "script-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'self'",
  ].join('; '));
  next();
});

app.use(express.json({ limit: '15mb' }));
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use('/api', authenticate, routes);

const pub = path.join(__dirname, '..', 'public');
app.use('/vendor/chart.umd.min.js', (req, res) => res.sendFile(path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.min.js'), { maxAge: '7d' }));
app.use(express.static(pub, {
  setHeaders: (res, file) => {
    if (/\.(html|webmanifest)$/.test(file) || file.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(pub, 'index.html')));

async function start() {
  try {
    await loadSettings();
    await seedBase();
    if (process.env.SEED_DEMO === 'true') await seedDemo();
  } catch (e) {
    console.error('\n  ✖ Não foi possível preparar o banco no Supabase:', e.message);
    if (/px_|relation|schema cache/i.test(e.message)) console.error('    Rode a migração supabase/migrations/*.sql no SQL Editor do projeto (veja o README).\n');
    process.exit(1);
  }
  const PORT = Number(process.env.PORT || 3000);
  app.listen(PORT, process.env.HOST || '0.0.0.0', () => console.log(`\n  PX Monitorias & Feedbacks rodando em http://localhost:${PORT}\n`));
}
start();

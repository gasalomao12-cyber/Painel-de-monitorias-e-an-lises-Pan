'use strict';
const path = require('path');
const express = require('express');
require('./db');
const { authenticate } = require('./auth');
const { seedBase, seedDemo } = require('./seed');
const routes = require('./routes');

seedBase();
if (process.env.SEED_DEMO !== 'false') seedDemo();

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
app.use(authenticate);
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use('/api', routes);

const pub = path.join(__dirname, '..', 'public');
app.use('/vendor/chart.umd.min.js', (req, res) => res.sendFile(path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.min.js'), { maxAge: '7d' }));
app.use(express.static(pub, {
  setHeaders: (res, file) => {
    if (/\.(html|webmanifest)$/.test(file) || file.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(pub, 'index.html')));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`\n  PX Monitorias & Feedbacks rodando em http://localhost:${PORT}\n`);
});

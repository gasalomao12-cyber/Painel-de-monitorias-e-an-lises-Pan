'use strict';
// Camada de dados — SQLite nativo do Node 22 (node:sqlite), sem dependências nativas.
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') console.warn(w); });

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'px-monitorias.db');

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL,
  display_name TEXT,
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin','qualidade','supervisor')),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  onboarded INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  theme TEXT DEFAULT 'dark',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  audio_folder_url TEXT,
  status TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','publicado','encerrado')),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS operators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  registration TEXT,
  team TEXT,
  supervisor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  supervisor_name TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS criteria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product TEXT NOT NULL CHECK (product IN ('REFIN','ENTREGA','AMBOS')),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  weight REAL NOT NULL DEFAULT 1,
  critical INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id INTEGER REFERENCES cycles(id) ON DELETE SET NULL,
  operator_id INTEGER NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  product TEXT NOT NULL CHECK (product IN ('REFIN','ENTREGA')),
  call_date TEXT,
  protocol TEXT,
  contract TEXT,
  customer TEXT,
  duration_sec INTEGER,
  audio_url TEXT,
  speech_score REAL,
  final_score REAL,
  speech_summary TEXT,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','revisada','feedback_aplicado')),
  transcript TEXT,
  transcript_name TEXT,
  ai_status TEXT DEFAULT 'nao_executada',
  ai_summary TEXT,
  ai_model TEXT,
  ai_ran_at TEXT,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_eval_cycle ON evaluations(cycle_id);
CREATE INDEX IF NOT EXISTS idx_eval_operator ON evaluations(operator_id);
CREATE TABLE IF NOT EXISTS evaluation_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  criterion_id INTEGER NOT NULL REFERENCES criteria(id) ON DELETE CASCADE,
  speech_result TEXT CHECK (speech_result IN ('C','P','NC','NA')),
  speech_note TEXT,
  final_result TEXT CHECK (final_result IN ('C','P','NC','NA')),
  adjusted INTEGER NOT NULL DEFAULT 0,
  adjust_reason TEXT,
  adjust_source TEXT,
  adjusted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  adjusted_at TEXT,
  ai_result TEXT,
  ai_evidence TEXT,
  ai_reason TEXT,
  ai_confidence REAL,
  UNIQUE (evaluation_id, criterion_id)
);
CREATE TABLE IF NOT EXISTS feedbacks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  operator_id INTEGER NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  applied_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  applied_at TEXT NOT NULL,
  modality TEXT,
  content TEXT NOT NULL,
  strengths TEXT,
  improvements TEXT,
  action_plan TEXT,
  operator_ack INTEGER NOT NULL DEFAULT 0,
  followup_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS bugs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'media',
  page TEXT,
  user_agent TEXT,
  screenshot TEXT,
  status TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','em_analise','resolvido','descartado')),
  admin_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function all(sql, ...p) { return db.prepare(sql).all(...p); }
function get(sql, ...p) { return db.prepare(sql).get(...p); }
function run(sql, ...p) { return db.prepare(sql).run(...p); }
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

function getSetting(key, fallback = null) {
  const r = get('SELECT value FROM settings WHERE key = ?', key);
  return r ? r.value : fallback;
}
function setSetting(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value == null ? null : String(value));
}

function audit(userId, action, entity, entityId, detail) {
  run('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)',
    userId || null, action, entity || null, entityId || null, detail ? JSON.stringify(detail) : null);
}

function notify(userIds, title, body, link) {
  for (const uid of new Set(userIds.filter(Boolean))) {
    run('INSERT INTO notifications (user_id, title, body, link) VALUES (?, ?, ?, ?)', uid, title, body || null, link || null);
  }
}

module.exports = { db, all, get, run, tx, getSetting, setSetting, audit, notify, DATA_DIR };

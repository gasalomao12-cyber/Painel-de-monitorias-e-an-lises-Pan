'use strict';
// Configurações, auditoria e notificações sobre as tabelas px_* do Supabase.
const { admin, must } = require('./supa');

const settings = new Map();

async function loadSettings() {
  const rows = await must(admin().from('px_settings').select('key, value'));
  settings.clear();
  for (const r of rows) settings.set(r.key, r.value);
}

function getSetting(key, fallback = null) {
  return settings.has(key) && settings.get(key) != null ? settings.get(key) : fallback;
}

async function setSetting(key, value) {
  const v = value == null ? null : String(value);
  await must(admin().from('px_settings').upsert({ key, value: v }));
  settings.set(key, v);
}

async function audit(userId, action, entity, entityId, detail) {
  const { error } = await admin().from('px_audit_log').insert({
    user_id: userId || null, action, entity: entity || null, entity_id: entityId || null, detail: detail || null,
  });
  if (error) console.error('Falha ao registrar auditoria:', error.message);
}

async function notify(userIds, title, body, link) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  const { error } = await admin().from('px_notifications').insert(ids.map((user_id) => ({ user_id, title, body: body || null, link: link || null })));
  if (error) console.error('Falha ao notificar:', error.message);
}

module.exports = { loadSettings, getSetting, setSetting, audit, notify };

// @ts-nocheck — ações registradas na plataforma → planilha online "CONTROLE DE AÇÕES" (Excel no OneDrive/SharePoint)
// Cada feedback, análise, calibragem e ação manual vira uma linha em px_actions, já com as colunas da planilha
// (LOGIN, SEGMENTO, TEMA, AÇÃO, DATA, OBS, RESPONSÁVEL). O envio usa o Microsoft Graph com um registro de
// aplicativo da empresa (client credentials) e acrescenta as linhas na tabela da planilha.
// O que falhar fica pendente e é reenviado depois, sem duplicar.
import { admin, must } from './supa.ts';
import { getSetting } from './db.ts';

const sb = () => admin();
const env = (k) => Deno.env.get(k) || '';
const httpError = (status, message) => Object.assign(new Error(message), { status });
// Endereços da Microsoft (sobrescrevíveis só por variável de ambiente, para testes)
const LOGIN_BASE = () => env('MS_LOGIN_BASE') || 'https://login.microsoftonline.com';
const GRAPH_BASE = () => env('MS_GRAPH_BASE') || 'https://graph.microsoft.com/v1.0';

// Listas da aba APOIO da planilha
export const THEMES = ['Conversão', 'Eficiência', 'Tabulação', 'Formação inicial', 'Abordagem', 'Checklist', 'Produto', 'Oferta', 'Processo', 'PIX'];
export const ACTIONS = ['Acompanhamento in loco', 'Análise', 'Calibragem', 'Dúvida operacional', 'Feedback', 'Feedback online', 'Formação inicial', 'Material de apoio', 'Recado', 'Reciclagem', 'Reunião', 'Simulador', 'Treinamento'];
export const DEFAULT_SEGMENT_MAP = {
  'VEICULOS:CONTACT': 'PAN VEÍCULOS - CONTACT',
  'VEICULOS:ATIVAS': 'PAN VEÍCULOS - ATIVAS',
  'VEICULOS:WO': 'PAN VEÍCULOS - W.O',
  'CARTOES:CLEAN_CURTO': 'PAN SEM GARANTIA - CLEAN CURTO',
  'CARTOES:CLEAN_LONGO': 'PAN SEM GARANTIA - CLEAN LONGO',
  'CARTOES:': 'PAN - SEM GARANTIA',
  'CONSIGNADO:PUBLICO': 'PAN SEM GARANTIA - EMPRÉSTIMO PÚBLICO',
  'CONSIGNADO:PRIVADO': 'PAN SEM GARANTIA - EMPRÉSTIMO PRIVADO',
  'CONSIGNADO:': 'PAN SEM GARANTIA - CONSIGNADO',
  'REFIN:': 'PAN VEÍCULOS - CONTACT',
  'ENTREGA:': 'PAN VEÍCULOS - CONTACT',
};

export function segmentMap() {
  let custom = {};
  try { custom = JSON.parse(getSetting('sheet_segment_map') || '{}') || {}; } catch { /* mapa inválido: usa o padrão */ }
  return { ...DEFAULT_SEGMENT_MAP, ...Object.fromEntries(Object.entries(custom).filter(([, v]) => String(v || '').trim())) };
}

// SEGMENTO da planilha a partir da monitoria (produto, segmento, equipe e campanha)
export function segmentLabel(ev) {
  if (!ev?.product) return null;
  const map = segmentMap();
  let key;
  if (ev.product === 'VEICULOS') {
    key = /panwo|(^|[_\s-])w\.?o([_\s-]|$)/i.test(ev.campaign || '') ? 'VEICULOS:WO' : /ativa/i.test(ev.team || '') ? 'VEICULOS:ATIVAS' : 'VEICULOS:CONTACT';
  } else key = `${ev.product}:${ev.segment || ''}`;
  return map[key] || map[`${ev.product}:`] || null;
}

// TEMA sugerido: etapa do roteiro onde estão as falhas da monitoria
const STAGE_THEME = { abertura: 'Abordagem', iniciacao: 'Abordagem', postura: 'Abordagem', sondagem: 'Conversão', negociacao: 'Conversão', argumentacao: 'Conversão', fechamento: 'Conversão', 'e.a. e refin': 'Oferta' };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export function suggestTheme(items = [], alerts = []) {
  if ((alerts || []).includes('oferta_perdida')) return 'Oferta';
  const count = {};
  for (const i of items) {
    if (!(Number(i.weight ?? 1) > 0) || !['NC', 'P'].includes(i.final_result)) continue;
    const t = STAGE_THEME[norm(i.stage)] || 'Conversão';
    count[t] = (count[t] || 0) + (i.final_result === 'NC' ? 1 : 0.5);
  }
  return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Conversão';
}

export const dayInBrazil = (d = new Date()) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const responsibleOf = (user) => String(user?.name || user?.display_name || user?.email || '').trim().toUpperCase() || null;
const clip = (s, n) => (s == null ? null : String(s).replace(/\s+/g, ' ').trim().slice(0, n) || null);

// Registra uma ação (uma linha da planilha). dedupe_key evita duas linhas para o mesmo fato.
export async function recordAction(a, user) {
  const op = a.operator_id ? await must(sb().from('px_operators').select('id, name, login, registration, team').eq('id', a.operator_id).maybeSingle()) : null;
  let segment = a.segment_label || null;
  if (!segment && a.evaluation) segment = segmentLabel({ ...a.evaluation, team: a.evaluation.team ?? op?.team });
  const row = {
    action_date: a.action_date || dayInBrazil(),
    operator_id: op?.id || null,
    login: clip(a.login || op?.login || op?.registration || op?.name, 80),
    segment_label: clip(segment, 120),
    theme: THEMES.includes(a.theme) ? a.theme : a.theme ? clip(a.theme, 60) : 'Conversão',
    action: clip(a.action, 60),
    obs: clip(a.obs, 300),
    responsible: clip(a.responsible || responsibleOf(user), 120),
    responsible_user: user?.id || null,
    source: a.source || 'manual',
    evaluation_id: a.evaluation_id || a.evaluation?.id || null,
    feedback_id: a.feedback_id || null,
    contest_id: a.contest_id || null,
    dedupe_key: a.dedupe_key || null,
    sync_status: sheetEnabled() ? 'pendente' : 'ignorado',
  };
  const { data, error } = row.dedupe_key
    ? await sb().from('px_actions').upsert(row, { onConflict: 'dedupe_key', ignoreDuplicates: true }).select('id')
    : await sb().from('px_actions').insert(row).select('id');
  if (error) { console.error('Falha ao registrar ação:', error.message); return null; }
  return data?.[0]?.id || null;
}

// ---------------------------------------------------------------- Microsoft Graph
export function sheetConfig() {
  return {
    enabled: getSetting('sheet_sync_enabled', '0') === '1',
    url: (getSetting('sheet_url') || '').trim(),
    table: (getSetting('sheet_table') || 'Tabela2').trim(),
    tenant: (env('MS_TENANT_ID') || getSetting('ms_tenant_id') || '').trim(),
    clientId: (env('MS_CLIENT_ID') || getSetting('ms_client_id') || '').trim(),
    secret: env('MS_CLIENT_SECRET') || getSetting('ms_client_secret') || '',
  };
}
export const sheetConfigured = () => { const c = sheetConfig(); return !!(c.url && c.tenant && c.clientId && c.secret); };
export const sheetEnabled = () => sheetConfig().enabled && sheetConfigured();

let tokenCache = null;
async function graphToken(cfg) {
  const key = `${cfg.tenant}|${cfg.clientId}|${cfg.secret.slice(-6)}`;
  if (tokenCache && tokenCache.key === key && tokenCache.exp > Date.now() + 60000) return tokenCache.token;
  const res = await fetch(`${LOGIN_BASE()}/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(20000),
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
  }).catch(() => { throw httpError(502, 'Não foi possível conectar ao login da Microsoft.'); });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    const code = String(j.error_codes?.[0] || j.error || res.status);
    const msg = /7000215|invalid_client/.test(code) ? 'Segredo do aplicativo inválido ou expirado.' : /700016|unauthorized_client/.test(code) ? 'ID do aplicativo (client ID) não encontrado neste tenant.' : /90002|900023|invalid_tenant/i.test(code + j.error_description) ? 'Tenant ID inválido.' : `Login da Microsoft recusado (${j.error_description?.split('\n')[0] || code}).`;
    throw httpError(502, msg);
  }
  tokenCache = { key, token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return j.access_token;
}

async function graph(cfg, method, path, body) {
  const token = await graphToken(cfg);
  const res = await fetch(`${GRAPH_BASE()}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000),
  }).catch(() => { throw httpError(502, 'Não foi possível conectar ao Microsoft Graph.'); });
  if (res.ok) return res.status === 204 ? null : res.json().catch(() => null);
  const j = await res.json().catch(() => ({}));
  const m = j?.error?.message || `erro ${res.status}`;
  if (res.status === 401 || res.status === 403) throw httpError(502, `Sem permissão na planilha (${m}). O aplicativo precisa da permissão de aplicativo Files.ReadWrite.All (ou Sites.Selected com acesso ao arquivo), com consentimento do administrador.`);
  if (res.status === 404) throw httpError(502, `Planilha ou tabela não encontrada (${m}). Confira o link e o nome da tabela.`);
  if (res.status === 429 || res.status === 503) throw httpError(429, 'O Microsoft Graph pediu para aguardar. As linhas ficam pendentes e serão reenviadas.');
  if (res.status === 409 || res.status === 423) throw httpError(409, 'A planilha está bloqueada para edição no momento. As linhas serão reenviadas.');
  throw httpError(502, `Microsoft Graph: ${m}`);
}

// Link de compartilhamento → driveId/itemId (ou "driveId/itemId" informado direto)
const itemCache = new Map();
async function resolveItem(cfg) {
  const direct = cfg.url.match(/^(b![\w-]+)\/([A-Z0-9]{20,})$/);
  if (direct) return { driveId: direct[1], itemId: direct[2] };
  if (itemCache.has(cfg.url)) return itemCache.get(cfg.url);
  const bin = [...new TextEncoder().encode(cfg.url)].map((c) => String.fromCharCode(c)).join('');
  const shareId = 'u!' + btoa(bin).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
  const it = await graph(cfg, 'GET', `/shares/${shareId}/driveItem?$select=id,name,parentReference`);
  const out = { driveId: it.parentReference.driveId, itemId: it.id, name: it.name };
  itemCache.set(cfg.url, out);
  return out;
}

const tablePath = (it, cfg) => `/drives/${encodeURIComponent(it.driveId)}/items/${encodeURIComponent(it.itemId)}/workbook/tables/${encodeURIComponent(cfg.table)}`;
// Datas vão como número de série do Excel para a coluna DATA continuar sendo data
const excelSerial = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); };
const rowValues = (a) => [a.login || '', a.segment_label || '', a.theme || '', a.action || '', excelSerial(a.action_date), a.obs || '', a.responsible || ''];

export async function testSheet() {
  const cfg = sheetConfig();
  if (!sheetConfigured()) throw httpError(400, 'Preencha o link da planilha, o tenant, o client ID e o segredo do aplicativo.');
  itemCache.delete(cfg.url);
  const it = await resolveItem(cfg);
  const cols = await graph(cfg, 'GET', `${tablePath(it, cfg)}/columns?$select=name`);
  const names = (cols?.value || []).map((c) => c.name);
  const expected = ['LOGIN', 'SEGMENTO', 'TEMA', 'AÇÃO', 'DATA', 'OBS', 'RESPONSÁVEL'];
  const rows = await graph(cfg, 'GET', `${tablePath(it, cfg)}/rows/$count`).catch(() => null);
  return { ok: true, file: it.name || null, table: cfg.table, columns: names, columns_ok: expected.every((c, i) => norm(names[i]) === norm(c)), rows: typeof rows === 'number' ? rows : rows?.value ?? null };
}

// Envia as linhas pendentes (em lote, na ordem em que foram registradas)
export async function flushActions({ limit = 100 } = {}) {
  if (!sheetEnabled()) return { sent: 0, failed: 0, skipped: true };
  const staleBefore = new Date(Date.now() - 5 * 60000).toISOString();
  const cands = await must(sb().from('px_actions').select('id')
    .or(`sync_status.in.(pendente,erro),and(sync_status.eq.enviando,sync_started_at.lt.${staleBefore})`)
    .lt('sync_attempts', 8).order('id').limit(limit));
  if (!cands.length) return { sent: 0, failed: 0 };
  // Reserva as linhas para este envio (outro envio simultâneo não pega as mesmas)
  const claimed = await must(sb().from('px_actions').update({ sync_status: 'enviando', sync_started_at: new Date().toISOString() })
    .in('id', cands.map((c) => c.id))
    .or(`sync_status.in.(pendente,erro),and(sync_status.eq.enviando,sync_started_at.lt.${staleBefore})`)
    .select('*').order('id'));
  if (!claimed.length) return { sent: 0, failed: 0 };
  const cfg = sheetConfig();
  try {
    const it = await resolveItem(cfg);
    for (let i = 0; i < claimed.length; i += 50) {
      const batch = claimed.slice(i, i + 50);
      await graph(cfg, 'POST', `${tablePath(it, cfg)}/rows`, { index: null, values: batch.map(rowValues) });
      await must(sb().from('px_actions').update({ sync_status: 'enviado', synced_at: new Date().toISOString(), sync_error: null }).in('id', batch.map((b) => b.id)));
      claimed.splice(i, batch.length, ...batch.map((b) => ({ ...b, sent: true })));
    }
    return { sent: claimed.length, failed: 0 };
  } catch (e) {
    const failed = claimed.filter((c) => !c.sent);
    for (const c of failed) {
      await sb().from('px_actions').update({ sync_status: 'erro', sync_error: String(e.message || e).slice(0, 500), sync_attempts: (c.sync_attempts || 0) + 1 }).eq('id', c.id);
    }
    return { sent: claimed.length - failed.length, failed: failed.length, error: e.message };
  }
}

// Envia em segundo plano quando o runtime permite (a resposta ao usuário não espera a planilha)
export function flushInBackground() {
  if (!sheetEnabled()) return;
  const p = flushActions().catch((e) => console.error('Envio para a planilha falhou:', e?.message || e));
  if (globalThis.EdgeRuntime?.waitUntil) globalThis.EdgeRuntime.waitUntil(p);
  return p;
}

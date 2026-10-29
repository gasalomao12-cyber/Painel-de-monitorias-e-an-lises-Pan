// @ts-nocheck — força-tarefa de análise manual das tabulações de queda de ligação.
// Capacity (operadores, liderança, gerência, campanha), CSV de metadados do discador,
// análise colaborativa (com reserva do atendimento por quem está analisando) e anexos de áudio/transcrição.
import { admin, must, fetchAll } from './supa.ts';
import { getSetting, setSetting, audit } from './db.ts';

const sb = () => admin();
const BUCKET = 'px-quedas';
const LOCK_MS = 15 * 60 * 1000;
const MAX_AUDIO = 50 * 1024 * 1024;
const VERDICTS = ['cliente', 'operador', 'tecnica', 'mudo', 'concluido', 'inconclusivo'];
const DISCONNECT = ['Interna', 'Externa'];
// Carteiras que a força-tarefa analisa
export const CARTEIRAS = ['SAFRA BS', 'SAFRA ADM', 'PAN CONTACT', 'PAN MASSIFICADOS', 'PAN ATIVAS E AJUIZADOS', 'PORTO'];
const carteiraOf = (v) => { const k = String(v || '').trim().toUpperCase(); return CARTEIRAS.includes(k) ? k : null; };
// A queda procede quando o cliente (ou a linha) derrubou a ligação
const TAB_OK = { cliente: true, tecnica: true, operador: false, mudo: false, concluido: false, inconclusivo: null };
// Colunas da lista (a transcrição só vem ao abrir o atendimento)
const LIST_COLS = 'id, portfolio, carteira, phone, attended, held, contact_id, call_at, duration_sec, login, operator_name, leader, manager, campaign, segment, dialer_campaign, operation, tabulation, disconnect, contract, customer, audio_file, audio_original, status, verdict, conduct, conduct_type, tab_correct, correct_tab, drop_moment, notes, audio_url, audio_path, audio_name, transcript_name, analyst_id, analyst_name, analyzed_at, locked_by, locked_name, locked_at, batch, created_at, updated_at';

export const nameKey = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const txt = (v, max = 300) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const loginOf = (v) => txt(v, 60)?.toLowerCase().replace(/\s+/g, '') || null;
const userName = (u) => u.display_name || u.name;
const lockAlive = (r) => r.locked_by && r.locked_at && Date.now() - new Date(r.locked_at).getTime() < LOCK_MS;
const httpError = (status, message) => Object.assign(new Error(message), { status });
// Carteira do usuário (PAN quando não definida) e quem pode mexer no capacity/gerências/pasta dela:
// na PAN, Qualidade e admin; nas demais carteiras, as próprias analistas
export const portfolioOf = (u) => String(u?.portfolio || '').trim().toUpperCase() || 'PAN';
const canManage = (req) => ['admin', 'qualidade'].includes(req.user.role) || portfolioOf(req.user) !== 'PAN';
const folderKey = (pf) => (pf === 'PAN' ? 'drop_audio_folder' : `drop_audio_folder:${pf}`);
const MANAGE_MSG = 'Na carteira PAN, só a Qualidade e o administrador alteram o capacity, as gerências e a pasta de áudios.';

function callAt(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}`;
  return null;
}
function seconds(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.round(v);
  const p = String(v).trim().split(':').map((x) => Number(x.replace(',', '.')));
  if (p.some((x) => Number.isNaN(x))) return null;
  return Math.round(p.reduce((a, x) => a * 60 + x, 0));
}
const disconnectOf = (v) => { const k = nameKey(v); return k.startsWith('intern') ? 'Interna' : k.startsWith('extern') ? 'Externa' : null; };

async function managers(portfolio) {
  const rows = await must(sb().from('px_roster_leaders').select('leader, manager').eq('portfolio', portfolio));
  return new Map(rows.map((r) => [nameKey(r.leader), r.manager]));
}
// Um operador por login dentro da carteira: o capacity do próprio usuário vale primeiro, depois o mais recente
function pickRoster(rows, scope) {
  const out = new Map();
  for (const r of rows) {
    const prev = out.get(r.login);
    const better = !prev || (r.scope === scope && prev.scope !== scope) || (prev.scope !== scope && r.updated_at > prev.updated_at);
    if (better) out.set(r.login, r);
  }
  return out;
}
// Liderança, gerência, campanha e segmento do operador a partir do capacity da carteira
async function enrich(rows, portfolio, scope) {
  const logins = [...new Set(rows.map((r) => r.login).filter(Boolean))];
  const found = [];
  for (let i = 0; i < logins.length; i += 200) found.push(...await must(sb().from('px_roster').select('*').eq('portfolio', portfolio).in('login', logins.slice(i, i + 200))));
  const roster = pickRoster(found, scope);
  const mgr = await managers(portfolio);
  return rows.map((r) => {
    const o = roster.get(r.login);
    if (!o) return r;
    return {
      ...r,
      operator_name: r.operator_name || o.name,
      leader: r.leader || o.leader,
      manager: r.manager || mgr.get(nameKey(o.leader)) || null,
      campaign: r.campaign || o.campaign,
      segment: r.segment || o.segment,
    };
  });
}

// Cada carteira cuida das próprias análises (o painel mostra todas); o admin pode tudo
function canEdit(req, row) {
  if (req.user.role === 'admin') return true;
  if ((row.portfolio || 'PAN') !== portfolioOf(req.user)) return false;
  if (req.user.role === 'qualidade') return true;
  return row.status === 'pendente' || row.analyst_id === req.user.id || row.created_by === req.user.id;
}

// Campos que o analista grava (metadados corrigidos + resultado da análise)
function reviewPatch(b) {
  const p = {};
  const set = (k, v) => { if (b[k] !== undefined) p[k] = v; };
  set('contact_id', txt(b.contact_id, 40));
  set('call_at', callAt(b.call_at));
  set('duration_sec', seconds(b.duration_sec));
  set('login', loginOf(b.login));
  for (const k of ['operator_name', 'leader', 'manager', 'campaign', 'segment', 'dialer_campaign', 'operation', 'tabulation', 'contract', 'customer', 'correct_tab', 'conduct_type']) set(k, txt(b[k], 200));
  set('disconnect', DISCONNECT.includes(b.disconnect) ? b.disconnect : null);
  set('audio_file', txt(b.audio_file, 400));
  set('audio_original', txt(b.audio_original, 200));
  set('audio_url', /^https:\/\//i.test(String(b.audio_url || '')) ? String(b.audio_url).trim().slice(0, 1500) : null);
  set('drop_moment', txt(b.drop_moment, 12));
  set('carteira', carteiraOf(b.carteira));
  set('phone', txt(String(b.phone ?? '').replace(/[^\d+]/g, ''), 20));
  for (const k of ['attended', 'held']) if (b[k] !== undefined) p[k] = b[k] === null || b[k] === '' ? null : !!b[k];
  set('notes', txt(b.notes, 4000));
  if (b.transcript !== undefined) {
    p.transcript = String(b.transcript || '').replace(/\r\n/g, '\n').trim().slice(0, 400000) || null;
    p.transcript_name = p.transcript ? txt(b.transcript_name, 200) || 'Transcrição colada' : null;
  }
  if (b.verdict !== undefined) p.verdict = VERDICTS.includes(b.verdict) ? b.verdict : null;
  if (b.conduct !== undefined) p.conduct = !!b.conduct;
  if (b.tab_correct !== undefined) p.tab_correct = b.tab_correct === null || b.tab_correct === '' ? null : !!b.tab_correct;
  else if (p.verdict) p.tab_correct = TAB_OK[p.verdict];
  return p;
}

export function registerQuedas(router, { h, QUALITY, ADMIN }) {
  // Tudo o que a aba precisa: atendimentos, capacity, gerências e o link da pasta de áudios
  router.get('/quedas', h(async (req, res) => {
    const pf = portfolioOf(req.user);
    const [rows, rosterAll, leaders, profiles] = await Promise.all([
      fetchAll(() => sb().from('px_drop_reviews').select(LIST_COLS).order('call_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false })),
      fetchAll(() => sb().from('px_roster').select('scope, login, name, name_key, registration, shift, status, campaign, segment, leader, active, updated_at').eq('portfolio', pf).order('name')),
      must(sb().from('px_roster_leaders').select('portfolio, leader, manager').order('leader')),
      must(sb().from('px_profiles').select('id, portfolio')),
    ]);
    const now = Date.now();
    for (const r of rows) if (r.locked_by && !(r.locked_at && now - new Date(r.locked_at).getTime() < LOCK_MS)) { r.locked_by = null; r.locked_name = null; }
    const roster = [...pickRoster(rosterAll, req.user.id).values()].sort((a, z) => a.name.localeCompare(z.name));
    const own = rosterAll.filter((r) => r.scope === req.user.id);
    const portfolios = [...new Set(['PAN', pf, ...rows.map((r) => r.portfolio), ...profiles.map((u) => portfolioOf(u))])].sort();
    res.json({
      rows, roster, leaders: leaders.filter((l) => l.portfolio === pf), portfolio: pf, portfolios, can_manage: canManage(req),
      // de quem é o capacity em uso: o do próprio usuário ou o de outra pessoa da carteira
      roster_own: own.filter((r) => r.active).length,
      roster_updated_at: (own.length ? own : rosterAll).reduce((m, r) => (r.updated_at > m ? r.updated_at : m), '') || null,
      roster_file: getSetting(`drop_roster_file:${req.user.id}`) || (own.length ? null : getSetting(`drop_roster_file:${pf}`) || (pf === 'PAN' ? getSetting('drop_roster_file') : null)),
      folder: getSetting(folderKey(pf)),
      folders: Object.fromEntries(portfolios.map((p) => [p, getSetting(folderKey(p))])),
      analyst_portfolio: Object.fromEntries(profiles.map((u) => [u.id, portfolioOf(u)])),
      me: req.user.id,
    });
  }));

  // Capacity novo: troca a base de operadores; quem saiu fica inativo (o histórico continua com o nome)
  // Qualquer perfil anexa o próprio capacity (vale só para ele e como reserva da carteira)
  router.post('/quedas/roster', h(async (req, res) => {
    const b = req.body || {};
    const pf = portfolioOf(req.user);
    const scope = req.user.id;
    const seen = new Map();
    for (const r of Array.isArray(b.rows) ? b.rows : []) {
      const login = loginOf(r.login);
      const name = txt(r.name, 160);
      if (!login || !name) continue;
      const prev = seen.get(login);
      // A aba de ativos manda; desligados/remanejados só entram se o login não estiver ativo
      if (prev && prev.active && !r.active) continue;
      seen.set(login, {
        scope, portfolio: pf, login, name, name_key: nameKey(name), registration: txt(r.registration, 30), shift: txt(r.shift, 30), status: txt(r.status, 40),
        campaign: txt(r.campaign, 80), segment: txt(r.segment, 80), leader: txt(r.leader, 160), active: r.active !== false, updated_at: new Date().toISOString(),
      });
    }
    const list = [...seen.values()];
    if (!list.filter((r) => r.active).length) throw httpError(400, 'Não encontrei operadores ativos no capacity (colunas OPERADOR, LOGIN e LIDERANÇA).');
    // Só o capacity deste usuário muda; o das outras pessoas (e o das outras carteiras) fica como está
    for (let i = 0; i < list.length; i += 500) await must(sb().from('px_roster').upsert(list.slice(i, i + 500), { onConflict: 'scope,login' }));
    const keep = new Set(list.map((r) => r.login));
    const old = await fetchAll(() => sb().from('px_roster').select('login').eq('scope', scope).eq('active', true));
    const gone = old.map((r) => r.login).filter((l) => !keep.has(l));
    for (let i = 0; i < gone.length; i += 200) await must(sb().from('px_roster').update({ active: false, status: 'FORA DO CAPACITY' }).eq('scope', scope).in('login', gone.slice(i, i + 200)));
    // O capacity da PAN de antes da separação por usuário é substituído pelo primeiro novo
    if (pf === 'PAN' && canManage(req)) await must(sb().from('px_roster').delete().eq('scope', 'shared'));

    // Gerência de cada liderança: mantém o que já foi definido; as novas vêm dos operadores já cadastrados na plataforma
    const known = await managers(pf);
    const byLeader = new Map();
    for (const r of list) if (r.leader && r.active) (byLeader.get(r.leader) || byLeader.set(r.leader, []).get(r.leader)).push(r.login);
    // Gerência que veio no próprio capacity (a mais frequente de cada liderança)
    const fromFile = new Map();
    for (const r of Array.isArray(b.rows) ? b.rows : []) {
      const leader = txt(r.leader, 160), manager = txt(r.manager, 160);
      if (!leader || !manager || r.active === false) continue;
      const v = fromFile.get(leader) || fromFile.set(leader, {}).get(leader);
      v[manager] = (v[manager] || 0) + 1;
    }
    const fileLeaders = [...fromFile].map(([leader, v]) => ({ portfolio: pf, leader, manager: Object.entries(v).sort((a, z) => z[1] - a[1])[0][0], updated_at: new Date().toISOString() }));
    // Quem cuida da carteira atualiza a gerência pelo arquivo; os demais só preenchem o que falta
    if (fileLeaders.length) await must(sb().from('px_roster_leaders').upsert(fileLeaders, { onConflict: 'portfolio,leader', ignoreDuplicates: !canManage(req) }));
    for (const l of fileLeaders) if (canManage(req) || !known.get(nameKey(l.leader))) known.set(nameKey(l.leader), l.manager);
    const newLeaders = [];
    for (const [leader, logins] of byLeader) {
      if (known.get(nameKey(leader))) continue;
      const ops = await must(sb().from('px_operators').select('manager_name').in('login', logins.slice(0, 300)).not('manager_name', 'is', null));
      const votes = {};
      for (const o of ops) votes[o.manager_name] = (votes[o.manager_name] || 0) + 1;
      const best = Object.entries(votes).sort((a, z) => z[1] - a[1])[0]?.[0] || null;
      newLeaders.push({ portfolio: pf, leader, manager: pf === 'PAN' ? best : null });
    }
    if (newLeaders.length) await must(sb().from('px_roster_leaders').upsert(newLeaders, { onConflict: 'portfolio,leader', ignoreDuplicates: true }));
    if (b.file) { await setSetting(`drop_roster_file:${scope}`, String(b.file).slice(0, 200)); await setSetting(`drop_roster_file:${pf}`, String(b.file).slice(0, 200)); }
    await audit(req.user.id, 'capacity_atualizado', 'roster', null, { carteira: pf, arquivo: b.file || null, ativos: list.filter((r) => r.active).length, inativos: gone.length });
    res.json({ active: list.filter((r) => r.active).length, inactive: list.length - list.filter((r) => r.active).length, removed: gone.length, leaders: byLeader.size, missing_manager: newLeaders.filter((l) => !l.manager).length });
  }));

  // Gerência de uma liderança (o capacity não traz); vale também para os atendimentos já lançados
  router.put('/quedas/leaders', h(async (req, res) => {
    if (!canManage(req)) throw httpError(403, MANAGE_MSG);
    const pf = portfolioOf(req.user);
    const leader = txt(req.body?.leader, 160);
    if (!leader) throw httpError(400, 'Informe a liderança.');
    const manager = txt(req.body?.manager, 160);
    await must(sb().from('px_roster_leaders').upsert({ portfolio: pf, leader, manager, updated_at: new Date().toISOString() }, { onConflict: 'portfolio,leader' }));
    await must(sb().from('px_drop_reviews').update({ manager }).eq('portfolio', pf).eq('leader', leader));
    res.json({ ok: true });
  }));

  router.put('/quedas/folder', h(async (req, res) => {
    if (!canManage(req)) throw httpError(403, MANAGE_MSG);
    const url = String(req.body?.url || '').trim();
    if (url && !/^https:\/\//i.test(url)) throw httpError(400, 'Cole o link completo da pasta (começando com https://).');
    await setSetting(folderKey(portfolioOf(req.user)), url || null);
    res.json({ ok: true });
  }));

  // CSV de metadados do discador (opcional): cria os atendimentos para análise
  router.post('/quedas/import', h(async (req, res) => {
    const b = req.body || {};
    const pf = portfolioOf(req.user);
    const batch = txt(b.batch, 120);
    const carteira = carteiraOf(b.carteira);
    const byId = new Map();
    for (const r of Array.isArray(b.rows) ? b.rows.slice(0, 20000) : []) {
      const id = txt(r.contact_id, 40);
      if (!id) continue;
      byId.set(id, {
        portfolio: pf, ...(carteira ? { carteira } : {}), phone: txt(String(r.phone ?? '').replace(/[^\d+]/g, ''), 20), contact_id: id, call_at: callAt(r.call_at), duration_sec: seconds(r.duration), login: loginOf(r.login),
        dialer_campaign: txt(r.dialer_campaign, 80), operation: txt(r.operation, 80), tabulation: txt(r.tabulation, 120),
        disconnect: disconnectOf(r.disconnect), contract: txt(r.contract, 60), customer: txt(r.customer, 160),
        audio_file: txt(r.audio_file, 400), audio_original: txt(r.audio_original, 200), batch,
      });
    }
    const rows = await enrich([...byId.values()], pf, req.user.id);
    if (!rows.length) throw httpError(400, 'Nenhuma linha com IdContato no arquivo.');
    const ids = rows.map((r) => r.contact_id);
    const existing = new Set();
    for (let i = 0; i < ids.length; i += 200) for (const r of await must(sb().from('px_drop_reviews').select('contact_id').eq('portfolio', pf).in('contact_id', ids.slice(i, i + 200)))) existing.add(r.contact_id);
    const fresh = rows.filter((r) => !existing.has(r.contact_id)).map((r) => ({ ...r, created_by: req.user.id }));
    // Já existentes: só completa os metadados (a análise feita não muda)
    for (let i = 0; i < fresh.length; i += 500) await must(sb().from('px_drop_reviews').insert(fresh.slice(i, i + 500)));
    const again = rows.filter((r) => existing.has(r.contact_id));
    for (let i = 0; i < again.length; i += 500) await must(sb().from('px_drop_reviews').upsert(again.slice(i, i + 500).map(({ batch: _b, ...r }) => r), { onConflict: 'portfolio,contact_id' }));
    await audit(req.user.id, 'quedas_importadas', 'drop_review', null, { carteira: pf, lote: batch, novos: fresh.length, atualizados: again.length });
    res.json({ created: fresh.length, updated: again.length, unknown_logins: [...new Set(rows.filter((r) => r.login && !r.leader).map((r) => r.login))] });
  }));

  router.get('/quedas/:id', h(async (req, res) => {
    const r = await must(sb().from('px_drop_reviews').select('*').eq('id', req.params.id).maybeSingle());
    if (!r) throw httpError(404, 'Atendimento não encontrado.');
    if (!lockAlive(r)) { r.locked_by = null; r.locked_name = null; }
    res.json(r);
  }));

  // Lançamento manual
  router.post('/quedas', h(async (req, res) => {
    const p = reviewPatch(req.body || {});
    if (!p.login && !p.operator_name) throw httpError(400, 'Informe o login ou o nome do operador.');
    const pf = portfolioOf(req.user);
    if (p.contact_id) {
      const dup = await must(sb().from('px_drop_reviews').select('id').eq('portfolio', pf).eq('contact_id', p.contact_id).maybeSingle());
      if (dup) return res.status(409).json({ error: `O atendimento ${p.contact_id} já está na força-tarefa.`, id: dup.id });
    }
    const [row] = await enrich([{ ...p, portfolio: pf, created_by: req.user.id, batch: 'Lançamento manual' }], pf, req.user.id);
    Object.assign(row, analysisMeta(req, row, null));
    const saved = await must(sb().from('px_drop_reviews').insert(row).select(LIST_COLS).single());
    await audit(req.user.id, 'queda_lancada', 'drop_review', saved.id, { contato: saved.contact_id });
    res.json(saved);
  }));

  router.put('/quedas/:id', h(async (req, res) => {
    const cur = await must(sb().from('px_drop_reviews').select('*').eq('id', req.params.id).maybeSingle());
    if (!cur) throw httpError(404, 'Atendimento não encontrado.');
    if (!canEdit(req, cur)) throw httpError(403, (cur.portfolio || 'PAN') !== portfolioOf(req.user) ? `Este atendimento é da carteira ${cur.portfolio}: só quem analisa essa carteira pode alterar.` : `Esta análise é de ${cur.analyst_name}. Só a Qualidade pode alterar.`);
    if (lockAlive(cur) && cur.locked_by !== req.user.id && !req.body?.force) throw httpError(409, `${cur.locked_name} está analisando este atendimento agora.`);
    const p = reviewPatch(req.body || {});
    if (p.contact_id && p.contact_id !== cur.contact_id) {
      const dup = await must(sb().from('px_drop_reviews').select('id').eq('portfolio', cur.portfolio).eq('contact_id', p.contact_id).neq('id', cur.id).maybeSingle());
      if (dup) throw httpError(409, `O atendimento ${p.contact_id} já está na força-tarefa.`);
    }
    // Login trocado: busca de novo liderança, gerência e campanha
    if (p.login && p.login !== cur.login) {
      const [e] = await enrich([{ login: p.login }], cur.portfolio, req.user.id);
      for (const k of ['operator_name', 'leader', 'manager', 'campaign', 'segment']) if (p[k] === undefined || p[k] === null) p[k] = e[k] ?? null;
    }
    Object.assign(p, analysisMeta(req, { ...cur, ...p }, cur), { locked_by: null, locked_name: null, locked_at: null, updated_at: new Date().toISOString() });
    const saved = await must(sb().from('px_drop_reviews').update(p).eq('id', cur.id).select(LIST_COLS).single());
    if (saved.status === 'analisada' && cur.status !== 'analisada') await audit(req.user.id, 'queda_analisada', 'drop_review', cur.id, { contato: cur.contact_id, veredito: saved.verdict, desvio: saved.conduct });
    res.json(saved);
  }));

  // Reserva o atendimento para quem abriu a análise (os outros veem "em análise por …")
  router.post('/quedas/:id/lock', h(async (req, res) => {
    const cur = await must(sb().from('px_drop_reviews').select('id, locked_by, locked_name, locked_at').eq('id', req.params.id).maybeSingle());
    if (!cur) throw httpError(404, 'Atendimento não encontrado.');
    if (lockAlive(cur) && cur.locked_by !== req.user.id && !req.body?.force) return res.json({ ok: false, by: cur.locked_name });
    await must(sb().from('px_drop_reviews').update({ locked_by: req.user.id, locked_name: userName(req.user), locked_at: new Date().toISOString() }).eq('id', cur.id));
    res.json({ ok: true });
  }));
  router.post('/quedas/:id/unlock', h(async (req, res) => {
    await must(sb().from('px_drop_reviews').update({ locked_by: null, locked_name: null, locked_at: null }).eq('id', req.params.id).eq('locked_by', req.user.id));
    res.json({ ok: true });
  }));

  router.post('/quedas/delete', h(async (req, res) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Boolean).slice(0, 5000);
    if (!ids.length) throw httpError(400, 'Nenhum atendimento selecionado.');
    let rows = [];
    for (let i = 0; i < ids.length; i += 200) rows.push(...await must(sb().from('px_drop_reviews').select('id, status, created_by, audio_path').in('id', ids.slice(i, i + 200))));
    if (req.user.role !== 'admin') rows = rows.filter((r) => r.status === 'pendente' && r.created_by === req.user.id);
    if (!rows.length) throw httpError(403, 'Só o administrador exclui análises feitas (ou atendimentos lançados por outra pessoa).');
    const paths = rows.map((r) => r.audio_path).filter(Boolean);
    if (paths.length) await sb().storage.from(BUCKET).remove(paths).catch(() => {});
    for (let i = 0; i < rows.length; i += 200) await must(sb().from('px_drop_reviews').delete().in('id', rows.slice(i, i + 200).map((r) => r.id)));
    await audit(req.user.id, 'quedas_excluidas', 'drop_review', null, { total: rows.length });
    res.json({ deleted: rows.length });
  }));

  // Áudio anexado: guardado no bucket privado; a reprodução usa um link assinado de 10 minutos
  router.post('/quedas/:id/audio', h(async (req, res) => {
    const cur = await must(sb().from('px_drop_reviews').select('*').eq('id', req.params.id).maybeSingle());
    if (!cur) throw httpError(404, 'Atendimento não encontrado.');
    if (!canEdit(req, cur)) throw httpError(403, 'Só a Qualidade pode alterar esta análise.');
    if (!req.raw?.byteLength) throw httpError(400, 'Arquivo de áudio vazio.');
    if (req.raw.byteLength > MAX_AUDIO) throw httpError(400, 'Áudio acima de 50 MB.');
    const name = String(req.query.name || 'audio.wav').replace(/[^\w.\-]+/g, '_').slice(-120);
    const path = `${cur.id}/${Date.now()}-${name}`;
    const { error } = await sb().storage.from(BUCKET).upload(path, req.raw, { contentType: req.headers['content-type'] || 'audio/wav', upsert: false });
    if (error) throw httpError(500, `Não foi possível guardar o áudio: ${error.message}`);
    if (cur.audio_path) await sb().storage.from(BUCKET).remove([cur.audio_path]).catch(() => {});
    await must(sb().from('px_drop_reviews').update({ audio_path: path, audio_name: String(req.query.name || name).slice(0, 200), updated_at: new Date().toISOString() }).eq('id', cur.id));
    res.json({ ok: true, audio_name: req.query.name || name });
  }));
  router.get('/quedas/:id/audio', h(async (req, res) => {
    const cur = await must(sb().from('px_drop_reviews').select('audio_path').eq('id', req.params.id).maybeSingle());
    if (!cur?.audio_path) throw httpError(404, 'Nenhum áudio anexado.');
    const { data, error } = await sb().storage.from(BUCKET).createSignedUrl(cur.audio_path, 600);
    if (error) throw httpError(500, error.message);
    res.json({ url: data.signedUrl });
  }));
  router.delete('/quedas/:id/audio', h(async (req, res) => {
    const cur = await must(sb().from('px_drop_reviews').select('*').eq('id', req.params.id).maybeSingle());
    if (!cur) throw httpError(404, 'Atendimento não encontrado.');
    if (!canEdit(req, cur)) throw httpError(403, 'Só a Qualidade pode alterar esta análise.');
    if (cur.audio_path) await sb().storage.from(BUCKET).remove([cur.audio_path]).catch(() => {});
    await must(sb().from('px_drop_reviews').update({ audio_path: null, audio_name: null }).eq('id', cur.id));
    res.json({ ok: true });
  }));
}

// Com veredito o atendimento vira "analisada"; desligar no cliente é sempre desvio de conduta
function analysisMeta(req, row, cur) {
  if (!row.verdict) return { status: 'pendente', conduct: !!row.conduct };
  const out = { status: 'analisada', conduct: row.verdict === 'operador' ? true : !!row.conduct };
  if (!cur || cur.status !== 'analisada' || !cur.analyst_id) {
    out.analyst_id = req.user.id; out.analyst_name = userName(req.user); out.analyzed_at = new Date().toISOString();
  }
  return out;
}

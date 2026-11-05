// @ts-nocheck — análises por carteira trazidas em HTML e capacity por setor.
//   • speech_safra: "Análise de Speech · Conversão Safra Pay" (ligação a ligação, 11 critérios do roteiro SAFRA_PAY)
//     vira atendimentos na plataforma, na carteira de quem importa (padrão: Safra BS).
//   • Relatórios (ex.: "Conversão e Eficiência · Recusas"): ficam guardados como análise da carteira, com os dados
//     extraídos (indicadores, visão e leitura por login, ofensores, plano de ação) e o arquivo original para consulta.
//     A leitura de cada login aparece no feedback do operador.
//   • Capacity por setor (PAN, Safra ADM e Call, Safra BS, Porto): nome, liderança e campanha de cada login, usados
//     nas importações e no cadastro dos operadores daquela carteira.
import { admin, must, fetchAll } from './supa.ts';
import { computeScore } from './scoring.ts';
import { CARTEIRAS, carteiraScope, carteirasOfText, carteirasOfUser, inScope, scopeValues } from './carteira.ts';
import { resolveCycle } from './dashboard.ts';
import { getSetting, setSetting } from './db.ts';

const sb = () => admin();
const httpError = (status, message) => Object.assign(new Error(message), { status });
const txt = (v, max = 300) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const loginOf = (v) => txt(v, 60)?.toLowerCase().replace(/\s+/g, '') || null;
const nameKey = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const title = (s) => String(s || '').toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\s(D[aeo]s?|E)\s/g, (m) => m.toLowerCase());

// Carteira de uma importação: a do arquivo (quando a pessoa pode vê-la) ou a única de quem importa
export function carteiraFor(req, hint) {
  const h = CARTEIRAS.includes(String(hint || '').toUpperCase()) ? String(hint).toUpperCase() : null;
  // A carteira escolhida vale quando a pessoa tem acesso a ela, mesmo vendo outra carteira na tela
  const own = req.user?.role === 'admin' ? CARTEIRAS : carteirasOfUser(req.user);
  if (h && own.includes(h)) return h;
  const scope = carteiraScope(req);
  return scope ? scope[0] : 'PAN';
}
// Carteiras em que a pessoa pode anexar capacity: o administrador em todas; Qualidade nas suas
export function capacityCarteiras(user) {
  if (user.role === 'admin') return CARTEIRAS;
  if (user.role !== 'qualidade') return [];
  return carteirasOfUser(user);
}

// ---------------------------------------------------------------- capacity por setor
// Linhas do capacity da carteira para os logins pedidos: vale o do setor; sem ele, o mais recente de alguém da carteira
export async function sectorRoster(carteira, logins) {
  const out = new Map();
  const list = [...new Set(logins.filter(Boolean))];
  const found = [];
  for (let i = 0; i < list.length; i += 200) found.push(...await must(sb().from('px_roster').select('scope, portfolio, login, name, registration, campaign, segment, leader, active, updated_at').in('login', list.slice(i, i + 200))));
  const rank = (r) => (r.scope === `setor:${carteira}` ? 3 : carteirasOfText(r.portfolio).includes(carteira) ? 2 : 0);
  for (const r of found) {
    if (!rank(r)) continue;
    const p = out.get(r.login);
    if (!p || rank(r) > rank(p) || (rank(r) === rank(p) && (r.active && !p.active || r.updated_at > p.updated_at))) out.set(r.login, r);
  }
  return out;
}

export async function applyCapacity(carteira, rows, file, userId) {
  const scope = `setor:${carteira}`;
  const seen = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const login = loginOf(r.login);
    const name = txt(r.name, 160);
    if (!login || !name) continue;
    const prev = seen.get(login);
    if (prev && prev.active && !r.active) continue;
    seen.set(login, {
      scope, portfolio: carteira, login, name, name_key: nameKey(name), registration: txt(r.registration, 30), shift: txt(r.shift, 30), status: txt(r.status, 40),
      campaign: txt(r.campaign, 80), segment: txt(r.segment, 80), leader: txt(r.leader, 160), active: r.active !== false, updated_at: new Date().toISOString(),
    });
  }
  const list = [...seen.values()];
  const active = list.filter((r) => r.active);
  if (!active.length) throw httpError(400, 'Não encontrei operadores ativos no capacity (colunas OPERADOR, LOGIN e LIDERANÇA).');
  for (let i = 0; i < list.length; i += 500) await must(sb().from('px_roster').upsert(list.slice(i, i + 500), { onConflict: 'scope,login' }));
  const keep = new Set(list.map((r) => r.login));
  const old = await fetchAll(() => sb().from('px_roster').select('login').eq('scope', scope).eq('active', true));
  const gone = old.map((r) => r.login).filter((l) => !keep.has(l));
  for (let i = 0; i < gone.length; i += 200) await must(sb().from('px_roster').update({ active: false, status: 'FORA DO CAPACITY' }).eq('scope', scope).in('login', gone.slice(i, i + 200)));
  // Gerência de cada liderança, quando o arquivo traz
  const votes = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const leader = txt(r.leader, 160), manager = txt(r.manager, 160);
    if (!leader || !manager || r.active === false) continue;
    const v = votes.get(leader) || votes.set(leader, {}).get(leader);
    v[manager] = (v[manager] || 0) + 1;
  }
  const leaders = [...votes].map(([leader, v]) => ({ portfolio: carteira, leader, manager: Object.entries(v).sort((a, z) => z[1] - a[1])[0][0], updated_at: new Date().toISOString() }));
  if (leaders.length) await must(sb().from('px_roster_leaders').upsert(leaders, { onConflict: 'portfolio,leader' }));
  const mgr = new Map(leaders.map((l) => [l.leader, l.manager]));
  // Operadores da carteira já cadastrados: nome completo, matrícula, liderança e gerência pelo capacity
  const byLogin = new Map(active.map((r) => [r.login, r]));
  const ops = await fetchAll(() => sb().from('px_operators').select('id, name, login, registration, supervisor_name, manager_name, team').in('portfolio', scopeValues([carteira])).not('login', 'is', null).order('id'));
  let updated = 0;
  for (const o of ops) {
    const c = byLogin.get(String(o.login).toLowerCase());
    if (!c) continue;
    const patch = {};
    const nm = title(c.name);
    if (nm && o.name !== nm) patch.name = nm;
    if (c.registration && o.registration !== c.registration) patch.registration = c.registration;
    if (c.leader && o.supervisor_name !== c.leader) patch.supervisor_name = c.leader;
    if (c.leader && mgr.get(c.leader) && o.manager_name !== mgr.get(c.leader)) patch.manager_name = mgr.get(c.leader);
    if (!o.team && (c.campaign || c.segment)) patch.team = txt(c.segment || c.campaign, 80);
    if (Object.keys(patch).length) { await must(sb().from('px_operators').update(patch).eq('id', o.id)); updated++; }
  }
  await setSetting(`capacity_file:${carteira}`, JSON.stringify({ file: txt(file, 200), at: new Date().toISOString(), by: userId, active: active.length }));
  return { carteira, active: active.length, inactive: list.length - active.length, removed: gone.length, operators_updated: updated, leaders: new Set(active.map((r) => r.leader).filter(Boolean)).size };
}

// ---------------------------------------------------------------- speech Safra Pay
const SAFRA_CODES = ['VPA', 'AVI', 'PAR', 'GRD', 'SOL', 'VAN', 'CSQ', 'PRB', 'ARG', 'MOT', 'J65'];
const res = (v) => (v === 1 ? 'C' : v === 0 ? 'NC' : 'NA');
const isoDate = (s) => { const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/); return m ? { date: `${m[3]}-${m[2]}-${m[1]}`, time: m[4] ? `${m[4]}:${m[5]}` : null } : null; };
const secs = (s) => { const p = String(s || '').split(':').map(Number); return p.length === 3 && p.every(Number.isFinite) ? p[0] * 3600 + p[1] * 60 + p[2] : null; };

export async function importSpeechSafra({ rows, period, file, carteira }, userId) {
  if (!Array.isArray(rows) || !rows.length) throw httpError(400, 'Nenhuma ligação recebida.');
  if (rows.length > 300) throw httpError(400, 'Envie no máximo 300 ligações por vez.');
  const valid = rows.filter((r) => r && r.id && isoDate(r.dt) && Array.isArray(r.a) && r.a.length === SAFRA_CODES.length && r.a.some((x) => x !== null));
  if (!valid.length) throw httpError(400, 'As ligações não estão no formato da análise de speech Safra.');
  const crit = await must(sb().from('px_criteria').select('id, code, weight, critical').eq('product', 'SAFRA_PAY'));
  const byCode = new Map(crit.map((c) => [c.code, c]));
  if (SAFRA_CODES.some((c) => !byCode.has(c))) throw httpError(400, 'O roteiro Safra Pay ainda não existe no banco. Rode a migração 20261105130000_px_safra_relatorios.sql.');
  const ids = valid.map((r) => String(r.id));
  const already = new Set();
  for (let i = 0; i < ids.length; i += 200) (await must(sb().from('px_evaluations').select('external_id').eq('source', 'speech_safra').in('external_id', ids.slice(i, i + 200)))).forEach((r) => already.add(r.external_id));
  const fresh = valid.filter((r) => !already.has(String(r.id)));
  if (!fresh.length) return { created: 0, skipped: valid.length, operators_created: 0 };

  // Operadores pelo login, só na carteira; o nome, a liderança e a campanha vêm do capacity do setor
  const logins = [...new Set(fresh.map((r) => loginOf(r.login)).filter(Boolean))];
  const roster = await sectorRoster(carteira, logins);
  const ops = await fetchAll(() => sb().from('px_operators').select('id, login, name').in('portfolio', scopeValues([carteira])).not('login', 'is', null).order('id'));
  const opId = new Map(ops.map((o) => [String(o.login).toLowerCase(), o]));
  let opsCreated = 0;
  for (const l of logins) {
    const r = roster.get(l);
    const o = opId.get(l);
    if (o) {
      if (r?.name && o.name === l) await must(sb().from('px_operators').update({ name: title(r.name), supervisor_name: r.leader || null }).eq('id', o.id));
      continue;
    }
    const created = await must(sb().from('px_operators').insert({ name: r?.name ? title(r.name) : l, login: l, registration: r?.registration || null, team: r?.segment || r?.campaign || null, supervisor_name: r?.leader || null, portfolio: carteira }).select('id, login, name').single());
    opId.set(l, created); opsCreated++;
  }

  const byCycle = new Map();
  for (const r of fresh) { const d = isoDate(r.dt).date; const k = `${d.slice(0, 8)}${Number(d.slice(8, 10)) <= 15 ? 'A' : 'B'}`; (byCycle.get(k) || byCycle.set(k, []).get(k)).push(d); }
  const cycleOf = new Map();
  for (const [k, ds] of byCycle) cycleOf.set(k, await resolveCycle(null, ds.sort()));

  const now = new Date().toISOString();
  const evRows = fresh.map((r) => {
    const { date, time } = isoDate(r.dt);
    const k = `${date.slice(0, 8)}${Number(date.slice(8, 10)) <= 15 ? 'A' : 'B'}`;
    const items = SAFRA_CODES.map((code, i) => ({ ...byCode.get(code), final_result: res(r.a[i]), speech_result: res(r.a[i]) }));
    const score = computeScore(items, 'final_result').score;
    const proposta = r.a[1] === 1 || r.a[2] === 1 || r.a[7] === 1;
    const login = loginOf(r.login);
    return {
      cycle_id: cycleOf.get(k), operator_id: opId.get(login).id, product: 'CARTOES', segment: null,
      source: 'speech_safra', external_id: String(r.id), protocol: String(r.id), call_date: date, call_time: time,
      customer: txt(r.cli, 160), duration_sec: secs(r.dur), campaign: txt(r.camp, 120), tabulation: txt(r.fin, 120),
      speech_score: score, final_score: score, status: 'revisada', reviewed_by: userId, reviewed_at: now, created_by: userId,
      alerts: proposta ? [] : ['sem_proposta'],
      details: {
        origem: 'Análise de speech Safra Pay', periodo: period || null, arquivo: txt(file, 200),
        facts: [['Campanha', txt(r.camp, 120)], ['Finalização', txt(r.fin, 120)], ['Login', login], ['Duração', txt(r.dur, 12)]].filter(([, v]) => v),
        highlights: proposta ? [] : [['Sem proposta', 'Não ofereceu à vista, parcelamento nem proposta ao banco.']],
      },
    };
  });
  const inserted = await must(sb().from('px_evaluations').insert(evRows).select('id, external_id'));
  const evalId = new Map(inserted.map((x) => [x.external_id, x.id]));
  try {
    const itemRows = [];
    for (const r of fresh) SAFRA_CODES.forEach((code, i) => itemRows.push({ evaluation_id: evalId.get(String(r.id)), criterion_id: byCode.get(code).id, speech_result: res(r.a[i]), final_result: res(r.a[i]), adjusted: false }));
    for (let i = 0; i < itemRows.length; i += 1000) await must(sb().from('px_evaluation_items').insert(itemRows.slice(i, i + 1000)));
  } catch (e) {
    await sb().from('px_evaluations').delete().in('id', inserted.map((x) => x.id));
    throw e;
  }
  return { created: inserted.length, skipped: valid.length - fresh.length, operators_created: opsCreated };
}

// ---------------------------------------------------------------- análises da carteira (relatórios)
const REPORT_KINDS = ['conversao', 'speech_safra', 'nota_qualidade', 'relatorio'];
export async function readingFor(req, logins) {
  const scope = carteiraScope(req);
  let q = sb().from('px_reports').select('id, portfolio, title, period, created_at, data').order('created_at', { ascending: false }).limit(60);
  if (scope) q = q.in('portfolio', scope);
  const reps = await must(q);
  const want = new Set(logins.map((l) => String(l || '').toLowerCase()).filter(Boolean));
  const out = new Map();
  for (const r of reps) {
    for (const x of r.data?.reading || []) {
      const l = String(x.login || '').toLowerCase();
      if (!want.has(l)) continue;
      (out.get(l) || out.set(l, []).get(l)).push({ report_id: r.id, title: r.title, period: r.period, text: x.text, action: x.action });
    }
  }
  return out;
}

export function registerSafra(router, { h, QUALITY, audit }) {
  router.get('/reports', h(async (req, res) => {
    const scope = carteiraScope(req);
    let q = sb().from('px_reports').select('id, portfolio, kind, title, period, file_name, data, created_by, created_at').order('created_at', { ascending: false });
    if (scope) q = q.in('portfolio', scope);
    const rows = await must(q);
    const ids = [...new Set(rows.map((r) => r.created_by).filter(Boolean))];
    const names = ids.length ? new Map((await must(sb().from('px_profiles').select('id, name, display_name').in('id', ids))).map((p) => [p.id, p.display_name || p.name])) : new Map();
    res.json(rows.map((r) => ({ ...r, created_by_name: names.get(r.created_by) || null })));
  }));
  router.get('/reports/:id/html', h(async (req, res) => {
    const r = await must(sb().from('px_reports').select('portfolio, html').eq('id', Number(req.params.id)).maybeSingle());
    if (!r || !inScope(carteiraScope(req), r.portfolio)) return res.status(404).json({ error: 'Análise não encontrada.' });
    res.json({ html: r.html || '' });
  }));
  router.post('/reports', QUALITY, h(async (req, res) => {
    const b = req.body || {};
    const kind = REPORT_KINDS.includes(b.kind) ? b.kind : 'relatorio';
    const t = txt(b.title, 200);
    if (!t) throw httpError(400, 'A análise precisa de um título.');
    const html = typeof b.html === 'string' ? b.html.slice(0, 3_000_000) : null;
    const portfolio = carteiraFor(req, b.carteira);
    // O mesmo arquivo de novo substitui a versão anterior
    const prev = await must(sb().from('px_reports').select('id').eq('portfolio', portfolio).eq('kind', kind).eq('title', t).eq('period', txt(b.period, 80) || '').limit(1));
    const row = { portfolio, kind, title: t, period: txt(b.period, 80) || '', file_name: txt(b.file_name, 200), data: b.data && typeof b.data === 'object' ? b.data : {}, html, created_by: req.user.id };
    const saved = prev.length
      ? await must(sb().from('px_reports').update({ ...row, created_at: new Date().toISOString() }).eq('id', prev[0].id).select('id').single())
      : await must(sb().from('px_reports').insert(row).select('id').single());
    await audit(req.user.id, 'analise_carteira_importada', 'report', saved.id, { titulo: t, carteira: portfolio, substituiu: !!prev.length });
    res.json({ id: saved.id, portfolio, replaced: !!prev.length });
  }));
  router.delete('/reports/:id', QUALITY, h(async (req, res) => {
    const id = Number(req.params.id);
    const r = await must(sb().from('px_reports').select('portfolio, title').eq('id', id).maybeSingle());
    if (!r || !inScope(carteiraScope(req), r.portfolio)) return res.status(404).json({ error: 'Análise não encontrada.' });
    await must(sb().from('px_reports').delete().eq('id', id));
    await audit(req.user.id, 'analise_carteira_excluida', 'report', id, { titulo: r.title });
    res.json({ ok: true });
  }));

  router.post('/import/speech-safra', QUALITY, h(async (req, res) => {
    const b = req.body || {};
    res.json(await importSpeechSafra({ rows: b.rows, period: txt(b.period, 80), file: b.filename, carteira: carteiraFor(req, b.carteira || 'SAFRA BS') }, req.user.id));
  }));

  // Capacity por setor
  router.get('/capacity', h(async (req, res) => {
    const can = capacityCarteiras(req.user);
    const scope = carteiraScope(req);
    const list = (scope || CARTEIRAS).filter((c) => req.user.role === 'admin' || carteirasOfUser(req.user).includes(c));
    const out = [];
    for (const c of list) {
      let meta = null; try { meta = JSON.parse(getSetting(`capacity_file:${c}`) || 'null'); } catch { meta = null; }
      out.push({ carteira: c, can_edit: can.includes(c), file: meta?.file || null, updated_at: meta?.at || null, active: meta?.active ?? null });
    }
    res.json(out);
  }));
  router.post('/capacity', QUALITY, h(async (req, res) => {
    const b = req.body || {};
    const c = String(b.carteira || '').toUpperCase();
    if (!capacityCarteiras(req.user).includes(c)) throw httpError(403, 'Você não pode anexar o capacity deste setor.');
    const out = await applyCapacity(c, b.rows, b.file, req.user.id);
    await audit(req.user.id, 'capacity_setor_atualizado', 'roster', null, { carteira: c, arquivo: txt(b.file, 200), ativos: out.active, saíram: out.removed });
    res.json(out);
  }));
}

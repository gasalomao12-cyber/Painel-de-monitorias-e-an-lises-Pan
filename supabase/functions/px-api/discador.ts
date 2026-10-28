// @ts-nocheck — lista de ligações exportada do discador (.csv: IdContato, Campanha, Operacao, Login, DataHoraLigacao,
// Duracao, CLIENTE, FINALIZACAO, Contrato, NomeDoArquivo, NomeOriginalDoArquivo, TIPO DE DESCONEXÃO…).
// Cada ligação vira um atendimento pendente (operador pelo login, carteira pela operação) ou completa o que já existe,
// para depois receber o áudio, a transcrição ou a análise com IA já vinculados pelo ID.
import { admin, must } from './supa.ts';

const sb = () => admin();
const httpError = (status, message) => Object.assign(new Error(message), { status });
const clip = (s, n) => (s == null || String(s).trim() === '' ? null : String(s).trim().slice(0, n));
const CRITERIA_FOR = { VEICULOS: ['VEICULOS'], CARTOES: ['SEM_GARANTIA', 'CARTOES'], CONSIGNADO: ['SEM_GARANTIA', 'CONSIGNADO'], REFIN: ['AMBOS', 'REFIN'], ENTREGA: ['AMBOS', 'ENTREGA'] };

function productOf(c) {
  const s = `${c.operation || ''} ${c.audio_file || ''}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  if (/CONSIG|EMPRESTIMO/.test(s)) return 'CONSIGNADO';
  if (/CART/.test(s)) return 'CARTOES';
  return 'VEICULOS';
}

// "00:02:32.460" ou "152" → segundos
function seconds(v) {
  if (v == null || v === '') return null;
  if (/^\d+(\.\d+)?$/.test(String(v))) return Math.round(Number(v));
  const p = String(v).split(':').map(Number);
  if (p.some(Number.isNaN)) return null;
  return Math.round(p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]);
}

function cycleName(from) {
  const d = new Date(from + 'T12:00:00');
  const mes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][d.getMonth()];
  return `${d.getDate() <= 15 ? '1ª' : '2ª'} quinzena · ${mes}/${d.getFullYear()}`;
}

export async function cycleFor(date, cache) {
  if (cache.has(date)) return cache.get(date);
  const hit = await must(sb().from('px_cycles').select('id').lte('start_date', date).gte('end_date', date).order('start_date', { ascending: false }).limit(1));
  let id = hit[0]?.id;
  if (!id) {
    const d = new Date(date + 'T12:00:00'), y = d.getFullYear(), m = d.getMonth(), first = d.getDate() <= 15, pad = (n) => String(n).padStart(2, '0');
    const row = await must(sb().from('px_cycles').insert({
      name: cycleName(date), start_date: `${y}-${pad(m + 1)}-${first ? '01' : '16'}`,
      end_date: first ? `${y}-${pad(m + 1)}-15` : `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`,
    }).select('id').single());
    id = row.id;
  }
  cache.set(date, id);
  return id;
}

export async function importCalls({ calls, cycle_id }, userId) {
  if (!Array.isArray(calls) || !calls.length) throw httpError(400, 'Nenhuma ligação recebida.');
  if (calls.length > 500) throw httpError(400, 'Envie no máximo 500 ligações por vez.');
  const rows = calls.map((c) => ({
    id: clip(c.id, 40), campaign: clip(c.campaign, 120), operation: clip(c.operation, 80), login: clip(c.login, 60)?.toLowerCase(),
    at: clip(c.datetime, 30), duration: seconds(c.duration), customer: clip(c.customer, 160), tabulation: clip(c.tabulation, 120),
    contract: clip(c.contract, 80), audio_file: clip(c.audio_file, 300), audio_original: clip(c.audio_original, 200), disconnect: clip(c.disconnect, 40),
  })).filter((c) => c.id && /^\d{4}-\d{2}-\d{2}/.test(c.at || '') && c.login);
  if (!rows.length) throw httpError(400, 'As linhas não têm IdContato, Login e DataHoraLigacao no formato esperado.');

  // Ligações que já existem (importadas de dashboard, planilha ou deste mesmo arquivo)
  const ids = [...new Set(rows.map((r) => r.id))];
  const existing = new Map();
  for (const col of ['external_id', 'protocol']) {
    const found = await must(sb().from('px_evaluations').select('id, external_id, protocol, tabulation, audio_file, duration_sec, campaign, channel, call_time, customer, contract, details').in(col, ids));
    for (const e of found) existing.set(String(e[col]), e);
  }

  // Operadores pelo login (cria os que faltam, com o login como nome até alguém completar o cadastro)
  const logins = [...new Set(rows.map((r) => r.login))];
  const ops = await must(sb().from('px_operators').select('id, login, team'));
  const byLogin = new Map(ops.filter((o) => o.login).map((o) => [o.login.toLowerCase(), o]));
  let opsCreated = 0;
  for (const lg of logins) {
    if (byLogin.has(lg)) continue;
    const r = rows.find((x) => x.login === lg);
    // Equipe: Sem Garantia pelo produto; em Veículos (Contact ou Ativas) fica para completar no cadastro
    const op = await must(sb().from('px_operators').insert({ name: lg, login: lg, team: productOf(r) === 'VEICULOS' ? null : 'PAN Sem Garantia' }).select('id, login, team').single());
    byLogin.set(lg, op); opsCreated++;
  }
  // Cartões e consignado: o segmento (Clean Curto/Longo, Público/Privado) vem da última monitoria do operador no mesmo produto
  const lastSeg = new Map();
  const segRows = await must(sb().from('px_evaluations').select('operator_id, product, segment, call_date').in('operator_id', [...byLogin.values()].map((o) => o.id)).not('segment', 'is', null).order('call_date', { ascending: false }));
  for (const s of segRows) { const k = `${s.operator_id}:${s.product}`; if (!lastSeg.has(k)) lastSeg.set(k, s.segment); }

  const cycles = new Map();
  let updated = 0;
  const fresh = [];
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const ex = existing.get(r.id);
    const facts = [['Tabulação', r.tabulation], ['Campanha', r.campaign], ['Canal', /AGV/i.test(r.campaign || '') ? 'AGV (agente virtual)' : 'Convencional'], ['Desconexão', r.disconnect], ['Arquivo no speech', r.audio_original]].filter(([, v]) => v);
    if (ex) {
      // Completa só o que estiver vazio; nada do que a Qualidade já trabalhou é sobrescrito
      const patch = {};
      if (!ex.tabulation && r.tabulation) patch.tabulation = r.tabulation;
      if (!ex.audio_file && r.audio_file) patch.audio_file = r.audio_file;
      if (!ex.duration_sec && r.duration) patch.duration_sec = r.duration;
      if (!ex.campaign && r.campaign) patch.campaign = r.campaign;
      if (!ex.channel && r.campaign) patch.channel = /AGV/i.test(r.campaign) ? 'AGV' : 'Convencional';
      if (!ex.call_time && r.at.length >= 16) patch.call_time = r.at.slice(11, 16);
      if (!ex.contract && r.contract) patch.contract = r.contract;
      if (!ex.details) patch.details = { origem: 'Lista de ligações do discador', facts };
      if (Object.keys(patch).length) { await must(sb().from('px_evaluations').update(patch).eq('id', ex.id)); updated++; }
      continue;
    }
    const op = byLogin.get(r.login);
    const product = productOf(r);
    const date = r.at.slice(0, 10);
    // Ligações AGV têm grupo próprio (a análise do dia), fora das quinzenas de monitoria
    const agv = /AGV/i.test(r.campaign || '');
    fresh.push({
      cycle_id: agv ? null : cycle_id || await cycleFor(date, cycles), operator_id: op.id, product,
      segment: ['CARTOES', 'CONSIGNADO'].includes(product) ? lastSeg.get(`${op.id}:${product}`) || null : null,
      source: 'discador', external_id: r.id, protocol: r.id, call_date: date, call_time: r.at.slice(11, 16) || null,
      duration_sec: r.duration, customer: r.customer, contract: r.contract, audio_file: r.audio_file,
      tabulation: r.tabulation, campaign: r.campaign, channel: /AGV/i.test(r.campaign || '') ? 'AGV' : 'Convencional',
      status: 'pendente', created_by: userId, details: { origem: 'Lista de ligações do discador', facts },
    });
  }
  let created = 0;
  if (fresh.length) {
    const inserted = await must(sb().from('px_evaluations').insert(fresh).select('id, product, channel'));
    created = inserted.length;
    // Roteiro em branco (o AGV nas campanhas AGV, o da carteira nas demais): será preenchido pelo speech,
    // pela análise com IA ou pela Qualidade
    const crit = await must(sb().from('px_criteria').select('id, product').eq('active', true));
    const items = inserted.flatMap((e) => crit.filter((c) => (e.channel === 'AGV' ? ['AGV'] : CRITERIA_FOR[e.product] || []).includes(c.product)).map((c) => ({ evaluation_id: e.id, criterion_id: c.id })));
    try { for (let i = 0; i < items.length; i += 1000) await must(sb().from('px_evaluation_items').insert(items.slice(i, i + 1000))); }
    catch (e) { await sb().from('px_evaluations').delete().in('id', inserted.map((x) => x.id)); throw e; }
  }
  return { created, updated, skipped: rows.length - created - updated, operators_created: opsCreated, cycle_id: cycle_id || [...cycles.values()][0] || null };
}

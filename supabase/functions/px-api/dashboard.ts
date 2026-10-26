// @ts-nocheck — importação dos dashboards de monitoria PAN já trabalhados (HTML com JSON embutido).
// Dois formatos conhecidos:
//   • dash_veiculos      — "Speech E.A. e Refin" de PAN Veículos (respostas do speech + ajustes de coerência)
//   • dash_sem_garantia  — "Roteiro PAN Sem Garantia" (Cartões e Consignado, leitura da transcrição completa)
// O navegador só extrai o JSON do arquivo; todo o mapeamento para a plataforma acontece aqui.
import { admin, must } from './supa.ts';
import { computeScore } from './scoring.ts';

const sb = () => admin();

// Item do dashboard → código do critério na plataforma (ver migração 20261026160000)
const KEYS = {
  dash_veiculos: { contrato: 'CTR', atraso: 'ATR', grav: 'GRV', sd: 'SMO', sv: 'SQQ', prop: 'PRP', alt: 'ALT', ea: 'OEA', rf: 'ORF', ben: 'BEN', cons: 'CSQ', conf: 'CFA', post: 'POS' },
  dash_sem_garantia: { ab: 'APR', cpf: 'CPF', div: 'DIV', sd: 'SMO', sv: 'SQQ', prop: 'PRP', alt: 'ALT', ben: 'BEN', cons: 'CSQ', conf: 'CFA', cad: 'CAD' },
};
const CRITERIA_PRODUCT = { dash_veiculos: 'VEICULOS', dash_sem_garantia: 'SEM_GARANTIA' };
const SOURCE_LABEL = { dash_veiculos: 'Dashboard Speech E.A. e Refin (Veículos)', dash_sem_garantia: 'Dashboard Roteiro Sem Garantia (Cartões e Consignado)' };

const GER = { AM: { nome: 'Amanda Mendes', op: 'Contact & WO' }, TS: { nome: 'Tatiane de Souza', op: 'Ativas' } };
const FAM = { ACO: 'Acordo ou indicação', PRO: 'Promessa ou previsão', SEM: 'Sem acordo, com motivo', IMP: 'CPC improdutivo', NCPC: 'Não falou com o titular' };
const DES = { 'ACORDO COM BOLETO OU PIX': 'Acordo com boleto ou Pix', 'PROMESSA SEM BOLETO': 'Promessa sem boleto', RECUSA: 'Recusou', 'JA PAGOU': 'Já tinha pago', 'CAIU OU DESLIGOU': 'Caiu ou desligou', 'SEM NEGOCIACAO': 'Sem negociação' };
const MOT = { 'DESEMPREGO OU SEM RENDA': 'Desemprego ou sem renda', 'SALARIO ATRASADO OU DATA DE RECEBIMENTO': 'Salário atrasado ou data de recebimento', 'DOENCA OU IMPREVISTO': 'Doença ou imprevisto', 'OUTRAS DIVIDAS': 'Outras dívidas', 'CARTAO USADO POR OUTRA PESSOA': 'Cartão usado por outra pessoa', 'DESCONTO NAO FEITO EM FOLHA': 'Desconto não feito em folha', 'JA PAGOU': 'Já pagou', 'NAO RECONHECE A DIVIDA': 'Não reconhece a dívida', 'ESQUECEU OU VAI PAGAR': 'Esqueceu ou vai pagar', 'NAO INFORMOU': 'Não informou o motivo', NA: 'Não se aplica' };
const OFS = { 'PAGAMENTO MINIMO': 'Pagamento mínimo', 'VALOR INTERMEDIARIO': 'Valor intermediário', 'FATURA OU PARCELA TOTAL': 'Fatura ou parcela total', 'PARCELAMENTO OU RENEGOCIACAO': 'Parcelamento ou renegociação', 'QUITACAO COM DESCONTO': 'Quitação com desconto' };
const ESF = { A: 'Negociação completa', M: 'Negociação parcial', B: 'Negociação fraca', Z: 'Sem nenhuma proposta' };
const COND = { RUDE: 'Rude', RISPIDO: 'Ríspido', SECO: 'Seco ou frio', IRONICO: 'Irônico', IMPACIENTE: 'Impaciente', RAIVA: 'Com raiva', INTERROMPEU: 'Interrompeu o cliente', 'PRESSAO OU AMEACA': 'Pressão ou ameaça', 'FALTA DE EMPATIA': 'Falta de empatia', 'ENCERRAMENTO ABRUPTO': 'Encerramento abrupto' };
const GRAV = { ALTA: 'alta', MEDIA: 'média', BAIXA: 'baixa' };
const SDC = { 'CLIENTE CONTOU SOZINHO': 'Cliente contou o motivo sozinho (não cobrado)', 'SEM ESPACO': 'Conversa sem espaço para a pergunta (não cobrado)', 'ACEITOU DE PRONTO': 'Cliente aceitou de pronto (havia tempo para perguntar)', 'TINHA OPORTUNIDADE': 'Tinha oportunidade e não perguntou', PERGUNTOU: 'Perguntou' };
const QUEM = { CLIENTE: 'Titular', 'OUTRA PESSOA': 'Outra pessoa', NINGUEM: 'Ninguém (caiu ou mudo)' };
// Evidências do dashboard Sem Garantia → item do roteiro (SONDAGEM vai para o motivo ou para quanto/quando, conforme o trecho)
const EVID = { PROPOSTA: 'prop', OUTRA_OPCAO: 'alt', BENEFICIO: 'ben', CONSEQUENCIA: 'cons' };

const res = (v) => (v === 1 ? 'C' : v === 0 ? 'NC' : 'NA');
const resTxt = (v) => (v === 'null' || v == null ? 'NA' : v === '1' || v === 1 ? 'C' : 'NC');
const clip = (s, n = 500) => (s == null ? null : String(s).trim().slice(0, n) || null);
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const noLeader = (s) => !s || /^sem lideran/i.test(s);

export function detectKind(calls) {
  const c = Array.isArray(calls) ? calls[0] : null;
  if (!c || !c.q) return null;
  if ('ea' in c.q && 'contrato' in c.q) return 'dash_veiculos';
  if ('ab' in c.q && 'cpf' in c.q) return 'dash_sem_garantia';
  return null;
}

// Produto e segmento da ligação. Sem Garantia aparta Cartões (Clean Curto / Clean Longo)
// e Consignado (Público / Privado) pelo segmento do Capacity.
export function productOf(kind, c) {
  if (kind === 'dash_veiculos') return { product: 'VEICULOS', segment: null };
  const seg = norm(c.seg);
  if (c.prod === 'CON') return { product: 'CONSIGNADO', segment: /privad/.test(seg) ? 'PRIVADO' : /consign|public/.test(seg) ? 'PUBLICO' : null };
  return { product: 'CARTOES', segment: /longo/.test(seg) ? 'CLEAN_LONGO' : /curto/.test(seg) ? 'CLEAN_CURTO' : null };
}

// "cad 0 para null: cliente já pagou; cons null para 0: ..." → ajustes item a item
export function parseMud(text, keys) {
  const out = {};
  const clauses = String(text || '').split(/;\s*|\.\s+(?=[a-z])/).map((s) => s.trim()).filter(Boolean);
  for (const cl of clauses) {
    const re = /\b([a-z]+) (0|1|null) para (0|1|null)\b/g;
    let m, any = false;
    while ((m = re.exec(cl))) {
      if (!keys.includes(m[1])) continue;
      any = true;
      out[m[1]] = { from: resTxt(m[2]), to: resTxt(m[3]), reason: clip(cl.replace(/^[^:]*:\s*/, ''), 400) || clip(cl, 400) };
    }
    if (any) continue;
    // Forma em lista: "sv, prop, ben e cad para null: quem atendeu foi a esposa"
    const lm = cl.match(/^(.*?)\bpara null\b/);
    if (!lm) continue;
    for (const k of keys) {
      if (new RegExp(`\\b${k}\\b`).test(lm[1]) && !out[k]) out[k] = { from: null, to: 'NA', reason: clip(cl, 400) };
    }
  }
  return out;
}

function vehicleCall(c) {
  const keys = Object.keys(KEYS.dash_veiculos);
  const q = c.q || {};
  const notes = Array.isArray(c.adj) ? c.adj.map(String) : [];
  const evNotes = [];
  const itemNote = {};
  for (const n of notes) {
    const low = norm(n);
    let k = null;
    if (low.startsWith('proposta:')) k = 'prop';
    else if (low.startsWith('consequencias')) k = 'cons';
    else { const m = n.match(/^([a-z]+):/); if (m && keys.includes(m[1])) k = m[1]; }
    if (k) itemNote[k] = n; else evNotes.push(n);
  }
  const items = {};
  for (const k of keys) {
    const final = res(q[k]);
    let speech = final, reason = null;
    if (`${k}_raw` in q) {
      speech = res(q[`${k}_raw`]);
      if (speech !== final) {
        reason = k === 'ea' ? 'Cliente fora da base apta de E.A.: a oferta não conta.'
          : c.aju ? 'Contrato ajuizado: refin não conta.' : 'Cliente fora da base Nelson (refin): a oferta não conta.';
      }
    }
    if (itemNote[k]) { reason = itemNote[k]; if (!(`${k}_raw` in q)) speech = null; }
    items[k] = { speech, final, reason, note: null };
  }
  const apt = c.aEA || c.aRF ? [c.aEA && 'Entrega amigável', c.aRF && 'Refin'].filter(Boolean).join(' e ') : 'Nenhuma das bases';
  const lost = (c.aEA && q.ea === 0) || (c.aRF && q.rf === 0);
  const alerts = [];
  if (lost) alerts.push('oferta_perdida');
  if (q.post === 0) alerts.push('postura');
  if (c.st === 'SEM') alerts.push('sem_speech');
  const highlights = [];
  if (c.st === 'SEM') highlights.push({ kind: 'warn', title: 'Sem resposta do speech', text: 'O speech não devolveu respostas para esta ligação. Ouça o áudio ou anexe a transcrição para analisar.' });
  if (lost) highlights.push({ kind: 'bad', title: 'Oportunidade perdida', text: `Cliente apto a ${apt.toLowerCase()} e a oferta não foi feita.` });
  if (q.post === 0) highlights.push({ kind: 'bad', title: 'Postura', text: 'O speech apontou postura inadequada nesta ligação.' });
  for (const n of evNotes) highlights.push({ kind: /conferir|ausente/i.test(n) ? 'warn' : 'info', title: 'Observação do dashboard', text: n });
  const g = GER[c.g];
  return {
    items, alerts, highlights,
    status: c.st === 'OK' ? 'revisada' : 'pendente',
    row: {
      campaign: clip(c.camp, 120), channel: c.agv ? 'AGV' : 'Convencional', tabulation: clip(c.fin, 120), outcome: FAM[c.fam] || clip(c.fam, 80),
      apt_ea: !!c.aEA, apt_refin: !!c.aRF, speech_summary: c.st === 'SEM' ? 'Sem resposta do speech.' : null,
    },
    operator: { team: g?.op || null, manager_name: g?.nome || null },
    facts: [
      ['Gerência', g ? `${g.nome} · ${g.op}` : c.g], ['Campanha', c.camp], ['Canal', c.agv ? 'AGV (agente virtual)' : 'Convencional'],
      ['Tabulação', c.fin], ['Desfecho', FAM[c.fam] || c.fam], ['Cliente apto a', apt],
      ['Oferta de refin (base Nelson)', c.aju ? 'Ajuizado: sem refin' : c.nel || null],
    ],
  };
}

function unsecuredCall(c) {
  const keys = Object.keys(KEYS.dash_sem_garantia);
  const q = c.q || {};
  const mud = parseMud(c.mud, keys);
  const items = {};
  for (const k of keys) {
    const final = res(q[k]);
    const a = mud[k];
    items[k] = a ? { speech: a.from, final, reason: a.reason, note: null } : { speech: final, final, reason: null, note: null };
  }
  const ev = c.ev || {};
  for (const [ek, k] of Object.entries(EVID)) if (ev[ek]) items[k].note = clip(`Trecho: “${ev[ek]}”`, 400);
  const sondMotivo = ev.SONDAGEM && /motivo|aconteceu|por ?que|o que houve/i.test(ev.SONDAGEM);
  if (ev.SONDAGEM && !sondMotivo) items.sv.note = clip(`Trecho: “${ev.SONDAGEM}”`, 400);
  items.sd.note = clip([
    c.sdcat && [SDC[c.sdcat] || c.sdcat, c.sdpq].filter(Boolean).join(' — '),
    sondMotivo && `Pergunta: “${ev.SONDAGEM}”`,
    ev.MOTIVO && `Cliente: “${ev.MOTIVO}”`,
  ].filter(Boolean).join(' · '), 600);
  const sigilo = (c.al || []).filter((a) => a[0] === 'sig').map((a) => a[1]);
  if (c.ev?.SIGILO) sigilo.push(c.ev.SIGILO);
  const alerts = [];
  if (sigilo.length) alerts.push('sigilo');
  if (c.cond) alerts.push('conduta');
  if (c.ruim) alerts.push('audio_ruim');
  if (c.esf === 'Z') alerts.push('sem_proposta');
  const highlights = [];
  if (sigilo.length) highlights.push({ kind: 'bad', title: 'Dados passados a outra pessoa (sigilo)', text: [...new Set(sigilo)].join(' · ') });
  if (c.cond) highlights.push({ kind: 'bad', title: `Conduta: ${COND[c.cond.tipo] || c.cond.tipo}${c.cond.grav ? ` · gravidade ${GRAV[c.cond.grav] || c.cond.grav}` : ''}`, text: `“${c.cond.trecho}”${c.cond.contexto ? ` — ${c.cond.contexto}` : ''}` });
  if (c.acolh) highlights.push({ kind: 'ok', title: 'Acolhimento', text: c.acolh });
  if (c.ruim) highlights.push({ kind: 'warn', title: 'Áudio sem condições de avaliação', text: 'Ligação curta, muda ou com áudio ruim.' });
  if (c.mud) highlights.push({ kind: 'info', title: 'Ajustes da segunda leitura', text: c.mud });
  return {
    items, alerts, highlights,
    status: 'revisada',
    row: {
      tabulation: clip(c.fin, 120), outcome: DES[c.des] || clip(c.des, 80), effort: ESF[c.esf] ? c.esf : null,
      speech_summary: clip(c.res, 2000), transcript: c.txt ? String(c.txt).slice(0, 400000) : null, transcript_name: c.txt ? `transcricao-${c.id}.txt` : null,
      ai_summary: c.res || c.pf || c.fb ? { engine: 'dashboard', summary: c.res || '', feedback: { strengths: c.pf || '', improvements: c.fb || '', action_plan: '' } } : null,
    },
    operator: { team: 'PAN Sem Garantia', manager_name: null },
    facts: [
      ['Segmento no Capacity', c.seg || null], ['Quem atendeu', QUEM[c.quem] || c.quem], ['Tabulação', c.fin],
      ['Desfecho', DES[c.des] || c.des], ['Motivo do atraso', MOT[c.mot] || c.mot],
      ['Ofertas feitas', (c.ofs || []).map((o) => OFS[o] || o).join(', ') || null], ['Esforço negocial', ESF[c.esf] || null],
    ],
  };
}

function cycleName(from) {
  const d = new Date(from + 'T12:00:00');
  const mes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][d.getMonth()];
  return `${d.getDate() <= 15 ? '1ª' : '2ª'} quinzena · ${mes}/${d.getFullYear()}`;
}

async function resolveCycle(cycleId, dates) {
  if (cycleId) {
    const c = await must(sb().from('px_cycles').select('id').eq('id', Number(cycleId)).maybeSingle());
    if (c) return c.id;
  }
  const from = dates[0], to = dates[dates.length - 1];
  const hit = await must(sb().from('px_cycles').select('id').lte('start_date', from).gte('end_date', to).order('start_date', { ascending: false }).limit(1));
  if (hit.length) return hit[0].id;
  const d = new Date(from + 'T12:00:00');
  const first = d.getDate() <= 15;
  const y = d.getFullYear(), m = d.getMonth();
  const pad = (n) => String(n).padStart(2, '0');
  const start = `${y}-${pad(m + 1)}-${first ? '01' : '16'}`;
  const end = first ? `${y}-${pad(m + 1)}-15` : `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`;
  const row = await must(sb().from('px_cycles').insert({ name: cycleName(from), start_date: start <= from ? start : from, end_date: end >= to ? end : to }).select('id').single());
  return row.id;
}

async function resolveOperators(calls, mapped) {
  const logins = [...new Set(calls.map((c) => String(c.log || '').trim().toLowerCase()).filter(Boolean))];
  const existing = await must(sb().from('px_operators').select('*'));
  const supervisors = await must(sb().from('px_profiles').select('id, name').eq('role', 'supervisor').eq('active', true));
  const supByName = new Map(supervisors.map((s) => [norm(s.name), s.id]));
  const byLogin = new Map(existing.filter((o) => o.login).map((o) => [o.login.toLowerCase(), o]));
  const byName = new Map(existing.map((o) => [norm(o.name), o]));
  const out = new Map();
  let created = 0;
  for (const login of logins) {
    const i = calls.findIndex((c) => String(c.log || '').trim().toLowerCase() === login);
    const c = calls[i], info = mapped[i].operator;
    const name = String(c.op || login).trim();
    const leader = noLeader(c.lid) ? null : String(c.lid).trim();
    const fields = { login, team: info.team, supervisor_name: leader, ...(info.manager_name ? { manager_name: info.manager_name } : {}) };
    const sup = leader ? supByName.get(norm(leader)) : null;
    if (sup) fields.supervisor_user_id = sup;
    let op = byLogin.get(login) || (name !== login ? byName.get(norm(name)) : null);
    if (op) {
      const changes = Object.fromEntries(Object.entries(fields).filter(([k, v]) => v && op[k] !== v));
      if (Object.keys(changes).length) op = await must(sb().from('px_operators').update(changes).eq('id', op.id).select().single());
    } else {
      op = await must(sb().from('px_operators').insert({ name, ...fields }).select().single());
      created++;
    }
    out.set(login, op.id);
  }
  return { ids: out, created };
}

// Importa um lote de ligações. Ligações já importadas (mesma origem + id) são ignoradas.
export async function importDashboard({ kind, calls, cycle_id, period }, userId) {
  if (!KEYS[kind]) throw Object.assign(new Error('Formato de dashboard não reconhecido.'), { status: 400 });
  if (!Array.isArray(calls) || !calls.length) throw Object.assign(new Error('Nenhuma ligação recebida.'), { status: 400 });
  if (calls.length > 200) throw Object.assign(new Error('Envie no máximo 200 ligações por vez.'), { status: 400 });
  const valid = calls.filter((c) => c && c.id && /^\d{4}-\d{2}-\d{2}/.test(String(c.dt || '')) && c.q);
  if (!valid.length) throw Object.assign(new Error('As ligações não estão no formato esperado.'), { status: 400 });

  const crit = await must(sb().from('px_criteria').select('id, code, weight, critical').eq('product', CRITERIA_PRODUCT[kind]));
  const critByCode = new Map(crit.map((c) => [c.code, c]));
  const missing = Object.values(KEYS[kind]).filter((code) => !critByCode.has(code));
  if (missing.length) throw Object.assign(new Error('Os critérios do roteiro ainda não existem no banco. Rode a migração 20261026160000_px_carteiras_dashboards.sql no SQL Editor.'), { status: 400 });

  const ids = valid.map((c) => String(c.id));
  const already = new Set((await must(sb().from('px_evaluations').select('external_id').eq('source', kind).in('external_id', ids))).map((r) => r.external_id));
  const fresh = valid.filter((c) => !already.has(String(c.id)));
  const dates = valid.map((c) => String(c.dt).slice(0, 10)).sort();
  const cycleId = await resolveCycle(cycle_id, dates);
  if (!fresh.length) return { kind, cycle_id: cycleId, created: 0, skipped: valid.length, operators_created: 0 };

  const mapped = fresh.map((c) => (kind === 'dash_veiculos' ? vehicleCall(c) : unsecuredCall(c)));
  const { ids: opIds, created: opsCreated } = await resolveOperators(fresh, mapped);
  const now = new Date().toISOString();

  const rows = fresh.map((c, i) => {
    const m = mapped[i];
    const { product, segment } = productOf(kind, c);
    const items = Object.entries(KEYS[kind]).map(([k, code]) => ({ ...critByCode.get(code), ...m.items[k] }));
    const speechScore = computeScore(items.map((it) => ({ ...it, speech_result: it.speech })), 'speech_result').score;
    const finalScore = computeScore(items.map((it) => ({ ...it, final_result: it.final })), 'final_result').score;
    const customer = c.cli && !/^nao localizado$/i.test(norm(c.cli)) ? clip(c.cli, 160) : null;
    return {
      cycle_id: cycleId, operator_id: opIds.get(String(c.log).trim().toLowerCase()), product, segment,
      source: kind, external_id: String(c.id), call_date: String(c.dt).slice(0, 10), call_time: String(c.dt).slice(11, 16) || null,
      protocol: String(c.id), customer, duration_sec: Number.isFinite(Number(c.dur)) ? Math.round(Number(c.dur)) : null,
      audio_file: clip(c.arq, 300), speech_score: speechScore, final_score: finalScore,
      status: m.status, reviewed_by: m.status === 'pendente' ? null : userId, reviewed_at: m.status === 'pendente' ? null : now,
      alerts: m.alerts, created_by: userId,
      details: { origem: SOURCE_LABEL[kind], periodo: period || null, facts: m.facts.filter(([, v]) => v != null && v !== ''), highlights: m.highlights },
      ...m.row,
    };
  });
  const inserted = await must(sb().from('px_evaluations').insert(rows).select('id, external_id'));
  const evalId = new Map(inserted.map((r) => [r.external_id, r.id]));
  try {
    const itemRows = [];
    fresh.forEach((c, i) => {
      for (const [k, code] of Object.entries(KEYS[kind])) {
        const it = mapped[i].items[k];
        const adjusted = it.speech !== it.final || !!it.reason;
        itemRows.push({
          evaluation_id: evalId.get(String(c.id)), criterion_id: critByCode.get(code).id,
          speech_result: it.speech, speech_note: it.note, final_result: it.final,
          adjusted, adjust_reason: adjusted ? it.reason || 'Ajuste trazido do dashboard.' : null,
          adjust_source: adjusted ? 'dashboard' : null, adjusted_at: adjusted ? now : null,
        });
      }
    });
    for (let i = 0; i < itemRows.length; i += 1000) await must(sb().from('px_evaluation_items').insert(itemRows.slice(i, i + 1000)));
  } catch (e) {
    await sb().from('px_evaluations').delete().in('id', inserted.map((r) => r.id));
    throw e;
  }
  return { kind, cycle_id: cycleId, created: inserted.length, skipped: valid.length - fresh.length, operators_created: opsCreated };
}

import { api } from '../api.js';
import { html, icon, $, toast, busy, fmtDate, fmtScore, fmtInt, PRODUCT, SEGMENT } from '../ui.js';
import { parseSheetFile, downloadTemplate } from '../files.js';
import { sendAgvDashboard, AGV_DASH_KIND } from './agv.js';
import { CARTEIRA_INFO, viewCarteira, userCarteiras } from '../carteira.js';
import { readCarteiraReport } from '../carteira-reports.js';

// ------------------------------------------------------------------ Lista de ligações do discador (.csv)
// Colunas do relatório do discador → campos da plataforma (sem acento e sem diferenciar maiúsculas)
const CALL_COLS = {
  id: ['idcontato', 'id contato', 'id da ligacao', 'id ligacao', 'idligacao', 'callid'],
  campaign: ['campanha'], operation: ['operacao', 'carteira'], login: ['login', 'usuario', 'agente'],
  datetime: ['datahoraligacao', 'data hora ligacao', 'datahora', 'data/hora', 'data da ligacao'], duration: ['duracao', 'tempo'],
  customer: ['cliente', 'nome do cliente'], tabulation: ['finalizacao', 'tabulacao'], contract: ['contrato'],
  audio_file: ['nomedoarquivo', 'nome do arquivo', 'arquivo'], audio_original: ['nomeoriginaldoarquivo', 'nome original do arquivo'],
  disconnect: ['tipo de desconexao', 'desconexao'],
};
const plain = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export function mapCalls(rows) {
  if (!rows.length) return null;
  const heads = Object.keys(rows[0]);
  const col = Object.fromEntries(Object.entries(CALL_COLS).map(([k, al]) => [k, heads.find((h) => al.includes(plain(h)))]));
  if (!col.id || !col.login || !col.datetime) return null;
  return rows.map((r) => Object.fromEntries(Object.entries(col).filter(([, h]) => h).map(([k, h]) => [k, r[h] == null ? '' : String(r[h]).trim()])))
    .filter((c) => c.id && c.login);
}
let calls = null;

function drawCalls(el, ctx) {
  const box = $('#calls-prev', el);
  if (!calls) { box.innerHTML = ''; return; }
  const { rows, name } = calls;
  const by = (k) => Object.entries(rows.reduce((a, r) => { const v = r[k] || '—'; a[v] = (a[v] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]);
  const dates = rows.map((r) => r.datetime.slice(0, 10)).sort();
  const known = new Set(ctx.store.meta.operators.map((o) => String(o.login || '').toLowerCase()).filter(Boolean));
  const logins = [...new Set(rows.map((r) => r.login.toLowerCase()))];
  const novos = logins.filter((l) => !known.has(l));
  box.innerHTML = String(html`<div class="card mt"><div class="card-head"><div><h3>${fmtInt(rows.length)} ligações do discador</h3>
      <div class="sub">${name} · ${fmtDate(dates[0])} a ${fmtDate(dates[dates.length - 1])}</div></div><div class="grow"></div>
      <button class="btn ghost" id="calls-cancel">Cancelar</button><button class="btn primary lg" id="calls-go">${icon('upload')}Importar ${fmtInt(rows.length)} ligações</button></div>
    <div class="card-body">
      <div class="grid g-4">
        <div class="insight"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${icon('layers')}</span><div><b>Carteiras</b><div class="t2 small">${by('operation').map(([k, n]) => `${k}: ${n}`).join(' · ')}</div></div></div>
        <div class="insight"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${icon('users')}</span><div><b>${logins.length} operadores</b><div class="t2 small">${novos.length ? `${novos.length} login(s) novo(s) serão cadastrados: ${novos.slice(0, 6).join(', ')}${novos.length > 6 ? '…' : ''}` : 'todos já cadastrados'}</div></div></div>
        <div class="insight"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${icon('list')}</span><div><b>Tabulações</b><div class="t2 small">${by('tabulation').slice(0, 4).map(([k, n]) => `${k}: ${n}`).join(' · ')}${by('tabulation').length > 4 ? ' …' : ''}</div></div></div>
        <div class="insight"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${icon('audio')}</span><div><b>Áudios</b><div class="t2 small">${rows.filter((r) => r.audio_file).length} com nome do arquivo: ao enviar o áudio ou a transcrição, a ligação se vincula sozinha.</div></div></div>
      </div>
      <div class="grid g-2 mt">
        <div class="field"><label for="calls-cycle">Quinzena de destino</label><select class="select" id="calls-cycle">
          <option value="">Automática (pela data de cada ligação)</option>${ctx.store.meta.cycles.map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select>
          <span class="hint">Ligações de campanhas AGV não entram em quinzena: ficam na divisão AGV, agrupadas pela análise do dia. Cada ligação vira um atendimento pendente de análise. Se ela já existir na plataforma (por exemplo, importada de um dashboard), só os dados que faltam são completados.</span></div>
        <div id="calls-progress" class="small t2" style="align-self:end"></div>
      </div>
    </div></div>`);
  $('#calls-cancel', box).onclick = () => { calls = null; $('#calls-name').textContent = '.csv exportado do discador'; drawCalls(el, ctx); };
  $('#calls-go', box).onclick = async (e) => {
    const btnEl = e.currentTarget; busy(btnEl, true, 'Importando');
    const prog = $('#calls-progress', box);
    const tot = { created: 0, updated: 0, skipped: 0, operators_created: 0 };
    const size = 200;
    try {
      for (let i = 0; i < rows.length; i += size) {
        prog.textContent = `Enviando ${Math.min(i + size, rows.length)} de ${rows.length}…`;
        const r = await api.post('/import/calls', { calls: rows.slice(i, i + size), cycle_id: $('#calls-cycle', box).value || null, filename: name, batch: i / size + 1, last: i + size >= rows.length });
        for (const k of Object.keys(tot)) tot[k] += r[k] || 0;
      }
      toast(`${tot.created} ligação(ões) nova(s)${tot.updated ? ` · ${tot.updated} completada(s)` : ''}${tot.skipped ? ` · ${tot.skipped} já estavam completas` : ''}${tot.operators_created ? ` · ${tot.operators_created} operador(es) cadastrado(s)` : ''}.`, 'ok', 6000);
      calls = null; await ctx.refreshMeta(); ctx.navigate('atendimentos');
    } catch (ex) { toast(ex.message, 'err', 7000); busy(btnEl, false); prog.textContent = ''; }
  };
}

let preview = null, fileName = '', dash = null;

// ------------------------------------------------------------------ Dashboards de monitoria PAN (.html)
// O arquivo traz os dados num <script id="dados" type="application/json">. Lemos só esse JSON
// no navegador; o mapeamento (roteiro, ajustes, alertas, produto e segmento) é feito pela API.
const DASH_KIND = { dash_veiculos: 'Speech E.A. e Refin · PAN Veículos', dash_sem_garantia: 'Roteiro Sem Garantia · PAN Cartões e Consignado' };
function detectKind(calls) {
  const q = calls?.[0]?.q;
  if (!q) return null;
  if ('ea' in q && 'contrato' in q) return 'dash_veiculos';
  if ('ab' in q && 'cpf' in q) return 'dash_sem_garantia';
  return null;
}
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// Mesma regra da API: Cartões em Clean Curto/Longo e Consignado em Público/Privado (segmento do Capacity)
function productOf(kind, c) {
  if (kind === 'dash_veiculos') return ['VEICULOS', null];
  const seg = norm(c.seg);
  if (c.prod === 'CON') return ['CONSIGNADO', /privad/.test(seg) ? 'PRIVADO' : /consign|public/.test(seg) ? 'PUBLICO' : 'none'];
  return ['CARTOES', /longo/.test(seg) ? 'CLEAN_LONGO' : /curto/.test(seg) ? 'CLEAN_CURTO' : 'none'];
}
// Dashboards AGV: "Teste do speech AGV" por gerência (resposta do speech + revisada) e o comparativo entre dois dias
function detectAgvKind(calls) {
  const c = (calls || []).find((x) => x && ((x.sp && x.fin) || (x.q && Object.keys(x.q).length))) || (calls || [])[0];
  if (!c) return null;
  if (c.sp && c.fin && 'ident' in c.sp) return 'dash_agv';
  if (c.day && c.q && ('sv' in c.q || 'conv' in c.q)) return 'dash_agv_cmp';
  return null;
}
const ddmm = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');
// Períodos e gerências ficam no script do dashboard (PER e GER); lidos como texto, sem executar nada do arquivo
function readEsforco(data, doc, text, file) {
  const periods = {};
  for (const m of text.matchAll(/\{\s*k:\s*'([A-Z])',\s*lb:\s*'([^']+)'\s*\}/g)) periods[m[1]] = m[2];
  const ger = {};
  const gerBlock = (text.match(/const GER = \{([\s\S]*?)\};/) || [])[1] || '';
  for (const m of gerBlock.matchAll(/(\w+):\s*\{\s*nome:\s*'([^']+)',\s*op:\s*'([^']+)'/g)) ger[m[1]] = { nome: m[2], op: m[3] };
  const title = (doc.title || '').trim();
  const dates = data.calls.map((c) => c.dt).filter(Boolean).sort();
  const year = (dates[dates.length - 1] || String(new Date().getFullYear())).slice(0, 4);
  // Notas do roteiro dos primeiros segundos das ligações de histórico vêm na lista "rot"
  const rot = new Map((data.rot || []).map((r) => [`${r.per}:${r.id}`, r]));
  const calls = data.calls.map((c) => { const r = rot.get(`${c.per}:${c.id}`); return r && !c.s ? { ...c, s: r.s, ap: r.ap } : c; });
  const ids = new Set(data.calls.map((c) => `${c.per}:${c.id}`));
  for (const r of data.rot || []) if (!ids.has(`${r.per}:${r.id}`)) calls.push({ ...r, c: null });
  return {
    kind: 'dash_agv_esf', calls, name: file.name, title,
    meta: { periods, ger, year, title, aud: typeof data.aud === 'string' ? data.aud : null, carteira: /ve[ií]culo/i.test(title) ? 'VEICULOS' : 'CARTOES' },
  };
}
// Dashboards de 2026-11 (versão 5): os dados vêm em <script id="data">, uma lista de ligações, e o link
// da pasta de áudios em const LINK. São convertidos para os formatos que a API já importa.
const secs = (v) => { const m = String(v || '').match(/^(\d+):(\d{2}):(\d{2})$/); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(v) || null; };
const GER_V5 = { 'Amanda Mendes': ['AM', 'Contact & WO'], 'Tatiane de Souza': ['TS', 'Ativas'] };
function periodV5(title, file, list) {
  const m = String(file.name).match(/(\d{1,2}(?:-\d{2})?a\d{1,2}-\d{2}|\d{1,2}-\d{2})(?=[_.])/);
  if (m) return m[1].replace(/a/, ' a ').replace(/-/g, '/');
  const d = list.map((c) => c.dt).filter(Boolean).sort();
  return d.length ? `${d[0].slice(8, 10)}/${d[0].slice(5, 7)} a ${d[d.length - 1].slice(8, 10)}/${d[d.length - 1].slice(5, 7)}` : '';
}
function readV5(list, doc, text, file) {
  const link = (text.match(/const LINK="([^"]*)"/) || [])[1] || '';
  const aud = /^https:\/\//.test(link) ? link : null;
  const title = (doc.title || '').trim();
  const evaluated = list.filter((c) => c && c.aval !== false);
  const excluded = list.length - evaluated.length;
  const period = periodV5(title, file, list);
  const year = (evaluated.map((c) => c.dt).filter(Boolean).sort().pop() || String(new Date().getFullYear())).slice(0, 4);
  const sample = evaluated.find((c) => c.q && Object.keys(c.q).length) || evaluated[0] || {};
  // Roteiro e Esforço Sem Garantia (Cartões e Consignado, AGV e convencional): mesmo roteiro do Sem Garantia
  if (sample.q && 'ab' in sample.q) {
    const calls = evaluated.map((c) => ({
      ...c, log: c.login, dt: `${c.dt} ${c.hr || ''}`.trim(), dur: secs(c.dur), prod: /consig/i.test(c.prod || '') ? 'CON' : 'CAR', seg: c.seg || null,
    }));
    return { kind: 'dash_sem_garantia', calls, period, name: file.name, title, aud, excluded, v5: true };
  }
  const ger = {};
  for (const c of evaluated) { const g = GER_V5[c.ger]; if (g) ger[g[0]] = { nome: c.ger, op: g[1] }; else if (c.ger) ger[c.ger] = { nome: c.ger, op: null }; }
  const base = (c) => ({ cid: c.id, id: c.audio || c.id, dt: `${c.dt} ${c.hr || ''}`.trim(), dur: secs(c.dur), login: c.login, op: c.op, lid: c.lid, camp: c.camp, tab: c.tabL || c.tab || null,
    arq: c.arq, cli: c.cli, desc: c.desc, g: (GER_V5[c.ger] || [c.ger])[0], per: 'C', agv: c.agv !== false, tentar: c.tentar, frase: c.frase, mail: c.fb || c.feedback || null });
  const meta = { periods: { C: period }, ger, year, title, aud, carteira: 'VEICULOS' };
  // Esforço negocial AGV (5 critérios + 6 itens do roteiro dos primeiros segundos)
  if (Array.isArray(sample.c) && Array.isArray(sample.s)) {
    const calls = evaluated.map((c) => ({ ...base(c), c: c.c, s: c.s, ev: c.ev, s_ev: c.s_ev, ok: c.ok, op2: c.op2, desf: c.desf, recusa: c.recusa, titular: c.titular, veic: c.veic }));
    return { kind: 'dash_agv_esf', calls, meta, name: file.name, title, excluded, v5: true };
  }
  // Refin e E.A. (Veículos, AGV e convencional): mesmos 5 critérios de esforço e 6 do roteiro, mais a oferta de refin e E.A.
  if (Array.isArray(sample.esf) && Array.isArray(sample.rot)) {
    const calls = evaluated.map((c) => ({ ...base(c), c: c.esf, s: c.rot, desf: c.desf, recusa: c.mot_rec, veic: c.veic, mot: c.mot, res: c.res,
      ea: { cabia: c.ea_cabia, ofertou: c.ea_ofertou, ev: c.ea_ev, apto: !!c.aptEA, terceiro: c.eaTerc }, rf: { cabia: c.rf_cabia, ofertou: c.rf_ofertou, cond: c.rf_cond, ev: c.rf_ev, apto: !!c.aptRF, info: c.rfInfo } }));
    return { kind: 'dash_agv_esf', calls, meta: { ...meta, kind: 'refin_ea' }, name: file.name, title, excluded, v5: true };
  }
  return null;
}

export async function readDashboard(file) {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'text/html');
  // Análises por carteira (speech Safra Pay, relatório de conversão e eficiência…)
  const rep = readCarteiraReport(doc, text, file);
  if (rep) return rep;
  const v5 = doc.querySelector('script#data[type="application/json"]');
  if (v5 && !doc.querySelector('script#dados')) {
    let list;
    try { list = JSON.parse(v5.textContent); } catch { throw new Error('Não foi possível ler os dados do dashboard.'); }
    const out = Array.isArray(list) ? readV5(list, doc, text, file) : null;
    if (!out) throw new Error('Formato de dashboard não reconhecido.');
    if (!out.calls.length) throw new Error('O dashboard não tem ligações analisadas.');
    return out;
  }
  const node = doc.querySelector('script#dados[type="application/json"]');
  if (!node) throw new Error('Este arquivo não tem os dados do dashboard (bloco "dados" não encontrado).');
  let data;
  try { data = JSON.parse(node.textContent); } catch { throw new Error('Não foi possível ler os dados do dashboard.'); }
  const ger = data.ger || null;
  if (ger && Array.isArray(data.calls) && !data.calls.length) throw new Error(`O dashboard AGV da gerência ${ger.nome || ''} (${ger.curto || ger.escopo || ''}) veio sem nenhuma ligação. Gere o arquivo de novo com as ligações do período.`);
  // "Esforço negocial AGV" por carteira: 5 critérios (c) e 6 itens do roteiro (s) por ligação, com histórico
  const ec = (data.calls || []).find((c) => c && Array.isArray(c.c));
  if (ec && ec.c.length === 5 && 'per' in ec) return readEsforco(data, doc, text, file);
  const agvKind = detectAgvKind(data.calls);
  if (agvKind) {
    const first = (d) => data.calls.filter((c) => c.day === d).map((c) => String(c.dt).slice(0, 10)).sort()[0];
    const meta = agvKind === 'dash_agv' ? { nome: ger?.nome || null, curto: ger?.curto || null, escopo: ger?.escopo || null }
      : { title: (doc.title || '').trim() || null, periods: { A: ddmm(first('A')), B: ddmm(first('B')) } };
    return { kind: agvKind, calls: data.calls, meta, name: file.name, title: (doc.title || '').trim() };
  }
  const kind = detectKind(data.calls);
  if (!kind) throw new Error('Formato de dashboard não reconhecido. São aceitos o "Speech E.A. e Refin" (Veículos), o "Roteiro Sem Garantia" e os dashboards AGV.');
  return { kind, calls: data.calls, period: data.periodo || '', name: file.name };
}

function drawDash(el, ctx) {
  const box = $('#dash-prev', el);
  if (!dash) { box.innerHTML = ''; return; }
  if (AGV_DASH_KIND[dash.kind]) { drawAgvDash(el, ctx, box); return; }
  if (REPORT_KIND[dash.kind]) { drawCarteiraReport(el, ctx, box); return; }
  const { kind, calls } = dash;
  const groups = {};
  for (const c of calls) { const [p, s] = productOf(kind, c); const k = `${p}|${s || ''}`; groups[k] = (groups[k] || 0) + 1; }
  const dates = calls.map((c) => String(c.dt).slice(0, 10)).sort();
  const leaders = new Set(calls.map((c) => c.lid).filter((x) => x && !/^sem lideran/i.test(x)));
  const ops = new Set(calls.map((c) => c.log));
  const withTxt = calls.filter((c) => c.txt).length;
  box.innerHTML = String(html`<div class="card mt"><div class="card-head"><div><h3>${DASH_KIND[kind]}</h3>
      <div class="sub">${dash.name} · ${dash.period || `${fmtDate(dates[0])} a ${fmtDate(dates[dates.length - 1])}`}</div></div><div class="grow"></div>
      <button class="btn ghost" id="dash-cancel">Cancelar</button><button class="btn primary lg" id="dash-go">${icon('upload')}Importar ${fmtInt(calls.length)} ligações</button></div>
    <div class="card-body">
      <div class="grid g-4">
        <div class="insight"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${icon('headset')}</span><div><b>${fmtInt(calls.length)} ligações</b><div class="t2 small">${fmtDate(dates[0])} a ${fmtDate(dates[dates.length - 1])}</div></div></div>
        <div class="insight"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${icon('users')}</span><div><b>${fmtInt(ops.size)} operadores</b><div class="t2 small">${leaders.size} líder(es) · cadastro automático pelo login</div></div></div>
        <div class="insight"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${icon('file')}</span><div><b>${withTxt ? `${fmtInt(withTxt)} transcrições` : 'Respostas do speech'}</b><div class="t2 small">${withTxt ? 'Resumo, ponto forte e feedback sugerido de cada ligação' : 'Com os ajustes de coerência do dashboard'}</div></div></div>
        <div class="insight"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${icon('layers')}</span><div><b>Por produto</b><div class="t2 small">${Object.entries(groups).map(([k, n]) => { const [p, s] = k.split('|'); return `${PRODUCT[p]}${s ? ` · ${SEGMENT[s]}` : ''}: ${n}`; }).join(' · ')}</div></div></div>
      </div>
      ${groups['CARTOES|none'] || groups['CONSIGNADO|none'] ? html`<div class="banner warn mt">${icon('alert')}<div>${(groups['CARTOES|none'] || 0) + (groups['CONSIGNADO|none'] || 0)} ligação(ões) sem segmento identificável no Capacity entram como <b>Segmento a definir</b>. Dá para ajustar depois no card da ligação (botão “Segmento”).</div></div>` : ''}
      <div class="grid g-2 mt">
        <div class="field"><label for="dash-cycle">Quinzena de destino</label><select class="select" id="dash-cycle">
          <option value="">Automática (pelas datas das ligações)</option>${ctx.store.meta.cycles.map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select>
          <span class="hint">Se não existir uma quinzena com essas datas, ela é criada. Ligações já importadas são ignoradas, então pode reenviar o arquivo sem duplicar.</span></div>
        <div id="dash-progress" class="small t2" style="align-self:end"></div>
      </div>
    </div></div>`);
  $('#dash-cancel', box).onclick = () => { dash = null; $('#dash-name').textContent = '.html exportado do dashboard'; drawDash(el, ctx); };
  $('#dash-go', box).onclick = async (e) => {
    const btn = e.currentTarget; busy(btn, true, 'Importando');
    const prog = $('#dash-progress', box);
    const tot = { created: 0, skipped: 0, operators_created: 0 };
    let cycle = $('#dash-cycle', box).value || null;
    const size = 40;
    try {
      for (let i = 0; i < calls.length; i += size) {
        prog.innerHTML = String(html`<div class="meter" style="height:8px"><i style="width:${Math.round((i / calls.length) * 100)}%"></i></div><div class="mt-0" style="margin-top:6px">Enviando ${Math.min(i + size, calls.length)} de ${calls.length}…</div>`);
        const r = await api.post('/import/dashboard', { kind, calls: calls.slice(i, i + size), cycle_id: cycle, period: dash.period, aud: dash.aud || null, filename: dash.name, batch: i / size + 1, last: i + size >= calls.length });
        cycle = r.cycle_id; tot.created += r.created; tot.skipped += r.skipped; tot.operators_created += r.operators_created;
      }
      toast(`${tot.created} ligação(ões) importada(s)${tot.skipped ? ` · ${tot.skipped} já existiam` : ''}${tot.operators_created ? ` · ${tot.operators_created} operador(es) cadastrado(s)` : ''}.`);
      dash = null;
      await ctx.refreshMeta();
      ctx.store.cycle = String(cycle); localStorage.setItem('px_cycle', ctx.store.cycle);
      ctx.navigate('painel');
    } catch (ex) {
      toast(`${ex.message}${tot.created ? ` (${tot.created} já foram importadas; reenvie o arquivo para continuar)` : ''}`, 'err', 8000);
      busy(btn, false); prog.textContent = '';
    }
  };
}

// ---------------------------------------------------------------- análises por carteira (HTML)
const REPORT_KIND = { speech_safra: 'Análise de speech (ligação a ligação)', conversao: 'Análise da carteira (relatório)' };
function drawCarteiraReport(el, ctx, box) {
  const d = dash, user = ctx.store.user;
  const own = userCarteiras(user);
  const chosen = d.carteira && own.includes(d.carteira) ? d.carteira : viewCarteira(user) || own[0];
  const r = d.data || d.summary || {};
  const logins = d.kind === 'speech_safra' ? new Set(d.rows.map((x) => x.login)).size : (r.reading || []).length;
  box.innerHTML = String(html`<div class="card mt"><div class="card-head"><div><h3>${d.title}</h3>
      <div class="sub">${d.name}${d.period ? ` · ${d.period}` : ''} · ${REPORT_KIND[d.kind]}</div></div><div class="grow"></div>
      <button class="btn ghost" id="dash-cancel">Cancelar</button><button class="btn primary lg" id="dash-go">${icon('upload')}${d.kind === 'speech_safra' ? `Importar ${fmtInt(d.rows.length)} ligações` : 'Guardar a análise'}</button></div>
    <div class="card-body">
      <div class="grid g-4">
        ${d.kind === 'speech_safra' ? html`
          <div class="insight"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${icon('headset')}</span><div><b>${fmtInt(d.rows.length)} ligações</b><div class="t2 small">${d.period}</div></div></div>
          <div class="insight"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${icon('users')}</span><div><b>${logins} logins</b><div class="t2 small">nome e liderança pelo capacity do setor</div></div></div>
          <div class="insight"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${icon('list')}</span><div><b>11 critérios</b><div class="t2 small">roteiro Safra Pay · produto Cartões</div></div></div>
          <div class="insight"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${icon('report')}</span><div><b>Análise da carteira</b><div class="t2 small">o arquivo também fica em Análises da carteira</div></div></div>`
        : html`${(r.kpis || []).slice(0, 4).map((k) => html`<div class="insight"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${icon('report')}</span><div><b>${k.value} · ${k.label}</b><div class="t2 small">${k.sub}</div></div></div>`)}`}
      </div>
      ${d.kind === 'conversao' ? html`<p class="small t2 mt">${r.lead || ''} ${logins ? html`A leitura de <b>${logins} login(s)</b> aparece no feedback de cada operador.` : ''}</p>` : ''}
      <div class="grid g-2 mt">
        <div class="field"><label for="rep-cart">Carteira</label><select class="select" id="rep-cart" ${own.length > 1 ? '' : 'disabled'}>${own.map((c) => html`<option value="${c}" ${c === chosen ? 'selected' : ''}>${CARTEIRA_INFO[c].label}</option>`)}</select>
          <span class="hint">${d.carteira ? `O arquivo é da carteira ${CARTEIRA_INFO[d.carteira]?.label || d.carteira}.` : 'Confira a carteira antes de importar.'} Só quem é dessa carteira vê a análise.</span></div>
        <div id="dash-progress" class="small t2" style="align-self:end"></div>
      </div>
    </div></div>`);
  $('#dash-cancel', box).onclick = () => { dash = null; $('#dash-name').textContent = '.html exportado do dashboard'; drawDash(el, ctx); };
  $('#dash-go', box).onclick = async (e) => {
    const btn = e.currentTarget; busy(btn, true, 'Importando');
    const prog = $('#dash-progress', box);
    const carteira = $('#rep-cart', box).value;
    const tot = { created: 0, skipped: 0, operators_created: 0 };
    try {
      if (d.kind === 'speech_safra') {
        for (let i = 0; i < d.rows.length; i += 100) {
          prog.textContent = `Enviando ${Math.min(i + 100, d.rows.length)} de ${d.rows.length}…`;
          const x = await api.post('/import/speech-safra', { rows: d.rows.slice(i, i + 100), period: d.period, filename: d.name, carteira });
          tot.created += x.created; tot.skipped += x.skipped; tot.operators_created += x.operators_created;
        }
      }
      prog.textContent = 'Guardando a análise…';
      await api.post('/reports', { kind: d.kind, title: d.title, period: d.period, carteira, file_name: d.name, data: d.kind === 'speech_safra' ? d.summary : d.data, html: d.html });
      toast(d.kind === 'speech_safra' ? `${tot.created} ligação(ões) importada(s)${tot.skipped ? ` · ${tot.skipped} já existiam` : ''}${tot.operators_created ? ` · ${tot.operators_created} operador(es) cadastrado(s)` : ''}.` : 'Análise guardada em Análises da carteira.');
      dash = null;
      await ctx.refreshMeta();
      ctx.navigate('analises');
    } catch (ex) { toast(ex.message, 'err', 8000); busy(btn, false); prog.textContent = ''; }
  };
}

// ---------------------------------------------------------------- capacity por setor
async function drawCapacity(el, ctx) {
  const box = $('#cap-box', el);
  let list = [];
  try { list = await api.get('/capacity'); } catch { list = []; }
  const editable = list.filter((c) => c.can_edit);
  if (!ctx.isCurrent()) return;
  if (!editable.length) { box.closest('.card').hidden = true; return; }
  box.innerHTML = String(html`<div class="cap-grid">${list.map((c) => html`<div class="cap-it">
      <div class="row between"><b>${CARTEIRA_INFO[c.carteira]?.label || c.carteira}</b>${c.active != null ? html`<span class="chip ok">${c.active} ativos</span>` : html`<span class="chip outline">sem capacity</span>`}</div>
      <div class="tiny muted">${c.updated_at ? `${c.file || 'capacity'} · ${fmtDate(c.updated_at)}` : 'Nenhum capacity anexado para o setor.'}</div>
      ${c.can_edit ? html`<label class="btn sm mt-0" style="margin-top:8px">${icon('upload')}Anexar capacity<input type="file" accept=".xlsx,.xls,.csv" data-cap="${c.carteira}" hidden></label>` : ''}
    </div>`)}</div><div id="cap-pv"></div>`);
  box.querySelectorAll('[data-cap]').forEach((inp) => inp.addEventListener('change', async () => {
    const f = inp.files[0]; if (!f) return;
    const carteira = inp.dataset.cap, pv = $('#cap-pv', box);
    pv.innerHTML = '<p class="small t2 mt">Lendo o capacity…</p>';
    try {
      const [{ parseWorkbook }, { capacityRows }] = await Promise.all([import('../files.js'), import('./quedas.js')]);
      const { rows } = capacityRows(await parseWorkbook(f));
      const act = rows.filter((r) => r.active);
      if (!act.length) throw new Error('Não encontrei operadores ativos no arquivo (colunas de login, nome e liderança).');
      pv.innerHTML = String(html`<div class="banner info mt">${icon('users')}<div><b>${f.name}</b>: ${act.length} operadores ativos${rows.length > act.length ? `, ${rows.length - act.length} desligados ou remanejados` : ''} para <b>${CARTEIRA_INFO[carteira].label}</b>.
        Os logins de fora do arquivo ficam inativos no capacity do setor; os operadores já cadastrados ganham nome, matrícula e liderança.
        <div class="row mt-0" style="margin-top:8px"><button class="btn primary sm" id="cap-go">${icon('check')}Atualizar o capacity do setor</button><button class="btn ghost sm" id="cap-no">Cancelar</button></div></div></div>`);
      $('#cap-no', pv).onclick = () => { pv.innerHTML = ''; inp.value = ''; };
      $('#cap-go', pv).onclick = async (ev) => {
        busy(ev.currentTarget, true, 'Atualizando');
        try {
          const r = await api.post('/capacity', { carteira, rows, file: f.name });
          toast(`Capacity de ${CARTEIRA_INFO[carteira].label} atualizado: ${r.active} ativos${r.removed ? `, ${r.removed} saíram` : ''}${r.operators_updated ? `, ${r.operators_updated} operador(es) atualizado(s)` : ''}.`);
          await ctx.refreshMeta(); drawCapacity(el, ctx);
        } catch (ex) { toast(ex.message, 'err', 7000); busy(ev.currentTarget, false); }
      };
    } catch (ex) { pv.innerHTML = ''; toast(ex.message, 'err', 7000); inp.value = ''; }
  }));
}

export async function render(el, _p, ctx) {
  const { store } = ctx;
  preview = null; dash = null; calls = null;
  const open = store.meta.cycles.find((c) => c.status === 'aberto');
  el.innerHTML = String(html`
    <div class="page-head"><div><h2>Importar monitorias</h2><p>Traga o dashboard de monitoria da quinzena (.html) ou a planilha de auditorias do speech (Excel ou CSV). Cada ligação vira um card de atendimento.</p></div></div>
    ${(() => { const c = viewCarteira(store.user) || 'PAN'; const many = userCarteiras(store.user).length > 1;
      return html`<div class="banner info mb">${icon('info')}<div>Os atendimentos importados entram na carteira <b>${CARTEIRA_INFO[c].label}</b> e só quem é dessa carteira vê as análises, os gráficos e os feedbacks.${many && !viewCarteira(store.user) ? ' Para importar em outra carteira, escolha-a no seletor do topo antes.' : ''}</div></div>`; })()}
    <div class="card card-pad mb"><span class="chip brand">Capacity</span><h3 style="margin:10px 0 6px">Capacity atualizado por setor</h3>
      <p class="small t2" style="margin-top:0">A planilha de operadores de cada setor (login, nome, matrícula, liderança e campanha). A plataforma usa o capacity para dar nome e liderança aos operadores nas importações e na força-tarefa de quedas.</p>
      <div id="cap-box"><p class="small t2">Carregando…</p></div>
    </div>
    <div class="card card-pad mb"><span class="chip brand">Discador</span><h3 style="margin:10px 0 6px">Lista de ligações do discador (.csv)</h3>
      <p class="small t2" style="margin-top:0">O relatório de ligações exportado do discador (IdContato, Campanha, Operação, Login, Data, Duração, Finalização, Nome do arquivo…). Cada ligação entra como atendimento pendente, com o operador e a carteira certos; depois é só enviar o áudio ou a transcrição.</p>
      <label class="drop" id="calls-drop" style="padding:20px"><input type="file" id="calls-file" accept=".csv,.txt,.xlsx" hidden>
        <div class="ic">${icon('upload')}</div><h4>Arraste o .csv do discador ou clique</h4><p class="muted small" style="margin:0" id="calls-name">.csv exportado do discador</p></label>
      <div id="calls-prev"></div>
    </div>
    <div class="card card-pad mb"><span class="chip brand">Dashboards e análises</span><h3 style="margin:10px 0 6px">Dashboard ou análise já trabalhada (.html)</h3>
      <p class="small t2" style="margin-top:0">Aceita a <b>análise de speech Safra Pay</b> e os <b>relatórios de conversão e eficiência</b> das carteiras (vão para Análises da carteira), o <b>Speech E.A. e Refin</b> (Veículos), o <b>Roteiro Sem Garantia</b> (Cartões em Clean Curto/Longo e Consignado em Público/Privado) e os <b>dashboards AGV</b> (teste do speech por gerência e comparativo), que vão para a divisão Análises AGV. Vêm junto o roteiro item a item, os ajustes de coerência com o motivo, líder e gerência, tabulação, desfecho, aptidão a E.A./refin, alertas de sigilo e conduta, transcrição, resumo e feedback sugerido.</p>
      <label class="drop" id="dash-drop" style="padding:20px"><input type="file" id="dash-file" accept=".html,.htm" hidden>
        <div class="ic">${icon('upload')}</div><h4>Arraste o arquivo do dashboard ou clique</h4><p class="muted small" style="margin:0" id="dash-name">.html exportado do dashboard</p></label>
      <div id="dash-prev"></div>
    </div>
    <h3 style="margin:22px 0 10px">Planilha do speech</h3>
    <div class="grid g-3">
      <div class="card card-pad"><span class="chip brand">Passo 1</span><h3 style="margin:10px 0 6px">Baixe o modelo</h3>
        <p class="small t2">Uma linha por atendimento. Os critérios ficam nas colunas pelo código (ex.: <b>IDT</b>, <b>RCE</b>) com C, P, NC ou NA — também aceitamos Sim/Não/Parcial. Colunas extras são ignoradas.</p>
        <button class="btn" id="tpl">${icon('download')}Modelo .xlsx</button></div>
      <div class="card card-pad span-2"><span class="chip brand">Passo 2</span><h3 style="margin:10px 0 6px">Envie a planilha</h3>
        <label class="drop" id="im-drop" style="padding:24px"><input type="file" id="im-file" accept=".xlsx,.csv" hidden>
          <div class="ic">${icon('upload')}</div><h4>Arraste a planilha ou clique</h4><p class="muted small" style="margin:0" id="im-name">.xlsx ou .csv · até 15 MB</p></label>
        <div class="field mt"><label for="im-cycle">Quinzena de destino</label><select class="select" id="im-cycle">
          <option value="">Sem quinzena</option>${store.meta.cycles.map((c) => html`<option value="${c.id}" ${(store.cycle ? String(c.id) === String(store.cycle) : open?.id === c.id) ? 'selected' : ''}>${c.name}</option>`)}</select>
          ${ctx.can('admin') ? html`<span class="hint">Crie novas quinzenas e o link da pasta de áudios em <a href="#/ciclos">Quinzenas &amp; áudios</a>.</span>` : ''}</div>
      </div>
    </div>
    <div id="im-prev" class="mt"></div>`);
  drawCapacity(el, ctx);
  $('#tpl').onclick = async (e) => {
    const btnEl = e.currentTarget;
    busy(btnEl, true); try { await downloadTemplate(store.meta.criteria.filter((c) => c.active)); } catch (ex) { toast(ex.message, 'err'); } busy(btnEl, false); };
  const drop = $('#im-drop');
  const handle = async (f) => {
    if (!f) return;
    fileName = f.name;
    $('#im-name').textContent = `${f.name} · lendo…`;
    try {
      preview = await api.post('/import/preview', { rows: await parseSheetFile(f) });
      $('#im-name').textContent = `${f.name} · ${preview.summary.total} linha(s)`;
      drawPreview(el, ctx);
    } catch (ex) { toast(ex.message, 'err'); $('#im-name').textContent = '.xlsx ou .csv'; }
  };
  $('#im-file').onchange = (e) => handle(e.target.files[0]);
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => handle(e.dataTransfer.files[0]));

  const cdrop = $('#calls-drop');
  const handleCalls = async (f) => {
    if (!f) return;
    $('#calls-name').textContent = `${f.name} · lendo…`;
    try {
      const rows = mapCalls(await parseSheetFile(f));
      if (!rows) throw new Error('Não reconheci as colunas do discador (precisa de IdContato, Login e DataHoraLigacao).');
      if (!rows.length) throw new Error('O arquivo não tem ligações.');
      calls = { name: f.name, rows };
      $('#calls-name').textContent = `${f.name} · ${rows.length} ligações`;
    } catch (ex) { calls = null; toast(ex.message, 'err', 7000); $('#calls-name').textContent = '.csv exportado do discador'; }
    drawCalls(el, ctx);
  };
  $('#calls-file').onchange = (e) => handleCalls(e.target.files[0]);
  ['dragenter', 'dragover'].forEach((t) => cdrop.addEventListener(t, (e) => { e.preventDefault(); cdrop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => cdrop.addEventListener(t, (e) => { e.preventDefault(); cdrop.classList.remove('over'); }));
  cdrop.addEventListener('drop', (e) => handleCalls(e.dataTransfer.files[0]));

  const ddrop = $('#dash-drop');
  const handleDash = async (f) => {
    if (!f) return;
    $('#dash-name').textContent = `${f.name} · lendo…`;
    try { dash = await readDashboard(f); $('#dash-name').textContent = `${f.name} · ${dash.kind === 'conversao' ? 'análise da carteira' : `${dash.calls.length} ligações`}`; drawDash(el, ctx); }
    catch (ex) { dash = null; toast(ex.message, 'err', 7000); $('#dash-name').textContent = '.html exportado do dashboard'; drawDash(el, ctx); }
  };
  $('#dash-file').onchange = (e) => handleDash(e.target.files[0]);
  ['dragenter', 'dragover'].forEach((t) => ddrop.addEventListener(t, (e) => { e.preventDefault(); ddrop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => ddrop.addEventListener(t, (e) => { e.preventDefault(); ddrop.classList.remove('over'); }));
  ddrop.addEventListener('drop', (e) => handleDash(e.dataTransfer.files[0]));
}

// Dashboard AGV: as ligações vão para a divisão AGV (completando as que já vieram do discador ou do speech)
function drawAgvDash(el, ctx, box) {
  const { calls, meta, name, title, kind } = dash;
  const dates = calls.map((c) => String(c.dt || '').slice(0, 10)).filter(Boolean).sort();
  const ops = new Set(calls.map((c) => c.login || c.log || c.op).filter(Boolean));
  box.innerHTML = String(html`<div class="card mt"><div class="card-head"><div><span class="chip brand">${icon('zap')}AGV</span><h3 style="margin-top:8px">${title || AGV_DASH_KIND[kind]}</h3>
      <div class="sub">${name} · ${dates.length ? `${fmtDate(dates[0])} a ${fmtDate(dates[dates.length - 1])}` : 'sem datas'}</div></div><div class="grow"></div>
      <button class="btn ghost" id="dash-cancel">Cancelar</button><button class="btn primary lg" id="dash-go">${icon('upload')}Importar ${fmtInt(calls.length)} ligações</button></div>
    <div class="card-body"><div class="grid g-3">
      <div class="insight"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${icon('headset')}</span><div><b>${fmtInt(calls.length)} ligações AGV</b><div class="t2 small">${AGV_DASH_KIND[kind]}${meta?.nome ? ` · gerência ${meta.nome}` : ''}${meta?.periods ? ` · A ${meta.periods.A} × B ${meta.periods.B}` : ''}</div></div></div>
      <div class="insight"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${icon('users')}</span><div><b>${fmtInt(ops.size)} operadores</b><div class="t2 small">cadastro completado pelo login</div></div></div>
      <div class="insight"><span class="ic" style="background:var(--brand-soft);color:var(--brand)">${icon('link')}</span><div><b>Sem duplicar</b><div class="t2 small">Ligação que já veio do discador ou do relatório do speech é completada com a leitura revisada.</div></div></div>
    </div><div id="dash-progress" class="small t2 mt"></div></div></div>`);
  $('#dash-cancel', box).onclick = () => { dash = null; $('#dash-name').textContent = '.html exportado do dashboard'; drawDash(el, ctx); };
  $('#dash-go', box).onclick = async (e) => {
    const btnEl = e.currentTarget; busy(btnEl, true, 'Importando');
    const prog = $('#dash-progress', box);
    try {
      const t = await sendAgvDashboard(dash, (msg) => { prog.textContent = msg; });
      toast(`${t.created} ligação(ões) nova(s) · ${t.updated} completada(s)${t.skipped.length ? ` · ${t.skipped.length} ignorada(s)` : ''}.`, 'ok', 6000);
      dash = null; await ctx.refreshMeta(); ctx.navigate('agv');
    } catch (ex) { toast(ex.message, 'err', 8000); busy(btnEl, false); prog.textContent = ''; }
  };
}

function drawPreview(el, ctx) {
  const p = preview, s = p.summary;
  const box = $('#im-prev', el);
  box.innerHTML = String(html`<div class="card">
    <div class="card-head"><div><span class="chip brand">Passo 3</span><h3 style="margin-top:8px">Confira antes de importar</h3><div class="sub">${s.valid} válida(s) · ${s.invalid} com erro · ${s.new_operators} operador(es) novo(s)</div></div><div class="grow"></div>
      <button class="btn primary lg" id="im-go" ${s.valid ? '' : 'disabled'}>${icon('upload')}Importar ${s.valid} monitoria(s)</button></div>
    <div class="card-body">
      <div class="row small t2 mb">${p.mapped.map((m) => html`<span class="chip ok">${m.header} → ${m.field}</span>`)}${p.criteria_columns.map((m) => html`<span class="chip info">${m.header} → ${m.code}</span>`)}${p.unmatched.map((h) => html`<span class="chip outline" title="Coluna ignorada">${h} (ignorada)</span>`)}</div>
      ${!p.criteria_columns.length ? html`<div class="banner warn">${icon('alert')}<div>Nenhuma coluna de critério reconhecida. Use os códigos do modelo (ex.: ABE, IDT, RPR) como cabeçalho para trazer a análise item a item.</div></div>` : ''}
      <div class="table-wrap" style="max-height:480px;overflow:auto"><table class="tbl"><thead><tr><th>Linha</th><th>Operador</th><th>Produto</th><th>Data</th><th>Protocolo</th><th class="right">Nota speech</th><th class="right">Critérios</th><th>Observações</th></tr></thead>
      <tbody>${p.rows.map((r) => html`<tr style="${r.errors.length ? 'background:var(--bad-soft)' : ''}">
        <td class="muted">${r.line}</td><td><b>${r.operator || '—'}</b>${!r.operator_id && r.operator ? html` <span class="chip brand">novo</span>` : ''}</td>
        <td>${r.product ? PRODUCT[r.product] : '—'}</td><td>${fmtDate(r.call_date)}</td><td class="small">${r.protocol || '—'}</td>
        <td class="right num">${fmtScore(r.speech_score)}</td><td class="right">${r.items.length}</td>
        <td class="small">${r.errors.map((x) => html`<div style="color:var(--bad-ink)">${x}</div>`)}${r.warnings.map((x) => html`<div class="muted">${x}</div>`)}</td></tr>`)}</tbody></table></div>
    </div></div>`);
  $('#im-go', box)?.addEventListener('click', async (e) => {
    const btnEl = e.currentTarget;
    busy(btnEl, true, 'Importando');
    try {
      const r = await api.post('/import/commit', { cycle_id: $('#im-cycle').value, rows: p.rows.filter((x) => !x.errors.length), filename: fileName });
      toast(`${r.created} monitoria(s) importada(s)${r.newOps ? ` · ${r.newOps} operador(es) cadastrado(s)` : ''}.`);
      await ctx.refreshMeta();
      if ($('#im-cycle').value) { ctx.store.cycle = $('#im-cycle').value; localStorage.setItem('px_cycle', ctx.store.cycle); }
      ctx.navigate('atendimentos');
    } catch (ex) { toast(ex.message, 'err'); busy(btnEl, false); }
  });
}

export const hasUnsavedChanges = () => !!preview || !!dash || !!calls;

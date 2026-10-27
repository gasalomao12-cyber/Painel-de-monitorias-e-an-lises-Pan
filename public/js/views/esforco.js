import { api } from '../api.js';
import { toast } from '../ui.js';

// Painel de esforço negocial AGV — mesma estrutura dos dashboards "Esforço negocial AGV" (capa, visão geral,
// lideranças, operadores e ligações), com os dados da plataforma, mais dispersões e evolução entre as análises.
// Só entram as ligações AGV com negociação (acordo, promessa, retorno ou sem acordo), sem trecho cortado nos 6 itens
// e com ao menos um item que cabia.
// Não mostra acurácia do speech: só o resultado final de cada item.

const IT = [
  { k: 'sond', code: 'SMO', t: 'Perguntou o motivo do atraso', c: 'Motivo do atraso', h: 'Motivo', e: 'Sondagem', dica: 'Perguntar o motivo do atraso antes de ofertar, para entender a situação real do cliente.' },
  { k: 'cap', code: 'SQQ', t: 'Perguntou quanto ou quando consegue pagar', c: 'Capacidade de pagamento', h: 'Capacidade', e: 'Sondagem', dica: 'Perguntar quanto e quando o cliente consegue pagar, para montar uma proposta possível para ele.' },
  { k: 'prop', code: 'PRP', t: 'Ofereceu pagamento com valor', c: 'Proposta com valor', h: 'Proposta', e: 'Negociação', dica: 'Apresentar uma proposta com valor e data, mesmo quando o cliente diz que está sem condições.' },
  { k: 'alt', code: 'ALT', t: 'Trouxe outra opção depois do não', c: 'Alternativa após o não', h: 'Alternativa', e: 'Negociação', dica: 'Depois do não, trazer outra opção (outra data, outro valor ou parte da parcela) antes de encerrar.' },
  { k: 'ben', code: 'BEN', t: 'Citou o benefício de pagar', c: 'Benefício de pagar', h: 'Benefício', e: 'Argumentação', dica: 'Mostrar o ganho de regularizar agora, como evitar novos encargos e voltar a ficar em dia.' },
  { k: 'cons', code: 'CSQ', t: 'Explicou as consequências', c: 'Consequências', h: 'Consequências', e: 'Argumentação', dica: 'Explicar com clareza o que acontece se a parcela continuar em atraso.' }];
const ETAPAS = ['Sondagem', 'Negociação', 'Argumentação'];
const DESF = { ACORDO: ['Acordo com boleto', '#1FA672'], PROMESSA: ['Promessa de pagamento', '#0A8FD6'], RETORNO: ['Retorno agendado', '#7C5CE0'], SEM_ACORDO: ['Sem acordo', '#E2475E'] };
const OUT = { 'Acordo com boleto': 'ACORDO', 'Promessa sem boleto': 'PROMESSA', 'Retorno combinado': 'RETORNO', 'Sem acordo': 'SEM_ACORDO' };
const RES = { C: 'SIM', P: 'PARCIAL', NC: 'NAO', NA: 'NA' };
const BANDS = [
  { k: 'bad', t: 'Crítico', r: 'abaixo de 45%', c: 'var(--badf)', test: (p) => p < 45 },
  { k: 'warn', t: 'Atenção', r: 'de 45% a 69%', c: 'var(--warnf)', test: (p) => p >= 45 && p < 70 },
  { k: 'ok', t: 'Bom', r: '70% ou mais', c: 'var(--okf)', test: (p) => p >= 70 }];
const REF = 70;
const PAL = ['#0A8FD6', '#7C5CE0', '#0E9F8E', '#E07B0B', '#D2477E', '#5B6B86'];
const LOGOS = '<div class="logos"><img src="brand/paschoalotto-branco.png" alt="Paschoalotto"><i></i><img src="brand/banco-pan-branco.png" alt="Banco PAN"></div>';
const TAB_LABEL = {
  'VENC. NAO ATENDE': 'Vencimento não atende', 'VENCIMENTO NAO ATENDE': 'Vencimento não atende', 'ATRASO DE SALARIO': 'Atraso de salário', 'REDUCAO DE RENDA': 'Redução de renda',
  DESEMPREGO: 'Desemprego', DOENCA: 'Doença', 'FINANCIOU PARA TERCEIRO': 'Financiou para terceiro',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fp = (v) => (v == null || Number.isNaN(v) ? '–' : `${Math.round(v)}%`);
const pc = (s, n) => (n ? (100 * s) / n : null);
const band = (p) => (p == null ? 'na' : p >= 70 ? 'ok' : p >= 45 ? 'warn' : 'bad');
const fill = (p) => (p == null ? 'var(--na)' : p >= 70 ? 'var(--okf)' : p >= 45 ? 'var(--warnf)' : 'var(--badf)');
const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
function tabLabel(t) {
  if (!t) return 'Sem tabulação';
  const s = plain(t).replace(/^SEM CONDICOES\s*-\s*/, '');
  if (TAB_LABEL[s]) return TAB_LABEL[s];
  const x = String(t).replace(/^sem condi[cç][oõ]es\s*-\s*/i, '').toLowerCase();
  return x.charAt(0).toUpperCase() + x.slice(1);
}
const curto = (s) => { const w = String(s).split(/\s+/).filter((x) => !['de', 'da', 'do', 'dos', 'das', 'e'].includes(x.toLowerCase())); return w.length > 1 ? `${w[0]} ${w[w.length - 1]}` : s; };
const lg = (n) => `${n} ${n === 1 ? 'ligação' : 'ligações'}`;
const ini = (s) => String(s).split(/\s+/).filter((w) => w.length > 2).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
const dfmt = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');
const dur = (s) => (s ? `${Math.floor(s / 60)}min${String(s % 60).padStart(2, '0')}s` : '–');
const monday = (d) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toISOString().slice(0, 10); };

const ICO = {
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  team: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>',
  trend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
  print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
};

// ------------------------------------------------------------------ estado
let RAW = [];                 // todas as ligações AGV elegíveis (todas as análises)
let VIEW = 'capa', GER = '', PER = '', F = { lid: '', tab: '' }, LQ = '', CHIP = 'todas', SORT = { k: 'p', d: 1 }, PRE = null, GRAN = 'cycle';
let LISTA = [], MID = null, root = null, LIDS = [], TABS = [];

function prep(d) {
  const byEval = new Map();
  for (const [id, code, fin] of d.items) { if (!byEval.has(id)) byEval.set(id, {}); byEval.get(id)[code] = fin; }
  // Gerência: a do cadastro do operador; sem ela, a mais comum da mesma equipe
  const teamMgr = {};
  for (const e of d.evals) if (e.manager && e.team) (teamMgr[e.team] ||= {})[e.manager] = ((teamMgr[e.team] || {})[e.manager] || 0) + 1;
  // A mesma gerência pode vir com o nome curto e o completo ("Amanda" e "Amanda Mendes"): vale o completo
  const names = [...new Set(d.evals.map((e) => e.manager).filter(Boolean))];
  const full = (m) => names.filter((x) => x !== m && plain(x).startsWith(`${plain(m)} `)).sort((a, b) => b.length - a.length)[0] || m;
  const mgrOf = (e) => full(e.manager || (e.team && teamMgr[e.team] ? Object.entries(teamMgr[e.team]).sort((a, b) => b[1] - a[1])[0][0] : '') || 'Sem gerência');
  const out = [];
  for (const e of d.evals) {
    const desf = OUT[e.outcome];
    if (!desf) continue;
    const r = byEval.get(e.id) || {};
    // Item sem resultado = trecho cortado (não avaliável): a ligação fica fora, como nos dashboards
    if (IT.some((i) => r[i.code] == null)) continue;
    const it = Object.fromEntries(IT.map((i) => [i.k, RES[r[i.code]] || 'NA']));
    const s = IT.reduce((a, i) => a + (it[i.k] === 'SIM' ? 1 : it[i.k] === 'PARCIAL' ? 0.5 : 0), 0);
    const n = IT.filter((i) => it[i.k] !== 'NA').length;
    if (!n) continue;
    const dt = e.date ? `${e.date} ${e.time || ''}`.trim() : '';
    out.push({
      eid: e.id, id: String(e.call_id || e.id), dt, date: e.date || '', dur: e.duration, op: e.operator || 'Operador', login: e.login || '', lid: e.supervisor || 'Sem liderança',
      ger: mgrOf(e), team: e.team || '', product: e.product, tab: tabLabel(e.tabulation), cli: e.customer || '', arq: e.audio_file || '', camp: e.campaign || '',
      cycle_id: e.cycle_id, cycle: e.cycle || 'Sem quinzena', cycle_start: e.cycle_start || '', desf, it, s, n, p: pc(s, n), falta: IT.filter((i) => it[i.k] === 'NAO').map((i) => i.k),
    });
  }
  for (const c of out) c.b = band(c.p);
  return out;
}

const gers = () => [...new Set(RAW.map((c) => c.ger))].sort((a, b) => RAW.filter((c) => c.ger === b).length - RAW.filter((c) => c.ger === a).length);
const inGer = () => RAW.filter((c) => !GER || c.ger === GER);
function periodsOf(L) {
  return [...new Map(L.map((c) => [String(c.cycle_id || ''), { id: String(c.cycle_id || ''), name: c.cycle, start: c.cycle_start }])).values()].sort((a, b) => String(a.start).localeCompare(String(b.start)));
}
const inPer = () => inGer().filter((c) => !PER || String(c.cycle_id || '') === PER);
const fl = () => inPer().filter((c) => (!F.lid || c.lid === F.lid) && (!F.tab || c.tab === F.tab));
const lcol = (l) => PAL[Math.max(0, LIDS.indexOf(l)) % PAL.length];
function refreshLists() {
  const L = inPer();
  const cnt = (k) => (a, b) => L.filter((c) => c[k] === b).length - L.filter((c) => c[k] === a).length;
  LIDS = [...new Set(L.map((c) => c.lid))].sort(cnt('lid'));
  TABS = [...new Set(L.map((c) => c.tab))].sort(cnt('tab'));
  if (F.lid && !LIDS.includes(F.lid)) F.lid = '';
  if (F.tab && !TABS.includes(F.tab)) F.tab = '';
}
// Cabeçalho: gerência, equipe e carteira do recorte
function G() {
  const L = inGer();
  const teams = Object.entries(L.reduce((a, c) => { if (c.team) a[c.team] = (a[c.team] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]);
  const prods = new Set(L.map((c) => c.product));
  const op = prods.size === 1 && prods.has('VEICULOS') ? 'Banco PAN · Veículos' : prods.has('VEICULOS') ? 'Banco PAN · Veículos e Sem Garantia' : 'Banco PAN · Sem Garantia';
  return { nome: GER || 'todas as gerências', curto: GER ? teams[0]?.[0] || 'AGV PAN' : 'AGV PAN', op, all: !GER };
}
function perLabel(L) {
  const d = L.map((c) => c.date).filter(Boolean).sort();
  if (!d.length) return '';
  const a = dfmt(d[0]), b = dfmt(d[d.length - 1]), y = d[d.length - 1].slice(0, 4);
  return `${a === b ? a : `${a} a ${b}`}/${y}`;
}

function agg(L) {
  const I = {}; let s = 0, n = 0;
  IT.forEach((i) => {
    const a = L.reduce((x, c) => x + (c.it[i.k] === 'SIM' ? 1 : c.it[i.k] === 'PARCIAL' ? 0.5 : 0), 0), b = L.filter((c) => c.it[i.k] !== 'NA').length;
    I[i.k] = { s: a, n: b, p: pc(a, b) }; s += a; n += b;
  });
  return { I, s, n, p: pc(s, n), calls: L.length, ops: new Set(L.map((c) => c.login || c.op)).size, lids: new Set(L.map((c) => c.lid)).size,
    sem: L.filter((c) => c.desf === 'SEM_ACORDO').length };
}
const rank = (A) => IT.map((i) => ({ ...i, ...A.I[i.k] })).filter((x) => x.p != null).sort((a, b) => a.p - b.p);

// ------------------------------------------------------------------ peças
const trk = (p, h, noref) => `<div class="trk"${h ? ` style="height:${h}px"` : ''}><i style="width:${Math.max(0, Math.min(100, p || 0)).toFixed(1)}%;background:${fill(p)}"></i>${noref ? '' : `<u style="left:${REF}%"></u>`}</div>`;
const pill = (p) => `<span class="pill ${band(p)}">${fp(p)}</span>`;
const hc = (p, tip) => `<span class="hc ${band(p)}"${tip ? ` data-tip="${esc(tip)}"` : ''}>${fp(p)}</span>`;
const card = (h, sub, body, cls = '', act = '') => `<section class="card ${cls}"><div class="ch"><div><h3>${h}</h3>${sub ? `<p>${sub}</p>` : ''}</div>${act}</div>${body}</section>`;
const lnk = (t, a) => `<button class="lnk" ${a}>${t} →</button>`;
const av = (l) => `<div class="av" style="background:${lcol(l)}">${esc(ini(l))}</div>`;
const desfT = (k) => (DESF[k] ? `<span class="dsf"><i style="background:${DESF[k][1]}"></i>${DESF[k][0]}</span>` : '–');
const dlt = (v) => (v == null ? '<span class="dlt flat">–</span>' : `<span class="dlt ${v > 0.5 ? 'up' : v < -0.5 ? 'down' : 'flat'}">${v > 0.5 ? '▲' : v < -0.5 ? '▼' : '='} ${v > 0 ? '+' : ''}${Math.round(v)} p.p.</span>`);

function itemBars(A) {
  return `<div class="stgs">${ETAPAS.map((et) => `<div class="stg"><div class="stg-h">${et}</div>${IT.filter((i) => i.e === et).map((i) => { const x = A.I[i.k];
    return `<button class="ir" data-goitem="${i.k}" data-tip="${esc(i.t)}: ${x.s} de ${lg(x.n)}"><span class="lb">${i.t}</span>${trk(x.p)}<span class="vl"><b class="num">${fp(x.p)}</b><small class="num">${x.s} de ${x.n}</small></span></button>`; }).join('')}</div>`).join('')}</div>
    <div class="ref"><span><i style="background:var(--okf)"></i>70% ou mais</span><span><i style="background:var(--warnf)"></i>45% a 69%</span><span><i style="background:var(--badf)"></i>abaixo de 45%</span><span><u></u>referência de 70%</span></div><p class="foot">Esforço = itens cumpridos ÷ itens que cabiam na ligação. Alternativa após o não só conta quando o cliente recusou uma proposta.</p>`;
}
function faixas(L) {
  const t = L.length || 1, rows = BANDS.map((b) => ({ ...b, n: L.filter((c) => b.test(c.p ?? 0)).length }));
  return `<div class="stk" role="img" aria-label="Ligações por faixa de esforço">${rows.filter((r) => r.n).map((r) => `<i style="width:${(100 * r.n) / t}%;background:${r.c}" data-tip="${r.t}: ${lg(r.n)}"></i>`).join('')}</div>
  <div class="bands">${rows.slice().reverse().map((r) => `<button class="bd" data-goband="${r.k}"><span class="dt" style="background:${r.c}"></span><span class="tx"><b>${r.t}</b><small>esforço ${r.r}</small></span><span class="n num">${r.n}</span><span class="p num">${fp(pc(r.n, t))}</span></button>`).join('')}</div>`;
}
function heatLid(L) {
  const rows = LIDS.map((l) => { const x = L.filter((c) => c.lid === l); return x.length ? { l, A: agg(x) } : null; }).filter(Boolean).sort((a, b) => b.A.calls - a.A.calls);
  return `<div class="tw"><table class="hm"><colgroup><col style="width:28%"><col style="width:18%">${IT.map(() => '<col>').join('')}</colgroup><thead><tr><th>Liderança</th><th>Esforço negocial</th>${IT.map((i) => `<th class="c" data-tip="${esc(i.t)}">${i.h}</th>`).join('')}</tr></thead><tbody>
  ${rows.map(({ l, A }) => `<tr class="rw" data-golid="${esc(l)}"><td><div class="lw">${av(l)}<div class="who"><b>${esc(l)}</b><small>${lg(A.calls)} · ${A.ops} operador${A.ops > 1 ? 'es' : ''}</small></div></div></td>
  <td><div class="ec">${trk(A.p, 8, 1)}<b class="num">${fp(A.p)}</b></div></td>${IT.map((i) => `<td class="c">${hc(A.I[i.k].p, `${i.t}: ${A.I[i.k].s} de ${A.I[i.k].n}`)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function porMotivo(L) {
  const rows = TABS.map((t) => { const x = L.filter((c) => c.tab === t); return x.length ? { t, A: agg(x) } : null; }).filter(Boolean).sort((a, b) => b.A.calls - a.A.calls);
  return rows.map(({ t, A }) => `<button class="mr" data-gotab="${esc(t)}"><span class="lb"><b>${esc(t)}</b><small>${lg(A.calls)}</small></span>${trk(A.p)}<span class="vl"><b class="num">${fp(A.p)}</b></span></button>`).join('');
}

// ------------------------------------------------------------------ gráficos (SVG)
// Dispersão: eixos em %, linhas de referência e pontos clicáveis
function scatter(pts, { xLabel, yLabel, xMax = 100, yMax = 100, refX = null, refY = null, refYLabel = '', xTicks, h = 300, w = 640 }) {
  const W = w, H = h, L = 46, R = 16, T = 14, B = 40, iw = W - L - R, ih = H - T - B;
  const X = (v) => L + (Math.max(0, Math.min(xMax, v)) / xMax) * iw, Y = (v) => T + ih - (Math.max(0, Math.min(yMax, v)) / yMax) * ih;
  const xt = xTicks || [0, 25, 50, 75, 100].map((v) => (v * xMax) / 100);
  const yt = [0, 25, 50, 75, 100].map((v) => (v * yMax) / 100);
  const fmtT = (v, max) => (max === 100 ? `${v}%` : `${Math.round(v * 10) / 10}`);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(yLabel)} por ${esc(xLabel)}">
    ${yt.map((v) => `<line class="gl" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${fmtT(v, yMax)}</text>`).join('')}
    ${xt.map((v) => `<text x="${X(v)}" y="${H - B + 18}" text-anchor="middle">${xMax === 100 ? `${v}%` : `${Math.round(v * 10) / 10}`}</text>`).join('')}
    <line class="ax" x1="${L}" x2="${W - R}" y1="${T + ih}" y2="${T + ih}"/>
    ${refX != null ? `<line class="rf" x1="${X(refX)}" x2="${X(refX)}" y1="${T}" y2="${T + ih}"/><text class="rfl" x="${X(refX) + 4}" y="${T + 11}">${REF}%</text>` : ''}
    ${refY != null ? `<line class="rf" x1="${L}" x2="${W - R}" y1="${Y(refY)}" y2="${Y(refY)}"/><text class="rfl" x="${W - R}" y="${Y(refY) - 5}" text-anchor="end">${esc(refYLabel)}</text>` : ''}
    ${pts.map((p) => `<circle class="pt" cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${p.r || 6}" fill="${p.color || fill(p.x)}" fill-opacity="${p.op ?? 0.75}" stroke="var(--card)" stroke-width="1.5" data-tip="${esc(p.tip)}" ${p.attr || ''}/>`).join('')}
    <text class="axl" x="${L + iw / 2}" y="${H - 4}" text-anchor="middle">${esc(xLabel)}</text>
    <text class="axl" transform="translate(12 ${T + ih / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text></svg>`;
}
// Linhas: uma série por linha, valores em %
function lines(labels, series, { h = 280, w = 640 } = {}) {
  const W = w, H = h, L = 46, R = 20, T = 18, B = 34, iw = W - L - R, ih = H - T - B;
  const X = (i) => L + (labels.length === 1 ? iw / 2 : (i / (labels.length - 1)) * iw), Y = (v) => T + ih - (Math.max(0, Math.min(100, v)) / 100) * ih;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução do esforço negocial">
    ${[0, 25, 50, 75, 100].map((v) => `<line class="gl" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${v}%</text>`).join('')}
    <line class="rf" x1="${L}" x2="${W - R}" y1="${Y(REF)}" y2="${Y(REF)}"/><text class="rfl" x="${W - R}" y="${Y(REF) - 5}" text-anchor="end">referência 70%</text>
    ${labels.map((l, i) => `<text x="${X(i)}" y="${H - 10}" text-anchor="middle">${esc(l)}</text>`).join('')}
    ${series.map((s) => {
      const pts = s.data.map((v, i) => (v == null ? null : [X(i), Y(v), v, i])).filter(Boolean);
      return `<polyline fill="none" stroke="${s.color}" stroke-width="${s.w || 2}" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? 'stroke-dasharray="5 4"' : ''} points="${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}"/>
      ${pts.map((p) => `<circle class="pt" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${s.w > 2 ? 5.5 : 4}" fill="${s.color}" stroke="var(--card)" stroke-width="2" data-tip="${esc(`${s.label} · ${labels[p[3]]}: ${fp(p[2])}`)}"/>${s.values ? `<text class="vl" x="${p[0].toFixed(1)}" y="${(p[1] - 11).toFixed(1)}" text-anchor="middle">${fp(p[2])}</text>` : ''}`).join('')}`;
    }).join('')}</svg>`;
}
function opsOf(L) {
  const M = {};
  L.forEach((c) => (M[c.login || c.op] ||= { key: c.login || c.op, op: c.op, login: c.login, lid: c.lid, v: [] }).v.push(c));
  return Object.values(M).map((o) => ({ ...o, A: agg(o.v) }));
}
function dispOps(L) {
  const ops = opsOf(L);
  const maxN = Math.max(1, ...ops.map((o) => o.v.length));
  const sem = pc(L.filter((c) => c.desf === 'SEM_ACORDO').length, L.length);
  const pts = ops.map((o) => ({ x: o.A.p ?? 0, y: pc(o.A.sem, o.v.length) ?? 0, r: 5 + 9 * Math.sqrt(o.v.length / maxN), attr: `data-goop="${esc(o.key)}"`,
    tip: `${o.op}: esforço ${fp(o.A.p)} · ${fp(pc(o.A.sem, o.v.length))} sem acordo · ${lg(o.v.length)}` }));
  return `${scatter(pts, { xLabel: 'Esforço negocial do operador', yLabel: '% das ligações sem acordo', refX: REF, refY: sem, refYLabel: `média ${fp(sem)}` })}
    <p class="foot">Cada bolha é um operador (tamanho = nº de ligações). <b>Acima da média e à esquerda da referência</b>: pouco esforço e muita ligação sem acordo, onde a conversão mais perde. Clique numa bolha para abrir as ligações.</p>`;
}
function dispCalls(L) {
  const durs = L.map((c) => (c.dur || 0) / 60);
  const xMax = Math.max(1, Math.ceil(Math.max(...durs, 1)));
  const pts = L.map((c) => ({ x: (c.dur || 0) / 60, y: c.p ?? 0, r: 5, op: 0.55, color: DESF[c.desf]?.[1], attr: `data-open="${esc(c.id)}"`,
    tip: `${c.id} · ${c.op}: esforço ${fp(c.p)} · ${dur(c.dur)} · ${DESF[c.desf]?.[0] || ''}` }));
  const step = xMax <= 6 ? 1 : Math.ceil(xMax / 6);
  const xTicks = []; for (let v = 0; v <= xMax; v += step) xTicks.push(v);
  return `${scatter(pts, { xLabel: 'Duração da ligação (minutos)', yLabel: 'Esforço negocial', xMax, refY: REF, refYLabel: 'referência 70%', xTicks, h: 340, w: 1240 })}
    <div class="lgd">${Object.values(DESF).map(([t, c]) => `<span><i style="background:${c}"></i>${t}</span>`).join('')}</div>
    <p class="foot">Cada ponto é uma ligação, colorida pelo desfecho. Ligações curtas com esforço baixo indicam encerramento antes de negociar.</p>`;
}

// Evolução entre as análises (quinzena, semana ou dia), sem o filtro de quinzena
const GRANS = [['cycle', 'Análise (quinzena)'], ['week', 'Semana'], ['day', 'Dia']];
function evoGroups() {
  const L = inGer().filter((c) => (!F.lid || c.lid === F.lid) && (!F.tab || c.tab === F.tab));
  const M = new Map();
  for (const c of L) {
    const [k, label, ord] = GRAN === 'cycle' ? [String(c.cycle_id || ''), c.cycle, c.cycle_start || ''] : GRAN === 'week' ? [monday(c.date), `Sem. ${dfmt(monday(c.date))}`, monday(c.date)] : [c.date, dfmt(c.date), c.date];
    if (!M.has(k)) M.set(k, { k, label: label.replace(/ quinzena · /i, 'ª q. ').replace('ªª', 'ª'), ord, v: [] });
    M.get(k).v.push(c);
  }
  return [...M.values()].sort((a, b) => String(a.ord).localeCompare(String(b.ord))).map((g) => ({ ...g, A: agg(g.v) }));
}
function evoMini() {
  const P = evoGroups();
  if (P.length < 2) return '<div class="empty" style="padding:28px 10px">Ainda há uma única análise neste recorte. A evolução aparece quando outra quinzena for importada.</div>';
  const last = P[P.length - 1].A.p, prev = P[P.length - 2].A.p;
  return `${lines(P.map((g) => g.label), [{ label: 'Esforço negocial', data: P.map((g) => g.A.p), color: 'var(--pan2)', w: 3, values: true }], { h: 240 })}
    <p class="foot">Última análise ${dlt(last - prev)} em relação à anterior.</p>`;
}

// ------------------------------------------------------------------ views
function vGeral() {
  const L = fl(); if (!L.length) return semDados();
  const A = agg(L), R = rank(A), pior = R[0], melhor = R[R.length - 1], R2 = R.slice(0, 2);
  const crit = L.filter((c) => c.b === 'bad').length;
  const evo = evoGroups(), cur = evo.findIndex((g) => (GRAN === 'cycle' ? g.k === (PER || evo[evo.length - 1]?.k) : false));
  const prevA = cur > 0 ? evo[cur - 1] : null, curA = cur >= 0 ? evo[cur] : null;
  const brief = [
    `Analisei <b>${lg(A.calls)}</b> AGV com negociação, de <b>${A.ops} operadores</b>${A.lids > 1 ? ` em ${A.lids} lideranças` : ''}. O esforço negocial ficou em <b>${fp(A.p)}</b>.`,
    R2.length > 1 ? `O ponto mais fraco do roteiro é <b>${pior.t.toLowerCase()}</b> (${fp(pior.p)}), seguido de <b>${R2[1].t.toLowerCase()}</b> (${fp(R2[1].p)}). O mais forte é <b>${melhor.t.toLowerCase()}</b> (${fp(melhor.p)}).` : '',
    `<b>${lg(crit)}</b> (${fp(pc(crit, A.calls))}) ficaram com esforço crítico, abaixo de 45% dos itens cumpridos, e <b>${fp(pc(A.sem, A.calls))}</b> terminaram sem acordo.`,
    prevA && curA && GRAN === 'cycle' && !F.lid && !F.tab ? `Em relação à análise anterior (${esc(prevA.label)}), o esforço ${curA.A.p - prevA.A.p >= 0.5 ? 'subiu' : curA.A.p - prevA.A.p <= -0.5 ? 'caiu' : 'ficou estável'}: <b>${fp(prevA.A.p)} → ${fp(curA.A.p)}</b>.` : ''].filter(Boolean);
  return `<div class="stack">
  <div class="brief"><div class="bi">${ICO.bulb}</div><div><h4>Em poucas palavras</h4><ul>${brief.map((b) => `<li>${b}</li>`).join('')}</ul></div></div>
  <div class="grid">
    <section class="card kpi c3" style="--kc:var(--pan)"><div class="l">Ligações analisadas</div><div class="v num">${A.calls}</div><div class="d">${A.ops} operadores · ${A.lids} liderança${A.lids > 1 ? 's' : ''}</div></section>
    <section class="card kpi c3" style="--kc:${fill(A.p)};--kv:${fill(A.p)}"><div class="l">Esforço negocial</div><div class="v num">${fp(A.p)}</div><div class="meter"><i style="width:${A.p}%;background:${fill(A.p)}"></i><u style="left:${REF}%"></u></div><div class="d">Média dos 6 itens da negociação · referência 70%</div></section>
    <section class="card kpi c3" style="--kc:var(--okf)"><div class="l">Etapa mais forte</div><div class="t">${melhor.t}</div><div class="d"><span class="pill ${band(melhor.p)}">${fp(melhor.p)}</span> <span class="mut">das ligações</span></div></section>
    <section class="card kpi c3" style="--kc:var(--badf)"><div class="l">Maior oportunidade</div><div class="t">${pior.t}</div><div class="d"><span class="pill ${band(pior.p)}">${fp(pior.p)}</span> <span class="mut">das ligações</span></div></section>
    ${card('Esforço negocial etapa por etapa', 'Percentual de ligações em que o operador cumpriu cada item. Clique num item para ver onde faltou.', itemBars(A), 'c7 fillc')}
    <div class="c5 col">${card('Ligações por faixa de esforço', 'Itens do roteiro cumpridos em cada ligação', faixas(L))}
    ${card('Esforço por motivo', 'Motivo de sem condições informado pelo cliente', porMotivo(L))}</div>
    ${A.lids > 1 ? card('Visão por liderança', 'Esforço de cada equipe, item a item. Clique numa linha para abrir a equipe.', heatLid(L), 'c12', lnk('Ver equipes', 'data-go="lid"')) : ''}
    ${card('Dispersão dos operadores', 'Esforço negocial × ligações que terminaram sem acordo', dispOps(L), 'c7')}
    ${card('Evolução entre as análises', 'Esforço negocial de cada análise importada', evoMini(), 'c5', lnk('Ver evolução', 'data-go="evo"'))}
    ${card('Dispersão das ligações', 'Duração × esforço negocial de cada ligação', dispCalls(L), 'c12')}
  </div></div>`;
}

function vLid() {
  const L = fl(); if (!L.length) return semDados();
  const rows = LIDS.map((l) => { const x = L.filter((c) => c.lid === l); return x.length ? { l, x, A: agg(x) } : null; }).filter(Boolean).sort((a, b) => b.A.calls - a.A.calls);
  return `<div class="lstack">${rows.map(({ l, x, A }) => {
    const R = rank(A), foco = R.filter((f) => f.p < 70).slice(0, 2);
    const ops = opsOf(x).sort((a, b) => a.A.p - b.A.p);
    return `<section class="card lc" style="--lcol:${lcol(l)}">
      <div class="lc-s">
        <div class="lc-h">${av(l)}<div class="nm"><b>${esc(l)}</b><small>${lg(A.calls)} · ${A.ops} operador${A.ops > 1 ? 'es' : ''}</small></div></div>
        <div class="lc-k"><b class="num" style="color:${fill(A.p)}">${fp(A.p)}</b><span>esforço negocial${A.calls < 5 ? ' · <span class="tag lt">amostra pequena</span>' : ''}</span></div>
        <div class="mini">${IT.map((i) => { const v = A.I[i.k]; return `<div class="mi" data-tip="${esc(i.t)}: ${v.s} de ${v.n}"><span>${i.c}</span>${trk(v.p, 6, 1)}<b class="num">${fp(v.p)}</b></div>`; }).join('')}</div>
        ${foco.length ? `<div class="focus"><span>Onde focar</span>${foco.map((f) => `<b>${f.c} · ${fp(f.p)}</b>`).join('')}</div>` : ''}
        <button class="tbtn" data-golidcalls="${esc(l)}">${A.calls === 1 ? 'Ver a ligação da equipe' : `Ver as ${A.calls} ligações da equipe`} →</button>
      </div>
      <div class="lc-t"><div class="lc-tt"><table class="hm"><colgroup><col style="width:44%"><col style="width:13%"><col style="width:14%"><col></colgroup><thead><tr><th>Operador</th><th class="c">Ligações</th><th class="c">Esforço</th><th>A desenvolver</th></tr></thead><tbody>
      ${ops.map((o) => { const w = rank(o.A)[0]; return `<tr class="rw" data-goop="${esc(o.key)}"><td><div class="who"><b>${esc(o.op)}</b><small>${esc(o.login || 'sem login')}</small></div></td><td class="c num">${o.v.length}</td><td class="c">${pill(o.A.p)}</td><td>${w && w.p < 70 ? `<span class="tag">${w.c}</span>` : '<span class="mut">–</span>'}</td></tr>`; }).join('')}</tbody></table></div></div></section>`; }).join('')}</div>`;
}

function vOps() {
  const L = fl(); if (!L.length) return semDados();
  let ops = opsOf(L).map((o) => { const w = rank(o.A)[0]; return { ...o, n: o.v.length, p: o.A.p, w, ...Object.fromEntries(IT.map((i) => [i.k, o.A.I[i.k].p ?? -1])) }; });
  const { k, d } = SORT;
  ops.sort((a, b) => { const x = a[k], y = b[k]; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * d || a.op.localeCompare(b.op); });
  const th = (key, t, cls = '') => { const it = IT.find((i) => i.k === key); return `<th class="${cls}${SORT.k === key ? ' sorted' : ''}" data-sort="${key}"${it ? ` data-tip="${esc(it.t)}"` : ''}>${t}<span class="ar">${SORT.k === key ? (SORT.d > 0 ? '↑' : '↓') : ''}</span></th>`; };
  return `<p class="cnt"><b>${ops.length}</b> operadores · clique no título de uma coluna para reordenar ou numa linha para abrir as ligações do operador</p>
  <div class="tw sc"><table class="hm"><colgroup><col style="width:18%"><col style="width:6.5%"><col style="width:6.5%">${IT.map(() => '<col style="width:8.2%">').join('')}<col></colgroup><thead><tr>${th('op', 'Operador')}${th('n', 'Ligações', 'c')}${th('p', 'Esforço', 'c')}${IT.map((i) => th(i.k, i.h, 'c')).join('')}<th>A desenvolver</th></tr></thead><tbody>
  ${ops.map((o) => `<tr class="rw" data-goop="${esc(o.key)}"><td><div class="who"><b>${esc(o.op)}</b><small><i class="ld" style="background:${lcol(o.lid)}"></i>${esc(o.login || 'sem login')} · ${esc(curto(o.lid))}</small></div></td><td class="c num">${o.n}</td><td class="c">${pill(o.p)}</td>
  ${IT.map((i) => { const v = o.A.I[i.k]; return `<td class="c">${v.n ? hc(v.p, `${i.t}: ${v.s} de ${v.n}`) : '<span class="hc na" data-tip="Não se aplicou">–</span>'}</td>`; }).join('')}
  <td>${o.w && o.w.p < 70 ? `<span class="tag">${o.w.c}</span>` : '<span class="mut">–</span>'}</td></tr>`).join('')}</tbody></table></div>`;
}

const CHIPS = [
  ['todas', 'Todas', () => true],
  ['bad', 'Esforço crítico', (c) => c.b === 'bad'],
  ['prop', 'Sem proposta com valor', (c) => c.it.prop === 'NAO'],
  ['alt', 'Sem alternativa após o não', (c) => c.it.alt === 'NAO'],
  ['sond', 'Sem perguntar o motivo', (c) => c.it.sond === 'NAO'],
  ['ok', 'Esforço bom', (c) => c.b === 'ok']];
function vLig() {
  const B = fl(); if (!B.length) return semDados();
  let L = B;
  if (PRE) L = L.filter(PRE.fn);
  const ch = CHIPS.find((x) => x[0] === CHIP) || CHIPS[0]; L = L.filter(ch[2]);
  const q = LQ.trim().toLowerCase(); if (q) L = L.filter((c) => `${c.id} ${c.op} ${c.login} ${c.cli} ${c.arq} ${c.tab}`.toLowerCase().includes(q));
  L = L.slice().sort((a, b) => (a.p ?? 0) - (b.p ?? 0) || b.dt.localeCompare(a.dt));
  LISTA = L.map((c) => c.id);
  const dot = (v, i) => `<i class="${v === 'SIM' ? 's' : v === 'NAO' ? 'n' : v === 'PARCIAL' ? 'p' : 'x'}" data-tip="${esc(i.t)}: ${v === 'SIM' ? 'fez' : v === 'NAO' ? 'faltou' : v === 'PARCIAL' ? 'fez em parte' : 'não se aplicou'}">${v === 'SIM' ? '✓' : v === 'NAO' ? '✕' : v === 'PARCIAL' ? '½' : '–'}</i>`;
  return `<div class="tb"><div class="chips">${PRE ? `<button class="chip on" data-act="clrpre">${esc(PRE.t)} <em>✕</em></button>` : ''}${CHIPS.map(([k, t, f]) => `<button class="chip${CHIP === k ? ' on' : ''}" data-chip="${k}">${t} <em class="num">${(PRE ? B.filter(PRE.fn) : B).filter(f).length}</em></button>`).join('')}</div></div>
  <div class="tb2"><p class="cnt"><b>${L.length}</b> de ${B.length} ligações · roteiro na ordem: motivo, capacidade, proposta, alternativa, benefício e consequências</p><label class="srch"><span class="sr">Buscar</span>${ICO.search}<input id="esf-q" placeholder="ID, operador, login ou cliente" value="${esc(LQ)}" autocomplete="off"></label></div>
  ${L.length ? `<div class="tw sc"><table class="hm"><colgroup><col style="width:15%"><col style="width:24%"><col style="width:17%"><col style="width:9%"><col style="width:17%"><col></colgroup><thead><tr><th>Ligação</th><th>Operador</th><th>Motivo</th><th class="c">Esforço</th><th data-tip="Motivo · Capacidade · Proposta · Alternativa · Benefício · Consequências">Roteiro</th><th>Desfecho</th></tr></thead><tbody>
  ${L.map((c) => `<tr class="rw" data-open="${esc(c.id)}"><td><div class="idc"><b class="num">${esc(c.id)}</b><small>${dfmt(c.date)} ${esc(c.dt.slice(11, 16))} · ${dur(c.dur)}</small></div></td><td><div class="who"><b>${esc(c.op)}</b><small>${esc(c.lid)}</small></div></td><td><span class="tag">${esc(c.tab)}</span></td><td class="c">${pill(c.p)}</td>
  <td><span class="dots">${IT.map((i) => dot(c.it[i.k], i)).join('')}</span></td><td>${desfT(c.desf)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card empty">Nenhuma ligação com esses filtros.</div>'}`;
}

function vEvo() {
  const P = evoGroups();
  if (!P.length) return semDados();
  const seg = `<div class="segb">${GRANS.map(([k, t]) => `<button data-gran="${k}" class="${GRAN === k ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  if (P.length < 2) return `<div class="stack">${seg}<div class="card vz"><div class="ic">${ICO.trend}</div><h3>Uma única ${GRAN === 'cycle' ? 'análise' : GRAN === 'week' ? 'semana' : 'data'} neste recorte</h3><p>A evolução compara as análises importadas. Assim que outra quinzena de ligações AGV entrar na plataforma, este quadro mostra o que subiu e o que caiu, item a item, por liderança e por operador.</p></div></div>`;
  const labels = P.map((g) => g.label);
  const colors = ['#0A8FD6', '#7C5CE0', '#0E9F8E', '#E07B0B', '#D2477E', '#5B6B86'];
  const last = P[P.length - 1], prev = P[P.length - 2];
  const cmpRows = (keyFn, nameFn) => {
    const M = new Map();
    for (const [gi, g] of [[0, prev], [1, last]]) for (const c of g.v) { const k = keyFn(c); if (!M.has(k)) M.set(k, { k, name: nameFn(c), v: [[], []] }); M.get(k).v[gi].push(c); }
    return [...M.values()].filter((r) => r.v[0].length && r.v[1].length).map((r) => { const a = agg(r.v[0]).p, b = agg(r.v[1]).p; return { ...r, a, b, d: b - a, n: [r.v[0].length, r.v[1].length] }; });
  };
  const lids = cmpRows((c) => c.lid, (c) => c.lid).sort((a, b) => b.d - a.d);
  const ops = cmpRows((c) => c.login || c.op, (c) => c.op).sort((a, b) => b.d - a.d);
  const opTable = (rows) => `<div class="tw"><table class="hm"><colgroup><col style="width:46%"><col><col><col style="width:22%"></colgroup><thead><tr><th>Operador</th><th class="c">${esc(prev.label)}</th><th class="c">${esc(last.label)}</th><th class="c">Variação</th></tr></thead><tbody>
    ${rows.map((r) => `<tr class="rw" data-goop="${esc(r.k)}"><td><div class="who"><b>${esc(r.name)}</b><small>${r.n[0]} → ${r.n[1]} ligações</small></div></td><td class="c">${hc(r.a)}</td><td class="c">${hc(r.b)}</td><td class="c">${dlt(r.d)}</td></tr>`).join('') || '<tr><td colspan="4" class="mut">Nenhum operador nas duas análises.</td></tr>'}</tbody></table></div>`;
  return `<div class="stack">
  <div class="tb" style="justify-content:space-between">${seg}<p class="cnt" style="margin:0">Comparando <b>${P.length}</b> ${GRAN === 'cycle' ? 'análises' : GRAN === 'week' ? 'semanas' : 'dias'} · o filtro de quinzena não se aplica aqui</p></div>
  <div class="grid">
    ${card('Esforço negocial por análise', 'Total do recorte (linha grossa) e cada item do roteiro', `${lines(labels, [{ label: 'Esforço negocial', data: P.map((g) => g.A.p), color: 'var(--ink)', w: 3.5, values: true },
      ...IT.map((i, n) => ({ label: i.c, data: P.map((g) => g.A.I[i.k].p), color: colors[n], dash: n % 2 === 1 }))], { h: 380, w: 1240 })}
      <div class="lgd"><span><i class="ln" style="background:var(--ink)"></i>Esforço negocial</span>${IT.map((i, n) => `<span><i class="ln" style="background:${colors[n]}"></i>${i.c}</span>`).join('')}</div>`, 'c12')}
    ${card('Item a item por análise', `Variação = ${esc(last.label)} em relação a ${esc(prev.label)}`, `<div class="tw"><table class="hm"><colgroup><col style="width:26%">${P.map(() => '<col>').join('')}<col style="width:14%"></colgroup><thead><tr><th>Item</th>${P.map((g) => `<th class="c">${esc(g.label)}</th>`).join('')}<th class="c">Variação</th></tr></thead><tbody>
      <tr><td><b>Ligações analisadas</b></td>${P.map((g) => `<td class="c num">${g.A.calls}</td>`).join('')}<td class="c mut">–</td></tr>
      <tr><td><b>Esforço negocial</b></td>${P.map((g) => `<td class="c">${hc(g.A.p)}</td>`).join('')}<td class="c">${dlt(last.A.p - prev.A.p)}</td></tr>
      ${IT.map((i) => `<tr><td>${i.t}</td>${P.map((g) => `<td class="c">${g.A.I[i.k].n ? hc(g.A.I[i.k].p, `${g.A.I[i.k].s} de ${g.A.I[i.k].n}`) : '<span class="hc na">–</span>'}</td>`).join('')}<td class="c">${prev.A.I[i.k].n && last.A.I[i.k].n ? dlt(last.A.I[i.k].p - prev.A.I[i.k].p) : '–'}</td></tr>`).join('')}
      <tr><td>Esforço crítico (abaixo de 45%)</td>${P.map((g) => `<td class="c num">${fp(pc(g.v.filter((c) => c.b === 'bad').length, g.v.length))}</td>`).join('')}<td class="c">–</td></tr>
      <tr><td>Terminaram sem acordo</td>${P.map((g) => `<td class="c num">${fp(pc(g.A.sem, g.A.calls))}</td>`).join('')}<td class="c">–</td></tr>
      </tbody></table></div>`, 'c12')}
    ${card('Lideranças: antes e agora', `${esc(prev.label)} → ${esc(last.label)}`, `<div class="tw"><table class="hm"><colgroup><col style="width:46%"><col><col><col style="width:22%"></colgroup><thead><tr><th>Liderança</th><th class="c">${esc(prev.label)}</th><th class="c">${esc(last.label)}</th><th class="c">Variação</th></tr></thead><tbody>
      ${lids.map((r) => `<tr class="rw" data-golid="${esc(r.k)}"><td><div class="lw">${av(r.k)}<div class="who"><b>${esc(r.name)}</b><small>${r.n[0]} → ${r.n[1]} ligações</small></div></div></td><td class="c">${hc(r.a)}</td><td class="c">${hc(r.b)}</td><td class="c">${dlt(r.d)}</td></tr>`).join('') || '<tr><td colspan="4" class="mut">Nenhuma liderança nas duas análises.</td></tr>'}</tbody></table></div>`, 'c6')}
    ${card('Operadores que mais evoluíram', 'Presentes nas duas últimas análises', opTable(ops.filter((r) => r.d > 0).slice(0, 10)), 'c6')}
    ${card('Operadores que mais caíram', 'Presentes nas duas últimas análises', opTable(ops.filter((r) => r.d < 0).sort((a, b) => a.d - b.d).slice(0, 10)), 'c6')}
    ${card('Dispersão: análise anterior × última', 'Cada bolha é um operador. Acima da diagonal, melhorou.', scatter(ops.map((r) => ({ x: r.a, y: r.b, r: 7, color: r.d >= 0 ? 'var(--okf)' : 'var(--badf)', attr: `data-goop="${esc(r.k)}"`, tip: `${r.name}: ${fp(r.a)} → ${fp(r.b)}` })), { xLabel: `Esforço em ${prev.label}`, yLabel: `Esforço em ${last.label}`, refX: REF, refY: REF, refYLabel: '70%' }).replace('</svg>', '<line class="gl" x1="46" y1="260" x2="624" y2="14" style="stroke-dasharray:3 4"/></svg>'), 'c6')}
  </div></div>`;
}

function semDados() {
  if (RAW.length) return `<div class="card vz"><div class="ic">${ICO.search}</div><h3>Nenhuma ligação com esses filtros</h3><p>Troque a gerência, a análise, a liderança ou o motivo selecionado no topo.</p></div>`;
  return `<div class="card vz"><div class="ic">${ICO.inbox}</div><h3>Sem ligações AGV com negociação</h3><p>Importe as ligações AGV (lista do discador, relatório do speech ou dashboards AGV) em <b>Análises AGV</b>. Assim que houver ligações com negociação, este painel mostra o esforço negocial, a visão por liderança e a evolução entre as análises.</p></div>`;
}

const VIEWS = {
  geral: { t: 'Visão geral', s: () => 'Esforço negocial nas ligações AGV com negociação', f: vGeral, i: 'grid' },
  lid: { t: 'Lideranças', s: () => 'Cada equipe com seus operadores, para tratativa individual', f: vLid, i: 'team' },
  ops: { t: 'Operadores', s: () => 'Esforço de cada operador, item a item do roteiro', f: vOps, i: 'user' },
  lig: { t: 'Ligações', s: () => 'Cada ligação analisada, com o roteiro e o desfecho', f: vLig, i: 'phone' },
  evo: { t: 'Evolução', s: () => 'Como o esforço mudou entre as análises', f: vEvo, i: 'trend' },
};

// ------------------------------------------------------------------ capa e cabeçalho
const selGer = (cls) => `<label class="${cls}"><span class="sr">Gerência</span><select data-f="ger"><option value="">Todas as gerências</option>${gers().map((g) => `<option value="${esc(g)}"${GER === g ? ' selected' : ''}>Gerência ${esc(g)}</option>`).join('')}</select></label>`;
const selPer = (cls) => { const P = periodsOf(inGer()); return `<label class="${cls}"><span class="sr">Análise</span><select data-f="per"><option value="">Todas as análises</option>${P.map((p) => `<option value="${esc(p.id)}"${PER === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>`; };
function cover() {
  const L = inPer(), A = agg(L), g = G(), has = L.length;
  const col = (p) => (p >= 70 ? '#34D399' : p >= 45 ? '#FBBF24' : '#FB7185');
  return `<div class="cover"><div class="cv">
  <div class="cv-top">${LOGOS}<span class="cv-tag"><i></i>${has ? `${lg(A.calls)} · ${perLabel(L)}` : 'Relatório AGV'}</span></div>
  <div class="cv-hero"><div>
    <div class="kick">Monitoria de qualidade · ${esc(g.op)}</div>
    <h1>Esforço negocial<span>${g.all ? 'todas as gerências' : `gerência ${esc(g.nome)}`}</span></h1>
    <p class="lead">Análise das ligações <b>AGV com negociação</b>, conferindo item a item o roteiro de negociação: sondagem, proposta, alternativa e argumentação.</p>
    <div class="cv-sel">${selGer('')}${selPer('')}</div>
    <div class="cv-btns"><button class="cbtn pri" data-go="geral">Abrir a análise →</button>${has ? '<button class="cbtn" data-go="lid">Ver por liderança</button><button class="cbtn" data-go="evo">Ver evolução</button>' : ''}</div>
    ${has ? `<div class="cv-chips"><span class="cv-chip">Operadores: <b>${A.ops}</b></span><span class="cv-chip">Lideranças: <b>${A.lids}</b></span><span class="cv-chip">Motivos: <b>${new Set(L.map((c) => c.tab)).size}</b></span><span class="cv-chip">Análises: <b>${periodsOf(inGer()).length}</b></span></div>` : ''}
  </div>
  <div class="cv-panel">${has ? `<div class="cv-ph"><div><small>Esforço negocial</small><strong>itens do roteiro cumpridos</strong></div><div class="cv-big num" style="color:${col(A.p)}">${fp(A.p)}<em style="color:#A9BCE3">referência 70%</em></div></div>
    <div class="cv-rows">${IT.map((i) => { const v = A.I[i.k]; return `<div class="cv-row"><span>${i.t}</span><div class="trk"><i style="width:${(v.p || 0).toFixed(1)}%;background:${col(v.p)}"></i></div><b class="num">${fp(v.p)}</b></div>`; }).join('')}</div>`
    : '<div class="cv-ph"><div><small>Situação</small><strong>Sem ligações neste recorte</strong></div></div><div class="cv-rows" style="font-size:14px;line-height:1.6;color:#D7E1F5">Ainda não há ligações AGV com negociação para esta gerência e análise. Troque o recorte acima ou importe as ligações em Análises AGV.</div>'}</div></div>
  ${has ? `<div class="cv-cards">
    <button class="cvc" data-go="geral"><div class="ic">${ICO.grid}</div><h3>Visão geral</h3><p>Esforço etapa por etapa, faixas, motivos e dispersões.</p></button>
    <button class="cvc" data-go="lid"><div class="ic">${ICO.team}</div><h3>Lideranças</h3><p>Cada equipe com seus operadores e onde focar.</p></button>
    <button class="cvc" data-go="ops"><div class="ic">${ICO.user}</div><h3>Operadores</h3><p>Mapa de calor item a item, do menor esforço ao maior.</p></button>
    <button class="cvc" data-go="lig"><div class="ic">${ICO.phone}</div><h3>Ligações</h3><p>Roteiro de cada ligação e o que desenvolver.</p></button>
    <button class="cvc" data-go="evo"><div class="ic">${ICO.trend}</div><h3>Evolução</h3><p>O que subiu e o que caiu entre as análises.</p></button>
  </div>` : ''}
  <div class="cv-foot"><span>Fonte: ligações AGV da plataforma (discador, relatório do speech e dashboards AGV)</span><span>Ligações com negociação · abertura e confirmação de dados não entram no esforço</span></div></div></div>`;
}
function header() {
  const g = G(), L = fl();
  const ops = new Set(L.map((c) => c.login || c.op)).size;
  const ct = { geral: '', lid: new Set(L.map((c) => c.lid)).size, ops, lig: L.length, evo: periodsOf(inGer()).length };
  return `<div class="topw"><header class="hdr"><div class="hdr-in">${LOGOS}<div class="hdr-t"><h1>Esforço negocial · ${esc(g.curto)}</h1><p>${g.all ? 'todas as gerências' : `gerência ${esc(g.nome)}`}${perLabel(inPer()) ? ` · ${perLabel(inPer())}` : ''} · ligações AGV com negociação</p></div>
  ${selGer('hsel')}${selPer('hsel')}
  <button class="hbtn" data-act="capa" aria-label="Capa">${ICO.home}<span>Capa</span></button><button class="hbtn" data-act="print" aria-label="Imprimir">${ICO.print}<span>Imprimir</span></button></div></header>
  <div class="bar"><div class="bar-in"><nav class="tabs" role="tablist">${Object.entries(VIEWS).map(([k, v]) => `<button class="tab${VIEW === k ? ' on' : ''}" role="tab" aria-selected="${VIEW === k}" data-go="${k}">${v.t}${RAW.length && ct[k] !== '' ? `<span class="ct num">${ct[k]}</span>` : ''}</button>`).join('')}</nav>
  ${RAW.length ? `<div class="flt">${LIDS.length > 1 ? `<label class="sel${F.lid ? ' on' : ''}"><span class="sr">Liderança</span><select data-f="lid"><option value="">Todas as lideranças</option>${LIDS.map((l) => `<option value="${esc(l)}"${F.lid === l ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>` : ''}
  <label class="sel${F.tab ? ' on' : ''}"><span class="sr">Motivo</span><select data-f="tab"><option value="">Todos os motivos</option>${TABS.map((t) => `<option value="${esc(t)}"${F.tab === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
  ${F.lid || F.tab ? '<button class="clr" data-act="limpar">Limpar</button>' : ''}</div>` : ''}</div></div></div>`;
}

function draw(keepFocus) {
  refreshLists();
  if (VIEW === 'capa') { root.innerHTML = cover(); return; }
  const V = VIEWS[VIEW];
  root.innerHTML = `${header()}<main class="wrap"><div class="vh"><div><h2>${V.t}</h2><p>${V.s()}${F.lid ? ` · ${esc(F.lid)}` : ''}${F.tab ? ` · ${esc(F.tab)}` : ''}</p></div></div><div>${V.f()}</div></main>`;
  if (keepFocus) { const q = root.querySelector('#esf-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
}
function go(v) { VIEW = v; draw(); window.scrollTo({ top: 0 }); }

// ------------------------------------------------------------------ modal da ligação
function ringSVG(p) {
  const r = 30, C = 2 * Math.PI * r, v = Math.max(0, Math.min(100, p || 0));
  return `<svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true"><circle cx="38" cy="38" r="${r}" fill="none" stroke="var(--line2)" stroke-width="8"/><circle cx="38" cy="38" r="${r}" fill="none" stroke="${fill(p)}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${((C * v) / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 38 38)"/><text x="38" y="43" text-anchor="middle" font-size="16" font-weight="800" font-family="Inter,system-ui,sans-serif">${fp(p)}</text></svg>`;
}
let modalEl = null;
function renderModal() {
  const c = RAW.find((x) => x.id === MID); if (!c) return; const i = LISTA.indexOf(MID);
  const st = (v) => (v === 'SIM' ? '<span class="pill ok">✓ Fez</span>' : v === 'NAO' ? '<span class="pill bad">✕ Faltou</span>' : v === 'PARCIAL' ? '<span class="pill warn">½ Em parte</span>' : '<span class="pill na">Não se aplicou</span>');
  const falta = IT.filter((x) => c.it[x.k] === 'NAO');
  modalEl.innerHTML = `<div class="md" role="dialog" aria-modal="true" aria-label="Ligação ${esc(c.id)}">
  <div class="md-h"><div><h3>Ligação ${esc(c.id)}</h3><p>${dfmt(c.date)}/${c.date.slice(0, 4)}${c.dt.slice(11, 16) ? ` às ${esc(c.dt.slice(11, 16))}` : ''} · ${dur(c.dur)}${c.camp ? ` · ${esc(c.camp)}` : ''}</p></div>
  <div class="md-x">${LISTA.length > 1 ? `<button class="mb" data-m="prev" ${i <= 0 ? 'disabled' : ''} aria-label="Anterior">‹</button><span class="pg num">${i + 1} de ${LISTA.length}</span><button class="mb" data-m="next" ${i >= LISTA.length - 1 ? 'disabled' : ''} aria-label="Próxima">›</button>` : ''}<button class="mb" data-m="close" aria-label="Fechar">✕</button></div></div>
  <div class="md-b">
    <div class="facts"><div class="fact"><small>Operador</small><b>${esc(c.op)}</b><em>${esc(c.login || 'sem login')} · ${esc(c.lid)}</em></div><div class="fact"><small>Cliente e motivo</small><b>${esc(c.cli || 'Não informado')}</b><em>${esc(c.tab)} · ${DESF[c.desf] ? DESF[c.desf][0] : '–'}</em></div></div>
    <div class="box"><h4>Roteiro de negociação</h4>${IT.map((x) => `<div class="ck"><div>${x.t}<small>${x.e}</small></div>${st(c.it[x.k])}</div>`).join('')}</div>
    <div class="mcol">
      <div class="box"><h4>Esforço negocial</h4><div class="ring">${ringSVG(c.p)}<div><b>${c.s} de ${c.n} itens cumpridos</b><span>${c.b === 'ok' ? 'Esforço bom' : c.b === 'warn' ? 'Esforço em atenção' : 'Esforço crítico'}</span></div></div></div>
      <div class="box aud"><h4>Localizar o áudio</h4><div class="row"><button class="abtn pri" data-copy="${esc(c.id)}">Copiar ID</button>${c.arq ? `<button class="abtn" data-copy="${esc(c.arq)}">Copiar nome do arquivo</button>` : ''}<a class="abtn" href="#/atendimentos/${c.eid}" data-m="close">Abrir o atendimento →</a></div>${c.arq ? `<div class="fname">${esc(c.arq)}</div>` : ''}</div>
    </div>
    <div class="box full"><h4>Para desenvolver</h4>${falta.length ? `<div class="tips">${falta.map((x) => `<div class="tip"><b>${x.c}</b><span>${x.dica}</span></div>`).join('')}</div>` : '<div class="ok-msg">Cumpriu todos os itens que cabiam nesta ligação.</div>'}</div>
  </div></div>`;
}
function onKey(e) { if (e.key === 'Escape') fechar(); if (e.key === 'ArrowRight') nav(1); if (e.key === 'ArrowLeft') nav(-1); }
function abrir(id) {
  if (!LISTA.includes(id)) LISTA = [id];
  MID = id;
  if (!modalEl) {
    modalEl = document.createElement('div'); modalEl.className = 'esf-modal';
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) return fechar();
      const cp = e.target.closest('[data-copy]'); if (cp) return copiar(cp.dataset.copy);
      const m = e.target.closest('[data-m]'); if (m) { const a = m.dataset.m; if (a === 'prev') nav(-1); else if (a === 'next') nav(1); else fechar(); }
    });
    document.body.appendChild(modalEl);
    document.addEventListener('keydown', onKey);
  }
  renderModal();
  modalEl.querySelector('[data-m=close]')?.focus();
}
function fechar() { modalEl?.remove(); modalEl = null; document.removeEventListener('keydown', onKey); }
function nav(d) { const i = LISTA.indexOf(MID) + d; if (i < 0 || i >= LISTA.length) return; MID = LISTA[i]; renderModal(); }
function copiar(t) {
  const fb = () => { const a = document.createElement('textarea'); a.value = t; a.style.position = 'fixed'; a.style.opacity = '0'; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); } catch { /* sem área de transferência */ } a.remove(); toast('Copiado'); };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(() => toast('Copiado'), fb); else fb();
}
function preLig(t, fn) { PRE = { t, fn }; CHIP = 'todas'; LQ = ''; go('lig'); }

// ------------------------------------------------------------------ eventos
function bind() {
  root.addEventListener('click', (e) => {
    const cp = e.target.closest('[data-copy]'); if (cp) { copiar(cp.dataset.copy); return; }
    const t = e.target.closest('[data-go],[data-act],[data-chip],[data-open],[data-goitem],[data-goband],[data-golid],[data-golidcalls],[data-gotab],[data-goop],[data-sort],[data-gran]'); if (!t) return;
    const ds = t.dataset;
    if (ds.go) { if (ds.go !== 'lig') PRE = null; return go(ds.go); }
    if (ds.gran) { GRAN = ds.gran; return draw(); }
    if (ds.sort) { SORT = SORT.k === ds.sort ? { k: ds.sort, d: -SORT.d } : { k: ds.sort, d: 1 }; return draw(); }
    if (ds.chip) { CHIP = ds.chip; return draw(); }
    if (ds.open) return abrir(ds.open);
    if (ds.goitem) { const it = IT.find((x) => x.k === ds.goitem); return preLig(`Faltou: ${it.c}`, (c) => c.it[it.k] === 'NAO'); }
    if (ds.goband) { const b = BANDS.find((x) => x.k === ds.goband); return preLig(`Esforço ${b.t.toLowerCase()}`, (c) => c.b === b.k); }
    if (ds.golid) { F.lid = ds.golid; return go('lid'); }
    if (ds.golidcalls) { F.lid = ds.golidcalls; PRE = null; CHIP = 'todas'; return go('lig'); }
    if (ds.gotab) { F.tab = ds.gotab; return go(VIEW); }
    if (ds.goop) { const L = (VIEW === 'evo' ? inGer() : fl()).filter((c) => (c.login || c.op) === ds.goop).sort((a, b) => (a.p ?? 0) - (b.p ?? 0)); LISTA = L.map((c) => c.id); if (L.length) abrir(L[0].id); return; }
    const a = ds.act;
    if (a === 'capa') { fechar(); return go('capa'); }
    if (a === 'print') return window.print();
    if (a === 'limpar') { F = { lid: '', tab: '' }; return draw(); }
    if (a === 'clrpre') { PRE = null; return draw(); }
  });
  root.addEventListener('change', (e) => {
    const s = e.target.closest('[data-f]'); if (!s) return;
    if (s.dataset.f === 'ger') { GER = s.value; PER = latestPer(); F = { lid: '', tab: '' }; }
    else if (s.dataset.f === 'per') PER = s.value;
    else F[s.dataset.f] = s.value;
    draw();
  });
  root.addEventListener('input', (e) => { if (e.target.id === 'esf-q') { LQ = e.target.value; clearTimeout(draw.t); draw.t = setTimeout(() => draw(true), 200); } });
  const tip = document.createElement('div'); tip.className = 'esf-tip'; root.appendChild(tip);
  const move = (e) => { const t = e.target.closest && e.target.closest('[data-tip]'); if (!t) { tip.style.opacity = 0; return; } tip.textContent = t.dataset.tip; tip.style.opacity = 1; const w = tip.offsetWidth; tip.style.left = `${Math.min(e.clientX + 14, innerWidth - w - 10)}px`; tip.style.top = `${Math.min(e.clientY + 16, innerHeight - 40)}px`; };
  root.addEventListener('mousemove', move);
  root.addEventListener('mouseleave', () => { tip.style.opacity = 0; });
}
const latestPer = () => { const P = periodsOf(inGer()); return P.length ? P[P.length - 1].id : ''; };

export async function render(el, _p, ctx) {
  ctx.setTitle('Esforço negocial', 'AGV');
  if (!document.querySelector('link[data-esf]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/esforco.css'; l.dataset.esf = '1'; document.head.appendChild(l);
  }
  el.innerHTML = '<div class="esf"><div class="wrap"><div class="card empty">Carregando o esforço negocial…</div></div></div>';
  root = el.querySelector('.esf');
  const top = document.querySelector('.topbar')?.offsetHeight; if (top) root.style.setProperty('--esf-top', `${top}px`);
  const d = await api.get('/agv/data');
  if (!ctx.isCurrent()) return;
  RAW = prep(d);
  if (GER && !gers().includes(GER)) GER = '';
  if (!PER || !periodsOf(inGer()).some((p) => p.id === PER)) PER = latestPer();
  fechar();
  // A tela fica apartada do resto: modal e tooltip saem quando se troca de página
  const tidy = () => { if (!document.body.contains(root)) { fechar(); window.removeEventListener('hashchange', tidy); } };
  window.addEventListener('hashchange', tidy);
  bind();
  draw();
}

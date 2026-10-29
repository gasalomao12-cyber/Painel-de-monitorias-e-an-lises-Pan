import { api, qs, saveBlob } from '../api.js';
import { html, icon, $, $$, toast, modal, busy, debounce, emptyState, confirmDialog, multiSelect, bindMultiSelect, fmtDur, fmtRel, avatar } from '../ui.js';
import { scatterChart, palette, destroyAll } from '../charts.js';
import { parseSheetFile, parseWorkbook, readTranscriptFile, readTranscriptLines } from '../files.js';

// Força-tarefa de queda de ligação: análise manual, em conjunto e em tempo real, dos atendimentos
// tabulados como queda. O capacity traz liderança/gerência/campanha pelo login ou nome do operador.
const VERDICT = {
  cliente: ['Cliente desligou', 'ok', 'O cliente encerrou ou abandonou: a queda procede'],
  operador: ['Operador desligou', 'bad', 'Desvio de conduta: o operador encerrou com o cliente na linha'],
  tecnica: ['Queda técnica', 'info', 'Falha de linha, sistema ou discador'],
  mudo: ['Ligação muda', 'warn', 'Sem áudio ou sem resposta do cliente'],
  concluido: ['Atendimento seguiu', 'warn', 'Não houve queda: a conversa continuou ou terminou normalmente'],
  inconclusivo: ['Inconclusivo', 'outline', 'Sem áudio ou trecho suficiente para concluir'],
};
const VCOLOR = { cliente: '--ok', operador: '--bad', tecnica: '--s-refin', mudo: '--warn', concluido: '--s-entrega', inconclusivo: '--na' };
// A queda procede quando o cliente (ou a linha) derrubou a ligação
const TAB_OK = { cliente: true, tecnica: true, operador: false, mudo: false, concluido: false, inconclusivo: null };
// Carteiras analisadas pela força-tarefa e o grupo de cada uma (visão apartada)
const CARTEIRAS = ['SAFRA BS', 'SAFRA ADM', 'PAN CONTACT', 'PAN MASSIFICADOS', 'PAN ATIVAS E AJUIZADOS', 'PORTO'];
const GROUPS = ['PAN', 'SAFRA', 'PORTO'];
const groupOf = (r) => (r.carteira ? r.carteira.split(' ')[0] : r.portfolio || 'PAN');
const CONDUCT = ['Desligou na cara do cliente', 'Desligou durante o atendimento', 'Encerrou sem retorno ao cliente', 'Outro desvio de conduta'];
const LIST = { todos: 'Todos', pendente: 'Pendentes', analisada: 'Analisados', desvio: 'Com desvio', interna: 'Desconexão interna' };
const PAGE = 25;

const key = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
// Tabulações que a força-tarefa analisa: queda de ligação e ligação muda
const isMute = (t) => /\bmud[ao]\b/.test(key(t));
const isDrop = (t) => /queda|caiu|abandon/.test(key(t)) || isMute(t);
// A tabulação procede? Na queda, quando o cliente ou a linha derrubou; na ligação muda, quando estava muda
const tabOkFor = (verdict, tab) => (!verdict ? null : isMute(tab) ? (verdict === 'mudo' ? true : verdict === 'inconclusivo' ? null : false) : TAB_OK[verdict]);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const pctTxt = (a, b) => (b ? `${pct(a, b)}%` : '—');
const dt = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}` : '—');
const dayOf = (s) => (s ? s.slice(0, 10) : '');
const title = (s) => String(s || '').toLowerCase().replace(/(^|\s)(\p{L})/gu, (m) => m.toUpperCase()).replace(/\b(De|Da|Do|Dos|Das|E)\b/g, (w) => w.toLowerCase());
const short = (s) => { const p = title(s).split(' ').filter(Boolean); return p.length > 2 ? `${p[0]} ${p[p.length - 1]}` : p.join(' '); };
const mmss = (s) => { const m = String(s || '').trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/); return m ? (Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) : /^\d+$/.test(String(s || '').trim()) ? Number(s) : null; };

const state = { f: {}, from: '', to: '', q: '', list: 'todos', page: 0, view: 'todas' };
const FILTERS = [
  ['carteira', 'Todas as carteiras', 'carteiras', (r) => r.carteira || 'A definir'],
  ['manager', 'Todas as gerências', 'gerências', (r) => r.manager],
  ['leader', 'Todas as lideranças', 'lideranças', (r) => r.leader],
  ['login', 'Todos os operadores', 'operadores', (r) => r.login],
  ['campaign', 'Todas as campanhas', 'campanhas', (r) => r.campaign],
  ['segment', 'Todos os segmentos', 'segmentos', (r) => r.segment],
  ['tabulation', 'Todas as tabulações', 'tabulações', (r) => r.tabulation],
  ['disconnect', 'Interna e externa', 'tipos', (r) => r.disconnect || '—'],
  ['verdict', 'Todos os resultados', 'resultados', (r) => r.verdict || 'pendente'],
  ['analyst', 'Todos os analistas', 'analistas', (r) => r.analyst_name],
];
let D = null;
let CTX = null;
let ROOT = null;
let roster = new Map();
let rosterRows = [];

function loadCss() {
  if (!document.querySelector('link[data-qd]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/quedas.css'; l.dataset.qd = '1'; document.head.appendChild(l);
  }
}

export async function render(el, _p, ctx) {
  CTX = ctx; ROOT = el;
  loadCss();
  ctx.setTitle('Queda de ligação', 'Força-tarefa');
  await fetchData();
  if (!ctx.isCurrent()) return;
  draw();
}

// Alguém salvou uma análise: atualiza números e lista sem fechar o que estiver aberto
export async function onRemote() {
  if (!ROOT?.isConnected) return;
  await fetchData().catch(() => {});
  if (!ROOT?.isConnected) return;
  const filtersBusy = $('.ms.open', ROOT) || ROOT.contains(document.activeElement) && /^(INPUT|SELECT)$/.test(document.activeElement.tagName);
  if (filtersBusy) drawBody(); else draw();
}

async function fetchData() {
  D = await api.get('/quedas');
  rosterRows = D.roster;
  roster = new Map(D.roster.map((r) => [r.login, r]));
}

// Carteira: aparece em cada análise quando há mais de uma na força-tarefa
const multi = () => new Set(D.rows.map((r) => r.carteira || r.portfolio || 'PAN')).size > 1 || D.portfolio !== 'PAN';
const pfChip = (pf, force = false) => ((force || multi()) ? html`<span class="chip qd-pf ${String(pf || 'PAN').startsWith('PAN') ? 'outline' : 'warn'}">${pf || 'PAN'}</span>` : '');
const mine = (r) => (r.portfolio || 'PAN') === D.portfolio;
const managerOf = (leader) => D.leaders.find((l) => key(l.leader) === key(leader))?.manager || '';
const managers = () => [...new Set([...D.leaders.map((l) => l.manager), ...(CTX.store.meta.operators || []).map((o) => o.manager_name)].filter(Boolean))].sort();

// Operador pelo login ou pelo nome (com ou sem acento); entre homônimos, prefere quem está ativo
export function findOperator(q, rows = rosterRows) {
  const raw = String(q || '').trim();
  if (!raw) return null;
  const tagged = raw.match(/[·(]\s*([\w.-]+)\s*\)?\s*$/);
  const byLogin = new Map(rows.map((r) => [r.login, r]));
  if (tagged && byLogin.get(tagged[1].toLowerCase())) return byLogin.get(tagged[1].toLowerCase());
  const lg = raw.toLowerCase().replace(/\s+/g, '');
  if (byLogin.get(lg)) return byLogin.get(lg);
  const k = key(raw);
  const pick = (list) => { const act = list.filter((r) => r.active); return act.length === 1 ? act[0] : list.length === 1 ? list[0] : null; };
  const exact = rows.filter((r) => r.name_key === k);
  if (exact.length) return pick(exact);
  const words = k.split(' ').filter((w) => w.length > 1);
  if (words.length >= 2) {
    const all = rows.filter((r) => { const n = r.name_key.split(' '); return words.every((w) => n.some((x) => x.startsWith(w))); });
    if (all.length) return pick(all);
  }
  return null;
}

function filtered() {
  const f = state.f;
  const q = key(state.q);
  return D.rows.filter((r) => {
    if (state.view !== 'todas' && groupOf(r) !== state.view) return false;
    for (const [id, , , get] of FILTERS) if (f[id]?.length && !f[id].includes(String(get(r) ?? ''))) return false;
    if (state.from && dayOf(r.call_at) < state.from) return false;
    if (state.to && dayOf(r.call_at) > state.to) return false;
    if (q && !key([r.contact_id, r.login, r.operator_name, r.leader, r.tabulation, r.notes, r.audio_file].join(' ')).includes(q)) return false;
    return true;
  });
}
const inList = (r) => (state.list === 'todos' ? true : state.list === 'desvio' ? r.conduct : state.list === 'interna' ? r.disconnect === 'Interna' : r.status === state.list);

function draw() {
  destroyAll();
  const opts = (id, get, label = (v) => v) => {
    const m = new Map();
    for (const r of D.rows) { const v = String(get(r) ?? ''); if (v) m.set(v, (m.get(v) || 0) + 1); }
    return [...m].sort((a, b) => String(label(a[0])).localeCompare(String(label(b[0])))).map(([v, n]) => [v, label(v), n]);
  };
  const labelOf = { login: (v) => `${title(roster.get(v)?.name || D.rows.find((r) => r.login === v)?.operator_name || v)} · ${v}`, verdict: (v) => VERDICT[v]?.[0] || 'Pendente', leader: title, manager: title, analyst: (v) => v };
  ROOT.innerHTML = String(html`<div class="qd">
    <div class="page-head qd-head"><div><h2>Queda de ligação ${D.portfolio !== 'PAN' || multi() ? html`<span class="chip qd-pf-me ${D.portfolio === 'PAN' ? 'outline' : 'warn'}" title="Sua carteira">${D.portfolio}</span>` : ''}</h2><p>Força-tarefa: ouça o áudio, confirme quem encerrou a ligação e se a tabulação de queda procede. Os números atualizam sozinhos para todo mundo.</p></div>
      <div class="grow"></div>
      <div class="qd-actions">
        <button class="btn sm" id="qd-folder">${icon('folder')}Pasta de áudios</button>
        <button class="btn sm" id="qd-csv">${icon('upload')}Importar CSV</button>
        <button class="btn sm" id="qd-trs">${icon('file')}Transcrições</button>
        <button class="btn sm" id="qd-export">${icon('download')}Exportar CSV</button>
        <button class="btn sm" id="qd-cap">${icon('users')}Capacity${D.roster.length ? '' : html` <b class="qd-dot"></b>`}</button>
        <button class="btn sm primary" id="qd-new">${icon('plus')}Nova análise</button>
      </div></div>
    ${!D.roster.length ? html`<div class="banner warn">${icon('alert')}<div><b>Anexe o capacity</b> para a plataforma trazer liderança, gerência e campanha ao digitar o login ou o nome do operador. <button class="btn sm" id="qd-cap2">Anexar capacity</button></div></div>` : ''}
    <div class="filters qd-filters" id="qd-filters">
      <div class="seg qd-view" id="qd-view" title="Visão consolidada ou apartada">${[['todas', 'Consolidada'], ...GROUPS.map((g) => [g, g])].map(([k, l]) => html`<button class="${state.view === k ? 'on' : ''}" data-v="${k}">${l}</button>`)}</div>
      ${FILTERS.map(([id, all, noun, get]) => multiSelect({ id: `qf-${id}`, allLabel: all, noun, options: opts(id, get, labelOf[id]), selected: state.f[id] || [], cls: 'sm' }))}
      <input class="input sm" type="date" id="qd-from" value="${state.from}" aria-label="De"><input class="input sm" type="date" id="qd-to" value="${state.to}" aria-label="Até">
      <input class="input sm qd-q" id="qd-q" placeholder="Buscar ID, login, observação…" value="${state.q}">
      ${Object.values(state.f).some((v) => v?.length) || state.from || state.to || state.q ? html`<button class="btn sm ghost" id="qd-clear">${icon('x')}Limpar</button>` : ''}
    </div>
    <div id="qd-body"></div>
  </div>`);
  for (const [id] of FILTERS) bindMultiSelect(ROOT, `qf-${id}`, (v) => { state.f[id] = v; state.page = 0; draw(); });
  $('#qd-from', ROOT).onchange = (e) => { state.from = e.target.value; state.page = 0; draw(); };
  $('#qd-to', ROOT).onchange = (e) => { state.to = e.target.value; state.page = 0; draw(); };
  $('#qd-q', ROOT).addEventListener('input', debounce((e) => { state.q = e.target.value; state.page = 0; drawBody(); }, 250));
  $('#qd-clear', ROOT)?.addEventListener('click', () => { state.f = {}; state.from = ''; state.to = ''; state.q = ''; state.page = 0; draw(); });
  $('#qd-folder', ROOT).onclick = () => openFolder();
  $('#qd-csv', ROOT).onclick = openImport;
  $('#qd-export', ROOT).onclick = openExport;
  $('#qd-trs', ROOT).onclick = openTranscripts;
  $$('#qd-view button', ROOT).forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.v; state.page = 0; draw(); }));
  $('#qd-cap', ROOT).onclick = openCapacity;
  $('#qd-cap2', ROOT)?.addEventListener('click', openCapacity);
  $('#qd-new', ROOT).onclick = () => openReview(null);
  drawBody();
}

function stats(rows) {
  const done = rows.filter((r) => r.status === 'analisada');
  const conduct = done.filter((r) => r.conduct);
  const wrong = done.filter((r) => r.tab_correct === false);
  const ok = done.filter((r) => r.tab_correct === true);
  const int = rows.filter((r) => r.disconnect === 'Interna');
  const intDone = int.filter((r) => r.status === 'analisada');
  return { rows, done, conduct, wrong, ok, int, intDone, intConduct: intDone.filter((r) => r.conduct) };
}

function drawBody() {
  const box = $('#qd-body', ROOT);
  if (!box) return;
  destroyAll();
  const rows = filtered();
  const s = stats(rows);
  if (!D.rows.length) {
    box.innerHTML = String(emptyState('phoneOff', 'Nenhum atendimento na força-tarefa ainda', 'Importe o CSV de metadados do discador ou lance um atendimento em “Nova análise”.'));
    return;
  }
  const locks = D.rows.filter((r) => r.locked_by && r.locked_by !== D.me);
  box.innerHTML = String(html`
    <div class="qd-kpis">
      ${kpi('Atendimentos', rows.length, `${rows.length - s.done.length} pendente(s)`)}
      ${kpi('Analisados', s.done.length, `${pctTxt(s.done.length, rows.length)} do total`, 'brand', s.done.length && rows.length ? pct(s.done.length, rows.length) : null)}
      ${kpi('Desvio de conduta', s.conduct.length, `${pctTxt(s.conduct.length, s.done.length)} dos analisados`, s.conduct.length ? 'bad' : '')}
      ${kpi('Tabulação incorreta', pctTxt(s.wrong.length, s.wrong.length + s.ok.length), `${s.wrong.length} de ${s.wrong.length + s.ok.length} com conclusão`, s.wrong.length ? 'warn' : '')}
      ${kpi('Queda procede', pctTxt(s.ok.length, s.wrong.length + s.ok.length), `${s.ok.length} cliente ou linha`, 'ok')}
      ${kpi('Desconexão interna', pctTxt(s.int.length, rows.length), s.intDone.length ? `${pctTxt(s.intConduct.length, s.intDone.length)} delas foram o operador` : `${s.int.length} atendimento(s)`, s.intConduct.length ? 'bad' : '')}
    </div>
    <div class="qd-grid">
      <section class="card qd-card"><div class="qd-ch"><h3>Desconexão × resultado</h3><span class="sub">quem encerrou, por tipo de desconexão</span></div>${discBlock(rows)}</section>
      <section class="card qd-card"><div class="qd-ch"><h3>Ofensores</h3><span class="sub">desvios e tabulações incorretas</span></div>${offenders(s.done)}</section>
      <section class="card qd-card"><div class="qd-ch"><h3>Dispersão por operador</h3><span class="sub">quedas tabuladas × % incorreta</span></div><div class="qd-chart"><canvas id="qd-sc" aria-label="Dispersão por operador"></canvas></div><div class="qd-legend"><span><i style="background:var(--bad)"></i>com desvio de conduta</span><span><i style="background:var(--brand)"></i>sem desvio</span></div></section>
    </div>
    ${conductCards(s.conduct)}
    <div class="qd-grid two">
      <section class="card qd-card"><div class="qd-ch"><h3>Por liderança</h3><span class="sub">gerência · liderança</span></div>${byLeader(rows)}</section>
      <section class="card qd-card"><div class="qd-ch"><h3>Andamento da força-tarefa</h3><span class="sub">análises por pessoa</span></div>${progress(rows, locks)}</section>
    </div>
    <section class="card qd-card qd-listcard">
      <div class="qd-ch"><div class="seg" id="qd-tabs">${Object.entries(LIST).map(([k, l]) => html`<button class="${state.list === k ? 'on' : ''}" data-l="${k}">${l} <em>${rows.filter((r) => (k === 'todos' ? true : k === 'desvio' ? r.conduct : k === 'interna' ? r.disconnect === 'Interna' : r.status === k)).length}</em></button>`)}</div>
        <div class="grow"></div>${CTX.can('admin') ? html`<button class="btn sm ghost" id="qd-del-sel" hidden>${icon('trash')}Excluir selecionados</button>` : ''}</div>
      <div id="qd-list"></div>
    </section>`);
  $$('#qd-tabs [data-l]', box).forEach((b) => b.addEventListener('click', () => { state.list = b.dataset.l; state.page = 0; drawBody(); }));
  $$('[data-op]', box).forEach((b) => b.addEventListener('click', () => { state.f.login = [b.dataset.op]; state.list = b.dataset.list || 'todos'; state.page = 0; draw(); }));
  $$('[data-ld]', box).forEach((b) => b.addEventListener('click', () => { state.f.leader = [b.dataset.ld]; state.page = 0; draw(); }));
  $$('[data-dv]', box).forEach((b) => b.addEventListener('click', () => { state.f.disconnect = [b.dataset.dv]; if (b.dataset.v) state.f.verdict = [b.dataset.v]; state.page = 0; draw(); }));
  $$('[data-open]', box).forEach((b) => b.addEventListener('click', () => openReview(Number(b.dataset.open))));
  drawScatter(s.done, rows);
  drawList(rows);
}

function kpi(label, val, foot, tone = '', meter = null) {
  return html`<div class="qd-kpi ${tone}"><span>${label}</span><b class="num">${val}</b><small>${foot}</small>${meter != null ? html`<i class="qd-meter"><i style="width:${meter}%"></i></i>` : ''}</div>`;
}

function discBlock(rows) {
  const groups = [['Interna', 'Interna'], ['Externa', 'Externa'], ['—', 'Sem informação']].map(([k, l]) => [k, l, rows.filter((r) => (r.disconnect || '—') === k)]).filter(([, , g]) => g.length);
  if (!groups.length) return html`<p class="qd-none">Sem atendimentos no filtro.</p>`;
  return html`<div class="qd-disc">${groups.map(([k, l, g]) => {
    const done = g.filter((r) => r.verdict);
    const parts = Object.keys(VERDICT).map((v) => [v, done.filter((r) => r.verdict === v).length]).filter(([, n]) => n);
    const op = done.filter((r) => r.verdict === 'operador').length;
    return html`<div class="qd-disc-row">
      <div class="qd-disc-top"><b>${l}</b><span class="num">${g.length} · ${done.length} analisado(s)</span>${op ? html`<span class="chip bad">${pctTxt(op, done.length)} operador</span>` : ''}</div>
      <div class="qd-stack">${parts.length ? parts.map(([v, n]) => html`<button style="flex:${n};background:var(${VCOLOR[v]})" title="${VERDICT[v][0]}: ${n}" data-dv="${k}" data-v="${v}" aria-label="${l}: ${VERDICT[v][0]} ${n}"></button>`) : html`<i class="qd-stack-empty" style="flex:1"></i>`}${g.length > done.length ? html`<i class="qd-stack-pend" style="flex:${g.length - done.length}" title="Pendentes: ${g.length - done.length}"></i>` : ''}</div>
    </div>`;
  })}
    <div class="qd-legend">${Object.entries(VERDICT).map(([v, [l]]) => html`<span><i style="background:var(${VCOLOR[v]})"></i>${l}</span>`)}<span><i class="pend"></i>Pendente</span></div>
  </div>`;
}

function byOperator(rows) {
  const m = new Map();
  for (const r of rows) {
    const k0 = r.login || key(r.operator_name);
    if (!k0) continue;
    const k = `${r.portfolio || 'PAN'}|${k0}`;
    const o = m.get(k) || m.set(k, { portfolio: r.portfolio || 'PAN', login: r.login, name: r.operator_name || roster.get(r.login)?.name || r.login, leader: r.leader, manager: r.manager, campaign: r.campaign, rows: [] }).get(k);
    o.rows.push(r);
  }
  return [...m.values()];
}

function offenders(done) {
  const ops = byOperator(done).map((o) => ({ ...o, conduct: o.rows.filter((r) => r.conduct).length, wrong: o.rows.filter((r) => r.tab_correct === false).length }))
    .filter((o) => o.conduct || o.wrong).sort((a, b) => b.conduct - a.conduct || b.wrong - a.wrong || b.rows.length - a.rows.length).slice(0, 7);
  if (!ops.length) return html`<p class="qd-none">${done.length ? 'Nenhum desvio ou tabulação incorreta até agora.' : 'Os ofensores aparecem conforme as análises são salvas.'}</p>`;
  const max = Math.max(...ops.map((o) => o.conduct + o.wrong));
  return html`<ol class="qd-off">${ops.map((o) => html`<li><button data-op="${o.login || ''}">
    <span class="qd-off-n"><b>${short(o.name)} ${pfChip(o.portfolio)}</b><small>${o.login || ''} · ${short(o.leader) || 'sem liderança'}</small></span>
    <span class="qd-off-bar"><i class="c" style="width:${(o.conduct / max) * 100}%"></i><i class="w" style="width:${((o.wrong - Math.min(o.wrong, o.conduct)) / max) * 100}%"></i></span>
    <span class="qd-off-v num">${o.conduct ? html`<em class="bad">${o.conduct}</em>` : ''}${o.wrong}/${o.rows.length}</span></button></li>`)}</ol>
    <p class="qd-foot"><i class="dot bad"></i>desvio de conduta · <i class="dot warn"></i>tabulação incorreta · número = incorretas/analisadas</p>`;
}

function drawScatter(done, rows) {
  const canvas = $('#qd-sc', ROOT);
  if (!canvas) return;
  const ops = byOperator(rows).map((o) => {
    const d = o.rows.filter((r) => r.status === 'analisada');
    const concl = d.filter((r) => r.tab_correct != null);
    return { ...o, total: o.rows.length, concl: concl.length, wrong: concl.filter((r) => r.tab_correct === false).length, conduct: d.filter((r) => r.conduct).length };
  }).filter((o) => o.concl);
  if (!ops.length) { canvas.parentElement.innerHTML = '<p class="qd-none">A dispersão aparece com as primeiras análises concluídas.</p>'; return; }
  const c = palette();
  const pt = (o) => ({ x: o.total, y: pct(o.wrong, o.concl), label: short(o.name), o });
  const xmax = Math.max(5, ...ops.map((o) => o.total)) + 1;
  scatterChart(canvas, [
    { label: 'Sem desvio', color: c.brand, data: ops.filter((o) => !o.conduct).map(pt) },
    { label: 'Com desvio', color: c.bad, data: ops.filter((o) => o.conduct).map(pt), radius: 7 },
  ], {
    xmin: 0, xmax, ymin: 0, ymax: 100, xLabel: 'quedas tabuladas', yLabel: '% incorreta',
    tooltip: (ctx) => { const o = ctx.raw.o; return ` ${ctx.raw.label}: ${o.total} queda(s), ${o.wrong}/${o.concl} incorreta(s)${o.conduct ? `, ${o.conduct} desvio(s)` : ''}`; },
    onClick: (p) => { if (p.o.login) { state.f.login = [p.o.login]; state.page = 0; draw(); } },
  });
}

function conductCards(conduct) {
  if (!conduct.length) return '';
  const ops = byOperator(conduct).sort((a, b) => b.rows.length - a.rows.length);
  const totalOf = (o) => D.rows.filter((r) => r.login === o.login && (r.portfolio || 'PAN') === o.portfolio && r.status === 'analisada').length;
  return html`<section class="qd-conduct"><div class="qd-ch"><h3>${icon('alert')}Desvios de conduta</h3><span class="sub">operadores que desligaram com o cliente na linha</span></div>
    <div class="qd-cards">${ops.map((o) => {
      const types = {};
      for (const r of o.rows) types[r.conduct_type || 'Desligou com o cliente na linha'] = (types[r.conduct_type || 'Desligou com o cliente na linha'] || 0) + 1;
      const last = o.rows.map((r) => r.call_at || r.analyzed_at).sort().pop();
      const int = o.rows.filter((r) => r.disconnect === 'Interna').length;
      return html`<article class="qd-op">
        <header>${avatar(title(o.name), 'sm')}<div><b>${title(o.name)} ${pfChip(o.portfolio)}</b><small>${o.login || '—'} · ${title(o.leader) || 'sem liderança'}${o.manager ? ` · ${title(o.manager)}` : ''}</small></div><span class="qd-op-n num" title="desvios / analisados">${o.rows.length}<small>/${totalOf(o)}</small></span></header>
        <div class="qd-op-tags">${Object.entries(types).map(([t, n]) => html`<span class="chip bad">${t}${n > 1 ? ` · ${n}` : ''}</span>`)}${int ? html`<span class="chip outline">${int} interna(s)</span>` : ''}</div>
        <footer><span>Último: ${dt(last)}</span><button class="btn sm ghost" data-op="${o.login || ''}" data-list="desvio">Ver atendimentos${icon('chevRight')}</button></footer>
      </article>`;
    })}</div></section>`;
}

function byLeader(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = `${r.portfolio || 'PAN'}|${r.leader || '—'}`;
    const o = m.get(k) || m.set(k, { portfolio: r.portfolio || 'PAN', leader: r.leader, manager: r.manager, rows: [] }).get(k);
    o.rows.push(r);
  }
  const list = [...m.values()].map((o) => { const s = stats(o.rows); return { ...o, s }; }).sort((a, b) => b.s.conduct.length - a.s.conduct.length || b.rows.length - a.rows.length);
  return html`<div class="table-wrap qd-tbl-wrap"><table class="tbl qd-tbl"><thead><tr><th>Liderança</th><th class="right">Quedas</th><th class="right">Analisadas</th><th class="right">Desvios</th><th class="right">Incorreta</th><th class="right">Interna</th></tr></thead>
    <tbody>${list.map((o) => html`<tr class="click" data-ld="${o.leader || ''}"><td><b>${short(o.leader) || 'Sem liderança'}</b> ${pfChip(o.portfolio)}<small>${title(o.manager) || 'gerência a definir'}</small></td>
      <td class="right num">${o.rows.length}</td><td class="right num">${o.s.done.length}</td>
      <td class="right num">${o.s.conduct.length ? html`<span class="chip bad">${o.s.conduct.length}</span>` : '0'}</td>
      <td class="right num">${pctTxt(o.s.wrong.length, o.s.wrong.length + o.s.ok.length)}</td><td class="right num">${pctTxt(o.s.int.length, o.rows.length)}</td></tr>`)}</tbody></table></div>`;
}

function progress(rows, locks) {
  const m = new Map();
  const today = new Date().toISOString().slice(0, 10);
  for (const r of rows.filter((x) => x.status === 'analisada')) {
    const k = r.analyst_id || r.analyst_name || '—';
    const o = m.get(k) || m.set(k, { name: r.analyst_name || '—', pf: D.analyst_portfolio?.[r.analyst_id] || r.portfolio || 'PAN', n: 0, today: 0, conduct: 0 }).get(k);
    o.n++; if ((r.analyzed_at || '').slice(0, 10) === today) o.today++; if (r.conduct) o.conduct++;
  }
  const list = [...m.values()].sort((a, b) => b.n - a.n);
  const done = rows.filter((r) => r.status === 'analisada').length;
  return html`<div class="qd-prog">
    <div class="qd-prog-bar"><i style="width:${pct(done, rows.length) || 0}%"></i></div>
    <p class="qd-foot">${done} de ${rows.length} analisados · ${rows.length - done} na fila</p>
    ${locks.length ? html`<div class="qd-live">${locks.slice(0, 6).map((r) => html`<span class="chip brand"><i class="qd-pulse"></i>${r.locked_name} · ${r.contact_id || short(r.operator_name)}</span>`)}</div>` : ''}
    ${list.length ? html`<ul class="qd-people">${list.map((o) => html`<li>${avatar(o.name, 'sm')}<b>${o.name} ${pfChip(o.pf)}</b><span class="num">${o.n}<small>${o.today ? ` · ${o.today} hoje` : ''}</small></span></li>`)}</ul>` : html`<p class="qd-none">Ninguém analisou ainda.</p>`}
  </div>`;
}

function drawList(rows) {
  const box = $('#qd-list', ROOT);
  const list = rows.filter(inList);
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  state.page = Math.min(state.page, pages - 1);
  const pg = list.slice(state.page * PAGE, state.page * PAGE + PAGE);
  if (!list.length) { box.innerHTML = '<p class="qd-none" style="padding:24px">Nada nesta lista com os filtros atuais.</p>'; return; }
  const admin = CTX.can('admin');
  box.innerHTML = String(html`<div class="table-wrap"><table class="tbl qd-tbl qd-list"><thead><tr>${admin ? html`<th><input type="checkbox" id="qd-all" aria-label="Selecionar todos"></th>` : ''}<th>Ligação</th><th>Operador</th><th>Liderança</th><th class="right">Duração</th><th>Tabulação</th><th>Desconexão</th><th>Resultado</th><th>Anexos</th><th>Analista</th></tr></thead>
    <tbody>${pg.map((r) => html`<tr class="click ${r.conduct ? 'qd-row-bad' : ''}" data-open="${r.id}">
      ${admin ? html`<td data-nocl><input type="checkbox" class="qd-sel" value="${r.id}" aria-label="Selecionar"></td>` : ''}
      <td><b class="num">${r.contact_id || '—'}</b> ${pfChip(r.carteira || r.portfolio)}<small>${dt(r.call_at)}</small></td>
      <td><b>${short(r.operator_name) || r.login || '—'}</b><small>${r.login || ''}${r.campaign ? ` · ${title(r.campaign)}` : ''}</small></td>
      <td><span>${short(r.leader) || '—'}</span><small>${short(r.manager)}</small></td>
      <td class="right num">${fmtDur(r.duration_sec)}</td>
      <td><span class="qd-tab ${isDrop(r.tabulation) ? 'is-drop' : ''}">${r.tabulation || '—'}</span>${r.tab_correct === false && r.correct_tab ? html`<small>→ ${r.correct_tab}</small>` : ''}</td>
      <td>${r.disconnect ? html`<span class="chip ${r.disconnect === 'Interna' ? 'warn' : 'outline'}">${r.disconnect}</span>` : html`<span class="muted">—</span>`}</td>
      <td>${r.locked_by && r.locked_by !== D.me ? html`<span class="chip brand"><i class="qd-pulse"></i>${r.locked_name}</span>` : r.verdict ? html`<span class="chip ${VERDICT[r.verdict][1]}">${VERDICT[r.verdict][0]}</span>${r.conduct && r.verdict !== 'operador' ? html` <span class="chip bad">Desvio</span>` : ''}` : html`<span class="chip">Pendente</span>`}</td>
      <td class="qd-att">${r.audio_path || r.audio_url ? html`<span title="Áudio anexado">${icon('audio')}</span>` : ''}${r.transcript_name ? html`<span title="Transcrição anexada">${icon('file')}</span>` : ''}</td>
      <td><small>${r.analyst_name || ''}</small></td></tr>`)}</tbody></table></div>
    ${pages > 1 ? html`<div class="qd-pager"><button class="btn sm ghost" id="qd-prev" ${state.page ? '' : 'disabled'}>${icon('chevLeft')}</button><span>${state.page + 1} de ${pages} · ${list.length} atendimentos</span><button class="btn sm ghost" id="qd-next" ${state.page < pages - 1 ? '' : 'disabled'}>${icon('chevRight')}</button></div>` : ''}`);
  $$('tr[data-open]', box).forEach((tr) => tr.addEventListener('click', (e) => { if (e.target.closest('[data-nocl]')) return; openReview(Number(tr.dataset.open), list); }));
  $('#qd-prev', box)?.addEventListener('click', () => { state.page--; drawList(rows); });
  $('#qd-next', box)?.addEventListener('click', () => { state.page++; drawList(rows); });
  const delBtn = $('#qd-del-sel', ROOT);
  const sync = () => { const n = $$('.qd-sel:checked', box).length; if (delBtn) { delBtn.hidden = !n; delBtn.lastChild.textContent = `Excluir ${n} selecionado(s)`; } };
  $('#qd-all', box)?.addEventListener('change', (e) => { $$('.qd-sel', box).forEach((c) => { c.checked = e.target.checked; }); sync(); });
  $$('.qd-sel', box).forEach((c) => c.addEventListener('change', sync));
  if (delBtn) delBtn.onclick = async () => {
    const ids = $$('.qd-sel:checked', box).map((c) => Number(c.value));
    if (!ids.length || !(await confirmDialog('Excluir atendimentos', `${ids.length} atendimento(s) saem da força-tarefa, com a análise e os anexos. Não dá para desfazer.`, { ok: 'Excluir', danger: true }))) return;
    try { const r = await api.post('/quedas/delete', { ids }); toast(`${r.deleted} atendimento(s) excluído(s).`); await fetchData(); draw(); } catch (ex) { toast(ex.message, 'err'); }
  };
}

// ---------------------------------------------------------------- Pasta de áudios
async function openFolder(pf = D.portfolio) {
  const url = pf === D.portfolio ? D.folder : D.folders?.[pf];
  if (url) { window.open(url, '_blank', 'noopener'); return; }
  if (pf !== D.portfolio || !D.can_manage) { toast(`A pasta de áudios da carteira ${pf} ainda não foi configurada.`, 'err', 5000); return; }
  folderDialog();
}
function folderDialog() {
  modal({
    title: `Pasta de áudios · ${D.portfolio}`,
    body: html`<p class="t2" style="margin-top:0">Cole o link da pasta do SharePoint/OneDrive com os áudios da carteira ${D.portfolio}. O botão “Pasta de áudios” abre esse link para quem analisa essa carteira. O link fica só no banco da plataforma.</p>
      <div class="field"><label for="qd-furl">Link da pasta</label><input class="input" id="qd-furl" value="${D.folder || ''}" placeholder="https://paschoalotto-my.sharepoint.com/…"></div>`,
    foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="qd-fsave">Salvar</button>`,
    onMount: (m, close) => {
      $('#qd-fsave', m).onclick = async (e) => {
        const btnEl = e.currentTarget;
        busy(btnEl, true, 'Salvando');
        try { await api.put('/quedas/folder', { url: $('#qd-furl', m).value }); D.folder = $('#qd-furl', m).value.trim() || null; close(); toast('Link da pasta salvo.'); }
        catch (ex) { toast(ex.message, 'err'); busy(btnEl, false); }
      };
    },
  });
}

// ---------------------------------------------------------------- Capacity
const hk = (s) => key(s).replace(/ /g, '');
const col = (row, ...names) => { for (const [k, v] of Object.entries(row)) { const kk = hk(k); if (names.some((n) => (n.endsWith('*') ? kk.startsWith(n.slice(0, -1)) : kk === n))) return v; } return null; };

// Colunas do capacity pelo sentido do cabeçalho (cada carteira usa nomes diferentes)
const CAP_COLS = {
  login: (k) => /login|usuario|^user/.test(k) && !/supervis|lider|gerent|coord/.test(k),
  name: (k) => /^(operador|colaborador|nome|funcionario|agente|atendente|consultor|assessor)/.test(k) && !/supervis|lider|gerent|coord|cliente|destino|login/.test(k),
  leader: (k) => /lider|supervis|coordena|^gestor|^sup$/.test(k) && !/destino|gerent/.test(k),
  manager: (k) => /gerent|gerencia/.test(k),
  campaign: (k) => /^(campanha|fila|celula|operacao|ilha)/.test(k),
  segment: (k) => /^(segmento|carteira|produto)/.test(k) && !/destino/.test(k),
  status: (k) => /^(situacao|status)/.test(k),
  shift: (k) => /^(turno|horario)/.test(k),
  registration: (k) => /^(nc|matricula|re|bpm|chapa)$/.test(k),
  dest: (k) => /carteiradestino/.test(k),
};
const cleanLogin = (v) => String(v ?? '').trim().replace(/^.*\\/, '').replace(/@.*$/, '').replace(/\s+/g, '').toLowerCase();

export function capacityRows(sheets) {
  const out = [];
  const summary = [];
  const skipped = [];
  for (const { name, matrix } of sheets) {
    // Cabeçalho: a primeira linha (entre as 30 primeiras) com login e nome do operador
    let hi = -1, map = null;
    for (let i = 0; i < Math.min(matrix.length, 30) && hi < 0; i++) {
      const keys = matrix[i].map((v) => hk(v));
      const pick = (f) => keys.findIndex((k) => k && f(k));
      const m = Object.fromEntries(Object.entries(CAP_COLS).map(([c, f]) => [c, pick(f)]));
      if (m.login >= 0 && m.name >= 0) { hi = i; map = m; }
    }
    if (hi < 0) { skipped.push([name, (matrix.find((r) => r.filter((v) => v != null && v !== '').length >= 2) || []).filter((v) => v != null && v !== '').slice(0, 8).join(', ')]); continue; }
    const head = matrix[hi];
    const kind = /deslig|demit/i.test(name) ? 'DESLIGADO' : /remanej|transfer/i.test(name) ? 'REMANEJADO' : /afast/i.test(name) ? 'AFASTADO' : null;
    const get = (r, c) => (map[c] >= 0 && r[map[c]] != null && String(r[map[c]]).trim() !== '' ? String(r[map[c]]).trim() : null);
    let n = 0;
    for (const r of matrix.slice(hi + 1)) {
      const login = cleanLogin(get(r, 'login'));
      const nm = get(r, 'name');
      if (!login || !nm || hk(nm) === hk(head[map.name])) continue;
      const st = get(r, 'status');
      const gone = kind === 'DESLIGADO' || kind === 'REMANEJADO' || /deslig|demit|remanej|transfer/i.test(st || '');
      const dest = get(r, 'dest');
      out.push({
        login, name: nm, registration: get(r, 'registration'), shift: get(r, 'shift'),
        status: kind ? (kind === 'REMANEJADO' && dest ? `REMANEJADO · ${dest}` : kind) : (st || 'ATIVO'),
        campaign: kind ? null : get(r, 'campaign'), segment: kind ? null : get(r, 'segment'),
        leader: get(r, 'leader'), manager: kind ? null : get(r, 'manager'), active: !gone && kind !== 'AFASTADO',
      });
      n++;
    }
    const used = Object.entries(map).filter(([c, i]) => i >= 0 && c !== 'dest').map(([c, i]) => `${CAP_LABEL[c]}: ${head[i]}`);
    summary.push([name, n, kind, used]);
  }
  return { rows: out, summary, skipped };
}
const CAP_LABEL = { login: 'login', name: 'operador', leader: 'liderança', manager: 'gerência', campaign: 'campanha', segment: 'segmento', status: 'situação', shift: 'turno', registration: 'matrícula' };

function openCapacity() {
  // Cada um anexa o próprio capacity; gerências e pasta seguem a regra da carteira
  const canEdit = D.can_manage;
  const active = D.roster.filter((r) => r.active);
  const leaders = [...new Set(active.map((r) => r.leader).filter(Boolean))].sort();
  const mgrs = managers();
  modal({
    title: `Capacity e gerências · carteira ${D.portfolio}`, wide: true, cls: 'qd-modal',
    body: html`
      <div class="qd-cap-top">
        <div><b class="num">${active.length}</b><span>operadores ativos</span></div>
        <div><b class="num">${leaders.length}</b><span>lideranças</span></div>
        <div><b>${D.roster_updated_at ? fmtRel(D.roster_updated_at) : '—'}</b><span>${D.roster_file || 'nenhum capacity anexado'}</span></div>
      </div>
      <p class="tiny muted" style="margin:-4px 0 12px">${D.roster_own ? 'Você está usando o seu próprio capacity.' : D.roster.length ? `Você está usando o capacity de outra pessoa da carteira ${D.portfolio}. Anexe o seu para usar só o seu.` : ''} O capacity que você anexar vale só para você${D.portfolio !== 'PAN' ? ` (e como reserva para a carteira ${D.portfolio})` : ' (e como reserva para a carteira PAN)'}: não muda o de outros usuários nem o de outras carteiras.</p>
      <label class="qd-drop" id="qd-capdrop">${icon('upload')}<span><b>Anexar capacity atualizado</b><small>.xlsx ou .csv com login e nome do operador (e, se tiver, liderança, gerência, campanha e segmento). Vale só para você; abas de desligados e remanejados também são lidas.</small></span><input type="file" accept=".xlsx,.xlsm,.xls,.csv" id="qd-capfile" hidden></label>
        <div id="qd-cappv"></div>
      <h4 class="qd-h4">Gerência de cada liderança</h4>
      <p class="tiny muted" style="margin-top:-4px">Quando o capacity tem a coluna de gerência, ela entra sozinha.${D.portfolio === 'PAN' ? ' Sem ela, a gerência vem dos operadores já cadastrados na plataforma; ajuste aqui quando precisar.' : ' Sem ela, preencha a gerência de cada liderança da carteira.'} Vale também para os atendimentos já lançados.</p>
      ${leaders.length ? html`<div class="qd-leaders">${leaders.map((l) => html`<div class="qd-leader"><span><b>${title(l)}</b><small>${active.filter((r) => r.leader === l).length} operador(es) · ${[...new Set(active.filter((r) => r.leader === l).map((r) => title(r.segment)).filter(Boolean))].join(', ')}</small></span>
        <input class="input sm" list="qd-mgrs" data-leader="${l}" value="${managerOf(l)}" placeholder="Gerência" ${canEdit ? '' : 'disabled'}></div>`)}</div><datalist id="qd-mgrs">${mgrs.map((m) => html`<option value="${m}">`)}</datalist>` : html`<p class="qd-none">Anexe o capacity para listar as lideranças.</p>`}
      ${canEdit ? html`<h4 class="qd-h4">Pasta de áudios da carteira ${D.portfolio}</h4><div class="row" style="gap:8px"><input class="input sm" id="qd-furl2" value="${D.folder || ''}" placeholder="Link da pasta no SharePoint" style="flex:1"><button class="btn sm" id="qd-fsave2">Salvar link</button></div>` : ''}`,
    foot: html`<button class="btn" data-close>Fechar</button>`,
    onMount: (m) => {
      $$('[data-leader]', m).forEach((inp) => inp.addEventListener('change', async () => {
        try { await api.put('/quedas/leaders', { leader: inp.dataset.leader, manager: inp.value }); const l = D.leaders.find((x) => x.leader === inp.dataset.leader); if (l) l.manager = inp.value; else D.leaders.push({ portfolio: D.portfolio, leader: inp.dataset.leader, manager: inp.value }); toast(`Gerência de ${short(inp.dataset.leader)} salva.`); }
        catch (ex) { toast(ex.message, 'err'); }
      }));
      $('#qd-fsave2', m)?.addEventListener('click', async () => {
        try { await api.put('/quedas/folder', { url: $('#qd-furl2', m).value }); D.folder = $('#qd-furl2', m).value.trim() || null; toast('Link da pasta salvo.'); } catch (ex) { toast(ex.message, 'err'); }
      });
      $('#qd-capfile', m)?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const pv = $('#qd-cappv', m);
        pv.innerHTML = '<p class="qd-none">Lendo o capacity…</p>';
        try {
          const { rows, summary, skipped } = capacityRows(await parseWorkbook(file));
          const act = rows.filter((r) => r.active);
          if (!act.length) {
            pv.innerHTML = String(html`<div class="qd-pv qd-pv-err"><p><b>Não encontrei operadores ativos em ${file.name}.</b> O capacity precisa ter uma coluna de login (LOGIN, LOGIN OLOS, USUÁRIO…) e uma de nome (OPERADOR, NOME, COLABORADOR…), em qualquer linha do topo.</p>
              <ul>${[...summary.map(([n, c, k, used]) => html`<li>${n}: ${c} linha(s)${k ? ` (${k.toLowerCase()})` : ''} · ${used.join(' · ')}</li>`), ...skipped.map(([n, h]) => html`<li>${n}: colunas não reconhecidas${h ? html` · começa com <i>${h}</i>` : ' · aba vazia'}</li>`)]}</ul></div>`);
            return;
          }
          const cur = new Set(D.roster.filter((r) => r.active && r.scope === D.me).map((r) => r.login));
          const nw = new Set(act.map((r) => r.login.toLowerCase()));
          const added = [...nw].filter((l) => !cur.has(l)).length;
          const left = [...cur].filter((l) => !nw.has(l)).length;
          const sample = act.slice(0, 3).map((r) => `${title(r.name)} · ${r.login}${r.leader ? ` · ${short(r.leader)}` : ''}${r.campaign ? ` · ${r.campaign}` : ''}`);
          pv.innerHTML = String(html`<div class="qd-pv"><p><b>${file.name}</b></p><ul>${summary.map(([n, c, k, used]) => html`<li>${n}: <b>${c}</b> ${k ? `(${k.toLowerCase()})` : 'operador(es)'}<small class="qd-cols">${used.join(' · ')}</small></li>`)}${skipped.map(([n]) => html`<li class="muted">${n}: ignorada (sem login e nome)</li>`)}</ul>
            <p class="tiny">Exemplo: ${sample.join(' | ')}</p>
            ${act.some((r) => !r.leader) ? html`<p class="tiny" style="color:var(--warn-ink)">${act.filter((r) => !r.leader).length} operador(es) sem liderança no arquivo.</p>` : ''}
            ${D.roster_own ? html`<p class="tiny">No seu capacity: ${added} entram, ${left} saem do ativo (continuam nas análises antigas).</p>` : ''}
            <button class="btn primary sm" id="qd-capgo">${icon('check')}Atualizar ${act.length} operadores ativos</button></div>`);
          $('#qd-capgo', pv).onclick = async (ev) => {
            const btnEl = ev.currentTarget;
            busy(btnEl, true, 'Atualizando');
            try {
              const r = await api.post('/quedas/roster', { rows, file: file.name });
              toast(`Capacity atualizado: ${r.active} ativos${r.removed ? `, ${r.removed} saíram` : ''}.${r.missing_manager ? ` ${r.missing_manager} liderança(s) sem gerência: preencha abaixo.` : ''}`, 'ok', 6000);
              await fetchData(); draw();
              m.closest('.overlay')?.remove();
              openCapacity();
            } catch (ex) { toast(ex.message, 'err'); busy(btnEl, false); }
          };
        } catch (ex) { pv.innerHTML = ''; toast(ex.message, 'err', 5000); }
      });
    },
  });
}

// ---------------------------------------------------------------- Exportar CSV (modelo da planilha de controle)
function lastCarteira() { try { return localStorage.getItem('px_qd_carteira') || ''; } catch { return ''; } }
const hms = (s) => (s == null ? '' : [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((x) => String(x).padStart(2, '0')).join(':'));
const brDate = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');
const tabLabel = (t) => (isMute(t) ? 'Ligação Muda' : isDrop(t) ? 'Queda de Ligação' : t || '');
const CSV_COLS = [
  ['Nome', (r) => String(r.operator_name || '').toUpperCase()],
  ['Login', (r) => r.login || ''],
  ['Contrato', (r) => r.contract || ''],
  ['Telefone', (r) => r.phone || ''],
  ['Data', (r) => brDate(r.call_at || r.analyzed_at)],
  ['Tempo Ligação', (r) => hms(r.duration_sec)],
  ['Classificação Operador', (r) => tabLabel(r.tabulation)],
  ['Classificação Correta', (r) => (r.tab_correct === true ? tabLabel(r.tabulation) : r.tab_correct === false ? r.correct_tab || 'Desconhecido' : '')],
  ['Status Classificação', (r) => (r.tab_correct === true ? 'Correto' : r.tab_correct === false ? 'Incorreto' : '')],
  ['Desconexão', (r) => r.disconnect || ''],
  ['Prestou Atendimento?', (r) => (r.attended === true ? 'Prestou Atendimento' : r.attended === false ? 'Não Prestou Atendimento' : '')],
  ['Segurou Ligação?', (r) => (r.held === true ? 'Sim' : r.held === false ? 'Não' : '')],
  ['Observação', (r) => r.notes || ''],
  ['Carteira', (r) => r.carteira || ''],
  ['ID Contato', (r) => r.contact_id || ''],
  ['Hora', (r) => (r.call_at ? r.call_at.slice(11, 16) : '')],
  ['Liderança', (r) => r.leader || ''],
  ['Gerência', (r) => r.manager || ''],
  ['Campanha', (r) => r.campaign || ''],
  ['Resultado da Análise', (r) => (r.verdict ? VERDICT[r.verdict][0] : 'Pendente')],
  ['Desvio de Conduta', (r) => (r.conduct ? 'Sim' : 'Não')],
  ['Tipo de Desvio', (r) => (r.conduct ? r.conduct_type || '' : '')],
  ['Momento da Queda', (r) => r.drop_moment || ''],
  ['Analista', (r) => r.analyst_name || ''],
  ['Data da Análise', (r) => brDate(r.analyzed_at)],
];
// CSV para o Excel brasileiro: separador ";", UTF-8 com BOM e todas as células entre aspas
export function dropsCsv(rows) {
  const q = (v) => `"${String(v ?? '').replace(/\r?\n/g, ' ').replace(/"/g, '""')}"`;
  return '\uFEFF' + [CSV_COLS.map(([h]) => q(h)).join(';'), ...rows.map((r) => CSV_COLS.map(([, f]) => q(f(r))).join(';'))].join('\r\n');
}

function openExport() {
  const views = [['todas', 'Consolidada (todas as carteiras)'], ...GROUPS.map((g) => [`g:${g}`, `${g} (todas as carteiras ${g})`]), ...CARTEIRAS.map((c) => [`c:${c}`, `Só ${c}`]), ['c:', 'Carteira a definir']];
  const cur = state.view === 'todas' ? 'todas' : `g:${state.view}`;
  const hasFilters = Object.values(state.f).some((v) => v?.length) || state.from || state.to || state.q;
  const pick = (v, useFilters, onlyDone) => {
    const base = useFilters ? filtered() : D.rows;
    return base.filter((r) => (v === 'todas' ? true : v.startsWith('g:') ? groupOf(r) === v.slice(2) : (r.carteira || '') === v.slice(2)))
      .filter((r) => !onlyDone || r.status === 'analisada')
      .sort((a, b) => String(a.operator_name || '').localeCompare(String(b.operator_name || '')) || String(a.call_at || '').localeCompare(String(b.call_at || '')));
  };
  modal({
    title: 'Exportar análises de queda (CSV)', cls: 'qd-modal',
    body: html`<p class="t2" style="margin-top:0">Mesmas colunas da planilha de controle (Nome, Login, Contrato, Telefone, Data, Tempo Ligação, Classificação Operador e Correta, Status, Desconexão, Prestou Atendimento?, Segurou Ligação?, Observação), seguidas de carteira, liderança, gerência, resultado e analista.</p>
      <div class="field"><label for="ex-view">Visão</label><select class="select" id="ex-view">${views.map(([k, l]) => html`<option value="${k}" ${k === cur ? 'selected' : ''}>${l}</option>`)}</select></div>
      <label class="check"><input type="checkbox" id="ex-done" checked> Só atendimentos já analisados</label><br>
      <label class="check" style="margin-top:8px"><input type="checkbox" id="ex-filt" ${hasFilters ? 'checked' : ''} ${hasFilters ? '' : 'disabled'}> Aplicar os filtros da tela (período, operador, liderança…)</label>
      <p class="tiny muted" id="ex-n" style="margin-top:12px"></p>`,
    foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="ex-go">${icon('download')}Baixar CSV</button>`,
    onMount: (m, close) => {
      // A visão escolhida aqui vale por cima da visão da tela
      const rowsNow = () => {
        const saved = state.view; state.view = 'todas';
        try { return pick($('#ex-view', m).value, $('#ex-filt', m).checked, $('#ex-done', m).checked); } finally { state.view = saved; }
      };
      const count = () => { const n = rowsNow().length; $('#ex-n', m).textContent = `${n} atendimento(s) no arquivo.`; $('#ex-go', m).disabled = !n; };
      ['#ex-view', '#ex-done', '#ex-filt'].forEach((sel) => { $(sel, m).onchange = count; });
      count();
      $('#ex-go', m).onclick = () => {
        const v = $('#ex-view', m).value;
        const label = v === 'todas' ? 'consolidado' : (v.slice(2) || 'a-definir').toLowerCase().replace(/\s+/g, '-');
        saveBlob(new Blob([dropsCsv(rowsNow())], { type: 'text/csv;charset=utf-8' }), `quedas_${label}_${new Date().toISOString().slice(0, 10)}.csv`);
        close(); toast('CSV gerado.');
      };
    },
  });
}

// ---------------------------------------------------------------- Transcrições em lote
// Um documento com várias transcrições: cada uma começa no nome do arquivo de áudio (que traz o IdContato)
const AUDIO_NAME = /[\w\-.()]+\.(?:wav|mp3|gsm|ogg|opus|m4a|wma|flac|amr)\b/i;
export function splitByAudio(lines) {
  const out = [];
  let cur = null;
  for (const { text, heading } of lines) {
    const t = String(text || '').trim();
    const m = t.match(AUDIO_NAME);
    const starts = m && t.length < 300 && (heading || t === m[0] || /^(arquivo|[aá]udio|grava[cç][aã]o)\b/i.test(t) || t.replace(m[0], '').trim().length < 3);
    if (starts) { cur = { audio: m[0], lines: [] }; out.push(cur); continue; }
    if (cur) cur.lines.push(t);
  }
  return out.map((x) => ({ ...x, ...audioMeta(x.audio), transcript: x.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() })).filter((x) => x.contact_id && x.transcript);
}
// O nome do arquivo do discador: IdContato_Telefone_CPF_CLIENTE_Contrato_…_login_ddmmaa_hhmm.wav (ou …_IdContato.wav)
export function audioMeta(name) {
  const base = String(name || '').replace(/\.[a-z0-9]+$/i, '');
  const parts = base.split('_');
  const id = (base.match(/^(\d{6,10})_/) || base.match(/_(\d{6,10})$/) || [])[1] || (/^\d{6,10}$/.test(base) ? base : '');
  const dm = base.match(/_([a-z][\w.]{2,30})_(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})$/i);
  return {
    contact_id: id, audio_file: name,
    login: dm ? dm[1].toLowerCase() : '',
    call_at: dm ? `20${dm[4]}-${dm[3]}-${dm[2]} ${dm[5]}:${dm[6]}` : '',
    phone: /^\d{10,11}$/.test(parts[1] || '') ? parts[1] : '',
  };
}

function openTranscripts() {
  let items = null, meta = null, docName = '';
  modal({
    title: 'Importar transcrições', wide: true, cls: 'qd-modal',
    body: html`<p class="t2" style="margin-top:0">Documento com várias transcrições (.docx ou .txt), uma por áudio, cada uma começando pelo nome do arquivo de áudio. Cada transcrição é anexada ao atendimento do mesmo IdContato; os que ainda não estão na plataforma são criados, com o operador e a desconexão do CSV de metadados (opcional, mas recomendado).</p>
      <label class="qd-drop">${icon('file')}<span><b>Documento com as transcrições</b><small id="tr-docname">.docx ou .txt</small></span><input type="file" accept=".docx,.txt" id="tr-doc" hidden></label>
      <label class="qd-drop">${icon('upload')}<span><b>CSV de metadados do discador (opcional)</b><small id="tr-metaname">Traz login, data, duração, finalização e o tipo de desconexão (Interna/Externa)</small></span><input type="file" accept=".csv,.xlsx,.txt" id="tr-meta" hidden></label>
      <div class="field"><label for="tr-cart">Carteira</label><select class="select" id="tr-cart"><option value="">Escolha a carteira…</option>${CARTEIRAS.map((c) => html`<option ${lastCarteira() === c ? 'selected' : ''}>${c}</option>`)}</select></div>
      <div id="tr-pv"></div>`,
    foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="tr-go" disabled>${icon('check')}Importar</button>`,
    onMount: (m, close) => {
      const go = $('#tr-go', m);
      const merged = () => (items || []).map((x) => {
        const r = meta?.get(x.contact_id);
        return { ...x, ...(r ? { login: r.login || x.login, call_at: r.call_at || x.call_at, duration: r.duration, phone: r.phone || x.phone, tabulation: r.tabulation, disconnect: r.disconnect, dialer_campaign: r.dialer_campaign, operation: r.operation, contract: r.contract, customer: r.customer, audio_original: r.audio_original } : {}), _meta: !!r };
      });
      const preview = () => {
        if (!items) return;
        const list = merged();
        const mineIds = new Set(D.rows.filter(mine).map((r) => r.contact_id));
        const known = list.filter((x) => mineIds.has(x.contact_id)).length;
        const withMeta = list.filter((x) => x._meta).length;
        const int = list.filter((x) => /^intern/i.test(String(x.disconnect || ''))).length;
        const ext = list.filter((x) => /^extern/i.test(String(x.disconnect || ''))).length;
        const logins = [...new Set(list.map((x) => String(x.login || '').toLowerCase()).filter(Boolean))];
        const out = logins.filter((l) => !roster.has(l));
        $('#tr-pv', m).innerHTML = String(html`<div class="qd-pv">
          <p><b>${docName}</b> · ${list.length} transcrição(ões) · ${logins.length} operador(es)</p>
          <ul><li><b>${known}</b> já na plataforma: a transcrição é anexada</li><li><b>${list.length - known}</b> novo(s): o atendimento é criado</li>
            <li>${meta ? html`<b>${withMeta}</b> com metadados · desconexão <b>${int}</b> interna e <b>${ext}</b> externa${list.length - withMeta ? html` · ${list.length - withMeta} sem linha no CSV (ficam com o login e a data do nome do arquivo)` : ''}` : 'Sem CSV de metadados: login e data vêm do nome do arquivo; a desconexão fica em branco.'}</li></ul>
          ${out.length ? html`<p class="tiny" style="color:var(--warn-ink)">${out.length} login(s) fora do seu capacity: ${out.join(', ')}. Eles entram sem liderança; anexe o capacity da carteira deles para completar.</p>` : ''}
        </div>`);
        go.disabled = !list.length || !$('#tr-cart', m).value;
        go.lastChild.textContent = `Importar ${list.length} transcrição(ões)`;
      };
      $('#tr-cart', m).onchange = preview;
      $('#tr-doc', m).onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          const { name, lines } = await readTranscriptLines(f);
          items = splitByAudio(lines); docName = name;
          if (!items.length) throw new Error('Não encontrei transcrições começando pelo nome do arquivo de áudio com o IdContato (ex.: 43516759_…wav).');
          $('#tr-docname', m).textContent = `${name} · ${items.length} transcrição(ões)`;
          preview();
        } catch (ex) { items = null; toast(ex.message, 'err', 6000); }
      };
      $('#tr-meta', m).onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          const rows = metadataRows(await parseSheetFile(f));
          if (!rows.length) throw new Error('Não encontrei a coluna IdContato no CSV.');
          meta = new Map(rows.map((r) => [r.contact_id, r]));
          $('#tr-metaname', m).textContent = `${f.name} · ${rows.length} linha(s)`;
          preview();
        } catch (ex) { meta = null; toast(ex.message, 'err', 6000); }
      };
      go.onclick = async (e) => {
        const btnEl = e.currentTarget;
        busy(btnEl, true, 'Importando');
        try {
          const carteira = $('#tr-cart', m).value;
          try { localStorage.setItem('px_qd_carteira', carteira); } catch { /* sem storage */ }
          const r = await api.post('/quedas/import-transcripts', { items: merged().map(({ _meta, lines, audio, ...x }) => x), carteira, file: docName });
          close();
          toast(`${r.attached} transcrição(ões) anexada(s), ${r.created} atendimento(s) criado(s)${r.others ? ` · ${r.others} ignorado(s) (outra carteira/pessoa)` : ''}.`, 'ok', 8000);
          await fetchData(); draw();
        } catch (ex) { toast(ex.message, 'err', 6000); busy(btnEl, false); }
      };
    },
  });
}

// ---------------------------------------------------------------- CSV de metadados
export function metadataRows(rows) {
  return rows.map((r) => ({
    contact_id: String(col(r, 'idcontato', 'idligacao', 'idchamada', 'id') || '').trim(),
    dialer_campaign: col(r, 'campanha'), operation: col(r, 'operacao'), login: col(r, 'login', 'usuario'),
    call_at: col(r, 'datahoraligacao', 'datahora', 'data'), duration: col(r, 'duracao', 'tempo'),
    tabulation: col(r, 'finalizacao', 'tabulacao'), contract: col(r, 'contrato'), phone: col(r, 'telefone', 'fone', 'celular'), customer: col(r, 'cliente', 'nomecliente'),
    audio_file: col(r, 'nomedoarquivo', 'arquivo'), audio_original: col(r, 'nomeoriginaldoarquivo'),
    disconnect: col(r, 'tipodedesconexao', 'desconexao', 'tipodesconexao'),
  })).filter((r) => r.contact_id);
}

// Planilha de análises (o CSV exportado pela plataforma ou a planilha de controle, já preenchidos)
export const isAnalysisSheet = (rows) => !!rows.length && Object.keys(rows[0]).some((k) => ['statusclassificacao', 'classificacaocorreta', 'resultadodaanalise', 'prestouatendimento'].includes(hk(k)));
const yesNo = (v) => { const k = key(v); return !k || k === '—' ? undefined : /^(nao|n)\b/.test(k) || k.includes('nao prestou') ? false : /^(sim|s)\b/.test(k) || k.includes('prestou') ? true : undefined; };
const VERDICT_BY_LABEL = Object.fromEntries(Object.entries(VERDICT).flatMap(([k, [l]]) => [[key(l), k], [k, k]]));
export function analysisRows(rows) {
  return rows.map((r) => {
    const status = key(col(r, 'statusclassificacao'));
    const tabOk = status.startsWith('correto') ? true : status.startsWith('incorreto') ? false : undefined;
    const desvio = yesNo(col(r, 'desviodeconduta'));
    let verdict = VERDICT_BY_LABEL[key(col(r, 'resultadodaanalise', 'resultado'))];
    let inferred = false;
    // Sem a coluna de resultado: deduz pela Status Classificação (e pelo desvio de conduta, quando houver)
    if (!verdict && (tabOk !== undefined || desvio)) { verdict = desvio ? 'operador' : tabOk ? (isMute(col(r, 'classificacaooperador', 'tabulacao')) ? 'mudo' : 'cliente') : 'concluido'; inferred = true; }
    const type = String(col(r, 'tipodedesvio') || '').trim();
    const cart = String(col(r, 'carteira') || '').trim().toUpperCase();
    const date = String(col(r, 'data') || '').trim();
    const hour = String(col(r, 'hora') || '').trim();
    const out = {
      contact_id: String(col(r, 'idcontato', 'idligacao') || '').trim() || undefined,
      login: String(col(r, 'login') || '').trim() || undefined,
      operator_name: String(col(r, 'nome', 'operador') || '').trim() || undefined,
      contract: String(col(r, 'contrato') || '').trim() || undefined,
      phone: String(col(r, 'telefone') || '').trim() || undefined,
      call_at: date ? `${date}${hour ? ` ${hour}` : ''}` : undefined,
      duration_sec: String(col(r, 'tempoligacao', 'duracao') || '').trim() || undefined,
      tabulation: String(col(r, 'classificacaooperador', 'tabulacao') || '').trim() || undefined,
      tab_correct: tabOk,
      correct_tab: tabOk === false ? String(col(r, 'classificacaocorreta') || '').trim() || undefined : undefined,
      disconnect: /^intern/.test(key(col(r, 'desconexao'))) ? 'Interna' : /^extern/.test(key(col(r, 'desconexao'))) ? 'Externa' : undefined,
      attended: yesNo(col(r, 'prestouatendimento')),
      held: yesNo(col(r, 'segurouligacao')),
      notes: String(col(r, 'observacao') || '').trim() || undefined,
      verdict,
      conduct: verdict === 'operador' ? true : desvio,
      conduct_type: (verdict === 'operador' || desvio) ? (CONDUCT.find((c) => key(c) === key(type)) || (type ? 'Outro desvio de conduta' : 'Desligou durante o atendimento')) : undefined,
      drop_moment: String(col(r, 'momentodaqueda') || '').trim() || undefined,
      carteira: CARTEIRAS.includes(cart) ? cart : undefined,
      leader: String(col(r, 'lideranca') || '').trim() || undefined,
      manager: String(col(r, 'gerencia') || '').trim() || undefined,
      _inferred: inferred,
    };
    return out;
  }).filter((r) => r.contact_id || r.login || r.operator_name);
}

function openImport() {
  let parsed = null;
  let fileName = '';
  let mode = 'meta';
  modal({
    title: 'Importar CSV', wide: true, cls: 'qd-modal',
    body: html`<p class="t2" style="margin-top:0"><b>Planilha de análises:</b> o CSV exportado pela plataforma (ou a planilha de controle) preenchido volta para cá e as análises são contabilizadas sozinhas. <b>CSV do discador:</b> o CSV de metadados traz IdContato, login, data, duração, finalização, arquivo do áudio e o tipo de desconexão (Interna/Externa). Cada linha vira um atendimento da carteira <b>${D.portfolio}</b>, já com liderança, gerência e campanha do seu capacity. O CPF não é guardado.</p>
      <label class="qd-drop">${icon('upload')}<span><b>Escolher o arquivo (.csv ou .xlsx)</b><small>A plataforma reconhece sozinha se é a planilha de análises ou o CSV do discador (IdContato; Login; DataHoraLigacao; Duracao; FINALIZACAO; NomeDoArquivo; TIPO DE DESCONEXÃO).</small></span><input type="file" accept=".csv,.xlsx,.txt" id="qd-csvf" hidden></label>
      <div class="field" style="margin-top:4px"><label for="qd-csvcart">Carteira dos atendimentos</label><select class="select" id="qd-csvcart"><option value="">Escolha a carteira…</option>${CARTEIRAS.map((c) => html`<option ${lastCarteira() === c ? 'selected' : ''}>${c}</option>`)}</select></div>
      <div id="qd-csvpv"></div>`,
    foot: html`<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="qd-csvgo" disabled>${icon('upload')}Importar</button>`,
    onMount: (m, close) => {
      const go = $('#qd-csvgo', m);
      const chosen = () => (parsed ? (mode === 'meta' && $('#qd-onlydrop', m)?.checked ? parsed.filter((r) => isDrop(r.tabulation)) : parsed) : []);
      $('#qd-csvcart', m).onchange = () => sync();
      // Na planilha de análises, a carteira escolhida só vale para as linhas sem a coluna Carteira
      const needCart = () => (mode === 'meta' ? true : chosen().some((r) => !r.carteira && !D.rows.some((x) => x.contact_id && x.contact_id === r.contact_id && x.carteira)));
      const sync = () => { const n = chosen().length; go.disabled = !n || (needCart() && !$('#qd-csvcart', m).value); go.lastChild.textContent = n ? (mode === 'meta' ? `Importar ${n} atendimento(s)` : `Contabilizar ${n} análise(s)`) : 'Importar'; };
      $('#qd-csvf', m).onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        fileName = file.name;
        try {
          const raw = await parseSheetFile(file);
          if (isAnalysisSheet(raw)) {
            mode = 'analises';
            parsed = analysisRows(raw);
            if (!parsed.length) throw new Error('A planilha de análises não tem linhas com ID Contato, login ou nome.');
            const byCid = new Map(D.rows.filter((x) => x.contact_id).map((x) => [x.contact_id, x]));
            const known = parsed.filter((r) => r.contact_id && byCid.has(r.contact_id)).length;
            const noId = parsed.filter((r) => !r.contact_id).length;
            const inferred = parsed.filter((r) => r._inferred).length;
            const desv = parsed.filter((r) => r.conduct).length;
            const st = { c: parsed.filter((r) => r.tab_correct === true).length, i: parsed.filter((r) => r.tab_correct === false).length };
            $('#qd-csvpv', m).innerHTML = String(html`<div class="qd-pv">
              <p><b>${file.name}</b> · planilha de análises · ${parsed.length} linha(s)</p>
              <ul><li><b>${known}</b> atendimento(s) já na plataforma pelo ID Contato: a análise é atualizada</li>
                ${noId ? html`<li><b>${noId}</b> linha(s) sem ID Contato: procuradas por login + data + duração; se não existirem, entram como atendimento novo</li>` : ''}
                ${parsed.length - known - noId ? html`<li><b>${parsed.length - known - noId}</b> com ID que ainda não está na plataforma: entram como atendimento novo</li>` : ''}
                <li>${st.c} correta(s) · ${st.i} incorreta(s) · ${desv} com desvio de conduta</li></ul>
              ${inferred ? html`<p class="tiny" style="color:var(--warn-ink)">${inferred} linha(s) sem a coluna "Resultado da Análise": o resultado é deduzido pela Status Classificação (Correto = cliente desligou, Incorreto = atendimento seguiu) e pela coluna "Desvio de Conduta" quando houver.</p>` : ''}
              <p class="tiny muted">Só as colunas preenchidas mudam a análise. Linhas de outra carteira ou de análises de outra pessoa (sem permissão) são ignoradas.</p>
            </div>`);
            $('#qd-csvcart', m).closest('.field').querySelector('label').textContent = 'Carteira para as linhas sem a coluna Carteira';
            sync();
            return;
          }
          mode = 'meta';
          $('#qd-csvcart', m).closest('.field').querySelector('label').textContent = 'Carteira dos atendimentos';
          parsed = metadataRows(raw);
          if (!parsed.length) throw new Error('Não encontrei a coluna IdContato no arquivo.');
          const tabs = {};
          for (const r of parsed) tabs[r.tabulation || '—'] = (tabs[r.tabulation || '—'] || 0) + 1;
          const drops = parsed.filter((r) => isDrop(r.tabulation)).length;
          const int = parsed.filter((r) => key(r.disconnect).startsWith('intern')).length;
          const unknown = [...new Set(parsed.map((r) => String(r.login || '').toLowerCase()).filter((l) => l && !roster.has(l)))];
          const known = new Set(D.rows.filter(mine).map((r) => r.contact_id));
          const again = parsed.filter((r) => known.has(r.contact_id)).length;
          $('#qd-csvpv', m).innerHTML = String(html`<div class="qd-pv">
            <p><b>${file.name}</b> · ${parsed.length} linha(s) · ${drops} com tabulação de queda ou ligação muda · ${int} desconexão interna${again ? ` · ${again} já na força-tarefa (só os dados do discador são atualizados)` : ''}</p>
            <div class="qd-tabs">${Object.entries(tabs).sort((a, b) => b[1] - a[1]).map(([t, n]) => html`<span class="chip ${isDrop(t) ? 'warn' : 'outline'}">${t} · ${n}</span>`)}</div>
            <label class="check"><input type="checkbox" id="qd-onlydrop" ${drops ? 'checked' : ''}> Importar só as tabulações de queda e ligação muda</label>
            ${unknown.length ? html`<p class="tiny" style="color:var(--warn-ink)">${unknown.length} login(s) fora do capacity: ${unknown.slice(0, 8).join(', ')}${unknown.length > 8 ? '…' : ''}. Eles entram sem liderança; atualize o capacity se precisar.</p>` : ''}
          </div>`);
          $('#qd-onlydrop', m).onchange = sync;
          sync();
        } catch (ex) { parsed = null; $('#qd-csvpv', m).innerHTML = ''; sync(); toast(ex.message, 'err', 5000); }
      };
      go.onclick = async (e) => {
        const btnEl = e.currentTarget;
        const rows = chosen();
        if (!rows.length) return;
        busy(btnEl, true, 'Importando');
        try {
          const carteira = $('#qd-csvcart', m).value;
          try { localStorage.setItem('px_qd_carteira', carteira); } catch { /* sem storage */ }
          if (mode === 'analises') {
            const r = await api.post('/quedas/import-analyses', { rows: rows.map(({ _inferred, ...x }) => x), file: fileName, carteira });
            close();
            const skip = [r.others ? `${r.others} de outra carteira/pessoa` : '', r.locked ? `${r.locked} em análise agora` : '', r.invalid ? `${r.invalid} inválida(s)` : ''].filter(Boolean).join(', ');
            toast(`Planilha contabilizada: ${r.updated} análise(s) atualizada(s), ${r.created} nova(s)${r.unchanged ? `, ${r.unchanged} sem mudança` : ''}${skip ? ` · ignoradas: ${skip}` : ''}.`, 'ok', 8000);
            await fetchData(); draw();
            return;
          }
          const r = await api.post('/quedas/import', { rows, batch: fileName, carteira });
          close();
          toast(`${r.created} atendimento(s) na fila${r.updated ? `, ${r.updated} atualizado(s)` : ''}.`, 'ok', 5000);
          await fetchData(); draw();
        } catch (ex) { toast(ex.message, 'err'); busy(btnEl, false); }
      };
    },
  });
}

// ---------------------------------------------------------------- Análise de um atendimento
async function openReview(id, queue = null) {
  let row = {};
  let locked = false;
  let lockTimer = null;
  if (id) {
    try { row = await api.get(`/quedas/${id}`); } catch (ex) { toast(ex.message, 'err'); return; }
  }
  // Atendimento de outra carteira (ou análise de outra pessoa sem permissão): só leitura
  const ro = !!id && !canEditRow(row);
  if (id && !ro) {
    const lk = await api.post(`/quedas/${id}/lock`).catch(() => ({ ok: true }));
    if (!lk.ok && !(await confirmDialog('Atendimento em análise', `${lk.by} está analisando este atendimento agora. Quer abrir mesmo assim? Quem salvar por último fica valendo.`, { ok: 'Abrir mesmo assim' }))) return;
    if (!lk.ok) await api.post(`/quedas/${id}/lock`, { force: true }).catch(() => {});
    locked = true;
    lockTimer = setInterval(() => api.post(`/quedas/${id}/lock`, { force: true }).catch(() => {}), 5 * 60 * 1000);
  }
  const canDelete = id && (CTX.can('admin') || (row.status === 'pendente' && row.created_by === CTX.store.user.id));
  const tabs = [...new Set(D.rows.map((r) => r.tabulation).filter(Boolean))].sort();
  const leaders = [...new Set(rosterRows.map((r) => r.leader).filter(Boolean))].sort();
  const camps = [...new Set(rosterRows.map((r) => r.campaign).filter(Boolean))].sort();
  const segs = [...new Set(rosterRows.map((r) => r.segment).filter(Boolean))].sort();
  const opList = rosterRows.filter((r) => r.active).sort((a, b) => a.name.localeCompare(b.name));
  let audioFile = null;
  let transcript = row.transcript || '';
  let transcriptName = row.transcript_name || '';
  const callLocal = row.call_at ? row.call_at.slice(0, 16) : '';
  const v = row.verdict || '';
  const pf = row.portfolio || D.portfolio;
  const next = () => (queue || []).find((r) => r.id !== id && mine(r) && r.status === 'pendente' && !(r.locked_by && r.locked_by !== D.me));

  const { el: m, close } = modal({
    title: `${id ? `Análise do atendimento ${row.contact_id || `#${id}`}` : 'Nova análise de queda'} · ${pf}`, wide: true, cls: 'qd-modal qd-rev',
    body: html`
      ${ro ? html`<div class="banner warn">${icon('lock')}<div>${pf !== D.portfolio ? html`Atendimento da carteira <b>${pf}</b>: só quem analisa essa carteira altera. Você pode consultar e ouvir o áudio.` : html`Análise de <b>${row.analyst_name}</b>: só a Qualidade altera.`}</div></div>` : ''}
      ${row.analyst_name ? html`<div class="banner info">${icon('info')}<div>Analisado por <b>${row.analyst_name}</b> ${fmtRel(row.analyzed_at)}.</div></div>` : ''}
      <div class="qd-sec"><h4>${icon('headset')}Atendimento</h4>
        <div class="qd-fgrid">
          <div class="field span-2"><label for="r-cart">Carteira analisada</label><select class="select" id="r-cart"><option value="">Escolha a carteira…</option>${CARTEIRAS.map((c) => html`<option ${(row.carteira || (!id ? lastCarteira() : '')) === c ? 'selected' : ''}>${c}</option>`)}</select></div>
          <div class="field"><label for="r-phone">Telefone</label><input class="input" id="r-phone" value="${row.phone || ''}" inputmode="tel" placeholder="DDD + número"></div>
          <div class="field"><label for="r-ctr">Contrato</label><input class="input" id="r-ctr" value="${row.contract || ''}"></div>
          <div class="field"><label for="r-cid">ID do contato</label><input class="input" id="r-cid" value="${row.contact_id || ''}" placeholder="IdContato"></div>
          <div class="field"><label for="r-at">Data e hora</label><input class="input" type="datetime-local" id="r-at" value="${callLocal}"></div>
          <div class="field"><label for="r-dur">Duração</label><input class="input" id="r-dur" value="${row.duration_sec != null ? fmtDur(row.duration_sec) : ''}" placeholder="m:ss"></div>
          <div class="field"><label for="r-tab">Tabulação do operador</label><input class="input" id="r-tab" list="r-tabs" value="${row.tabulation || ''}" placeholder="QUEDA LIGACAO CLIENTE"><datalist id="r-tabs">${['QUEDA LIGACAO CLIENTE', 'QUEDA DE LIGACAO', 'LIGACAO MUDA', ...tabs].filter((t, i, a) => a.indexOf(t) === i).map((t) => html`<option value="${t}">`)}</datalist></div>
          <div class="field span-2"><label>Tipo de desconexão</label><div class="seg" id="r-disc">${['Interna', 'Externa', ''].map((d) => html`<button type="button" data-v="${d}" class="${(row.disconnect || '') === d ? 'on' : ''}">${d || 'Não informado'}</button>`)}</div></div>
          ${row.dialer_campaign || row.operation ? html`<div class="field"><label>Discador</label><div class="qd-ro">${[row.dialer_campaign, row.operation].filter(Boolean).join(' · ')}</div></div>` : ''}
        </div>
        ${row.disconnect === 'Interna' ? html`<p class="qd-hint warn">${icon('alert')}Desconexão <b>interna</b>: a ligação foi encerrada do nosso lado. Confirme no áudio se o cliente realmente abandonou antes de validar a queda.</p>` : ''}
      </div>
      <div class="qd-sec"><h4>${icon('user')}Operador</h4>
        <div class="qd-fgrid">
          <div class="field span-2"><label for="r-op">Login ou nome completo</label><input class="input" id="r-op" list="r-ops" autocomplete="off" value="${row.login ? `${title(row.operator_name || roster.get(row.login)?.name || '')} · ${row.login}`.replace(/^ · /, '') : row.operator_name || ''}" placeholder="Digite o login ou o nome (com ou sem acento)">
            <datalist id="r-ops">${opList.map((o) => html`<option value="${title(o.name)} · ${o.login}">`)}</datalist><small class="qd-found" id="r-found"></small></div>
          <div class="field"><label for="r-ld">Liderança</label><input class="input" id="r-ld" list="r-lds" value="${row.leader || ''}"><datalist id="r-lds">${leaders.map((l) => html`<option value="${l}">`)}</datalist></div>
          <div class="field"><label for="r-mg">Gerência</label><input class="input" id="r-mg" list="r-mgs" value="${row.manager || ''}"><datalist id="r-mgs">${managers().map((l) => html`<option value="${l}">`)}</datalist></div>
          <div class="field"><label for="r-cp">Campanha / setor</label><input class="input" id="r-cp" list="r-cps" value="${row.campaign || ''}"><datalist id="r-cps">${camps.map((l) => html`<option value="${l}">`)}</datalist></div>
          <div class="field"><label for="r-sg">Segmento</label><input class="input" id="r-sg" list="r-sgs" value="${row.segment || ''}"><datalist id="r-sgs">${segs.map((l) => html`<option value="${l}">`)}</datalist></div>
        </div>
      </div>
      <div class="qd-sec"><h4>${icon('audio')}Áudio e transcrição</h4>
        <div class="qd-audio">
          <button type="button" class="btn sm" id="r-folder">${icon('folder')}Abrir pasta de áudios${icon('external')}</button>
          ${row.audio_file || row.audio_original ? html`<button type="button" class="btn sm ghost" id="r-copy" title="${row.audio_file || row.audio_original}">${icon('copy')}Copiar nome do arquivo</button>` : ''}
        </div>
        <div class="qd-fgrid">
          <div class="field span-2"><label for="r-aurl">Link do áudio analisado</label><input class="input" id="r-aurl" value="${row.audio_url || ''}" placeholder="Cole o link do arquivo na pasta (Copiar link)"></div>
          <div class="field span-2"><label for="r-afname">Nome do áudio</label><input class="input qd-mono" id="r-afname" value="${row.audio_original || row.audio_file || ''}" placeholder="ex.: asp-t2-epro202610271619_43514503.wav"></div>
          <div class="field span-2"><label>Arquivo do áudio</label><label class="qd-file">${icon('upload')}<span id="r-aname">${row.audio_name || 'Anexar áudio (.wav, .mp3…)'}</span><input type="file" accept="audio/*,.wav,.mp3,.gsm,.ogg,.opus,.m4a" id="r-afile" hidden></label>
            ${row.audio_path ? html`<div class="qd-player" id="r-player"><button type="button" class="btn sm" id="r-play">${icon('play')}Ouvir áudio anexado</button>${canEditRow(row) ? html`<button type="button" class="btn-icon" id="r-adel" aria-label="Remover áudio">${icon('trash')}</button>` : ''}</div>` : ''}</div>
        </div>
        <div class="field"><label for="r-tr">Transcrição <span class="muted tiny" id="r-trname">${transcriptName && transcriptName !== 'Transcrição colada' ? `· ${transcriptName}` : ''}</span></label>
          <div class="qd-trbar"><label class="btn sm ghost">${icon('file')}Anexar arquivo (.txt, .docx)<input type="file" accept=".txt,.docx,.vtt,.srt,.json" id="r-trfile" hidden></label></div>
          <textarea class="textarea qd-tr" id="r-tr" placeholder="Cole aqui a transcrição (Atendente: … / Cliente: …)">${transcript}</textarea></div>
      </div>
      <div class="qd-sec"><h4>${icon('target')}Resultado da análise</h4>
        <div class="qd-verdicts" id="r-verdict">${Object.entries(VERDICT).map(([k, [l, tone, d]]) => html`<button type="button" class="qd-vd ${tone} ${v === k ? 'on' : ''}" data-v="${k}"><b>${l}</b><small>${d}</small></button>`)}</div>
        <div class="qd-fgrid">
          <div class="field"><label>A tabulação procede?</label><div class="seg" id="r-tabok">${[['1', 'Sim'], ['0', 'Não'], ['', 'Sem conclusão']].map(([k, l]) => html`<button type="button" data-v="${k}" class="${(row.tab_correct === true ? '1' : row.tab_correct === false ? '0' : '') === k ? 'on' : ''}">${l}</button>`)}</div></div>
          <div class="field" id="r-ctab-f"><label for="r-ctab">Tabulação correta</label><input class="input" id="r-ctab" list="r-tabs" value="${row.correct_tab || ''}" placeholder="Qual deveria ser"></div>
          <div class="field"><label for="r-mom">Momento da queda</label><input class="input" id="r-mom" value="${row.drop_moment || ''}" placeholder="m:ss no áudio"></div>
          <div class="field span-2"><label>Prestou atendimento?</label><div class="seg" id="r-att">${[['1', 'Prestou atendimento'], ['0', 'Não prestou'], ['', '—']].map(([k, l]) => html`<button type="button" data-v="${k}" class="${(row.attended === true ? '1' : row.attended === false ? '0' : '') === k ? 'on' : ''}">${l}</button>`)}</div></div>
          <div class="field span-2"><label>Segurou a ligação?</label><div class="seg" id="r-held">${[['1', 'Sim'], ['0', 'Não'], ['', '—']].map(([k, l]) => html`<button type="button" data-v="${k}" class="${(row.held === true ? '1' : row.held === false ? '0' : '') === k ? 'on' : ''}">${l}</button>`)}</div></div>
        </div>
        <div class="qd-conduct-box ${row.conduct ? 'on' : ''}" id="r-cbox">
          <label class="switch"><input type="checkbox" id="r-conduct" ${row.conduct ? 'checked' : ''}><span><b>Desvio de conduta</b> · o operador desligou com o cliente na linha</span></label>
          <select class="select sm" id="r-ctype"><option value="">Tipo de desvio…</option>${CONDUCT.map((c) => html`<option ${row.conduct_type === c ? 'selected' : ''}>${c}</option>`)}</select>
        </div>
        <div class="field"><label for="r-notes">Observação / evidência</label><textarea class="textarea" id="r-notes" rows="3" placeholder="O que aconteceu na ligação (ex.: cliente pediu para aguardar e o operador encerrou aos 2:10)">${row.notes || ''}</textarea></div>
      </div>`,
    foot: ro ? html`<button class="btn" data-close>Fechar</button>` : html`${canDelete ? html`<button class="btn ghost danger" id="r-del">${icon('trash')}Excluir</button>` : ''}<div class="grow"></div>
      <button class="btn ghost" data-close>Cancelar</button>
      ${queue ? html`<button class="btn" id="r-savenext">Salvar e próximo${icon('chevRight')}</button>` : ''}
      <button class="btn primary" id="r-save">${icon('check')}Salvar</button>`,
    onClose: () => { clearInterval(lockTimer); if (locked && id) api.post(`/quedas/${id}/unlock`).catch(() => {}); },
  });

  const val = (s) => $(s, m).value.trim();
  const segVal = (s) => $(`${s} button.on`, m)?.dataset.v ?? '';
  const segBind = (s, cb) => $$(`${s} button`, m).forEach((b) => b.addEventListener('click', () => { $$(`${s} button`, m).forEach((x) => x.classList.toggle('on', x === b)); cb?.(b.dataset.v); }));
  segBind('#r-disc');
  segBind('#r-att');
  segBind('#r-held');
  segBind('#r-tabok', () => syncTab());
  const syncTab = () => { $('#r-ctab-f', m).hidden = segVal('#r-tabok') !== '0'; };
  const syncConduct = () => {
    const on = $('#r-conduct', m).checked;
    $('#r-cbox', m).classList.toggle('on', on);
    $('#r-ctype', m).hidden = !on;
  };
  syncTab(); syncConduct();
  let autoConduct = false;
  $$('#r-verdict .qd-vd', m).forEach((b) => b.addEventListener('click', () => {
    const was = b.classList.contains('on');
    $$('#r-verdict .qd-vd', m).forEach((x) => x.classList.toggle('on', x === b && !was));
    const k = was ? '' : b.dataset.v;
    const ok = tabOkFor(k, val('#r-tab'));
    $$('#r-tabok button', m).forEach((x) => x.classList.toggle('on', x.dataset.v === (ok === true ? '1' : ok === false ? '0' : '')));
    // "Operador desligou" é sempre desvio de conduta; ao trocar de resultado, desfaz só a marcação automática
    if (k === 'operador') {
      if (!$('#r-conduct', m).checked) { $('#r-conduct', m).checked = true; autoConduct = true; }
      if (!$('#r-ctype', m).value) $('#r-ctype', m).value = CONDUCT[1];
    } else if (autoConduct) { $('#r-conduct', m).checked = false; $('#r-ctype', m).value = ''; autoConduct = false; }
    if (k === 'concluido' && !val('#r-ctab')) setTimeout(() => $('#r-ctab', m).focus(), 0);
    syncTab(); syncConduct();
  }));
  $('#r-conduct', m).onchange = () => { autoConduct = false; syncConduct(); };

  // Login ou nome → liderança, gerência, campanha e segmento
  const found = $('#r-found', m);
  const applyOp = (fill) => {
    const o = findOperator(val('#r-op'));
    if (!val('#r-op')) { found.textContent = ''; found.className = 'qd-found'; return null; }
    if (!o) { found.textContent = rosterRows.length ? 'Não encontrado no capacity: preencha liderança e campanha à mão.' : 'Anexe o capacity para preencher sozinho.'; found.className = 'qd-found warn'; return null; }
    found.innerHTML = String(html`${icon('checkCircle')}${title(o.name)} · ${o.login} · ${o.status || (o.active ? 'ATIVO' : 'INATIVO')}${o.shift ? ` · ${o.shift}` : ''}`);
    found.className = `qd-found ${o.active ? 'ok' : 'warn'}`;
    if (fill) {
      $('#r-ld', m).value = o.leader || '';
      $('#r-mg', m).value = managerOf(o.leader) || '';
      $('#r-cp', m).value = o.campaign || '';
      $('#r-sg', m).value = o.segment || '';
      $('#r-op', m).value = `${title(o.name)} · ${o.login}`;
    }
    return o;
  };
  $('#r-op', m).addEventListener('input', debounce(() => { const o = findOperator(val('#r-op')); if (o && (val('#r-op').includes('·') || o.login === val('#r-op').toLowerCase())) applyOp(true); else applyOp(false); }, 200));
  $('#r-op', m).addEventListener('change', () => applyOp(true));
  // O capacity carregado é o da carteira do usuário: em atendimento de outra carteira não confere o operador
  if (val('#r-op') && pf === D.portfolio) applyOp(false);
  $('#r-ld', m).addEventListener('change', () => { if (!val('#r-mg') || D.leaders.some((l) => l.manager === val('#r-mg'))) $('#r-mg', m).value = managerOf(val('#r-ld')) || val('#r-mg'); });

  let reopening = false;
  $('#r-cid', m).addEventListener('change', () => {
    if (reopening) return;
    const dup = D.rows.find((r) => (r.portfolio || 'PAN') === pf && r.contact_id && r.contact_id === val('#r-cid') && r.id !== id);
    // Fecha fora do evento de blur (o campo ainda está saindo de foco)
    if (dup && !id) { reopening = true; toast(`O atendimento ${dup.contact_id} já está na força-tarefa: abrindo.`); setTimeout(() => { close(); openReview(dup.id, queue); }, 0); }
    else if (dup) toast(`O ID ${dup.contact_id} já é de outro atendimento da força-tarefa.`, 'err');
  });
  $('#r-folder', m).onclick = () => openFolder(pf);
  if (ro) $$('input, select, textarea, .qd-vd, .seg button, .qd-file, .qd-trbar label', m).forEach((x) => { x.disabled = true; x.classList.add('qd-ro-f'); });
  $('#r-copy', m)?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(row.audio_original || row.audio_file); toast('Nome do arquivo copiado: busque na pasta com Ctrl+F.'); } catch { toast('Não foi possível copiar.', 'err'); } });
  $('#r-afile', m).onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) { toast('Áudio acima de 50 MB.', 'err'); e.target.value = ''; return; }
    audioFile = f; $('#r-aname', m).textContent = `${f.name} · será anexado ao salvar`;
    if (!val('#r-afname')) $('#r-afname', m).value = f.name;
    checkAudio();
  };
  // Áudio já analisado por alguém (qualquer carteira ou usuário): avisa assim que o link ou o nome é informado
  let lastAudioCheck = `${row.audio_url || ''}|${row.audio_original || row.audio_file || ''}`;
  const checkAudio = async () => {
    const url = val('#r-aurl');
    const name = audioFile?.name || val('#r-afname');
    const sig = `${/^https:\/\//i.test(url) ? url : ''}|${name.length >= 5 ? name : ''}`;
    if (sig === '|' || sig === lastAudioCheck || ro) return;
    lastAudioCheck = sig;
    try {
      const { matches } = await api.get(`/quedas/check-audio${qs({ id: id || '', url: sig.split('|')[0], name: sig.split('|')[1] })}`);
      if (matches.length && m.isConnected) alreadyAnalyzed(matches);
    } catch { /* a checagem nunca impede a análise */ }
  };
  const alreadyAnalyzed = (matches) => {
    const pop = modal({
      title: matches.some((x) => x.status === 'analisada') ? 'Este atendimento já foi analisado' : 'Este atendimento está em análise', dismissable: false, cls: 'qd-modal qd-dup',
      body: html`<div class="banner warn">${icon('alert')}<div>O áudio informado já pertence a ${matches.length > 1 ? `${matches.length} atendimentos` : 'um atendimento'} da força-tarefa. Confira antes de analisar de novo.</div></div>
        <div class="qd-dups">${matches.map((x) => html`<article class="qd-dupc">
          <div><b>${x.contact_id ? `Atendimento ${x.contact_id}` : `Lançamento #${x.id}`}</b> ${pfChip(x.carteira || x.portfolio, true)}
            <small>${title(x.operator_name) || x.login || '—'}${x.login ? ` · ${x.login}` : ''}${x.call_at ? ` · ligação ${dt(x.call_at)}` : ''}</small></div>
          <p>${x.status === 'analisada' ? html`Analisado por <b>${x.analyst_name || '—'}</b> ${x.analyzed_at ? fmtRel(x.analyzed_at) : ''} · <span class="chip ${VERDICT[x.verdict]?.[1] || ''}">${VERDICT[x.verdict]?.[0] || 'Analisado'}</span>${x.conduct ? html` <span class="chip bad">Desvio de conduta</span>` : ''}` : ''}
            ${x.live ? html`<span class="chip brand"><i class="qd-pulse"></i>Em análise agora por ${x.locked_name}</span>` : ''}</p>
          <small class="muted">Mesmo ${x.why}</small>
          <button type="button" class="btn sm" data-dup="${x.id}">${icon('eye')}Abrir esta análise</button>
        </article>`)}</div>`,
      foot: html`<button class="btn" id="dup-go">Continuar mesmo assim</button>`,
      onMount: (pm, pclose) => {
        $('#dup-go', pm).onclick = pclose;
        $$('[data-dup]', pm).forEach((b) => b.addEventListener('click', () => { pclose(); close(); openReview(Number(b.dataset.dup)); }));
      },
    });
    return pop;
  };
  $('#r-aurl', m).addEventListener('input', debounce(checkAudio, 700));
  $('#r-aurl', m).addEventListener('change', checkAudio);
  $('#r-afname', m).addEventListener('input', debounce(checkAudio, 900));
  $('#r-afname', m).addEventListener('change', checkAudio);
  $('#r-play', m)?.addEventListener('click', async (e) => {
    const btnEl = e.currentTarget;
    busy(btnEl, true, 'Carregando');
    try { const { url } = await api.get(`/quedas/${id}/audio`); btnEl.replaceWith(Object.assign(document.createElement('audio'), { src: url, controls: true, autoplay: true, className: 'qd-audio-el' })); }
    catch (ex) { toast(ex.message, 'err'); busy(btnEl, false); }
  });
  $('#r-adel', m)?.addEventListener('click', async () => {
    if (!(await confirmDialog('Remover áudio', 'O arquivo anexado sai desta análise.', { ok: 'Remover', danger: true }))) return;
    try { await api.del(`/quedas/${id}/audio`); $('#r-player', m)?.remove(); $('#r-aname', m).textContent = 'Anexar áudio (.wav, .mp3…)'; toast('Áudio removido.'); } catch (ex) { toast(ex.message, 'err'); }
  });
  $('#r-trfile', m).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { const t = await readTranscriptFile(f); $('#r-tr', m).value = t.text; transcriptName = t.name; $('#r-trname', m).textContent = `· ${t.name}`; }
    catch (ex) { toast(ex.message, 'err'); }
  };
  $('#r-tr', m).addEventListener('input', () => { if (!$('#r-tr', m).value.trim()) transcriptName = ''; });
  $('#r-del', m)?.addEventListener('click', async () => {
    if (!(await confirmDialog('Excluir atendimento', 'O atendimento sai da força-tarefa, com a análise e os anexos.', { ok: 'Excluir', danger: true }))) return;
    try { await api.post('/quedas/delete', { ids: [id] }); locked = false; close(); toast('Atendimento excluído.'); await fetchData(); draw(); } catch (ex) { toast(ex.message, 'err'); }
  });

  const save = async (btnEl, goNext) => {
    const verdict = $('#r-verdict .qd-vd.on', m)?.dataset.v || null;
    const o = findOperator(val('#r-op'));
    const opText = val('#r-op');
    if (!opText) { toast('Informe o login ou o nome do operador.', 'err'); $('#r-op', m).focus(); return; }
    const conduct = $('#r-conduct', m).checked;
    if (conduct && !$('#r-ctype', m).value) { toast('Escolha o tipo de desvio de conduta.', 'err'); $('#r-ctype', m).focus(); return; }
    const tabOk = segVal('#r-tabok');
    const dur = val('#r-dur');
    const carteira = $('#r-cart', m).value;
    if (verdict && !carteira) { toast('Escolha a carteira analisada.', 'err'); $('#r-cart', m).focus(); return; }
    const yn = (s) => { const x = segVal(s); return x === '' ? null : x === '1'; };
    const body = {
      carteira, phone: val('#r-phone'), contract: val('#r-ctr'), attended: yn('#r-att'), held: yn('#r-held'),
      contact_id: val('#r-cid'), call_at: val('#r-at') ? `${val('#r-at').replace('T', ' ')}:00` : '', duration_sec: dur ? mmss(dur) : '',
      tabulation: val('#r-tab'), disconnect: segVal('#r-disc'),
      login: o ? o.login : /^[\w.-]+$/.test(opText) ? opText : '', operator_name: o ? o.name : /\s/.test(opText) ? opText.replace(/\s*·.*$/, '') : (row.operator_name || ''),
      leader: val('#r-ld'), manager: val('#r-mg'), campaign: val('#r-cp'), segment: val('#r-sg'),
      ...(val('#r-afname') !== (row.audio_original || row.audio_file || '') ? { audio_file: val('#r-afname') } : {}),
      audio_url: val('#r-aurl'), transcript: $('#r-tr', m).value, transcript_name: transcriptName,
      verdict, conduct, conduct_type: conduct ? $('#r-ctype', m).value : '', tab_correct: tabOk === '' ? null : tabOk === '1',
      correct_tab: tabOk === '0' ? val('#r-ctab') : '', drop_moment: val('#r-mom'), notes: val('#r-notes'), force: true,
    };
    if (body.audio_url && !/^https:\/\//i.test(body.audio_url)) { toast('O link do áudio precisa começar com https://', 'err'); return; }
    if (dur && body.duration_sec == null) { toast('Duração no formato m:ss (ex.: 2:35).', 'err'); return; }
    busy(btnEl, true, 'Salvando');
    try {
      const saved = id ? await api.put(`/quedas/${id}`, body) : await api.post('/quedas', body);
      if (audioFile) {
        try { await api.upload(`/quedas/${saved.id}/audio?name=${encodeURIComponent(audioFile.name)}`, audioFile); }
        catch (ex) { toast(`Análise salva, mas o áudio não foi anexado: ${ex.message}`, 'err', 6000); }
      }
      locked = false;
      if (carteira) try { localStorage.setItem('px_qd_carteira', carteira); } catch { /* sem storage */ }
      close();
      toast(verdict ? `Análise salva${conduct ? ' · desvio de conduta registrado' : ''}.` : 'Atendimento salvo como pendente.');
      await fetchData(); if (ROOT?.isConnected) draw();
      if (goNext) { const n = next(); if (n) openReview(n.id, filtered().filter(inList)); else toast('Não há mais pendentes da sua carteira nesta lista.'); }
    } catch (ex) { toast(ex.message, 'err', 5000); busy(btnEl, false); }
  };
  $('#r-save', m)?.addEventListener('click', (e) => save(e.currentTarget, false));
  $('#r-savenext', m)?.addEventListener('click', (e) => save(e.currentTarget, true));
}

function canEditRow(r) {
  if (CTX.can('admin')) return true;
  if ((r.portfolio || 'PAN') !== D.portfolio) return false;
  return CTX.can('qualidade') || r.status === 'pendente' || r.analyst_id === CTX.store.user.id || r.created_by === CTX.store.user.id;
}

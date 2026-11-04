// Leitura dos relatórios de análise por carteira (HTML) para a importação:
//  • Análise de speech Safra Pay: script com const DATA = { q: [...11 critérios], rows: [...ligações] }
//  • Relatório de conversão e eficiência (e outros do mesmo modelo): HTML estático com indicadores, visão e
//    leitura por login, eficiência por etapa, desfechos, ofensores e plano de ação
import { CARTEIRAS } from './carteira.js';

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// Texto do elemento; quebras de linha (<br>) viram espaço
const t = (el) => { if (!el) return ''; const c = el.cloneNode(true); c.querySelectorAll('br').forEach((b) => b.replaceWith(' ')); return clean(c.textContent); };
const PERIOD_RE = /(\d{2}\/\d{2}(?:\/\d{2,4})?)\s*(?:a|até|-)\s*(\d{2}\/\d{2}(?:\/\d{2,4})?)/i;

// Carteira pelo título do arquivo ("Safra BS", "Safra ADM", "Porto", "PAN")
export function carteiraOfTitle(s) {
  const v = String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/SAFRA\s*(BS\b|PAY)/.test(v)) return 'SAFRA BS';
  if (/SAFRA\s*(ADM|CALL)/.test(v)) return 'SAFRA ADM';
  if (/PORTO/.test(v)) return 'PORTO';
  if (/SAFRA/.test(v)) return 'SAFRA BS';
  if (/\bPAN\b/.test(v)) return 'PAN';
  return null;
}

function speechSafra(doc, text) {
  const i = text.indexOf('const DATA = ');
  if (i < 0) return null;
  let data;
  try {
    // O objeto vai até o primeiro ";\n" depois dele
    const start = i + 'const DATA = '.length;
    const end = text.indexOf(';\n', start);
    data = JSON.parse(text.slice(start, end > 0 ? end : undefined).trim());
  } catch { return null; }
  if (!Array.isArray(data?.q) || !Array.isArray(data?.rows) || !data.rows.length || !Array.isArray(data.rows[0]?.a)) return null;
  if (data.q.length !== 11) return null;
  const title = clean(doc.title) || 'Análise de speech';
  const dates = data.rows.map((r) => String(r.dt || '').slice(0, 10)).filter(Boolean);
  const iso = (d) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;
  const sorted = dates.map(iso).sort();
  const br = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const period = sorted.length ? `${br(sorted[0])} a ${br(sorted[sorted.length - 1])}` : '';
  // Resumo para a página de análises da carteira: % de cada critério e por login
  const pct = (rows, k) => { const v = rows.filter((r) => r.a[k] !== null && r.a[k] !== undefined); return v.length ? Math.round((v.filter((r) => r.a[k] === 1).length / v.length) * 1000) / 10 : null; };
  const SHORT = ['Valor, produto e atraso', 'Oferta à vista', 'Oferta de parcelamento', 'Oferta gradativa', 'Soluções alternativas', 'Vantagens', 'Consequências', 'Proposta ao banco', 'Argumentação', 'Motivo do não pagamento', 'Sem correção após 65 dias'];
  const logins = [...new Set(data.rows.map((r) => r.login))];
  const adh = (rows) => { let s = 0, n = 0; rows.forEach((r) => r.a.forEach((x) => { if (x !== null && x !== undefined) { n++; s += x; } })); return n ? Math.round((s / n) * 1000) / 10 : null; };
  const fins = {}; data.rows.forEach((r) => { fins[r.fin || '—'] = (fins[r.fin || '—'] || 0) + 1; });
  const summary = {
    kpis: [{ label: 'Ligações analisadas', value: String(data.rows.length), sub: `${logins.length} logins` }, { label: 'Aderência média', value: `${adh(data.rows)}%`, sub: '11 critérios de negociação' }],
    criteria: SHORT.map((n, k) => ({ label: n, value: pct(data.rows, k) })),
    logins: logins.map((l) => { const rows = data.rows.filter((r) => r.login === l); return { login: l, calls: rows.length, value: adh(rows) }; }).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
    outcomes: Object.entries(fins).map(([label, n]) => ({ label, n })),
  };
  return { kind: 'speech_safra', title, period, carteira: carteiraOfTitle(`${title} ${t(doc.body).slice(0, 400)}`) || 'SAFRA BS', rows: data.rows, calls: data.rows, summary };
}

function conversionReport(doc) {
  if (!doc.querySelector('.kpis .kpi, .lrs .lr, .cmp .tr')) return null;
  const title = clean(doc.title) || t(doc.querySelector('h1')) || 'Análise da carteira';
  const head = t(doc.querySelector('header, .hd, .top')) + ' ' + t(doc.body).slice(0, 600);
  const pm = head.match(PERIOD_RE);
  const kpis = [...doc.querySelectorAll('.kpis .kpi')].map((k) => ({ label: t(k.querySelector('.kl')), value: t(k.querySelector('.kv')), sub: t(k.querySelector('.sub')), tag: t(k.querySelector('.tag')) }));
  const sc = doc.querySelector('.score');
  const score = sc ? { label: t(sc.querySelector('.sl')), value: t(sc.querySelector('b.num, .num')), sub: t(sc.querySelector('.sf')) } : null;
  const sections = [...doc.querySelectorAll('section')].filter((s) => s.querySelector('.sec')).map((s) => ({ num: t(s.querySelector('.sec .k')), title: t(s.querySelector('.sec h2')), text: clean([...s.querySelectorAll('.leit p, .card > p')].map((p) => p.textContent).join(' ')) }));
  const table = (() => {
    const cmp = doc.querySelector('.cmp');
    if (!cmp) return null;
    const cols = [...cmp.querySelectorAll('.th > span')].map(t);
    const rows = [...cmp.querySelectorAll('.tr')].map((r) => [...r.children].map(t));
    return { cols, rows, note: t(cmp.parentElement?.querySelector('p')) };
  })();
  const stages = [...doc.querySelectorAll('.et')].map((g) => ({ group: t(g.querySelector('.fh')), items: [...g.querySelectorAll('.er')].map((r) => ({ label: t(r.querySelector('.el')), value: t(r.querySelector('.ev b')), compare: t(r.querySelector('.ev em')).replace(/^×\s*/, '') })) }));
  const dists = [...doc.querySelectorAll('.card')].filter((c) => c.querySelector(':scope > .lb2') && c.querySelector('.r')).map((c) => ({ label: t(c.querySelector('.lb2')), items: [...c.querySelectorAll('.r')].map((r) => ({ label: t(r.querySelector('.t span')), value: t(r.querySelector('.t b')) })), note: t(c.querySelector(':scope > p')) }));
  const findings = [...doc.querySelectorAll('.opc')].map((o) => ({ name: t(o.querySelector('.on')), tag: t(o.querySelector('.tg')), fields: [...o.querySelectorAll('.ox')].map((x) => ({ label: t(x.querySelector('.ol')), text: t(x.querySelector('p')) })) }));
  const reading = [...doc.querySelectorAll('.lr')].map((l) => ({ login: t(l.querySelector('b')).toLowerCase(), text: t(l.querySelector('span')), action: t(l.querySelector('em')) })).filter((x) => x.login);
  const plan = [...doc.querySelectorAll('.apc')].map((a) => ({ num: t(a.querySelector('.n')), title: t(a.querySelector('h3')), text: t(a.querySelector('p')), indicator: t(a.querySelector('.ind')).replace(/^Indicador\s*/, '') }));
  if (!kpis.length && !reading.length && !table) return null;
  return {
    kind: 'conversao', title, period: pm ? `${pm[1]} a ${pm[2]}` : '', carteira: carteiraOfTitle(`${title} ${head}`),
    calls: [], data: { lead: t(doc.querySelector('.lead')), kick: t(doc.querySelector('.kick')), score, kpis, sections, table, stages, dists, findings, reading, plan },
  };
}

// Reconhece os relatórios de carteira; devolve null para os outros formatos (dashboards PAN e AGV)
export function readCarteiraReport(doc, text, file) {
  const out = speechSafra(doc, text) || conversionReport(doc);
  if (!out) return null;
  if (out.carteira && !CARTEIRAS.includes(out.carteira)) out.carteira = null;
  return { ...out, name: file.name, html: text };
}

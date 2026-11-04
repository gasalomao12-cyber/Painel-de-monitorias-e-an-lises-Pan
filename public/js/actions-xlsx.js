import { saveBlob } from './api.js';
import { parseWorkbook } from './files.js';

// Planilha "CONTROLE DE AÇÕES" no modelo das carteiras: as mesmas 7 colunas (LOGIN, SEGMENTO, TEMA, AÇÃO,
// DATA, OBS, RESPONSÁVEL), tabela com filtro, listas da aba APOIO nas colunas e cabeçalho fixo.
// Quem vê várias carteiras baixa o consolidado: RESUMO, CONSOLIDADO e uma aba por carteira, no mesmo arquivo.
export const CART_SHEET = { PAN: 'PAN', 'SAFRA ADM': 'SAFRA ADM E CALL', 'SAFRA BS': 'SAFRA BS', PORTO: 'PORTO BANK' };
const COLS = [
  { key: 'login', header: 'LOGIN', width: 22 },
  { key: 'segmento', header: 'SEGMENTO', width: 40 },
  { key: 'tema', header: 'TEMA', width: 18 },
  { key: 'acao', header: 'AÇÃO', width: 26 },
  { key: 'data', header: 'DATA', width: 13 },
  { key: 'obs', header: 'OBS', width: 80 },
  { key: 'responsavel', header: 'RESPONSÁVEL', width: 38 },
];
const NAVY = 'FF141E45', GOLD = 'FFC3AC6B', LINE = 'FFD9DEEA';
const excel = async () => { if (!window.ExcelJS) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'vendor/exceljs.min.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); return window.ExcelJS; };
const toDate = (iso) => { const [y, m, d] = String(iso || '').split('-').map(Number); return y ? new Date(Date.UTC(y, m - 1, d)) : null; };

// Faixas das listas na aba APOIO (a aba é criada por último, depois das abas de controle)
const APOIO_COLS = (lists) => [['SEGMENTO', lists.segments], ['TEMA', lists.themes], ['AÇÃO', lists.actions], ['RESPONSÁVEL', lists.responsibles]];
const apoioRanges = (lists) => Object.fromEntries(APOIO_COLS(lists).map(([h, l], i) => [h, `APOIO!$${'ABCD'[i]}$2:$${'ABCD'[i]}$${Math.max(2, l.length + 1)}`]));
function addApoio(wb, lists) {
  const ws = wb.addWorksheet('APOIO', { properties: { tabColor: { argb: 'FF9AA3B8' } } });
  const cols = APOIO_COLS(lists);
  ws.columns = cols.map(([h]) => ({ header: h, width: h === 'SEGMENTO' ? 42 : h === 'RESPONSÁVEL' ? 40 : 26 }));
  const max = Math.max(...cols.map(([, l]) => l.length));
  for (let i = 0; i < max; i++) ws.addRow(cols.map(([, l]) => l[i] ?? null));
  styleHead(ws.getRow(1), cols.length);
  ws.autoFilter = { from: 'A1', to: `D${max + 1}` };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}
function styleHead(row, n) {
  row.height = 26;
  for (let c = 1; c <= n; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = { bottom: { style: 'medium', color: { argb: GOLD } } };
  }
}
// Uma aba de controle: tabela do Excel (filtro e faixas), listas do APOIO e cabeçalho congelado
function addControl(wb, name, rows, ranges, { tab, withCarteira = false } = {}) {
  const ws = wb.addWorksheet(name, { properties: { tabColor: { argb: tab || NAVY } }, views: [{ state: 'frozen', ySplit: 1 }] });
  const cols = withCarteira ? [{ key: 'carteira', header: 'CARTEIRA', width: 18 }, ...COLS] : COLS;
  ws.columns = cols.map((c) => ({ key: c.key, width: c.width }));
  const data = rows.map((r) => cols.map((c) => (c.key === 'data' ? toDate(r.data) : c.key === 'carteira' ? CART_SHEET[r.carteira] || r.carteira : r[c.key] ?? null)));
  ws.addTable({
    name: `T_${name.replace(/[^A-Za-z0-9]/g, '_')}`, ref: 'A1', headerRow: true,
    style: { theme: 'TableStyleLight8', showRowStripes: true },
    columns: cols.map((c) => ({ name: c.header, filterButton: true })),
    rows: data.length ? data : [cols.map(() => null)],
  });
  styleHead(ws.getRow(1), cols.length);
  const off = withCarteira ? 1 : 0, L = (i) => String.fromCharCode(65 + i + off);
  const last = Math.max(2, data.length + 1);
  ws.getColumn(5 + off).numFmt = 'dd/mm/yyyy';
  ws.getColumn(5 + off).alignment = { horizontal: 'center' };
  ws.getColumn(6 + off).alignment = { wrapText: true, vertical: 'top' };
  for (let r = 2; r <= last; r++) {
    const row = ws.getRow(r);
    row.font = { name: 'Calibri', size: 10.5 };
    row.alignment = { vertical: 'top' };
    for (let c = 1; c <= cols.length; c++) row.getCell(c).border = { bottom: { style: 'hair', color: { argb: LINE } } };
  }
  // Listas suspensas como na planilha atual (também para as próximas linhas digitadas à mão)
  const dv = (col, range) => { ws.dataValidations.add(`${L(col)}2:${L(col)}${last + 500}`, { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [range] }); };
  dv(1, ranges['SEGMENTO']); dv(2, ranges['TEMA']); dv(3, ranges['AÇÃO']); dv(6, ranges['RESPONSÁVEL']);
  ws.dataValidations.add(`${L(4)}2:${L(4)}${last + 500}`, { type: 'date', operator: 'greaterThan', allowBlank: true, showErrorMessage: true, errorTitle: 'Data', error: 'Digite uma data (dd/mm/aaaa).', formulae: [new Date(Date.UTC(2020, 0, 1))] });
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  ws.headerFooter = { oddFooter: `&L${name}&RPágina &P de &N` };
  return ws;
}
// Resumo: ações por carteira e por tipo, para conferir o consolidado de relance
function addSummary(wb, rows, carteiras, lists) {
  const ws = wb.addWorksheet('RESUMO', { properties: { tabColor: { argb: GOLD } }, views: [{ state: 'frozen', ySplit: 4, xSplit: 1 }] });
  ws.getCell('A1').value = 'CONTROLE DE AÇÕES · CONSOLIDADO';
  ws.getCell('A1').font = { bold: true, size: 16, color: { argb: NAVY } };
  const dates = rows.map((r) => r.data).filter(Boolean).sort();
  const br = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
  ws.getCell('A2').value = `${rows.length} ações · ${br(dates[0])} a ${br(dates[dates.length - 1])} · gerado pela PX Monitorias em ${new Date().toLocaleString('pt-BR')}`;
  ws.getCell('A2').font = { italic: true, size: 10, color: { argb: 'FF5B6478' } };
  const acts = [...new Set([...lists.actions, ...rows.map((r) => r.acao).filter(Boolean)])];
  const head = ['AÇÃO', ...carteiras.map((c) => CART_SHEET[c]), 'TOTAL'];
  ws.getRow(4).values = head; styleHead(ws.getRow(4), head.length);
  ws.getColumn(1).width = 40; for (let i = 2; i <= head.length; i++) ws.getColumn(i).width = 18;
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  let r = 5;
  for (const a of acts) {
    const vals = carteiras.map((c) => rows.filter((x) => x.carteira === c && x.acao === a).length);
    if (!vals.some(Boolean)) continue;
    ws.getRow(r).values = [a, ...vals, { formula: `SUM(B${r}:${String.fromCharCode(65 + carteiras.length)}${r})` }];
    r++;
  }
  const tot = ws.getRow(r);
  tot.values = ['TOTAL', ...carteiras.map((_, i) => ({ formula: `SUM(${String.fromCharCode(66 + i)}5:${String.fromCharCode(66 + i)}${r - 1})` })), { formula: `SUM(${String.fromCharCode(66 + carteiras.length)}5:${String.fromCharCode(66 + carteiras.length)}${r - 1})` }];
  tot.font = { bold: true }; tot.eachCell((c) => { c.border = { top: { style: 'medium', color: { argb: NAVY } } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3EEDF' } }; });
  for (let i = 5; i <= r; i++) for (let c = 2; c <= head.length; c++) ws.getRow(i).getCell(c).alignment = { horizontal: 'center' };
}

// Baixa a planilha: consolidado (várias carteiras) ou a da carteira (uma só, no modelo da carteira)
export async function downloadActions(data, { consolidated }) {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PX Monitorias'; wb.created = new Date();
  const rows = data.rows;
  const carteiras = (data.scope || Object.keys(CART_SHEET)).filter((c) => CART_SHEET[c]);
  const stamp = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
  const ranges = apoioRanges(data.lists);
  const type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (consolidated) {
    addSummary(wb, rows, carteiras, data.lists);
    addControl(wb, 'CONSOLIDADO', rows, ranges, { tab: GOLD, withCarteira: true });
    for (const c of carteiras) addControl(wb, CART_SHEET[c], rows.filter((r) => r.carteira === c), ranges);
    addApoio(wb, data.lists);
    saveBlob(new Blob([await wb.xlsx.writeBuffer()], { type }), `CONTROLE DE AÇÕES - CONSOLIDADO - ${stamp}.xlsx`);
  } else {
    const c = carteiras[0];
    addControl(wb, 'CONTROLE DE AÇÕES', rows, ranges);
    addApoio(wb, data.lists);
    saveBlob(new Blob([await wb.xlsx.writeBuffer()], { type }), `CONTROLE DE AÇÕES - ${CART_SHEET[c] || c} - ${stamp}.xlsx`);
  }
}

// Lê uma planilha "CONTROLE DE AÇÕES" existente (aba de controle, cabeçalho LOGIN/SEGMENTO/…)
export async function readActionsFile(file) {
  const sheets = await parseWorkbook(file);
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  const pick = sheets.find((s) => /CONTROLE/.test(norm(s.name))) || sheets.find((s) => !/APOIO|RESUMO/.test(norm(s.name))) || sheets[0];
  if (!pick || !pick.matrix.length) throw new Error('Não encontrei a aba de controle na planilha.');
  const hi = pick.matrix.findIndex((r) => r.some((v) => norm(v) === 'SEGMENTO') && r.some((v) => norm(v) === 'ACAO'));
  if (hi < 0) throw new Error('A planilha precisa das colunas SEGMENTO, TEMA, AÇÃO, DATA, OBS e RESPONSÁVEL.');
  const head = pick.matrix[hi].map(norm);
  const col = (...n) => head.findIndex((h) => n.includes(h));
  const ix = { login: col('LOGIN', 'A'), segmento: col('SEGMENTO'), tema: col('TEMA'), acao: col('ACAO'), data: col('DATA'), obs: col('OBS'), responsavel: col('RESPONSAVEL'), carteira: col('CARTEIRA') };
  if (ix.login < 0) ix.login = 0;
  const brDate = (v) => { const s = String(v ?? '').trim(); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`; m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return null; };
  const rows = pick.matrix.slice(hi + 1).map((r) => ({
    login: r[ix.login], segmento: ix.segmento >= 0 ? r[ix.segmento] : null, tema: ix.tema >= 0 ? r[ix.tema] : null, acao: ix.acao >= 0 ? r[ix.acao] : null,
    data: ix.data >= 0 ? brDate(r[ix.data]) : null, obs: ix.obs >= 0 ? r[ix.obs] : null, responsavel: ix.responsavel >= 0 ? r[ix.responsavel] : null,
  })).filter((r) => r.login || r.acao);
  return { sheet: pick.name, rows };
}

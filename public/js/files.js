// Leitura e geração de arquivos no próprio navegador (sem servidor):
// transcrições (.txt, .docx, .vtt, .srt, .json) e planilhas (.xlsx, .csv).
import { saveBlob } from './api.js';

const loaded = {};
function loadScript(src) {
  if (!loaded[src]) {
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Não foi possível carregar o leitor de arquivos.'));
      document.head.appendChild(s);
    });
  }
  return loaded[src];
}
const excel = async () => { await loadScript('vendor/exceljs.min.js'); return window.ExcelJS; };
const mammoth = async () => { await loadScript('vendor/mammoth.browser.min.js'); return window.mammoth; };

const extOf = (name) => (String(name || '').match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';

async function decodeText(file) {
  const buf = await file.arrayBuffer();
  const utf = new TextDecoder('utf-8').decode(buf);
  // Arquivos salvos em ANSI (Windows-1252) viram "�" em UTF-8
  return utf.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf.replace(/^﻿/, '');
}

function cleanSubtitles(text) {
  const out = [];
  let stamp = null;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l === 'WEBVTT' || /^\d+$/.test(l) || /^NOTE\b/.test(l)) continue;
    const m = l.match(/^(\d{1,2}:)?(\d{2}):(\d{2})[.,]\d{3}\s*-->/);
    if (m) { stamp = `${m[1] ? m[1] : ''}${m[2]}:${m[3]}`; continue; }
    const voice = l.match(/^<v\s+([^>]+)>(.*)$/);
    const txt = voice ? `${voice[1]}: ${voice[2].replace(/<\/v>$/, '')}` : l.replace(/<[^>]+>/g, '');
    out.push(stamp ? `[${stamp}] ${txt}` : txt);
    stamp = null;
  }
  return out.join('\n');
}

function jsonTranscript(text) {
  try {
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : data.segments || data.utterances || data.transcript || data.results;
    if (!Array.isArray(arr)) return typeof data.text === 'string' ? data.text : text;
    return arr.map((s) => {
      const who = s.speaker || s.speaker_label || s.channel || s.role || s.participant || '';
      const t = s.text || s.transcript || s.content || '';
      const st = s.start ?? s.start_time ?? s.begin;
      const ts = st != null && !Number.isNaN(Number(st)) ? `[${String(Math.floor(Number(st) / 60)).padStart(2, '0')}:${String(Math.floor(Number(st) % 60)).padStart(2, '0')}] ` : '';
      return `${ts}${who ? who + ': ' : ''}${t}`.trim();
    }).filter(Boolean).join('\n');
  } catch { return text; }
}

export async function readTranscriptFile(file, { limit = 400000 } = {}) {
  const ext = extOf(file.name) || 'txt';
  let text;
  if (ext === 'docx') text = (await (await mammoth()).extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  else if (['txt', 'text', 'log', 'md', 'csv'].includes(ext)) text = await decodeText(file);
  else if (ext === 'vtt' || ext === 'srt') text = cleanSubtitles(await decodeText(file));
  else if (ext === 'json') text = jsonTranscript(await decodeText(file));
  else throw new Error('Formato não suportado. Use .txt, .docx, .vtt, .srt ou .json.');
  return { name: file.name.slice(0, 200), text: text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, limit) };
}

// Documento com uma ou várias transcrições, linha a linha. No .docx guarda quais linhas são títulos
// (estilo de título ou parágrafo todo em negrito) e lê tabelas "hora | falante | fala" como diálogo.
function docxLines(htmlText) {
  const doc = new DOMParser().parseFromString(`<body>${htmlText}</body>`, 'text/html');
  const out = [];
  const push = (text, heading) => { for (const part of String(text).split('\n')) { const t = part.replace(/\s+/g, ' ').trim(); if (t) out.push({ text: t, heading }); } };
  const textOf = (el) => { const c = el.cloneNode(true); c.querySelectorAll('br').forEach((br) => br.replaceWith('\n')); return c.textContent || ''; };
  const walk = (el) => {
    for (const node of el.children) {
      const tag = node.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) push(textOf(node), true);
      else if (tag === 'p' || tag === 'li') {
        const txt = textOf(node).trim();
        const bold = [...node.querySelectorAll('strong, b')].map((b) => b.textContent).join('').replace(/\s+/g, '');
        push(txt, !!txt && txt.length < 140 && bold.length >= txt.replace(/\s+/g, '').length * 0.9);
      } else if (tag === 'table') {
        for (const tr of node.querySelectorAll('tr')) {
          const cells = [...tr.children].map((td) => textOf(td).replace(/\s+/g, ' ').trim()).filter(Boolean);
          if (!cells.length) continue;
          const ts = /^\[?\d{1,2}:\d{2}(:\d{2})?\]?$/.test(cells[0]);
          if (ts && cells.length >= 3) push(`[${cells[0].replace(/[[\]]/g, '')}] ${cells[1]}: ${cells.slice(2).join(' ')}`, false);
          else if (ts) push(`[${cells[0].replace(/[[\]]/g, '')}] ${cells.slice(1).join(' ')}`, false);
          else if (cells.length === 2 && cells[0].length < 30) push(`${cells[0]}: ${cells[1]}`, false);
          else push(cells.join(' — '), false);
        }
      } else if (['ul', 'ol', 'div', 'section'].includes(tag)) walk(node);
      else push(textOf(node), false);
    }
  };
  walk(doc.body);
  return out;
}

export async function readTranscriptLines(file) {
  const ext = extOf(file.name) || 'txt';
  if (ext === 'docx') {
    const m = await mammoth();
    const { value } = await m.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    return { name: file.name.slice(0, 200), lines: docxLines(value) };
  }
  const { text } = await readTranscriptFile(file, { limit: 5_000_000 });
  return { name: file.name.slice(0, 200), lines: text.split('\n').map((t) => ({ text: t, heading: false })) };
}

// ---------- Planilhas ----------
function parseCsv(text) {
  const firstLine = text.split(/\r?\n/)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => String(c).trim()));
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [String(h).trim(), r[i] ?? ''])));
}

function cellValue(v) {
  if (v == null) return null;
  if (v instanceof Date) {
    // Horas do Excel chegam como data-base 1899/1900
    if (v.getUTCFullYear() < 1901) return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}:${String(v.getUTCSeconds()).padStart(2, '0')}`;
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'object') {
    if (v.text) return v.text;
    if (v.result !== undefined) return cellValue(v.result);
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.hyperlink) return v.hyperlink;
  }
  return v;
}

export async function parseSheetFile(file) {
  const ext = extOf(file.name);
  if (ext === 'csv' || ext === 'txt') return parseCsv(await decodeText(file));
  if (ext !== 'xlsx') throw new Error('Envie um arquivo .xlsx ou .csv.');
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets.find((w) => w.rowCount > 1) || wb.worksheets[0];
  if (!ws) return [];
  const head = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { head[i] = String(cellValue(c.value) ?? '').trim(); });
  const out = [];
  ws.eachRow((r, idx) => {
    if (idx === 1) return;
    const o = {}; let any = false;
    head.forEach((h, i) => { if (!h) return; const v = cellValue(r.getCell(i).value); if (v !== null && v !== '') any = true; o[h] = v; });
    if (any) out.push(o);
  });
  return out;
}

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF141A33' } };
function styleHeader(ws) {
  ws.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = HEADER_FILL; c.alignment = { vertical: 'middle' }; });
  ws.getRow(1).height = 22;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}
async function saveWorkbook(wb, filename) {
  const buf = await wb.xlsx.writeBuffer();
  saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}

export async function downloadTemplate(criteria) {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PX Monitorias';
  const ws = wb.addWorksheet('Monitorias');
  const base = ['Operador', 'Matricula', 'Equipe', 'Supervisor', 'Produto', 'Data', 'Protocolo', 'Contrato', 'Cliente', 'Duracao', 'Nota speech', 'Link audio', 'Resumo'];
  ws.columns = [...base, ...criteria.map((c) => c.code), ...criteria.map((c) => `OBS ${c.code}`)].map((h) => ({ header: h, key: h, width: Math.max(12, h.length + 4) }));
  styleHeader(ws);
  const ex = { Operador: 'Nome do Operador', Matricula: 'PX01234', Equipe: 'Equipe Alfa', Supervisor: 'Nome do Supervisor', Produto: 'Refinanciamento', Data: '01/10/2026', Protocolo: '20261001000123', Contrato: '***12345', Cliente: 'Nome do cliente', Duracao: '04:32', 'Nota speech': 87.5, 'Link audio': '', Resumo: 'Resumo do speech' };
  criteria.forEach((c) => { ex[c.code] = c.product === 'ENTREGA' ? '' : 'C'; });
  ws.addRow(ex);
  const legend = wb.addWorksheet('Legenda');
  legend.columns = [{ header: 'Código', key: 'code', width: 10 }, { header: 'Critério', key: 'name', width: 38 }, { header: 'Produto', key: 'product', width: 14 }, { header: 'Peso', key: 'weight', width: 8 }, { header: 'Crítico', key: 'critical', width: 9 }, { header: 'Descrição', key: 'description', width: 90 }];
  styleHeader(legend);
  criteria.forEach((c) => legend.addRow({ ...c, product: { REFIN: 'Refinanciamento', ENTREGA: 'Entrega Amigável', AMBOS: 'Refin e Entrega', VEICULOS: 'Veículos', SEM_GARANTIA: 'Cartões e Consignado', CARTOES: 'Cartões', CONSIGNADO: 'Consignado' }[c.product], critical: c.critical ? 'Sim' : 'Não' }));
  legend.addRow({});
  legend.addRow({ code: 'Valores', name: 'C = Conforme · P = Parcial · NC = Não conforme · NA = Não se aplica (também aceita Sim/Não/Parcial)' });
  await saveWorkbook(wb, 'modelo-importacao-px-monitorias.xlsx');
}

const PRODUCT = { VEICULOS: 'Veículos', CARTOES: 'Cartões', CONSIGNADO: 'Consignado', REFIN: 'Refinanciamento', ENTREGA: 'Entrega Amigável' };
const SEGMENT = { CLEAN_CURTO: 'Clean Curto', CLEAN_LONGO: 'Clean Longo', PUBLICO: 'Público', PRIVADO: 'Privado' };
const STATUS = { pendente: 'Pendente de revisão', revisada: 'Revisada', feedback_aplicado: 'Feedback aplicado' };

export async function downloadEvaluations(rows) {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Atendimentos');
  ws.columns = [
    ['ID', 'id', 8], ['Ciclo', 'cycle_name', 24], ['Operador', 'operator_name', 28], ['Login', 'login', 14], ['Líder', 'supervisor_name', 26], ['Equipe', 'team', 14],
    ['Produto', 'product', 14], ['Segmento', 'segment', 14], ['Data', 'call_date', 12], ['Hora', 'call_time', 8],
    ['Protocolo / ID ligação', 'protocol', 20], ['Tabulação', 'tabulation', 26], ['Desfecho', 'outcome', 24], ['Nota speech / 1ª leitura', 'speech_score', 12], ['Nota final', 'final_score', 12],
    ['Ajustes', 'adjustments', 9], ['Alertas', 'alerts', 24], ['Status', 'status', 20], ['Feedback em', 'feedback_at', 18], ['Arquivo do áudio', 'audio_file', 50], ['Link áudio', 'audio_link', 40],
  ].map(([header, key, width]) => ({ header, key, width }));
  styleHeader(ws);
  rows.forEach((r) => ws.addRow({ ...r, product: PRODUCT[r.product], segment: SEGMENT[r.segment] || '', alerts: (r.alerts || []).join(', '), status: STATUS[r.status], feedback_at: r.feedback_at ? new Date(r.feedback_at).toLocaleString('pt-BR') : '' }));
  await saveWorkbook(wb, 'atendimentos-px-monitorias.xlsx');
}

export async function downloadFeedbacks(rows) {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Feedbacks');
  ws.columns = [
    ['Data do feedback', 'applied_at', 18], ['Operador', 'operator_name', 28], ['Equipe', 'team', 14], ['Ciclo', 'cycle_name', 24], ['Produto', 'product', 18],
    ['Data ligação', 'call_date', 12], ['Protocolo', 'protocol', 20], ['Nota final', 'final_score', 10], ['Aplicado por', 'applied_by_name', 24], ['Modalidade', 'modality', 16],
    ['O que foi passado', 'content', 70], ['Pontos fortes', 'strengths', 40], ['Pontos de melhoria', 'improvements', 40], ['Plano de ação', 'action_plan', 40],
    ['Ciente', 'operator_ack', 8], ['Acompanhamento', 'followup_date', 14],
  ].map(([header, key, width]) => ({ header, key, width }));
  styleHeader(ws);
  rows.forEach((r) => {
    const row = ws.addRow({ ...r, product: PRODUCT[r.product], operator_ack: r.operator_ack ? 'Sim' : 'Não', applied_at: r.applied_at ? new Date(r.applied_at).toLocaleString('pt-BR') : '' });
    row.alignment = { wrapText: true, vertical: 'top' };
  });
  await saveWorkbook(wb, 'feedbacks-px-monitorias.xlsx');
}

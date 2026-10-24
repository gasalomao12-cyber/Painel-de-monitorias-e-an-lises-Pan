'use strict';
// Leitura de transcrições e planilhas, geração de modelos e exportações.
const ExcelJS = require('exceljs');
const mammoth = require('mammoth');

const strip = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function decodeText(buf) {
  const utf = buf.toString('utf8');
  // Arquivos salvos em ANSI (Windows-1252) viram "�" em UTF-8
  return utf.includes('�') ? buf.toString('latin1') : utf.replace(/^﻿/, '');
}

function cleanSubtitles(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let stamp = null;
  for (const raw of lines) {
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

async function readTranscript({ text, name, base64 }) {
  const fname = String(name || 'transcricao.txt').slice(0, 200);
  const ext = (fname.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || 'txt';
  if (typeof text === 'string' && !base64) return { text: text.slice(0, 400000), name: fname };
  if (!base64) return { text: '', name: fname };
  const buf = Buffer.from(String(base64).replace(/^data:[^,]+,/, ''), 'base64');
  let out;
  if (ext === 'docx') out = (await mammoth.extractRawText({ buffer: buf })).value;
  else if (['txt', 'text', 'log', 'md', 'csv'].includes(ext)) out = decodeText(buf);
  else if (ext === 'vtt' || ext === 'srt') out = cleanSubtitles(decodeText(buf));
  else if (ext === 'json') out = jsonTranscript(decodeText(buf));
  else {
    const err = new Error('Formato não suportado. Use .txt, .docx, .vtt, .srt ou .json.');
    err.status = 400; throw err;
  }
  return { text: out.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 400000), name: fname };
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

async function parseSheet({ base64, name }) {
  const buf = Buffer.from(String(base64 || '').replace(/^data:[^,]+,/, ''), 'base64');
  const ext = (String(name || '').match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
  if (ext === 'csv' || ext === 'txt') return parseCsv(decodeText(buf));
  if (ext !== 'xlsx') { const e = new Error('Envie um arquivo .xlsx ou .csv.'); e.status = 400; throw e; }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
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

function cellValue(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.text) return v.text;
    if (v.result !== undefined) return v.result;
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.hyperlink) return v.hyperlink;
  }
  return v;
}

const FIELD_ALIASES = {
  operator: ['operador', 'nome do operador', 'agente', 'atendente', 'nome operador', 'colaborador'],
  registration: ['matricula', 'login', 'id operador', 'login operador', 're'],
  team: ['equipe', 'celula', 'time', 'grupo'],
  supervisor: ['supervisor', 'supervisora', 'lider', 'coordenador'],
  product: ['produto', 'tipo', 'carteira', 'tipo de atendimento', 'fila'],
  call_date: ['data', 'data da ligacao', 'data ligacao', 'data do atendimento', 'data atendimento'],
  protocol: ['protocolo', 'id ligacao', 'id da ligacao', 'call id', 'id chamada'],
  contract: ['contrato', 'numero do contrato'],
  customer: ['cliente', 'nome do cliente'],
  duration_sec: ['duracao', 'tempo', 'tma', 'duracao (s)', 'duracao segundos'],
  speech_score: ['nota', 'nota speech', 'nota_speech', 'score', 'nota final speech', 'pontuacao'],
  audio_url: ['link', 'audio', 'link audio', 'link do audio', 'url audio', 'gravacao'],
  summary: ['resumo', 'observacao', 'observacoes', 'resumo speech', 'comentario'],
  transcript: ['transcricao', 'transcript', 'texto da ligacao'],
};

function toResult(v) {
  const s = strip(v);
  if (!s) return null;
  if (['c', 'conforme', 'sim', 's', '1', 'ok', '100', 'x', 'atendeu', 'yes', 'true'].includes(s)) return 'C';
  if (['p', 'parcial', 'parcialmente', '0.5', '0,5', '50', 'em parte'].includes(s)) return 'P';
  if (['nc', 'nao conforme', 'nao', 'n', '0', 'nao atendeu', 'no', 'false'].includes(s)) return 'NC';
  if (['na', 'n/a', 'nao se aplica', '-', 'n.a.', 'nsa'].includes(s)) return 'NA';
  return undefined;
}

function toProduct(v) {
  const s = strip(v);
  if (/entrega|amigavel|devolu/.test(s)) return 'ENTREGA';
  if (/refin|renegoc|refinanc/.test(s)) return 'REFIN';
  return null;
}

function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function toSeconds(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.getUTCHours() * 3600 + v.getUTCMinutes() * 60 + v.getUTCSeconds();
  if (typeof v === 'number') return v < 1 ? Math.round(v * 86400) : Math.round(v);
  const p = String(v).split(':').map(Number);
  if (p.some(Number.isNaN)) return null;
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0];
}

function toScore(v) {
  if (v == null || v === '') return null;
  const x = Number(String(v).replace('%', '').replace(',', '.'));
  if (Number.isNaN(x)) return null;
  return x <= 1 && String(v).indexOf('%') < 0 && x !== 0 ? Math.round(x * 1000) / 10 : x;
}

function normalizeRows(rows, criteria, operators) {
  const headers = rows.length ? Object.keys(rows.reduce((a, r) => Object.assign(a, r), {})) : [];
  const map = {}, critMap = {}, noteMap = {}, unmatched = [];
  for (const h of headers) {
    const k = strip(h).replace(/[_]+/g, ' ');
    const field = Object.entries(FIELD_ALIASES).find(([, al]) => al.includes(k));
    if (field) { map[h] = field[0]; continue; }
    const obs = k.match(/^(obs|observacao|nota)\s*[-:]?\s*(.+)$/);
    const target = obs ? obs[2] : k;
    const c = criteria.find((cr) => strip(cr.code) === target || strip(cr.name) === target);
    if (c) { (obs ? noteMap : critMap)[h] = c; continue; }
    unmatched.push(h);
  }
  const out = rows.map((r, idx) => {
    const o = { line: idx + 2, errors: [], warnings: [], items: [] };
    for (const [h, f] of Object.entries(map)) o[f] = r[h];
    o.operator = String(o.operator || '').trim();
    o.registration = o.registration != null ? String(o.registration).trim() : null;
    o.product = toProduct(o.product);
    o.call_date = toDate(o.call_date);
    o.duration_sec = toSeconds(o.duration_sec);
    o.speech_score = toScore(o.speech_score);
    o.protocol = o.protocol != null ? String(o.protocol) : null;
    if (o.audio_url && !/^https?:\/\//i.test(String(o.audio_url))) { o.warnings.push('Link de áudio ignorado (não é uma URL).'); o.audio_url = null; }
    if (!o.operator) o.errors.push('Operador não informado.');
    if (!o.product) o.errors.push('Produto não reconhecido (use Refinanciamento ou Entrega Amigável).');
    const op = operators.find((x) => (o.registration && x.registration && String(x.registration) === o.registration) || strip(x.name) === strip(o.operator));
    o.operator_id = op ? op.id : null;
    if (!op && o.operator) o.warnings.push('Operador novo — será cadastrado.');
    for (const [h, c] of Object.entries(critMap)) {
      if (o.product && c.product !== 'AMBOS' && c.product !== o.product) continue;
      const res = toResult(r[h]);
      if (res === undefined) { o.warnings.push(`Valor "${r[h]}" em ${c.code} não reconhecido.`); continue; }
      const noteH = Object.entries(noteMap).find(([, nc]) => nc.id === c.id)?.[0];
      o.items.push({ criterion_id: c.id, code: c.code, speech_result: res, speech_note: noteH ? r[noteH] || null : null });
    }
    if (!o.items.length && o.speech_score == null) o.warnings.push('Nenhum critério ou nota encontrado nesta linha.');
    return o;
  });
  return {
    rows: out,
    mapped: Object.entries(map).map(([h, f]) => ({ header: h, field: f })),
    criteria_columns: Object.entries(critMap).map(([h, c]) => ({ header: h, code: c.code, name: c.name })),
    unmatched,
    summary: { total: out.length, valid: out.filter((r) => !r.errors.length).length, invalid: out.filter((r) => r.errors.length).length, new_operators: new Set(out.filter((r) => !r.operator_id && r.operator).map((r) => strip(r.operator))).size },
  };
}

// ---------- Geração de planilhas ----------
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF141A33' } };
function styleHeader(ws) {
  ws.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = HEADER_FILL; c.alignment = { vertical: 'middle' }; });
  ws.getRow(1).height = 22;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

async function buildTemplate(criteria) {
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
  criteria.forEach((c) => legend.addRow({ ...c, product: { REFIN: 'Refinanciamento', ENTREGA: 'Entrega Amigável', AMBOS: 'Ambos' }[c.product], critical: c.critical ? 'Sim' : 'Não' }));
  legend.addRow({});
  legend.addRow({ code: 'Valores', name: 'C = Conforme · P = Parcial · NC = Não conforme · NA = Não se aplica (também aceita Sim/Não/Parcial)' });
  return wb.xlsx.writeBuffer();
}

const PRODUCT = { REFIN: 'Refinanciamento', ENTREGA: 'Entrega Amigável' };
const STATUS = { pendente: 'Pendente de revisão', revisada: 'Revisada', feedback_aplicado: 'Feedback aplicado' };

async function exportEvaluations(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Atendimentos');
  ws.columns = [
    ['ID', 'id', 8], ['Ciclo', 'cycle_name', 24], ['Operador', 'operator_name', 28], ['Equipe', 'team', 14], ['Produto', 'product', 18], ['Data', 'call_date', 12],
    ['Protocolo', 'protocol', 20], ['Nota speech', 'speech_score', 12], ['Nota final', 'final_score', 12], ['Ajustes', 'adjustments', 9], ['Status', 'status', 20],
    ['Feedback em', 'feedback_at', 18], ['Link áudio', 'audio_link', 40],
  ].map(([header, key, width]) => ({ header, key, width }));
  styleHeader(ws);
  rows.forEach((r) => ws.addRow({ ...r, product: PRODUCT[r.product], status: STATUS[r.status] }));
  return wb.xlsx.writeBuffer();
}

async function exportFeedbacks(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Feedbacks');
  ws.columns = [
    ['Data do feedback', 'applied_at', 18], ['Operador', 'operator_name', 28], ['Equipe', 'team', 14], ['Ciclo', 'cycle_name', 24], ['Produto', 'product', 18],
    ['Data ligação', 'call_date', 12], ['Protocolo', 'protocol', 20], ['Nota final', 'final_score', 10], ['Aplicado por', 'applied_by_name', 24], ['Modalidade', 'modality', 16],
    ['O que foi passado', 'content', 70], ['Pontos fortes', 'strengths', 40], ['Pontos de melhoria', 'improvements', 40], ['Plano de ação', 'action_plan', 40],
    ['Ciente', 'operator_ack', 8], ['Acompanhamento', 'followup_date', 14],
  ].map(([header, key, width]) => ({ header, key, width }));
  styleHeader(ws);
  rows.forEach((r) => { const row = ws.addRow({ ...r, product: PRODUCT[r.product], operator_ack: r.operator_ack ? 'Sim' : 'Não' }); row.alignment = { wrapText: true, vertical: 'top' }; });
  return wb.xlsx.writeBuffer();
}

module.exports = { readTranscript, parseSheet, normalizeRows, buildTemplate, exportEvaluations, exportFeedbacks };

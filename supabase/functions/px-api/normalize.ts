// @ts-nocheck — normalização das planilhas do speech (as linhas chegam já lidas pelo navegador)
const strip = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

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
  // Horas do Excel chegam como data-base 1899-12-30 + hora
  const t = String(v).match(/^1899-12-3\dT(\d\d):(\d\d):(\d\d)/);
  if (t) return Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]);
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


export { normalizeRows };

// Separa um documento com várias transcrições (ex.: um .docx com todas as ligações da quinzena)
// em uma transcrição por ligação, e extrai do cabeçalho de cada uma o que identifica a ligação:
// arquivo de áudio, ID da ligação, login e nome do operador, data e carteira.
// Funções puras (sem DOM) para rodar no navegador e nos testes.

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const AUDIO_RE = /[\w\-.()À-ÿ]+\.(?:wav|mp3|gsm|ogg|opus|m4a|wma|flac|amr)\b/i;
const TS_RE = /^\s*[[(]?\s*((?:\d{1,2}:)?\d{1,2}:\d{2})(?:[.,]\d+)?\s*[\])]?\s*(?:-+>?\s*(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d+)?\s*)?[-–:]?\s*/;
const SPEAKER_RE = /^(operador[a]?|agente|atendente|consultor[a]?|cliente|devedor[a]?|titular|speaker\s*\d+|falante\s*\d+|locutor\s*\d+|interlocutor\s*\d+|pessoa\s*\d+|participante\s*\d+|canal\s*\d+|spk_?\d+)\s*[:\-–]/i;
// Linha que abre uma ligação: "Ligação 3", "Ligação: 39627735", "Protocolo 123...", "Transcrição 2", "ID da ligação: ..."
const LABEL_RE = /^(?:liga[cç][aã]o|chamada|atendimento|grava[cç][aã]o|transcri[cç][aã]o|protocolo|id\s+da\s+liga[cç][aã]o|id\s+da\s+chamada|call\s*id|arquivo|[aá]udio)\b\s*(?:n[º°o.]*\s*)?(?:#\s*)?[:\-–]?\s*\S/i;
const SEPARATOR_RE = /^[\s\-=_*~#•·]{4,}$/;
// Metadados do cabeçalho ("Operador: Maria Silva", "Data: 01/10/2026", "Login: msilva")
const META_RE = /^(operador(?:\(a\)|a)?|agente|atendente|colaborador[a]?|consultor[a]?|nome\s+do\s+operador|login|usu[aá]rio|matr[ií]cula|data|hora|dura[cç][aã]o|carteira|produto|fila|campanha|segmento|cliente|cpf|contrato|supervisor[a]?|l[ií]der|equipe|protocolo|id(?:\s+da\s+liga[cç][aã]o)?|arquivo|[aá]udio)\s*[:\-–]\s*(.+)$/i;
const GREETING = /^(bom dia|boa tarde|boa noite|al[oô]|ol[aá]|oi\b|sim\b|n[aã]o\b|pois n[aã]o|tudo bem|isso|ok\b|certo|obrigad)/i;

export function tsSeconds(line) {
  const m = String(line).match(TS_RE);
  if (!m) return null;
  const p = m[1].split(':').map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
}

const PERSON_LABEL = /^(operador|agente|atendente|colaborador|consultor|cliente|nome do operador)/;
const CONNECTORS = new Set(['de', 'da', 'do', 'dos', 'das', 'e', 'di', 'du']);
// Nome próprio ("Maria Eduarda Souza") ou login ("msouza", "maria.souza")
const looksLikeName = (v) => /^[a-z][a-z0-9._]{2,30}$/.test(v)
  || v.split(/\s+/).every((w) => CONNECTORS.has(w.toLowerCase()) || /^[A-ZÀ-Ý][a-zà-ÿ'’]+$|^[A-ZÀ-Ý]{2,}$|^[A-ZÀ-Ý]\.?$/.test(w));

function isMetaLine(text) {
  const m = text.match(META_RE);
  if (!m) return false;
  const v = m[2].trim().replace(/\s*\(.*?\)\s*$/, '');
  // "Operador: Bom dia, tudo bem?" ou "Operador: Tchau." são falas, não cabeçalho
  if (v.split(/\s+/).length > 8 || GREETING.test(v) || /[?!]/.test(v)) return false;
  if (PERSON_LABEL.test(norm(m[1]))) return looksLikeName(v);
  return true;
}

function isDialog(text) {
  if (tsSeconds(text) != null) return true;
  if (SPEAKER_RE.test(text) && !isMetaLine(text)) return true;
  return false;
}

// lines: [{ text, heading }]  (heading = título/linha toda em negrito no .docx)
export function classify(lines) {
  return lines.map((l, i) => {
    const text = String(l.text || '').replace(/\s+/g, ' ').trim();
    return {
      i, text, heading: !!l.heading,
      audio: AUDIO_RE.test(text) && text.length < 400,
      label: LABEL_RE.test(text) && text.length < 160 && !isDialog(text),
      separator: SEPARATOR_RE.test(text),
      meta: isMetaLine(text),
      dialog: isDialog(text),
      ts: tsSeconds(text),
    };
  }).filter((l) => l.text);
}

// Sobe o início da ligação para incluir o cabeçalho logo acima do marcador (metadados, títulos, separadores)
function headerStart(c, idx, floor) {
  let s = idx;
  for (let k = idx - 1, n = 0; k > floor && n < 8; k--, n++) {
    const l = c[k];
    if (l.meta || l.heading || l.separator || l.label || l.audio) s = k; else break;
  }
  return s;
}

function segmentsFrom(c, starts) {
  const uniq = [...new Set(starts)].sort((a, b) => a - b);
  return uniq.map((s, j) => c.slice(s, j + 1 < uniq.length ? uniq[j + 1] : c.length));
}

// Uma divisão só vale se quase todas as partes tiverem conversa de verdade
function goodSplit(segs) {
  if (segs.length < 2) return false;
  const withTalk = segs.filter((s) => s.filter((l) => l.dialog || (!l.meta && !l.separator && !l.heading && l.text.length > 20)).length >= 3);
  return withTalk.length >= Math.max(2, Math.ceil(segs.length * 0.8));
}

export function splitLines(lines) {
  const c = classify(lines);
  if (!c.length) return { method: 'vazio', segments: [] };
  const strategies = [
    ['arquivo de áudio', (l, k) => l.audio && !c.slice(Math.max(0, k - 6), k).some((x) => x.audio)],
    ['título de ligação', (l) => l.label],
    ['títulos do documento', (l) => l.heading && !l.dialog],
    ['separador', (l) => l.separator],
    ['nome do operador', (l) => /^(operador(?:\(a\)|a)?|agente|atendente|colaborador[a]?|nome\s+do\s+operador)\s*[:\-–]/i.test(l.text) && l.meta],
  ];
  for (const [name, test] of strategies) {
    const marks = c.map((l, k) => (test(l, k) ? k : -1)).filter((k) => k >= 0);
    if (marks.length < 2) continue;
    let prev = 0;
    const starts = [0, ...marks.map((k) => { const s = headerStart(c, k, prev); prev = k; return s; })];
    let segs = segmentsFrom(c, starts).filter((s) => s.length);
    // O trecho antes do primeiro marcador costuma ser capa/índice: junta na primeira ligação se não tiver conversa
    if (segs.length > 1 && !segs[0].some((l) => l.dialog)) segs = [[...segs[0], ...segs[1]], ...segs.slice(2)];
    // Separadores podem marcar o fim em vez do início: descarta partes vazias
    segs = segs.filter((s) => s.some((l) => !l.separator));
    if (goodSplit(segs)) return { method: name, segments: segs };
  }
  // Sem marcador explícito: o tempo da conversa volta a zero quando começa outra ligação
  const starts = [0];
  let last = null;
  c.forEach((l, k) => {
    if (l.ts == null) return;
    if (last != null && l.ts <= 5 && last > 20) starts.push(headerStart(c, k, starts[starts.length - 1]));
    last = l.ts;
  });
  if (starts.length > 1) {
    const segs = segmentsFrom(c, starts);
    if (goodSplit(segs)) return { method: 'tempo reiniciado', segments: segs };
  }
  return { method: 'documento único', segments: [c] };
}

const QUEUE_PRODUCT = [[/cart/i, 'CARTOES'], [/consig|emprestimo/i, 'CONSIGNADO'], [/veic|agvia|panwo|pafixa|panpark|auto/i, 'VEICULOS'], [/entrega|amigavel/i, 'ENTREGA'], [/refin/i, 'REFIN']];

export function metaOf(seg) {
  const head = [];
  for (const l of seg) { if (l.dialog && head.length) break; head.push(l); if (head.length >= 15) break; }
  const headText = head.map((l) => l.text).join('\n');
  const all = seg.map((l) => l.text).join('\n');
  const meta = {};
  const audio = (headText.match(AUDIO_RE) || all.match(AUDIO_RE) || [])[0];
  if (audio) {
    meta.audioFile = audio;
    const stem = audio.replace(/\.[a-z0-9]+$/i, '');
    // ID no começo (padrão do discador) ou no fim (nome original no speech: asp-t2-epro…_43501102.wav)
    const id = stem.match(/^(\d{6,})[_\-.]/) || stem.match(/[_-](\d{6,})$/);
    if (id) meta.callId = id[1];
    // ..._LOGIN_DDMMAA_HHMM.wav (padrão do discador)
    const lg = stem.match(/_([a-z][a-z0-9.]{2,30})_(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})$/i);
    if (lg) {
      meta.login = lg[1].toLowerCase();
      meta.date = `20${lg[4]}-${lg[3]}-${lg[2]}`;
      meta.time = `${lg[5]}:${lg[6]}`;
    }
    const q = QUEUE_PRODUCT.find(([re]) => re.test(norm(stem).replace(/[^a-z]/g, '')));
    if (q) meta.product = q[1];
  }
  for (const l of head) {
    const m = l.text.match(META_RE);
    if (!m || !l.meta) continue;
    const k = norm(m[1]), v = m[2].trim();
    if (/^(operador|operadora|operador\(a\)|agente|atendente|colaborador|colaboradora|consultor|consultora|nome do operador)$/.test(k) && !meta.operatorName) meta.operatorName = v.replace(/\s*\(.*?\)\s*$/, '');
    else if (/^(login|usuario)$/.test(k) && !meta.login) meta.login = v.split(/\s+/)[0].toLowerCase();
    else if (k === 'matricula' && !meta.registration) meta.registration = v;
    else if (k === 'data' && !meta.date) { const d = v.match(/(\d{2})\/(\d{2})\/(\d{2,4})/); if (d) meta.date = `${d[3].length === 2 ? '20' + d[3] : d[3]}-${d[2]}-${d[1]}`; }
    else if (k === 'hora' && !meta.time) meta.time = (v.match(/\d{1,2}:\d{2}/) || [])[0];
    else if (/^(protocolo|id|id da ligacao)$/.test(k) && !meta.callId) meta.callId = (v.match(/\d{5,}/) || [])[0];
    else if (/^(carteira|produto|fila|segmento)$/.test(k) && !meta.product) { const q = QUEUE_PRODUCT.find(([re]) => re.test(norm(v))); if (q) meta.product = q[1]; }
    else if (/^(supervisor|supervisora|lider|equipe)$/.test(k) && !meta.leader) meta.leader = v;
  }
  if (!meta.callId) { const id = headText.match(/(?:liga[cç][aã]o|chamada|protocolo|transcri[cç][aã]o|grava[cç][aã]o|atendimento|id)[^\d\n]{0,20}(\d{6,})/i); if (id) meta.callId = id[1]; }
  if (!meta.date) { const d = headText.match(/(\d{2})\/(\d{2})\/(\d{4})/); if (d) meta.date = `${d[3]}-${d[2]}-${d[1]}`; }
  // Sem cabeçalho: o próprio operador costuma se apresentar ("meu nome é Tainara")
  if (!meta.operatorName) {
    const said = all.match(/(?:meu nome [eé]|aqui [eé] (?:o |a )?|quem fala [eé] (?:o |a )?|eu sou (?:o |a )?)([A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+)?)/);
    if (said) meta.spokenName = said[1];
  }
  meta.title = meta.audioFile || (meta.callId ? `Ligação ${meta.callId}` : head.find((l) => (l.heading || l.label) && !l.dialog)?.text || null);
  return meta;
}

export function splitTranscripts(lines) {
  const { method, segments } = splitLines(lines);
  return {
    method,
    items: segments.map((seg, n) => {
      const meta = metaOf(seg);
      meta.title = meta.title || (segments.length > 1 ? `Ligação ${n + 1}` : 'Transcrição');
      return { n: n + 1, meta, text: seg.map((l) => l.text).join('\n'), lines: seg.length };
    }),
  };
}

// ---------- Vínculo com a base: monitoria existente e operador ----------
const tokens = (s) => norm(s).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1 && !['de', 'da', 'do', 'dos', 'das', 'e'].includes(t));

export function matchOperator(meta, operators) {
  if (meta.login) {
    const o = operators.find((x) => x.login && x.login.toLowerCase() === meta.login);
    if (o) return { op: o, how: 'login' };
  }
  if (meta.registration) {
    const o = operators.find((x) => x.registration && norm(x.registration) === norm(meta.registration));
    if (o) return { op: o, how: 'matrícula' };
  }
  if (meta.operatorName) {
    const want = tokens(meta.operatorName);
    const exact = operators.find((x) => norm(x.name) === norm(meta.operatorName));
    if (exact) return { op: exact, how: 'nome' };
    // Nome parcial ("Maria Souza" para "Maria Eduarda Souza"): todas as palavras informadas aparecem no cadastro
    const partial = operators.filter((x) => { const have = tokens(x.name); return want.length >= 2 && want.every((t) => have.includes(t)); });
    if (partial.length === 1) return { op: partial[0], how: 'nome' };
  }
  if (meta.spokenName) {
    const first = norm(meta.spokenName).split(' ')[0];
    const cands = operators.filter((x) => tokens(x.name)[0] === first);
    if (cands.length === 1) return { op: cands[0], how: 'nome falado na ligação', weak: true };
  }
  return null;
}

// operatorId (opcional): sem ID nem áudio, vale operador + data (+ hora) quando só houver uma ligação assim
export function matchEvaluation(meta, evaluations, operatorId = null) {
  const stem = (s) => norm(String(s || '').replace(/\.[a-z0-9]+$/i, ''));
  if (meta.callId) {
    const e = evaluations.find((x) => String(x.external_id || '') === meta.callId || String(x.protocol || '') === meta.callId);
    if (e) return e;
  }
  if (meta.audioFile) {
    const e = evaluations.find((x) => x.audio_file && stem(x.audio_file) === stem(meta.audioFile));
    if (e) return e;
  }
  if (operatorId && meta.date) {
    const c = evaluations.filter((x) => String(x.operator_id) === String(operatorId) && x.call_date === meta.date && (!meta.time || !x.call_time || x.call_time === meta.time));
    if (c.length === 1) return c[0];
  }
  return null;
}

// @ts-nocheck — transcrição do áudio das ligações com o Azure Speech (fast transcription, síncrona)
// Docs: https://learn.microsoft.com/azure/ai-services/speech-service/fast-transcription-create
// O áudio vai do servidor direto para o recurso de Speech da empresa; a plataforma guarda só o texto.
import { getSetting } from './db.ts';

const API_VERSION = '2025-10-15';
// Termos da operação que o reconhecimento costuma errar
const PHRASES = ['Paschoalotto', 'Banco PAN', 'entrega amigável', 'refinanciamento', 'refin', 'Serasa', 'boleto', 'Pix', 'consignado', 'parcela em atraso', 'quitação'];

const env = (k) => Deno.env.get(k) || '';
const httpError = (status, message) => Object.assign(new Error(message), { status });

export function speechConfig() {
  const key = env('AZURE_SPEECH_KEY') || getSetting('azure_speech_key') || '';
  const where = (env('AZURE_SPEECH_ENDPOINT') || getSetting('azure_speech_endpoint') || '').trim();
  // Aceita a região ("brazilsouth") ou o endpoint do recurso ("https://meu-recurso.cognitiveservices.azure.com")
  const endpoint = !where ? '' : /^https?:\/\//i.test(where) ? where.replace(/\/+$/, '') : `https://${where.toLowerCase()}.api.cognitive.microsoft.com`;
  return {
    key, endpoint,
    mode: getSetting('azure_speech_mode', 'diarizacao') === 'canais' ? 'canais' : 'diarizacao',
    keySource: env('AZURE_SPEECH_KEY') ? 'variavel_ambiente' : getSetting('azure_speech_key') ? 'banco' : null,
  };
}

export const speechConfigured = () => { const c = speechConfig(); return !!(c.key && c.endpoint); };

async function callAzure(cfg, bytes, filename, contentType, definition) {
  const form = new FormData();
  form.append('audio', new Blob([bytes], { type: contentType || 'application/octet-stream' }), filename || 'ligacao.wav');
  form.append('definition', JSON.stringify(definition));
  let res;
  try {
    res = await fetch(`${cfg.endpoint}/speechtotext/transcriptions:transcribe?api-version=${API_VERSION}`, {
      method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': cfg.key }, body: form, signal: AbortSignal.timeout(140000),
    });
  } catch (e) {
    throw httpError(502, e?.name === 'TimeoutError' ? 'O Azure Speech demorou demais para responder. Tente um áudio menor ou tente de novo.' : 'Não foi possível conectar ao Azure Speech. Confira o endpoint/região nas Configurações.');
  }
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j?.error?.message || j?.message || ''; } catch { /* sem corpo */ }
    if (res.status === 401 || res.status === 403) throw httpError(502, 'Chave ou região do Azure Speech inválida. Revise em Configurações.');
    if (res.status === 404) throw httpError(502, 'Endpoint do Azure Speech não encontrado. Confira a região/endpoint em Configurações.');
    if (res.status === 429) throw httpError(429, 'Limite de uso do Azure Speech atingido. Aguarde alguns instantes e tente de novo.');
    if (res.status === 413) throw httpError(413, 'O Azure Speech recusou o arquivo por tamanho.');
    throw httpError(502, `O Azure Speech recusou o áudio${detail ? `: ${detail}` : ` (erro ${res.status})`}.`);
  }
  return res.json();
}

// Quem é o operador: o lado que se apresenta e fala de dívida/proposta
const OPERATOR_WORDS = /paschoalotto|pascualotto|meu nome|falo d[ae]|em nome d|assessoria|banco pan|est[aá] sendo gravad|liga[cç][aã]o (?:est[aá] sendo |[eé] )?gravad|gravada|confirm\w* (?:os )?(?:tr[eê]s )?(?:primeiros )?d[ií]gitos|cpf|parcela|em atraso|d[eé]bito|proposta|boleto|acordo|desconto|vencimento|consigo te ajudar|posso te ajudar/gi;

function toTranscript(result, mode) {
  const phrases = (result.phrases || []).filter((p) => String(p.text || '').trim());
  const keyOf = (p) => (mode === 'canais' ? p.channel ?? 0 : p.speaker ?? p.channel ?? 0);
  const groups = new Map();
  for (const p of phrases) {
    const k = keyOf(p);
    const g = groups.get(k) || { score: 0, words: 0, first: p.offsetMilliseconds || 0 };
    g.score += (String(p.text).match(OPERATOR_WORDS) || []).length;
    g.words += String(p.text).split(/\s+/).length;
    groups.set(k, g);
  }
  const keys = [...groups.keys()];
  let operatorKey = null;
  if (keys.length > 1) {
    operatorKey = keys.sort((a, b) => (groups.get(b).score - groups.get(a).score) || (groups.get(b).words - groups.get(a).words))[0];
  }
  const label = (k) => (operatorKey == null ? null : k === operatorKey ? 'Operador' : keys.length > 2 ? `Cliente ${keys.indexOf(k)}` : 'Cliente');
  const stamp = (ms) => { const s = Math.floor((ms || 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  // Junta frases seguidas do mesmo falante (pausas curtas) para a leitura ficar natural
  const lines = [];
  let cur = null;
  for (const p of phrases.sort((a, b) => (a.offsetMilliseconds || 0) - (b.offsetMilliseconds || 0))) {
    const k = keyOf(p);
    const start = p.offsetMilliseconds || 0;
    if (cur && cur.k === k && start - cur.end < 1500) { cur.text += ` ${p.text.trim()}`; cur.end = start + (p.durationMilliseconds || 0); continue; }
    cur = { k, start, end: start + (p.durationMilliseconds || 0), text: p.text.trim() };
    lines.push(cur);
  }
  const text = lines.map((l) => `[${stamp(l.start)}] ${label(l.k) ? `${label(l.k)}: ` : ''}${l.text}`).join('\n');
  const conf = phrases.length ? phrases.reduce((a, p) => a + (Number(p.confidence) || 0), 0) / phrases.length : null;
  return {
    text, durationSec: result.durationMilliseconds ? Math.round(result.durationMilliseconds / 1000) : null,
    speakers: keys.length, operatorIdentified: operatorKey != null, confidence: conf != null ? Math.round(conf * 100) / 100 : null, phrases: phrases.length,
  };
}

export async function transcribeAudio(bytes, { filename, contentType } = {}) {
  const cfg = speechConfig();
  if (!cfg.key || !cfg.endpoint) throw httpError(400, 'Configure o Azure Speech (chave e região) em Configurações para transcrever áudios.');
  if (!bytes?.byteLength) throw httpError(400, 'Envie o arquivo de áudio da ligação.');
  const base = { locales: ['pt-BR'], profanityFilterMode: 'None', phraseList: { phrases: PHRASES } };
  let mode = cfg.mode;
  let result = await callAzure(cfg, bytes, filename, contentType, mode === 'canais' ? { ...base, channels: [0, 1] } : { ...base, diarization: { enabled: true, maxSpeakers: 2 } });
  // Áudio mono no modo "canais": não há como separar por canal, refaz separando pela voz
  if (mode === 'canais' && new Set((result.phrases || []).map((p) => p.channel ?? 0)).size < 2 && (result.phrases || []).length > 3) {
    mode = 'diarizacao';
    result = await callAzure(cfg, bytes, filename, contentType, { ...base, diarization: { enabled: true, maxSpeakers: 2 } });
  }
  const out = toTranscript(result, mode);
  if (!out.text.trim()) throw httpError(422, 'O Azure Speech não encontrou fala neste áudio (silêncio, ruído ou ligação muda).');
  return { ...out, mode };
}

// Teste da configuração: envia 1 segundo de silêncio (WAV 16 kHz mono) e confere se o Azure aceita
export async function testSpeech() {
  const cfg = speechConfig();
  if (!cfg.key || !cfg.endpoint) throw httpError(400, 'Informe a chave e a região/endpoint do Azure Speech.');
  const rate = 16000, samples = rate, buf = new ArrayBuffer(44 + samples * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, samples * 2, true);
  await callAzure(cfg, new Uint8Array(buf), 'teste.wav', 'audio/wav', { locales: ['pt-BR'] });
  return { ok: true, endpoint: cfg.endpoint };
}

export { toTranscript };

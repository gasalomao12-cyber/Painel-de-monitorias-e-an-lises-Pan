// @ts-nocheck — portado do servidor Node; tipagem frouxa de propósito
// Regra de nota: Conforme = 100% do peso, Parcial = 50%, Não conforme = 0, N/A sai da base.
// Critério marcado como crítico em "Não conforme" zera a nota (falha grave).

const PARTIAL_FACTOR = 0.5;

function computeScore(items, field = 'final_result') {
  let total = 0, points = 0, criticalFail = false, counted = 0;
  for (const it of items) {
    const r = it[field] || it.speech_result;
    if (!r || r === 'NA') continue;
    const w = Number(it.weight) || 1;
    total += w; counted++;
    if (r === 'C') points += w;
    else if (r === 'P') points += w * PARTIAL_FACTOR;
    else if (r === 'NC' && it.critical) criticalFail = true;
  }
  if (!counted) return { score: null, criticalFail: false };
  const score = criticalFail ? 0 : Math.round((points / total) * 1000) / 10;
  return { score, criticalFail };
}

function band(score) {
  if (score == null) return 'sem_nota';
  if (score >= 90) return 'excelente';
  if (score >= 75) return 'bom';
  if (score >= 60) return 'atencao';
  return 'critico';
}

export { computeScore, band, PARTIAL_FACTOR };

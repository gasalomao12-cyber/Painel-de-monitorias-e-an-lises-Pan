// @ts-nocheck — carteira que cada pessoa enxerga na plataforma: PAN, SAFRA ADM (ADM e Call), SAFRA BS e PORTO.
// Vem do campo Carteira do acesso (px_profiles.portfolio), o mesmo da força-tarefa de queda:
// "SAFRA BS" = Safra BS; "SAFRA ADM" ou "SAFRA CALL" = Safra ADM e Call; "SAFRA" sozinho = as duas do Safra;
// "PORTO BANK" = Porto; vazio = PAN; "PAN SAFRA PORTO BANK" = todas.
// Quem tem mais de uma carteira (e o administrador, que vê todas) escolhe no seletor da barra superior
// (cabeçalho x-px-carteira); sem escolha, vê todas as suas.
export const CARTEIRAS = ['PAN', 'SAFRA ADM', 'SAFRA BS', 'PORTO'];
const word = (p, w) => new RegExp(`(^|[^A-Z])${w}([^A-Z]|$)`).test(p);

export function carteirasOfText(v) {
  const p = String(v || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const l = new Set();
  if (word(p, 'PAN')) l.add('PAN');
  if (word(p, 'PORTO')) l.add('PORTO');
  if (word(p, 'SAFRA')) {
    const bs = word(p, 'BS'), adm = word(p, 'ADM') || word(p, 'CALL');
    if (bs) l.add('SAFRA BS');
    if (adm) l.add('SAFRA ADM');
    if (!bs && !adm) { l.add('SAFRA ADM'); l.add('SAFRA BS'); }
  }
  return CARTEIRAS.filter((c) => l.has(c));
}
export function carteirasOfUser(u) { const l = carteirasOfText(u?.portfolio); return l.length ? l : ['PAN']; }
// Valor gravado no operador: uma das carteiras (o que vier fora da lista vira PAN)
export const carteiraValue = (v) => { const l = carteirasOfText(v); return l.length === 1 ? l[0] : 'PAN'; };

// Carteiras que a requisição enxerga: lista, ou null quando são todas
export function carteiraScope(req) {
  if (!req.user) return null;
  const h = String(req.headers['x-px-carteira'] || '').trim().toUpperCase();
  const own = req.user.role === 'admin' ? CARTEIRAS : carteirasOfUser(req.user);
  if (own.length > 1 && own.includes(h)) return [h];
  return own.length === CARTEIRAS.length ? null : own;
}
// Operador gravado como "SAFRA" (antes da divisão) aparece nas duas visões do Safra
export const inScope = (scope, pf) => !scope || scope.includes(pf || 'PAN') || (pf === 'SAFRA' && scope.some((c) => c.startsWith('SAFRA')));
// Filtro da coluna portfolio para o escopo
export const scopeValues = (scope) => (scope.some((c) => c.startsWith('SAFRA')) ? [...scope, 'SAFRA'] : scope);
// Carteira em que entram os operadores novos de uma importação
export const carteiraNew = (req) => { const s = carteiraScope(req); return s && s.length === 1 ? s[0] : 'PAN'; };

// Carteira de um atendimento da força-tarefa de queda ("SAFRA BS", "SAFRA ADM", "PAN CONTACT"…)
export const carteiraGroup = (c) => {
  const v = String(c || '').toUpperCase();
  if (!v) return null;
  if (v.startsWith('SAFRA')) return word(v, 'BS') ? 'SAFRA BS' : word(v, 'ADM') || word(v, 'CALL') ? 'SAFRA ADM' : 'SAFRA';
  return v.startsWith('PORTO') ? 'PORTO' : 'PAN';
};

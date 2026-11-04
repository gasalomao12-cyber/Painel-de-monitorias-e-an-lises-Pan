// @ts-nocheck — carteira (PAN, SAFRA, PORTO) que cada pessoa enxerga na plataforma.
// Vem do campo Carteira do acesso (px_profiles.portfolio), que também guarda a carteira da força-tarefa de queda:
// "SAFRA ADM" e "SAFRA BS" = SAFRA, "PORTO BANK" = PORTO, vazio = PAN, e "PAN SAFRA PORTO BANK" = as três.
// Quem tem mais de uma carteira (e o administrador, que vê todas) escolhe no seletor da barra superior
// (cabeçalho x-px-carteira); sem escolha, vê todas as suas.
export const CARTEIRAS = ['PAN', 'SAFRA', 'PORTO'];

export function carteirasOfUser(u) {
  const p = String(u?.portfolio || '').toUpperCase();
  const l = CARTEIRAS.filter((c) => new RegExp(`(^|[^A-Z])${c}([^A-Z]|$)`).test(p));
  return l.length ? l : ['PAN'];
}

// Carteiras que a requisição enxerga: lista, ou null quando são todas
export function carteiraScope(req) {
  if (!req.user) return null;
  const h = String(req.headers['x-px-carteira'] || '').toUpperCase();
  const own = req.user.role === 'admin' ? CARTEIRAS : carteirasOfUser(req.user);
  if (own.length > 1 && own.includes(h)) return [h];
  return own.length === CARTEIRAS.length ? null : own;
}
export const inScope = (scope, pf) => !scope || scope.includes(pf || 'PAN');
// Carteira em que entram os operadores novos de uma importação
export const carteiraNew = (req) => { const s = carteiraScope(req); return s && s.length === 1 ? s[0] : 'PAN'; };

// Grupo de uma carteira analisada da força-tarefa de queda ("SAFRA BS" → SAFRA, "PAN CONTACT" → PAN)
export const carteiraGroup = (c) => { const v = String(c || '').toUpperCase(); return v.startsWith('SAFRA') ? 'SAFRA' : v.startsWith('PORTO') ? 'PORTO' : v ? 'PAN' : null; };

// @ts-nocheck — carteira (PAN, SAFRA, PORTO) que cada pessoa enxerga na plataforma.
// Qualidade e Supervisão veem só a própria carteira (px_profiles.portfolio; vazio = PAN). O administrador vê todas,
// ou a que escolher no seletor da barra superior (cabeçalho x-px-carteira).
export const CARTEIRAS = ['PAN', 'SAFRA', 'PORTO'];

export function carteiraOf(req) {
  if (!req.user) return null;
  if (req.user.role === 'admin') { const h = String(req.headers['x-px-carteira'] || '').toUpperCase(); return CARTEIRAS.includes(h) ? h : null; }
  const p = String(req.user.portfolio || '').trim().toUpperCase();
  return CARTEIRAS.includes(p) ? p : 'PAN';
}

// Grupo de uma carteira analisada da força-tarefa de queda ("SAFRA BS" → SAFRA, "PAN CONTACT" → PAN)
export const carteiraGroup = (c) => { const v = String(c || '').toUpperCase(); return v.startsWith('SAFRA') ? 'SAFRA' : v.startsWith('PORTO') ? 'PORTO' : v ? 'PAN' : null; };

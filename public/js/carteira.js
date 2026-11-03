// Carteira (PAN, SAFRA, PORTO) de quem está usando: define o que a pessoa vê e as cores e a logo da plataforma.
// Qualidade e Supervisão ficam na própria carteira; o administrador escolhe no seletor da barra superior.
export const CARTEIRAS = ['PAN', 'SAFRA', 'PORTO'];
export const CARTEIRA_INFO = {
  PAN: { label: 'Banco PAN', logo: 'brand/banco-pan-branco.png' },
  SAFRA: { label: 'Safra', logo: 'brand/safra-branco.png' },
  PORTO: { label: 'Porto Bank', logo: 'brand/porto-bank-branco.svg' },
};
const KEY = 'px_carteira';
export function chosenCarteira() { try { const v = localStorage.getItem(KEY); return CARTEIRAS.includes(v) ? v : ''; } catch { return ''; } }
export function chooseCarteira(v) { try { if (CARTEIRAS.includes(v)) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* sem storage */ } }

// Carteira em vigor para a pessoa: a dela (vazio = PAN) ou, para o admin, a escolhida ('' = todas)
export function viewCarteira(user) {
  if (!user) return '';
  if (user.role === 'admin') return chosenCarteira();
  const p = String(user.portfolio || '').toUpperCase();
  return CARTEIRAS.includes(p) ? p : 'PAN';
}

export function applyCarteira(user) {
  const c = viewCarteira(user);
  if (c) document.documentElement.dataset.carteira = c; else delete document.documentElement.dataset.carteira;
  return c;
}

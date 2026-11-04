// Carteira (PAN, SAFRA, PORTO) de quem está usando: define o que a pessoa vê e as cores e a logo da plataforma.
// Quem tem uma carteira fica nela; o administrador e quem tem várias escolhem no seletor da barra superior.
export const CARTEIRAS = ['PAN', 'SAFRA', 'PORTO'];
// Logos oficiais: versão clara (sobre fundo escuro) e versão colorida (tema claro)
export const CARTEIRA_INFO = {
  PAN: { label: 'Banco PAN', logo: 'brand/banco-pan-branco.png', logoLight: 'brand/banco-pan.png' },
  SAFRA: { label: 'Safra', logo: 'brand/safra-branco.svg', logoLight: 'brand/safra.svg' },
  PORTO: { label: 'Porto Bank', logo: 'brand/porto-branco.svg', logoLight: 'brand/porto.svg' },
};
// As duas versões da logo; o CSS mostra a certa para o tema
export const carteiraLogo = (c) => { const i = CARTEIRA_INFO[c]; return i ? `<img class="lg-d" src="${i.logo}" alt="${i.label}"><img class="lg-l" src="${i.logoLight}" alt="${i.label}">` : ''; };
const KEY = 'px_carteira';
export function chosenCarteira() { try { const v = localStorage.getItem(KEY); return CARTEIRAS.includes(v) ? v : ''; } catch { return ''; } }
export function chooseCarteira(v) { try { if (CARTEIRAS.includes(v)) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* sem storage */ } }

// Carteiras do acesso: "SAFRA ADM" = SAFRA, "PORTO BANK" = PORTO, vazio = PAN, "PAN SAFRA PORTO BANK" = as três
export function userCarteiras(user) {
  if (!user) return [];
  if (user.role === 'admin') return CARTEIRAS;
  const p = String(user.portfolio || '').toUpperCase();
  const l = CARTEIRAS.filter((c) => new RegExp(`(^|[^A-Z])${c}([^A-Z]|$)`).test(p));
  return l.length ? l : ['PAN'];
}
// Carteira em vigor: a única da pessoa ou, para quem tem várias, a escolhida no seletor ('' = todas as suas)
export function viewCarteira(user) {
  const own = userCarteiras(user);
  if (own.length === 1) return own[0];
  const c = chosenCarteira();
  return own.includes(c) ? c : '';
}

export function applyCarteira(user) {
  const c = viewCarteira(user);
  if (c) document.documentElement.dataset.carteira = c; else delete document.documentElement.dataset.carteira;
  return c;
}

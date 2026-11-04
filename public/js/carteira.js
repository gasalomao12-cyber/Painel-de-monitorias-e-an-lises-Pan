// Carteira de quem está usando (PAN, Safra ADM e Call, Safra BS, Porto): define o que a pessoa vê e as cores e a
// logo da plataforma. Quem tem uma carteira fica nela; o administrador e quem tem várias escolhem no seletor do topo.
export const CARTEIRAS = ['PAN', 'SAFRA ADM', 'SAFRA BS', 'PORTO'];
// Logos oficiais: versão clara (sobre fundo escuro) e versão colorida (tema claro); theme = cores da plataforma
const SAFRA_LOGO = { logo: 'brand/safra-branco.svg', logoLight: 'brand/safra.svg', theme: 'SAFRA' };
export const CARTEIRA_INFO = {
  PAN: { label: 'Banco PAN', logo: 'brand/banco-pan-branco.png', logoLight: 'brand/banco-pan.png', theme: 'PAN' },
  'SAFRA ADM': { label: 'Safra ADM e Call', tag: 'ADM · Call', ...SAFRA_LOGO },
  'SAFRA BS': { label: 'Safra BS', tag: 'BS', ...SAFRA_LOGO },
  PORTO: { label: 'Porto Bank', logo: 'brand/porto-branco.svg', logoLight: 'brand/porto.svg', theme: 'PORTO' },
};
// As duas versões da logo (o CSS mostra a certa para o tema) e, no Safra, qual das duas carteiras
export const carteiraLogo = (c) => { const i = CARTEIRA_INFO[c]; return i ? `<img class="lg-d" src="${i.logo}" alt="${i.label}"><img class="lg-l" src="${i.logoLight}" alt="${i.label}">${i.tag ? `<span class="lg-tag">${i.tag}</span>` : ''}` : ''; };
export const carteiraTheme = (c) => CARTEIRA_INFO[c]?.theme || '';
const KEY = 'px_carteira';
export function chosenCarteira() { try { const v = localStorage.getItem(KEY); return CARTEIRAS.includes(v) ? v : ''; } catch { return ''; } }
export function chooseCarteira(v) { try { if (CARTEIRAS.includes(v)) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* sem storage */ } }

// Carteiras do acesso: "SAFRA BS" = Safra BS; "SAFRA ADM" ou "SAFRA CALL" = Safra ADM e Call; "SAFRA" = as duas;
// "PORTO BANK" = Porto; vazio = PAN; "PAN SAFRA PORTO BANK" = todas
const word = (p, w) => new RegExp(`(^|[^A-Z])${w}([^A-Z]|$)`).test(p);
export function userCarteiras(user) {
  if (!user) return [];
  if (user.role === 'admin') return CARTEIRAS;
  const p = String(user.portfolio || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const l = new Set();
  if (word(p, 'PAN')) l.add('PAN');
  if (word(p, 'PORTO')) l.add('PORTO');
  if (word(p, 'SAFRA')) {
    const bs = word(p, 'BS'), adm = word(p, 'ADM') || word(p, 'CALL');
    if (bs) l.add('SAFRA BS');
    if (adm) l.add('SAFRA ADM');
    if (!bs && !adm) { l.add('SAFRA ADM'); l.add('SAFRA BS'); }
  }
  const out = CARTEIRAS.filter((c) => l.has(c));
  return out.length ? out : ['PAN'];
}
// Carteira em vigor: a única da pessoa ou, para quem tem várias, a escolhida no seletor ('' = todas as suas)
export function viewCarteira(user) {
  const own = userCarteiras(user);
  if (own.length === 1) return own[0];
  const c = chosenCarteira();
  return own.includes(c) ? c : '';
}

export function applyCarteira(user) {
  const c = viewCarteira(user), d = document.documentElement.dataset;
  if (c) { d.carteira = carteiraTheme(c); d.carteiraKey = c; } else { delete d.carteira; delete d.carteiraKey; }
  return c;
}

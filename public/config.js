// Configuração pública do site. A chave publicável é feita para ficar no navegador:
// sozinha ela não lê nem grava nada nas tabelas da plataforma (RLS fechado).
window.PX_CONFIG = {
  supabaseUrl: 'https://avhlvnuspaaacuitvjdd.supabase.co',
  publishableKey: 'sb_publishable_10wGU6JMGnG2tzH0Jih6Iw_D-q70EHF',
  // URL da Edge Function px-api (padrão: <supabaseUrl>/functions/v1/px-api)
  apiUrl: '',
};
// Para testes locais: localStorage.setItem('px_dev_config', JSON.stringify({ supabaseUrl, publishableKey, apiUrl }))
try { Object.assign(window.PX_CONFIG, JSON.parse(localStorage.getItem('px_dev_config') || '{}')); } catch (e) { /* sem override */ }

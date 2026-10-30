#!/usr/bin/env bash
# Aponta as telas (pasta public/) para o Supabase da VM.
# Uso: ./configurar-telas.sh https://px-api.EMPRESA.com.br <ANON_KEY> [/opt/px-app]
# Rode de novo depois de cada atualização do código (o atualizar.sh já chama este script).
set -euo pipefail

API_URL="${1:?Informe a URL da API, ex.: https://px-api.EMPRESA.com.br}"
ANON_KEY="${2:?Informe o ANON_KEY do .env do Supabase}"
APP_DIR="${3:-/opt/px-app}"
API_URL="${API_URL%/}"
API_HOST="${API_URL#https://}"
PUB="$APP_DIR/public"

# Endereço do Supabase e chave publicável
cat > "$PUB/config.js" <<EOF
// Configuração da VM (gerada por implantacao-vm/scripts/configurar-telas.sh)
window.PX_CONFIG = {
  supabaseUrl: '$API_URL',
  publishableKey: '$ANON_KEY',
  apiUrl: '',
};
try { Object.assign(window.PX_CONFIG, JSON.parse(localStorage.getItem('px_dev_config') || '{}')); } catch (e) { /* sem override */ }
EOF

# Política de segurança (CSP) das páginas: libera o domínio da API em vez de *.supabase.co
for f in index.html report.html redefinir-senha.html; do
  sed -i \
    -e "s#https://\*\.supabase\.co#https://$API_HOST#g" \
    -e "s#wss://\*\.supabase\.co#wss://$API_HOST#g" \
    "$PUB/$f"
done

# Versão publicada: a plataforma compara com a aberta e avisa quando há uma nova
SHA="$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || date +%s)"
printf '{"v":"%s","at":"%s"}\n' "$SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$PUB/version.json"

echo "Telas configuradas para $API_URL"

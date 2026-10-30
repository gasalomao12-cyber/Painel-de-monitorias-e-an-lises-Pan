#!/usr/bin/env bash
# Atualiza a PX Monitorias na VM com a versão mais recente do GitHub.
# Uso: ./atualizar.sh https://px-api.EMPRESA.com.br <ANON_KEY> [/opt/px-app] [/opt/px]
set -euo pipefail

API_URL="${1:?Informe a URL da API}"
ANON_KEY="${2:?Informe o ANON_KEY}"
APP_DIR="${3:-/opt/px-app}"
SUPA_DIR="${4:-/opt/px}"
HERE="$(cd "$(dirname "$0")" && pwd)"

# 1. Código novo (descarta as edições locais de config.js e da CSP, refeitas no passo 4)
git -C "$APP_DIR" fetch origin main
git -C "$APP_DIR" reset --hard origin/main

# 2. Banco: as migrações já aplicadas não mudam nada
"$HERE/aplicar-migracoes.sh" "$APP_DIR"

# 3. API: copia a função e reinicia o container de funções
rm -rf "$SUPA_DIR/volumes/functions/px-api"
cp -r "$APP_DIR/supabase/functions/px-api" "$SUPA_DIR/volumes/functions/px-api"
docker compose -f "$SUPA_DIR/docker-compose.yml" restart functions

# 4. Telas apontando para a VM
"$HERE/configurar-telas.sh" "$API_URL" "$ANON_KEY" "$APP_DIR"

curl -fsS "$API_URL/functions/v1/px-api/healthz" && echo " ← API no ar"

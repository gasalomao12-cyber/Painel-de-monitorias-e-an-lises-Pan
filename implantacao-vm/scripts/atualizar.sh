#!/usr/bin/env bash
# Atualiza a PX Monitorias com a versão mais recente do GitHub e reinicia o serviço.
# Uso (como root): ./atualizar.sh [/opt/px-app] [/etc/px-monitorias/px.env]
set -euo pipefail
APP_DIR="${1:-/opt/px-app}"
ENV_FILE="${2:-/etc/px-monitorias/px.env}"
HERE="$(cd "$(dirname "$0")" && pwd)"
set -a; . "$ENV_FILE"; set +a

git -C "$APP_DIR" fetch origin main
git -C "$APP_DIR" reset --hard origin/main
"$HERE/aplicar-migracoes.sh" "$PX_DATABASE_URL" "$APP_DIR"
systemctl restart px-monitorias
sleep 3
curl -fsS "http://${PX_HOST:-127.0.0.1}:${PX_PORT:-8080}/px-api/healthz" && echo " ← PX Monitorias no ar"

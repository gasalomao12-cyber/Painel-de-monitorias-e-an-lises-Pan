#!/usr/bin/env bash
# Cria ou atualiza o banco da PX Monitorias rodando as migrações em ordem de data.
# Todas podem ser rodadas mais de uma vez. Uso: ./aplicar-migracoes.sh [/opt/px-app] [container-do-banco]
set -euo pipefail

APP_DIR="${1:-/opt/px-app}"
DB="${2:-supabase-db}"

for f in "$APP_DIR"/supabase/migrations/*.sql; do
  echo "→ $(basename "$f")"
  docker exec -i "$DB" psql -U postgres -v ON_ERROR_STOP=1 -q < "$f"
done
echo "Migrações aplicadas."

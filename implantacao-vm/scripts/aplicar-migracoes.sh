#!/usr/bin/env bash
# Atualiza o banco da PX Monitorias: roda, em ordem de data, só as migrações de supabase/migrations/ que ainda não
# estão em public.px_schema_migrations (o px_monitorias_postgres.sql já marca as que contém).
# Uso: ./aplicar-migracoes.sh "postgres://px:SENHA@127.0.0.1:5432/px_monitorias" [/opt/px-app]
set -euo pipefail
URL="${1:?Informe a URL do banco}"
APP_DIR="${2:-/opt/px-app}"
PSQL="${PSQL:-psql}"
run() { $PSQL "$URL" -v ON_ERROR_STOP=1 -q "$@"; }

for f in "$APP_DIR"/supabase/migrations/*.sql; do
  v="$(basename "$f" .sql)"
  [ "$(run -tAc "select 1 from public.px_schema_migrations where version = '$v'")" = "1" ] && continue
  echo "→ $v"
  run -f "$f"
  run -c "insert into public.px_schema_migrations (version) values ('$v')"
done
echo "Banco atualizado."

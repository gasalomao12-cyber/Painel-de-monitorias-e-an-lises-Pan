#!/usr/bin/env bash
# Cria ou atualiza o banco da PX Monitorias. Roda, em ordem de data, só as migrações que ainda
# não foram aplicadas (registradas em public.px_schema_migrations).
# Uso: ./aplicar-migracoes.sh [/opt/px-app] [container-do-banco]
set -euo pipefail

APP_DIR="${1:-/opt/px-app}"
DB="${2:-supabase-db}"
psql_db() { docker exec -i "$DB" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

psql_db -c "create table if not exists public.px_schema_migrations (version text primary key, applied_at timestamptz not null default now());
            alter table public.px_schema_migrations enable row level security;" >/dev/null

for f in "$APP_DIR"/supabase/migrations/*.sql; do
  v="$(basename "$f" .sql)"
  if [ "$(psql_db -tAc "select 1 from public.px_schema_migrations where version = '$v'")" = "1" ]; then continue; fi
  echo "→ $v"
  psql_db < "$f"
  psql_db -c "insert into public.px_schema_migrations (version) values ('$v')" >/dev/null
done
echo "Banco atualizado."

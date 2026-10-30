#!/usr/bin/env bash
# Gera px_monitorias_completo.sql juntando as migrações de supabase/migrations/ em ordem.
# Uso (na raiz do projeto): implantacao-vm/sql/gerar-sql-completo.sh
set -euo pipefail
OUT=implantacao-vm/sql/px_monitorias_completo.sql
{
  cat implantacao-vm/sql/cabecalho.sql
  for f in supabase/migrations/*.sql; do
    printf -- '\n-- -------------------------------------------------------------------------------------\n-- %s\n-- -------------------------------------------------------------------------------------\n\n' "$(basename "$f")"
    cat "$f"; printf '\n'
    printf "insert into public.px_schema_migrations (version) values ('%s') on conflict do nothing;\n" "$(basename "$f" .sql)"
  done
  printf "\nnotify pgrst, 'reload schema';\n"
} > "$OUT"
echo "Gerado: $OUT"

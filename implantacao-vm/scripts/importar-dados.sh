#!/usr/bin/env bash
# Importa no banco da VM os dados exportados por exportar-dados-supabase.sh.
# Rode DEPOIS do SQL completo (ou de aplicar-migracoes.sh), com a VM ainda sem uso.
# Uso: ./importar-dados.sh [pasta-dos-arquivos] [container-do-banco]
set -euo pipefail

IN="${1:-./dados-px}"
DB="${2:-supabase-db}"
# supabase_admin: o papel com permissão para desligar os gatilhos durante a carga
run() { docker exec -i "$DB" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q; }

# A instalação já cria dados padrão (critérios, configurações): a carga substitui tudo pelo que veio da nuvem.
# Proteção: não roda sobre um banco que já tem usuários, a menos que FORCAR=1.
n="$(docker exec -i "$DB" psql -U postgres -d postgres -tAc 'select count(*) from public.px_profiles')"
if [ "$n" != "0" ] && [ "${FORCAR:-0}" != "1" ]; then
  echo "O banco da VM já tem $n usuário(s) na plataforma. Para apagar e importar mesmo assim: FORCAR=1 $0 $*"; exit 1
fi
run <<'SQL'
do $$ begin
  execute (select 'truncate ' || string_agg(format('public.%I', tablename), ', ') || ' restart identity cascade'
           from pg_tables where schemaname = 'public' and tablename like 'px\_%' and tablename <> 'px_schema_migrations');
end $$;
SQL

echo "→ usuários";  run < "$IN/01_usuarios.sql"
echo "→ dados px";  run < "$IN/02_dados_px.sql"
[ -s "$IN/03_arquivos.sql" ] && { echo "→ áudios (registro)"; run < "$IN/03_arquivos.sql"; }

# Sequências de ID continuam depois do maior ID importado
run <<'SQL'
do $$ declare r record; begin
  for r in select c.relname t, a.attname col, pg_get_serial_sequence('public.' || c.relname, a.attname) s
    from pg_class c join pg_attribute a on a.attrelid = c.oid
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'px\_%'
      and not a.attisdropped and pg_get_serial_sequence('public.' || c.relname, a.attname) is not null
  loop execute format('select setval(%L, coalesce((select max(%I) from public.%I), 0) + 1, false)', r.s, r.col, r.t); end loop;
end $$;
SQL
docker exec -i "$DB" psql -U postgres -d postgres -tAc \
  "select 'usuarios: ' || count(*) from public.px_profiles union all select 'monitorias: ' || count(*) from public.px_evaluations union all select 'quedas: ' || count(*) from public.px_drop_reviews"
echo "Dados importados."

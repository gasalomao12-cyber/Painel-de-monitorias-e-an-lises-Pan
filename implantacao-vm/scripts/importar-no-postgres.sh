#!/usr/bin/env bash
# Importa no PostgreSQL da empresa os dados exportados por exportar-do-supabase.sh.
# Rode DEPOIS do sql/px_monitorias_postgres.sql, num banco ainda sem uso, com o superusuário (postgres):
# a carga desliga os gatilhos das tabelas, o que só ele pode fazer.
#
# Uso: ./importar-no-postgres.sh "postgres://postgres:SENHA@127.0.0.1:5432/px_monitorias" [pasta]
# (como root no servidor, também serve: sudo -u postgres ./importar-no-postgres.sh "dbname=px_monitorias" pasta)
# Sem psql instalado, use: PSQL="docker run --rm -i --network host -v $PWD:/in -w /in postgres:17 psql"
set -euo pipefail
URL="${1:?Informe a URL do banco da empresa}"
IN="${2:-.}"
PSQL="${PSQL:-psql}"
run() { $PSQL "$URL" -v ON_ERROR_STOP=1 -q "$@"; }

n="$(run -tAc 'select count(*) from public.px_profiles')"
if [ "$n" != "0" ] && [ "${FORCAR:-0}" != "1" ]; then
  echo "O banco já tem $n usuário(s) na plataforma. Para apagar e importar mesmo assim: FORCAR=1 $0 $*"; exit 1
fi

# A instalação cria dados padrão (critérios, configurações): a carga substitui tudo pelo que veio do Supabase
run -c "do \$\$ begin execute (select 'truncate ' || string_agg(format('public.%I', tablename), ', ') || ' restart identity cascade'
          from pg_tables where schemaname = 'public' and tablename like 'px\_%' and tablename <> 'px_schema_migrations'); end \$\$;"

echo "→ usuários"
run -c "\copy public.px_auth_users (id, email, encrypted_password, email_confirmed_at, banned_until, raw_user_meta_data, last_sign_in_at, created_at, updated_at) from '$IN/01_usuarios.csv' with csv header"
echo "→ dados"
run -f "$IN/02_dados_px.sql"

# Sequências de ID continuam depois do maior ID importado
run -c "do \$\$ declare r record; begin
  for r in select c.relname t, a.attname col, pg_get_serial_sequence('public.' || c.relname, a.attname) s
    from pg_class c join pg_attribute a on a.attrelid = c.oid
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'px\_%'
      and not a.attisdropped and pg_get_serial_sequence('public.' || c.relname, a.attname) is not null
  loop execute format('select setval(%L, coalesce((select max(%I) from public.%I), 0) + 1, false)', r.s, r.col, r.t); end loop;
end \$\$;"

run -tAc "select 'usuarios: ' || count(*) from public.px_profiles union all select 'monitorias: ' || count(*) from public.px_evaluations union all select 'quedas: ' || count(*) from public.px_drop_reviews"
echo "Dados importados. Os logins continuam com as mesmas senhas."

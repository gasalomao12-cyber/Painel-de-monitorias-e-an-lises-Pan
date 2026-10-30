#!/usr/bin/env bash
# Exporta do Supabase (nuvem) tudo o que a PX Monitorias tem no banco, para importar no PostgreSQL da empresa.
# Precisa da connection string do banco: Supabase › Project Settings › Database › Connection string (URI).
# Usa psql/pg_dump da imagem oficial postgres:17 (Docker); com o cliente do Postgres 17 instalado, troque PSQL/PGDUMP.
#
# Uso: ./exportar-do-supabase.sh "postgresql://postgres.REF:SENHA@HOST:5432/postgres" [pasta]
# Gera: 01_usuarios.csv (logins da plataforma, senhas em bcrypt) e 02_dados_px.sql (todas as tabelas px_*).
# Os áudios vêm à parte: baixar-audios.ts.
# ATENÇÃO: dados pessoais de clientes e colaboradores. Guarde e transfira com segurança.
set -euo pipefail
URL="${1:?Informe a connection string do banco do Supabase}"
OUT="$(cd "${2:-.}" 2>/dev/null || mkdir -p "${2:-.}"; cd "${2:-.}" && pwd)"
D=(docker run --rm -i --network host -v "$OUT:/out" postgres:17)

# Só os usuários que têm perfil na plataforma (o projeto pode ter usuários de outros sistemas)
"${D[@]}" psql "$URL" -v ON_ERROR_STOP=1 -c "\copy (select u.id, u.email, u.encrypted_password, u.email_confirmed_at, u.banned_until, coalesce(u.raw_user_meta_data, '{}'::jsonb), u.last_sign_in_at, u.created_at, u.updated_at from auth.users u join public.px_profiles p on p.id = u.id) to '/out/01_usuarios.csv' with csv header"
"${D[@]}" pg_dump "$URL" --data-only --no-owner --no-privileges --disable-triggers -t 'public.px_*' -T public.px_schema_migrations -f /out/02_dados_px.sql

chmod 600 "$OUT"/01_usuarios.csv "$OUT"/02_dados_px.sql
ls -la "$OUT"/01_usuarios.csv "$OUT"/02_dados_px.sql

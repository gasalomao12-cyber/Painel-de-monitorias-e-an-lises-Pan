#!/usr/bin/env bash
# Exporta os DADOS da PX Monitorias do Supabase (nuvem) em arquivos .sql, para importar no servidor local.
# Precisa da "connection string" do banco: Supabase › Project Settings › Database › Connection string (URI),
# com a senha do banco. Usa o pg_dump da imagem oficial do Postgres 17 (Docker).
#
# Uso: ./exportar-dados-supabase.sh "postgresql://postgres.REF:SENHA@HOST:5432/postgres" [pasta-de-saida]
# Gera:
#   01_usuarios.sql  logins (auth.users e auth.identities, com as senhas criptografadas)
#   02_dados_px.sql  todas as tabelas px_* (monitorias, feedbacks, análises de queda…)
#   03_arquivos.sql  registro dos áudios do bucket px-quedas (os arquivos em si vêm à parte, ver o guia)
# ATENÇÃO: os arquivos têm dados pessoais de clientes e colaboradores. Guarde e transfira com segurança.
set -euo pipefail

URL="${1:?Informe a connection string do banco do Supabase}"
OUT="${2:-./dados-px}"
mkdir -p "$OUT"
DUMP=(docker run --rm -i --network host postgres:17 pg_dump "$URL" --data-only --no-owner --no-privileges --disable-triggers)

"${DUMP[@]}" -t auth.users -t auth.identities > "$OUT/01_usuarios.sql"
"${DUMP[@]}" -t 'public.px_*' -T public.px_schema_migrations > "$OUT/02_dados_px.sql"
# Só os objetos do bucket px-quedas (os demais buckets do projeto ficam de fora)
docker run --rm -i --network host postgres:17 psql "$URL" -At -c \
  "select format('insert into storage.objects (id, bucket_id, name, owner, owner_id, metadata, created_at, updated_at) values (%L, %L, %L, %L, %L, %L, %L, %L) on conflict do nothing;', id, bucket_id, name, owner, owner_id, metadata, created_at, updated_at) from storage.objects where bucket_id = 'px-quedas'" \
  > "$OUT/03_arquivos.sql"

chmod 600 "$OUT"/*.sql
ls -la "$OUT"
echo "Exportado em $OUT. Importe na VM com importar-dados.sh."

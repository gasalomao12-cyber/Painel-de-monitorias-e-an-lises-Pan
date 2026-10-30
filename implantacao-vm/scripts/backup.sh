#!/usr/bin/env bash
# Backup diário da PX Monitorias: banco (pg_dump) e áudios (Storage).
# Agende no cron, ex.: 30 2 * * * /opt/px-app/implantacao-vm/scripts/backup.sh /backup/px
# Guarde as cópias FORA da VM e criptografadas: há telefone e CPF de clientes.
set -euo pipefail

DEST="${1:-/backup/px}"
SUPA_DIR="${2:-/opt/px}"
DB="${3:-supabase-db}"
KEEP_DAYS="${KEEP_DAYS:-30}"
STAMP="$(date +%Y-%m-%d_%H%M)"
mkdir -p "$DEST"

# Banco inteiro (inclui auth.users, para manter os logins)
docker exec "$DB" pg_dump -U postgres -Fc postgres > "$DEST/px-db_$STAMP.dump"

# Áudios da força-tarefa (bucket px-quedas)
tar -czf "$DEST/px-storage_$STAMP.tar.gz" -C "$SUPA_DIR/volumes" storage

find "$DEST" -name 'px-*' -mtime +"$KEEP_DAYS" -delete
echo "Backup em $DEST ($STAMP)"

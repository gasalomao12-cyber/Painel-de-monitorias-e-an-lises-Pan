#!/usr/bin/env bash
# Backup diário da PX Monitorias: banco (pg_dump) e áudios (pasta PX_FILES_DIR).
# Cron, ex.: 30 2 * * * /opt/px-app/implantacao-vm/scripts/backup.sh /backup/px
# Guarde as cópias FORA do servidor e criptografadas: há telefone e CPF de clientes.
set -euo pipefail
DEST="${1:-/backup/px}"
ENV_FILE="${2:-/etc/px-monitorias/px.env}"
KEEP_DAYS="${KEEP_DAYS:-30}"
set -a; . "$ENV_FILE"; set +a
STAMP="$(date +%Y-%m-%d_%H%M)"
mkdir -p "$DEST"

pg_dump "$PX_DATABASE_URL" -Fc -f "$DEST/px-db_$STAMP.dump"
tar -czf "$DEST/px-arquivos_$STAMP.tar.gz" -C "$(dirname "$PX_FILES_DIR")" "$(basename "$PX_FILES_DIR")"

find "$DEST" -name 'px-*' -mtime +"$KEEP_DAYS" -delete
echo "Backup em $DEST ($STAMP). Restaurar: pg_restore -d <banco vazio> px-db_$STAMP.dump"

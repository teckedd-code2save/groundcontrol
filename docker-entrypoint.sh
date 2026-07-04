#!/bin/sh
set -e

# Sync the database schema before serving. The runtime DB lives on a named
# volume (groundcontrol-db -> /app/prisma), which masks the image's prisma
# dir — so we ship schema + migrations at /app/db (unmasked) and point the
# CLI at it explicitly.
SCHEMA=/app/db/schema.prisma

if [ -f "$SCHEMA" ]; then
  echo "[entrypoint] applying database migrations..."
  if npx prisma migrate deploy --schema "$SCHEMA"; then
    echo "[entrypoint] migrations applied."
  else
    # Fallback for databases created before migrate tracking (no
    # _prisma_migrations baseline): push the schema additively.
    echo "[entrypoint] migrate deploy failed - falling back to prisma db push"
    npx prisma db push --schema "$SCHEMA" --skip-generate
  fi
else
  echo "[entrypoint] WARNING: $SCHEMA not found, skipping migration"
fi

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

exec node server.js

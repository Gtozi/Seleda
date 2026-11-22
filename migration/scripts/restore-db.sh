#!/usr/bin/env bash
# Restore the dumped `public` schema into the self-hosted Supabase Postgres
# running in Dokploy (container name: supabase-db).
#
# Run ON the Contabo VPS, from the directory containing supabase-public.dump.
#
# Required env:
#   DUMP_FILE   path to the dump (default: ./supabase-public.dump)
#
# The stack must already be deployed and healthy (db container running).
set -euo pipefail

DUMP_FILE="${DUMP_FILE:-supabase-public.dump}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"

[ -f "$DUMP_FILE" ] || { echo "Dump file not found: $DUMP_FILE"; exit 1; }

echo "Copying dump into $DB_CONTAINER ..."
docker cp "$DUMP_FILE" "$DB_CONTAINER:/tmp/restore.dump"

echo "Pre-creating extensions ..."
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=0 <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS supabase_vault;
SQL

echo "Restoring (this prints harmless 'already exists' warnings) ..."
docker exec "$DB_CONTAINER" pg_restore \
  -U postgres -d postgres \
  --no-owner --role=postgres \
  --exit-on-error \
  /tmp/restore.dump || {
    echo ""
    echo "NOTE: pg_restore stopped on first error. Re-run without --exit-on-error"
    echo "to apply everything possible, then review errors manually:"
    echo "  docker exec $DB_CONTAINER pg_restore -U postgres -d postgres --no-owner --role=postgres /tmp/restore.dump"
    exit 1
  }

echo "Verifying row counts ..."
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -c \
  "select count(*) as public_tables from information_schema.tables where table_schema='public';"

echo "Restore complete."

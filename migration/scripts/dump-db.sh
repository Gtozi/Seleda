#!/usr/bin/env bash
# Dump the Supabase `public` schema (tables, functions, RLS, data, publications)
# from the OLD hosted Supabase project.
#
# Run from the Contabo VPS (or any machine with Docker + network access to Supabase).
#
# Required env:
#   SUPABASE_DB_URL   Session-pooler or direct Postgres connection string, e.g.
#                     postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
#                     (use SESSION mode port 5432, NOT transaction mode 6543)
#
# Output: ./supabase-public.dump  (pg_restore custom format, ~136 MB DB -> small file)
set -euo pipefail

: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL to the Supabase Postgres connection string}"

OUT="${OUT:-supabase-public.dump}"

echo "Dumping public schema from Supabase ..."
docker run --rm \
  -v "$(pwd):/backup" \
  postgres:17-alpine \
  sh -c "pg_dump '$SUPABASE_DB_URL' -Fc --no-comments -f /backup/$OUT \
    --schema=public"

echo "Done: $OUT ($(du -h "$OUT" | cut -f1))"
echo "Next: copy this file to the VPS and run restore-db.sh"

# SELEDA ERP — Supabase → Contabo (self-hosted) Migration Runbook

Target architecture: official Supabase self-hosted Docker stack deployed via
**Dokploy** on your **Contabo VPS**. The app keeps using `@supabase/supabase-js`
unchanged — only the URL and API keys change.

## What's in this folder

```
migration/
  contabo/                  # Vendored official supabase/docker stack (pinned)
    docker-compose.yml      #   full stack: db, auth, rest, realtime, storage,
                            #   imgproxy, meta, functions, studio, envoy, supavisor
    .env                    #   generated secrets (gitignored — do NOT commit)
    .env.example
    volumes/                #   envoy config, db init scripts, entrypoints
  scripts/
    generate-env.mjs        #   regenerates contabo/.env with fresh secrets
    dump-db.sh              #   pg_dump public schema from hosted Supabase
    restore-db.sh           #   pg_restore into self-hosted db container
    copy-storage.mjs        #   copies all Storage buckets/files old → new
  RUNBOOK.md                #   this file
```

Current project facts (verified via Supabase MCP):
- DB size: ~136 MB, `public` schema: 1,043 tables / 678 functions
- Storage: 3 buckets / 1,040 objects
- Supabase Auth: 17 users — UNUSED by the app (custom `user_sessions` /
  `guest_sessions`), safe to skip
- Vault: empty; extensions needed: pgcrypto, uuid-ossp, btree_gist,
  pg_stat_statements, pg_cron, supabase_vault

---

## Phase 0 — Prep (before cutover, no downtime)

1. **DNS**: create an A record for the API, e.g. `supabase.seledabet.com` →
   Contabo VPS IP. TLS is handled by Dokploy/Traefik.
2. **Regenerate env with your real domains** (from repo root):

   ```bash
   node migration/scripts/generate-env.mjs \
     --api-domain supabase.seledabet.com \
     --app-url https://seledabet.com
   ```

   This rewrites `migration/contabo/.env` with fresh secrets.
   If you already generated it, just edit these lines by hand:
   `SUPABASE_PUBLIC_URL`, `API_EXTERNAL_URL`, `SITE_URL`.

3. **Push this repo** (or at least the `migration/contabo` folder) to GitHub —
   Dokploy deploys Compose services from a Git repo.

## Phase 1 — Deploy the stack on Dokploy

1. Dokploy → **Create Service → Compose** → pick your repo.
2. Set **Compose Path** to `migration/contabo/docker-compose.yml`.
3. Paste the contents of `migration/contabo/.env` into the service's
   **Environment** editor (Dokploy injects it for `${...}` interpolation).
4. Deploy. First boot takes a few minutes (image pulls + db init).
5. **Domains**: add a domain for the `api-gw` service:
   `https://supabase.seledabet.com` → container port `8000`.
   Optionally add a second domain for `studio` → port `3000`
   (that's your self-hosted dashboard login: `supabase` / `DASHBOARD_PASSWORD`).
6. Verify: `curl https://supabase.seledabet.com/rest/v1/` should return
   a PostgREST response (not a gateway error).

> Resource note: the full stack is ~12 containers. If the VPS is small (<8 GB
> RAM), drop `studio`, `functions`, `meta`, and `supavisor` from the compose
> (edit depends_on chains accordingly) — the app only needs
> db/auth/rest/realtime/storage/imgproxy/api-gw.

> Security note: `supavisor` publishes Postgres on host port 5432. Either
> firewall it (UFW: allow only your IP / Dokploy needs it for migrations) or
> remove the `ports:` block — the app never connects via raw Postgres.

## Phase 2 — Data migration (downtime window)

You need the OLD database password / pooler string:
Supabase Dashboard → Project Settings → Database → Connection string.
Use the **Session pooler** (port 5432) or direct connection — NOT the
transaction pooler (6543).

```bash
# On any machine with Docker (the VPS works):
export SUPABASE_DB_URL='postgresql://postgres.<ref>:<pwd>@aws-0-<region>.pooler.supabase.com:5432/postgres'
bash migration/scripts/dump-db.sh          # writes ./supabase-public.dump
```

Then on the VPS, next to the dump:

```bash
bash migration/scripts/restore-db.sh       # restores into supabase-db container
```

Sanity check in Studio (or psql):

```sql
select count(*) from public.reservations;
select count(*) from public.user_sessions;
select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and proname='post_folio_charge_with_routing';
```

## Phase 3 — Storage files

```bash
cd <repo root>
OLD_SUPABASE_URL=https://<old-ref>.supabase.co \
OLD_SERVICE_ROLE_KEY=<old service_role JWT> \
NEW_SUPABASE_URL=https://supabase.seledabet.com \
NEW_SERVICE_ROLE_KEY=<new service_role key from .env> \
node migration/scripts/copy-storage.mjs
```

The new service_role key is the `SERVICE_ROLE_KEY` value in
`migration/contabo/.env`. ~1,040 files — runs in a few minutes.

## Phase 4 — Cutover

Update these env vars **everywhere they are set**:

| Var | New value |
|---|---|
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | `https://supabase.seledabet.com` |
| `SUPABASE_SERVICE_ROLE_KEY` | `SERVICE_ROLE_KEY` from `contabo/.env` |
| `VITE_SUPABASE_ANON_KEY` | `ANON_KEY` from `contabo/.env` |

Places to update: local `.env`, Dokploy app env (backend), and the
**Vercel** project env (frontend — `VITE_*` vars are build-time, so trigger
a redeploy after changing them).

Then verify:

- [ ] `GET /api/health` → 200
- [ ] Staff login (custom sessions — unaffected by Auth migration)
- [ ] Open a folio / reservation (exercises RPCs)
- [ ] Room Assignment page (exercises realtime channel)
- [ ] Load one guest ID / payment document (exercises storage)
- [ ] Guest portal login + a booking

## Phase 5 — Decommission (only after soak period)

- Keep the old Supabase project **paused, not deleted**, for 1–2 weeks.
- Supabase free-tier pause is fine; do NOT delete until confident.
- Set up Dokploy scheduled backups for the `supabase-db` volume
  (`pg_dump` cron on the VPS is enough at 136 MB).

## Known risks / follow-ups

- **Realtime** is the flakiest self-hosted component — test early.
- **`pg_cron` jobs**: check `select * from cron.job` on old DB; recreate any
  on the new DB (your app also has an in-process `scheduler.ts` — likely
  redundant, but verify).
- **RLS**: policies moved with the dump; the `anon`/`authenticated`/
  `service_role` roles already exist in the self-hosted image. If REST
  returns permission errors, check `PGRST_DB_SCHEMAS` and role grants.
- **No managed backups / no Supabase dashboard log explorer** — that's the
  trade for self-hosting. Studio container covers basic inspection.
- If anything breaks: rollback = point env vars back at the old
  `*.supabase.co` URL + old keys. Keep the old `.env` backed up.

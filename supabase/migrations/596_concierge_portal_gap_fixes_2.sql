-- 596_concierge_portal_gap_fixes_2.sql
-- Second wave of Concierge portal gap fixes:
--   1. Registers concierge:* permission codes, creates role_concierge, grants
--      the codes to concierge-family roles, and links concierge system users
--      — enabling requirePermission() on the previously unguarded mutations.
--   2. guest_requests.scheduled_for — structured due-time for wake-up calls /
--      reminders so the scheduler can dispatch them (was free text in the
--      description).
--   3. vendors.source — marks which portal created a vendor row (the table is
--      shared with Accounts Payable).
--   4. Registers the Concierge Wake-up Dispatch scheduled job.

-- ── 1. Concierge permission codes ─────────────────────────────────────────
INSERT INTO permissions (id, code, module, description)
SELECT v.id, v.code, 'concierge', v.description
FROM (VALUES
  ('perm-concierge-requests-manage', 'concierge:requests:manage',
   'Create and update concierge guest requests, communications, and shuttle requests'),
  ('perm-concierge-catalog-manage', 'concierge:catalog:manage',
   'Manage concierge service catalog items'),
  ('perm-concierge-vendors-manage', 'concierge:vendors:manage',
   'Create and update concierge vendors'),
  ('perm-concierge-billing-manage', 'concierge:billing:manage',
   'Post and void concierge charges on guest folios'),
  ('perm-concierge-recommendations-manage', 'concierge:recommendations:manage',
   'Manage the concierge local-recommendations knowledge base'),
  ('perm-concierge-reports-manage', 'concierge:reports:manage',
   'Run and configure concierge reports'),
  ('perm-concierge-settings-manage', 'concierge:settings:manage',
   'Manage concierge portal settings')
) AS v(id, code, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code = v.code)
ON CONFLICT (id) DO NOTHING;

-- ── 2. Concierge role ─────────────────────────────────────────────────────
INSERT INTO roles (id, name, description, is_superuser, is_system)
VALUES ('role_concierge', 'concierge', 'Concierge staff — concierge portal access', false, true)
ON CONFLICT (id) DO NOTHING;

-- Grant the concierge codes to every concierge-family role that exists.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('concierge', 'concierge_manager', 'guest_services_manager')
  AND p.code LIKE 'concierge:%'
ON CONFLICT DO NOTHING;

-- Link concierge system users to the concierge role so requirePermission()
-- resolves for them (userCan checks user_roles → role_permissions).
INSERT INTO user_roles (user_id, role_id)
SELECT su.id, 'role_concierge'
FROM system_users su
WHERE su.role IN ('concierge', 'concierge_manager', 'guest_services_manager')
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = su.id AND ur.role_id = 'role_concierge'
  );

-- ── 3. guest_requests.scheduled_for ───────────────────────────────────────
ALTER TABLE public.guest_requests
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;

CREATE INDEX IF NOT EXISTS idx_guest_requests_scheduled_for
  ON public.guest_requests(request_type, scheduled_for)
  WHERE scheduled_for IS NOT NULL;

-- ── 4. vendors.source ─────────────────────────────────────────────────────
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS source text;

-- Backfill the concierge seed vendors (590) so GET /vendors?source=Concierge
-- (the new default scope) sees them; AP vendors keep source = NULL.
UPDATE public.vendors
   SET source = 'Concierge'
 WHERE source IS NULL
   AND id LIKE 'vnd_con_%';

-- ── 4b. transport_requests.reservation_id ─────────────────────────────────
-- Lets concierge shuttle requests deep-link back to their reservation/guest
-- profile (the shared transport table only had guest_id + a free-text room).
ALTER TABLE public.transport_requests
  ADD COLUMN IF NOT EXISTS reservation_id text REFERENCES public.reservations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transport_requests_reservation
  ON public.transport_requests(reservation_id) WHERE reservation_id IS NOT NULL;

-- ── 5. Wake-up dispatch job ───────────────────────────────────────────────
-- Handler lives in src/server/scheduler.ts (concierge_wakeup_dispatch): every
-- 5 minutes, flags due wake-up/reminder requests and alerts the desk.
INSERT INTO scheduled_jobs (name, type, schedule_cron, config, enabled)
SELECT 'Concierge Wake-up Dispatch', 'concierge_wakeup_dispatch', '*/5 * * * *', '{}', true
WHERE NOT EXISTS (
  SELECT 1 FROM scheduled_jobs WHERE type = 'concierge_wakeup_dispatch'
);

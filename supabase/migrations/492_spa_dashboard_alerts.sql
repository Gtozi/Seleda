-- =============================================================================
-- 492_spa_dashboard_alerts.sql
-- Spa dashboard alert feed. KPIs are computed live in the dashboard endpoint;
-- this table persists operational alerts (VIP arrivals, expiries, maintenance)
-- with read/dismiss state. Link columns are plain text navigational hints
-- (matching the guest_requests denormalized convention) so an alert stays
-- valid even if the referenced record is removed.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.spa_alerts (
  id             text PRIMARY KEY,
  alert_type     text NOT NULL,
  message        text NOT NULL,
  severity       text NOT NULL DEFAULT 'Info'
                 CHECK (severity IN ('Info','Warning','Critical')),
  guest_id       text,
  appointment_id text,
  therapist_id   text,
  is_read        boolean NOT NULL DEFAULT false,
  property_id    uuid REFERENCES public.properties(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.spa_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spa_alerts_authenticated ON public.spa_alerts;
CREATE POLICY spa_alerts_authenticated ON public.spa_alerts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spa_alerts TO authenticated;

CREATE INDEX IF NOT EXISTS spa_alerts_created_idx  ON public.spa_alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS spa_alerts_severity_idx ON public.spa_alerts (severity);

-- ── Seed: the former mock alerts ─────────────────────────────────────────────

INSERT INTO public.spa_alerts
  (id, alert_type, message, severity, guest_id, appointment_id, therapist_id, created_at)
VALUES
  ('SPA-ALT-001', 'VIP Appointment',
   'VIP appointment for Mrs. Johnson - Couples Retreat Package at 2:00 PM',
   'Critical', 'GST-001', 'APT-001', NULL, '2026-09-13T10:30:00Z'),
  ('SPA-ALT-002', 'Therapist Unavailable',
   'Therapist Emily Chen called in sick - reassign 3 appointments',
   'Critical', NULL, NULL, 'THP-001', '2026-09-13T09:45:00Z'),
  ('SPA-ALT-003', 'Low Inventory',
   'Lavender massage oil below minimum stock level',
   'Warning', NULL, NULL, NULL, '2026-09-13T09:15:00Z'),
  ('SPA-ALT-004', 'Membership Expiry',
   '5 memberships expiring this week - send renewal notices',
   'Warning', NULL, NULL, NULL, '2026-09-13T08:30:00Z'),
  ('SPA-ALT-005', 'Equipment Maintenance Due',
   'Hydrotherapy pump scheduled for maintenance tomorrow',
   'Info', NULL, NULL, NULL, '2026-09-13T08:00:00Z'),
  ('SPA-ALT-006', 'Package Expiry',
   'Weekend Spa Package expires in 3 days - 2 unused sessions',
   'Warning', 'GST-002', NULL, NULL, '2026-09-13T07:30:00Z')
ON CONFLICT (id) DO NOTHING;

-- 653_guest_notifications.sql
-- Guest Portal — Notifications module.
-- Backs the /guest/notifications tab (NotificationsModule.tsx).
-- The guest-portal /notifications/* endpoints previously wrote to
-- `push_notifications` / `notification_subscriptions`, tables that were never
-- created — this migration adds the real per-guest notification feed.
--
-- Rows are emitted by the backend when staff-visible events happen for a
-- guest (e.g. a concierge reply to their message, a guest-request status
-- change). `read`/`dismissed_at` drive the guest-side unread filter and
-- delete (soft-dismiss) actions.

-- ── Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.guest_notifications (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  guest_id        TEXT NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  reservation_id  TEXT REFERENCES public.reservations(id) ON DELETE SET NULL,
  property_id     UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  category        TEXT NOT NULL DEFAULT 'general',
  title           TEXT NOT NULL,
  message         TEXT NOT NULL,
  priority        TEXT NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('normal', 'high')),
  read            BOOLEAN NOT NULL DEFAULT false,
  read_at         TIMESTAMPTZ,
  dismissed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guest_notifications_guest
  ON public.guest_notifications(guest_id, created_at DESC)
  WHERE dismissed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_guest_notifications_reservation
  ON public.guest_notifications(reservation_id);
CREATE INDEX IF NOT EXISTS idx_guest_notifications_unread
  ON public.guest_notifications(guest_id)
  WHERE read = false AND dismissed_at IS NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.guest_notifications ENABLE ROW LEVEL SECURITY;

-- Access is enforced at the API layer via canActForGuest (the service role
-- bypasses RLS); the policy below is a defense-in-depth fallback for the
-- authenticated role.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'guest_notifications'
      AND policyname = 'guest_notifications_authenticated'
  ) THEN
    CREATE POLICY guest_notifications_authenticated
      ON public.guest_notifications
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.guest_notifications TO authenticated;

-- 650_guest_mobile_check_ins.sql
-- Guest Portal — Digital Check-in module.
-- Backs the /guest/checkin tab (DigitalCheckinModule.tsx).
-- The /api/guest-portal/check-in/* endpoints already referenced a
-- `mobile_check_ins` table, but it was never created — this migration
-- persists that contract so the module can initiate, resume, and complete
-- real check-ins via the API.
--
-- Flow: initiated → in_progress → completed (cancelled side-branch).
-- `progress` JSONB tracks which wizard steps the guest has finished so an
-- interrupted check-in can be resumed: {registration, identity, payment,
-- roomPrefs, signature} plus captured registration fields.

-- ── Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mobile_check_ins (
  id                     TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  reservation_id         TEXT NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  property_id            UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  guest_id               TEXT NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  status                 TEXT NOT NULL DEFAULT 'initiated' CHECK (status IN (
                           'initiated', 'in_progress', 'completed', 'cancelled'
                         )),
  progress               JSONB NOT NULL DEFAULT '{}'::jsonb,
  estimated_arrival      TEXT,
  room_preferences       TEXT,
  signature              TEXT,
  photo_id_verified      BOOLEAN NOT NULL DEFAULT FALSE,
  payment_method_on_file BOOLEAN NOT NULL DEFAULT FALSE,
  completed_by           TEXT,
  initiated_at           TIMESTAMPTZ,
  completed_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mobile_check_ins_reservation
  ON public.mobile_check_ins(reservation_id);
CREATE INDEX IF NOT EXISTS idx_mobile_check_ins_guest
  ON public.mobile_check_ins(guest_id);
CREATE INDEX IF NOT EXISTS idx_mobile_check_ins_property
  ON public.mobile_check_ins(property_id);
CREATE INDEX IF NOT EXISTS idx_mobile_check_ins_status
  ON public.mobile_check_ins(status);

-- ── updated_at trigger ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_mobile_check_ins_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mobile_check_ins_updated_at ON public.mobile_check_ins;
CREATE TRIGGER trg_mobile_check_ins_updated_at
  BEFORE UPDATE ON public.mobile_check_ins
  FOR EACH ROW
  EXECUTE FUNCTION public.update_mobile_check_ins_timestamp();

ALTER TABLE public.mobile_check_ins ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mobile_check_ins TO authenticated;

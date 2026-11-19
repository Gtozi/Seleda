-- 651_guest_digital_keys.sql
-- Guest Portal — Digital Room Key module.
-- Backs the /guest/digital-key tab (DigitalRoomKeyModule.tsx).
-- The /api/guest-portal/digital-key/* endpoints already referenced a
-- `digital_keys` table, but it was never created — this migration persists
-- that contract so the module can list, issue, share, and revoke real keys.
--
-- `kind='device'` rows are keys activated on the guest's own devices;
-- `kind='shared'` rows grant access to a named companion. Statuses:
-- active → (expired | revoked).

-- ── Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.digital_keys (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  reservation_id      TEXT NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  property_id         UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  guest_id            TEXT REFERENCES public.guests(id) ON DELETE CASCADE,
  room_id             TEXT,
  kind                TEXT NOT NULL DEFAULT 'device' CHECK (kind IN ('device', 'shared')),
  device_name         TEXT,
  device_type         TEXT CHECK (device_type IN ('iOS', 'Android') OR device_type IS NULL),
  shared_with_name    TEXT,
  shared_relationship TEXT,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
                        'active', 'expired', 'revoked'
                      )),
  issued_at           TIMESTAMPTZ,
  expiry_date         TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_digital_keys_reservation
  ON public.digital_keys(reservation_id);
CREATE INDEX IF NOT EXISTS idx_digital_keys_guest
  ON public.digital_keys(guest_id);
CREATE INDEX IF NOT EXISTS idx_digital_keys_property
  ON public.digital_keys(property_id);
CREATE INDEX IF NOT EXISTS idx_digital_keys_status
  ON public.digital_keys(status);

-- ── updated_at trigger ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_digital_keys_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_digital_keys_updated_at ON public.digital_keys;
CREATE TRIGGER trg_digital_keys_updated_at
  BEFORE UPDATE ON public.digital_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.update_digital_keys_timestamp();

ALTER TABLE public.digital_keys ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.digital_keys TO authenticated;

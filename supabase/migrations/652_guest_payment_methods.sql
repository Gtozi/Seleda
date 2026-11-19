-- Migration 652: guest_payment_methods
-- Card-on-file references for the guest portal wallet. Stores display
-- metadata only (label, last four, expiry) — never PAN or CVV. Staff use
-- the reference when applying a payment at the desk.
CREATE TABLE IF NOT EXISTS public.guest_payment_methods (
  id            TEXT PRIMARY KEY,
  guest_id      TEXT NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  method_type   TEXT NOT NULL,
  label         TEXT NOT NULL,
  last_four     TEXT,
  expiry        TEXT,
  is_default    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guest_payment_methods_guest
  ON public.guest_payment_methods(guest_id);

CREATE OR REPLACE FUNCTION public.update_guest_payment_methods_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guest_payment_methods_updated_at ON public.guest_payment_methods;
CREATE TRIGGER trg_guest_payment_methods_updated_at
  BEFORE UPDATE ON public.guest_payment_methods
  FOR EACH ROW
  EXECUTE FUNCTION public.update_guest_payment_methods_timestamp();

ALTER TABLE public.guest_payment_methods ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.guest_payment_methods TO authenticated;

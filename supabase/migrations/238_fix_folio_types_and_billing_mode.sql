-- Migration 238: Fix folio types, add billing_mode, backfill group_id
--
-- 1. Add 'Company' to folio_type CHECK constraint
-- 2. Add billing_mode to reservations ('individual' | 'group' | 'corporate')
-- 3. Backfill group_id on existing folios from reservations.booking_group_id
-- 4. Backfill billing_mode on existing reservations
-- 5. Add indexes for group_id and owner lookups

ALTER TABLE public.folios DROP CONSTRAINT IF EXISTS folios_folio_type_check;
ALTER TABLE public.folios ADD CONSTRAINT folios_folio_type_check
  CHECK (folio_type = ANY (ARRAY['Guest'::text, 'Group'::text, 'Master'::text, 'Company'::text, 'House'::text]));

ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS billing_mode text DEFAULT 'individual';
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_billing_mode_check;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_billing_mode_check
  CHECK (billing_mode = ANY (ARRAY['individual'::text, 'group'::text, 'corporate'::text]));

UPDATE public.folios f
SET group_id = r.booking_group_id
FROM reservations r
WHERE f.reservation_id = r.id
  AND r.booking_group_id IS NOT NULL
  AND f.group_id IS NULL;

UPDATE public.reservations SET billing_mode = 'corporate' WHERE corporate_account_id IS NOT NULL;
UPDATE public.reservations SET billing_mode = 'group' WHERE booking_group_id IS NOT NULL AND corporate_account_id IS NULL AND billing_mode = 'individual';

CREATE INDEX IF NOT EXISTS idx_folios_group_id ON public.folios(group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_folios_owner ON public.folios(owner_type, owner_id) WHERE owner_type IS NOT NULL;

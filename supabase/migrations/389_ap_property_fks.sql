-- Migration 389: Add missing property_id FKs on AP tables
-- The ap_three_way_matches and ap_payment_schedules tables have property_id uuid
-- columns but no foreign key to properties(id). The AP routes use explicit FK
-- names (ap_three_way_matches_property_id_fkey / ap_payment_schedules_property_id_fkey)
-- in their Supabase select joins, so the FKs must exist with those exact names.

-- ap_three_way_matches.property_id -> properties.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ap_three_way_matches_property_id_fkey'
      AND conrelid = 'public.ap_three_way_matches'::regclass
  ) THEN
    ALTER TABLE public.ap_three_way_matches
      ADD CONSTRAINT ap_three_way_matches_property_id_fkey
      FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ap_payment_schedules.property_id -> properties.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ap_payment_schedules_property_id_fkey'
      AND conrelid = 'public.ap_payment_schedules'::regclass
  ) THEN
    ALTER TABLE public.ap_payment_schedules
      ADD CONSTRAINT ap_payment_schedules_property_id_fkey
      FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE SET NULL;
  END IF;
END $$;

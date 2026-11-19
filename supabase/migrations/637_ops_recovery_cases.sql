-- 637: Guest recovery cases for the Operations Guest Recovery tab.
-- Lifecycle: logged → investigating → compensation-pending → corrective-action
--            → follow-up → guest-confirmation → closed
-- Links: feedback_id → guest_feedback (intake), work_order_id → work_orders
-- (corrective action in the Engineering portal).

CREATE TABLE IF NOT EXISTS public.ops_recovery_cases (
  id                  text        PRIMARY KEY,
  property_id         uuid        REFERENCES public.properties(id) ON DELETE CASCADE,
  guest_name          text        NOT NULL,
  room_number         text,
  complaint           text        NOT NULL,
  category            text        NOT NULL DEFAULT 'Other' CHECK (category IN (
    'Maintenance','Housekeeping','F&B','Facilities','Front Office','Security','Spa','Other')),
  status              text        NOT NULL DEFAULT 'logged' CHECK (status IN (
    'logged','investigating','compensation-pending','corrective-action',
    'follow-up','guest-confirmation','closed')),
  priority            text        NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  assigned_to         text,
  compensation_amount numeric,
  corrective_action   text,
  follow_up_date      date,
  feedback_id         text,
  work_order_id       text,
  notes               text,
  logged_by           text,
  closed_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_recovery_prop ON public.ops_recovery_cases (property_id);
CREATE INDEX IF NOT EXISTS idx_ops_recovery_feedback ON public.ops_recovery_cases (feedback_id);

CREATE OR REPLACE FUNCTION public.set_ops_recovery_cases_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_ops_recovery_cases_updated_at ON public.ops_recovery_cases;
CREATE TRIGGER trg_ops_recovery_cases_updated_at
  BEFORE UPDATE ON public.ops_recovery_cases
  FOR EACH ROW EXECUTE FUNCTION public.set_ops_recovery_cases_updated_at();

ALTER TABLE public.ops_recovery_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ops_recovery_cases_auth ON public.ops_recovery_cases;
CREATE POLICY ops_recovery_cases_auth ON public.ops_recovery_cases
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_recovery_cases TO authenticated;

-- Seed the cases previously hardcoded in GuestRecovery.tsx.
INSERT INTO public.ops_recovery_cases
  (id, property_id, guest_name, room_number, complaint, category, status, priority,
   assigned_to, compensation_amount, corrective_action, follow_up_date, logged_by, created_at)
VALUES
  ('rc-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Mr. Johnson', '305',
   'Water leak in bathroom caused damage to personal belongings', 'Maintenance',
   'corrective-action', 'high', 'Guest Relations Manager', 150,
   'Room moved, belongings cleaned, plumbing repaired', NULL, 'seed', '2026-07-31T09:30:00Z'),
  ('rc-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Ms. Williams', '412',
   'Noise from construction work prevented sleep', 'Facilities',
   'compensation-pending', 'medium', 'Front Office Manager', 75,
   NULL, NULL, 'seed', '2026-07-31T11:15:00Z'),
  ('rc-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Dr. Brown', '218',
   'Room service delivered cold meal', 'F&B',
   'investigating', 'low', 'F&B Manager', NULL,
   NULL, NULL, 'seed', '2026-07-31T07:45:00Z'),
  ('rc-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Mr. Davis', '501',
   'AC not working properly throughout stay', 'Maintenance',
   'follow-up', 'high', 'Engineering Manager', 200,
   'AC repaired, partial refund processed', '2026-08-02', 'seed', '2026-07-30T14:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- 632_ops_approval_center.sql
-- Operations Portal — Manager Approval Center module.
-- Backs the /erp/operations/approvals tab (ManagerApprovalCenter.tsx).
--
-- The approval inbox aggregates pending requests from the real department
-- tables (fin_approval_requests, fin_journal_approvals, hr_approval_requests,
-- hr_manager_approvals, hr_overtime_requests, uinv_approval_requests) and
-- writes decisions back to them. This table holds ops-center-native
-- requests that don't belong to a department workflow (rate overrides,
-- complimentary stays, misc approvals) — seeded with the 6 requests that
-- were previously hardcoded in the component.
--
--   status: pending → approved | rejected | escalated

-- ── Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ops_approval_requests (
  id              TEXT PRIMARY KEY,
  property_id     UUID,
  type            TEXT NOT NULL,
  category        TEXT NOT NULL,
  department      TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  amount          NUMERIC,
  requested_by    TEXT,
  urgency         TEXT NOT NULL DEFAULT 'medium' CHECK (urgency IN (
                    'low', 'medium', 'high', 'critical'
                  )),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                    'pending', 'approved', 'rejected', 'escalated'
                  )),
  details         JSONB,
  decided_by      TEXT,
  decided_at      TIMESTAMPTZ,
  decision_notes  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_approval_requests_property
  ON public.ops_approval_requests(property_id);
CREATE INDEX IF NOT EXISTS idx_ops_approval_requests_status
  ON public.ops_approval_requests(status);

-- ── updated_at trigger ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_ops_approval_requests_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ops_approval_requests_updated_at
  ON public.ops_approval_requests;
CREATE TRIGGER trg_ops_approval_requests_updated_at
  BEFORE UPDATE ON public.ops_approval_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ops_approval_requests_timestamp();

ALTER TABLE public.ops_approval_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_approval_requests TO authenticated;

-- ── Seed mock data ───────────────────────────────────────────────────────
-- The 6 requests previously hardcoded in ManagerApprovalCenter.tsx
-- (mockRequests). Uses the demo property
-- 18762279-a389-41c9-9169-7ebc682e9703. 'requested_at' is set to now minus
-- the offset the mock displayed ("2 hours ago", "1 day ago", ...).
INSERT INTO public.ops_approval_requests
  (id, property_id, type, category, department, title, description,
   amount, requested_by, urgency, status, details, created_at)
VALUES
  ('ops-apr-seed-001', '18762279-a389-41c9-9169-7ebc682e9703',
   'Rate Override', 'Front Office', 'FrontOffice',
   'Room Rate Override - Room 305',
   'Guest requesting 15% discount due to extended stay commitment',
   42.50, 'John Smith', 'medium', 'pending',
   '{"roomNumber":"305","guestName":"Mr. Johnson","originalRate":285,"requestedRate":242.50,"reason":"Extended stay - 7 nights"}'::jsonb,
   NOW() - interval '2 hours'),
  ('ops-apr-seed-002', '18762279-a389-41c9-9169-7ebc682e9703',
   'Complimentary Stay', 'Front Office', 'FrontOffice',
   'Complimentary Night - VIP Guest',
   'Request for complimentary night for VIP guest due to service recovery',
   285, 'Sarah Johnson', 'high', 'pending',
   '{"guestName":"Dr. Michael Chen","roomNumber":"Presidential Suite","reason":"Service recovery for HVAC issue","nights":1}'::jsonb,
   NOW() - interval '3 hours'),
  ('ops-apr-seed-003', '18762279-a389-41c9-9169-7ebc682e9703',
   'Emergency Purchase', 'Procurement', 'Procurement',
   'Emergency HVAC Parts',
   'Urgent purchase of HVAC replacement parts for Floor 3 repair',
   2500, 'Mike Wilson', 'critical', 'pending',
   '{"items":"Compressor unit, control board, refrigerant","vendor":"Climate Control Solutions","reason":"Critical system failure affecting 12 rooms"}'::jsonb,
   NOW() - interval '1 hour'),
  ('ops-apr-seed-004', '18762279-a389-41c9-9169-7ebc682e9703',
   'Overtime Approval', 'Human Resources', 'HR',
   'Housekeeping Overtime - Weekend',
   'Request for overtime approval for housekeeping staff due to high occupancy',
   1200, 'Emily Brown', 'medium', 'pending',
   '{"staffCount":5,"hours":8,"reason":"82% occupancy, VIP arrivals"}'::jsonb,
   NOW() - interval '4 hours'),
  ('ops-apr-seed-005', '18762279-a389-41c9-9169-7ebc682e9703',
   'Refund Approval', 'Finance', 'Finance',
   'Guest Refund - Room 402',
   'Partial refund requested due to noise disturbance from construction',
   150, 'David Lee', 'low', 'pending',
   '{"guestName":"Ms. Garcia","roomNumber":"402","reason":"Noise disturbance from construction work","refundPercentage":50}'::jsonb,
   NOW() - interval '5 hours'),
  ('ops-apr-seed-006', '18762279-a389-41c9-9169-7ebc682e9703',
   'Capital Repair', 'Engineering', 'Engineering',
   'Elevator Modernization - North Wing',
   'Capital expenditure approval for elevator system upgrade',
   45000, 'Robert Taylor', 'low', 'escalated',
   '{"elevatorCount":2,"estimatedDuration":"4 weeks","vendor":"Elevator Technologies Inc","justification":"Equipment end-of-life, safety compliance"}'::jsonb,
   NOW() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

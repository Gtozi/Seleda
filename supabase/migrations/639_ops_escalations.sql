-- Migration 639: Operations Escalation Center persistence
-- Backs /erp/operations/escalation (EscalationCenter.tsx).
--
-- ops_escalations stores escalations that have been acknowledged into the
-- Ops workflow. Auto-detected candidates (overdue Emergency work orders,
-- stale Urgent/High guest requests, Critical security incidents, overdue
-- Critical/High housekeeping tasks) are computed live by
-- operationsEscalations.routes.ts and adopted here via source_ref dedup.

CREATE TABLE IF NOT EXISTS public.ops_escalations (
  id            TEXT PRIMARY KEY,
  property_id   UUID,
  type          TEXT NOT NULL CHECK (type IN (
    'sla-violation', 'guest-complaint', 'delayed-task',
    'equipment-failure', 'staff-shortage', 'high-risk-incident', 'other')),
  severity      TEXT NOT NULL DEFAULT 'moderate' CHECK (severity IN ('minor', 'moderate', 'major', 'critical')),
  description   TEXT NOT NULL,
  source        TEXT,                 -- originating portal/department
  source_ref    TEXT UNIQUE,          -- e.g. 'work_orders/WO-001' for dedup
  escalated_to  TEXT,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'in-progress', 'resolved')),
  due_by        TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  resolved_at   TIMESTAMPTZ,
  resolution    TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_escalations_status ON public.ops_escalations (status);
CREATE INDEX IF NOT EXISTS idx_ops_escalations_property ON public.ops_escalations (property_id);

CREATE OR REPLACE FUNCTION public.ops_escalations_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ops_escalations_updated ON public.ops_escalations;
CREATE TRIGGER trg_ops_escalations_updated
  BEFORE UPDATE ON public.ops_escalations
  FOR EACH ROW EXECUTE FUNCTION public.ops_escalations_touch_updated_at();

ALTER TABLE public.ops_escalations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ops_escalations_auth ON public.ops_escalations;
CREATE POLICY ops_escalations_auth ON public.ops_escalations
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_escalations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_escalations TO service_role;

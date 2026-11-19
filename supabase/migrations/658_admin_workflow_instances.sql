-- ============================================================
-- Migration 658: Workflow instances (runtime state for admin_workflows)
-- ============================================================
-- A row is created when an active admin_workflows definition matches an
-- emitted event (e.g. purchase_order.submitted). `steps` is a snapshot of
-- the definition at start so later edits don't alter running instances.
-- Served by src/server/routes/adminControl.routes.ts and
-- src/server/services/workflowEngine.ts. Service-role only.

CREATE TABLE IF NOT EXISTS public.admin_workflow_instances (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workflow_id text,
  workflow_name text NOT NULL,
  workflow_version integer NOT NULL DEFAULT 1,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  trigger_event text NOT NULL,
  property_id uuid,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_step integer NOT NULL DEFAULT 0,
  assigned_role text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','rejected','cancelled')),
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS admin_workflow_instances_entity_idx ON public.admin_workflow_instances (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS admin_workflow_instances_pending_idx ON public.admin_workflow_instances (status, assigned_role) WHERE status = 'pending';

ALTER TABLE public.admin_workflow_instances ENABLE ROW LEVEL SECURITY;

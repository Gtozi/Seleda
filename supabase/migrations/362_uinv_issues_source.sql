-- ════════════════════════════════════════════════════════════════
-- 362 — uinv_issues: add source column + issue_number auto-generation
--
-- Distinguishes department requisitions (created from a department
-- portal) from direct issues (created from the inventory portal's
-- Stock Operations tab). Both share the uinv_issues table as the
-- single source of truth.
-- ════════════════════════════════════════════════════════════════

ALTER TABLE public.uinv_issues
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'Direct';

-- Backfill: any issue with a REQ- prefix is a requisition
UPDATE public.uinv_issues SET source = 'Requisition' WHERE issue_number LIKE 'REQ-%' AND source = 'Direct';

CREATE INDEX IF NOT EXISTS idx_uinv_issues_source ON public.uinv_issues(source);

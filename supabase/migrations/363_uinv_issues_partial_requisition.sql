-- ════════════════════════════════════════════════════════════════
-- 363 — uinv_issues: requisition_id + partial fulfillment support
--
-- - Adds requisition_id column so a direct issue can be linked back
--   to the requisition it fulfills.
-- - Adds partially_issued_qty tracking per line via the lines JSONB
--   (issuedQty already exists on lines; this migration just documents
--    the 'Partially Issued' approval_status value).
-- ════════════════════════════════════════════════════════════════

ALTER TABLE public.uinv_issues
  ADD COLUMN IF NOT EXISTS requisition_id text REFERENCES public.uinv_issues(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_uinv_issues_requisition_id ON public.uinv_issues(requisition_id);

-- NOTE: approval_status is a free-text column (no CHECK constraint),
-- so 'Partially Issued' is accepted without a schema change.

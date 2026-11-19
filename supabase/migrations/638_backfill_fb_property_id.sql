-- 638: Backfill property_id for legacy F&B quality tables (same convention as
-- migration 630 — all NULL rows are legacy seed data for the main property;
-- no rows reference the Airport Branch). fb_guest_feedback lacked the column
-- entirely, so it is added first (nullable + backfill, matching migration 319).

ALTER TABLE public.fb_guest_feedback
  ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL;

UPDATE public.fb_quality_service_standards
SET property_id = '18762279-a389-41c9-9169-7ebc682e9703'
WHERE property_id IS NULL;

UPDATE public.fb_compliance_audits
SET property_id = '18762279-a389-41c9-9169-7ebc682e9703'
WHERE property_id IS NULL;

UPDATE public.fb_guest_feedback
SET property_id = '18762279-a389-41c9-9169-7ebc682e9703'
WHERE property_id IS NULL;

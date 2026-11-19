-- Migration: consolidate FB Financial Control and FB Analytics under fb_financials
-- Adds the new combined module key to F&B role module_access and removes
-- the old split keys (fb_financial_control, fb_analytics) so the combined
-- /erp/fb/financials tab is accessible and the old tabs are no longer shown.

UPDATE roles
SET module_access = COALESCE(module_access, '{}'::jsonb)
                   || '{"fb_financials": {"edit": true, "read": true}}'::jsonb
                   - 'fb_financial_control'
                   - 'fb_analytics'
WHERE module_access ?| ARRAY['fb_financial_control','fb_analytics','fnb'];

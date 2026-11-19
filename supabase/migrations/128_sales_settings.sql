-- Migration 128: Sales Settings
-- Tracks configurable sales portal settings (key/value with type and category).

-- =============================================================
-- 1. Sales Settings table
-- =============================================================

CREATE TABLE IF NOT EXISTS public.sales_settings (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  setting_key text NOT NULL UNIQUE,
  setting_value text,
  setting_type text DEFAULT 'string',
  label text,
  category text,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- 2. updated_at trigger
-- =============================================================

DROP TRIGGER IF EXISTS trg_sales_settings_updated_at ON public.sales_settings;
CREATE TRIGGER trg_sales_settings_updated_at
  BEFORE UPDATE ON public.sales_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================
-- 3. Performance indexes
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_sales_settings_category ON public.sales_settings(category);
CREATE INDEX IF NOT EXISTS idx_sales_settings_key ON public.sales_settings(setting_key);

-- =============================================================
-- 4. Mock data
-- =============================================================

INSERT INTO public.sales_settings (id, setting_key, setting_value, setting_type, label, category, created_by) VALUES
  ('mock-set-001', 'defaultCurrency', 'USD', 'string', 'Default Currency', 'General Settings', 'system'),
  ('mock-set-002', 'leadScoringThreshold', '50', 'number', 'Lead Scoring Threshold', 'General Settings', 'system'),
  ('mock-set-003', 'autoAssignLeads', 'true', 'boolean', 'Auto-assign new leads to sales reps (round-robin)', 'General Settings', 'system'),
  ('mock-set-004', 'proposalValidDays', '30', 'number', 'Proposal Validity (days)', 'General Settings', 'system'),
  ('mock-set-005', 'proposalPrefix', 'PROP-', 'string', 'Proposal Prefix', 'General Settings', 'system'),
  ('mock-set-006', 'contractPrefix', 'CTR-', 'string', 'Contract Prefix', 'General Settings', 'system'),
  ('mock-set-007', 'corporateDiscountDefault', '10', 'number', 'Corporate Discount Default (%)', 'Commission Structure', 'system'),
  ('mock-set-008', 'travelAgentCommissionDefault', '12', 'number', 'Travel Agent Commission Default (%)', 'Commission Structure', 'system'),
  ('mock-set-009', 'loyaltyBronzeThreshold', '0', 'number', 'Bronze (points)', 'Loyalty Tiers', 'system'),
  ('mock-set-010', 'loyaltySilverThreshold', '5000', 'number', 'Silver (points)', 'Loyalty Tiers', 'system'),
  ('mock-set-011', 'loyaltyGoldThreshold', '15000', 'number', 'Gold (points)', 'Loyalty Tiers', 'system'),
  ('mock-set-012', 'loyaltyPlatinumThreshold', '30000', 'number', 'Platinum (points)', 'Loyalty Tiers', 'system'),
  ('mock-set-013', 'emailNotifications', 'true', 'boolean', 'Email Notifications', 'Notification Settings', 'system'),
  ('mock-set-014', 'smsNotifications', 'true', 'boolean', 'SMS Notifications', 'Notification Settings', 'system'),
  ('mock-set-015', 'pushNotifications', 'false', 'boolean', 'Push Notifications', 'Notification Settings', 'system'),
  ('mock-set-016', 'leadAssignedAlert', 'true', 'boolean', 'Lead Assigned Alert', 'Notification Settings', 'system'),
  ('mock-set-017', 'proposalStatusAlert', 'true', 'boolean', 'Proposal Status Change Alert', 'Notification Settings', 'system'),
  ('mock-set-018', 'contractExpiryAlert', 'true', 'boolean', 'Contract Expiry Alert', 'Notification Settings', 'system'),
  ('mock-set-019', 'campaignCompletionAlert', 'true', 'boolean', 'Campaign Completion Alert', 'Notification Settings', 'system')
ON CONFLICT (setting_key) DO NOTHING;

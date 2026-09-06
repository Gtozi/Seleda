-- Finance Dashboard mock data migration.
-- Stores snapshot-based dashboard KPIs, charts, alerts, bank accounts and
-- ratios so /erp/finance/dashboard can be DB-backed instead of hard-coded.

BEGIN;

-- Single snapshot table for finance dashboard data.
-- A snapshot belongs to a property (or is global when property_id IS NULL).
CREATE TABLE IF NOT EXISTS fin_dashboard_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  kpis JSONB NOT NULL DEFAULT '[]'::jsonb,
  revenue_expense_trend JSONB NOT NULL DEFAULT '[]'::jsonb,
  dept_revenue JSONB NOT NULL DEFAULT '[]'::jsonb,
  ar_aging JSONB NOT NULL DEFAULT '[]'::jsonb,
  alerts JSONB NOT NULL DEFAULT '[]'::jsonb,
  bank_accounts JSONB NOT NULL DEFAULT '[]'::jsonb,
  ratios JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(property_id, snapshot_date)
);

ALTER TABLE fin_dashboard_snapshots ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read dashboard snapshots for any property.
-- This mirrors the property-scoped read pattern used elsewhere; apps filter
-- by current property on the client/server side.
CREATE POLICY "Allow authenticated read dashboard snapshots"
  ON fin_dashboard_snapshots
  FOR SELECT TO authenticated USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON fin_dashboard_snapshots TO authenticated;

-- updated_at trigger
CREATE OR REPLACE FUNCTION trg_fin_dashboard_snapshots_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fin_dashboard_snapshots_updated_at ON fin_dashboard_snapshots;
CREATE TRIGGER fin_dashboard_snapshots_updated_at
  BEFORE UPDATE ON fin_dashboard_snapshots
  FOR EACH ROW EXECUTE FUNCTION trg_fin_dashboard_snapshots_updated_at();

-- Global demo snapshot for finance dashboard.
INSERT INTO fin_dashboard_snapshots (property_id, snapshot_date, kpis, revenue_expense_trend, dept_revenue, ar_aging, alerts, bank_accounts, ratios)
VALUES (
  NULL,
  '2024-06-30',
  '[
    {"label":"Total Revenue","value":"$2,450,000","trend":"+8.5%","is_positive":true,"icon":"DollarSign","color_class":"text-emerald-500","bg_class":"bg-emerald-50 dark:bg-emerald-500/10"},
    {"label":"Total Expenses","value":"$1,850,000","trend":"+5.2%","is_positive":false,"icon":"Wallet","color_class":"text-rose-500","bg_class":"bg-rose-50 dark:bg-rose-500/10"},
    {"label":"Gross Profit","value":"$600,000","trend":"+12.3%","is_positive":true,"icon":"TrendingUp","color_class":"text-indigo-500","bg_class":"bg-indigo-50 dark:bg-indigo-500/10"},
    {"label":"Operating Profit","value":"$420,000","trend":"+9.8%","is_positive":true,"icon":"Activity","color_class":"text-blue-500","bg_class":"bg-blue-50 dark:bg-blue-500/10"},
    {"label":"Net Profit","value":"$285,000","trend":"+15.2%","is_positive":true,"icon":"Banknote","color_class":"text-emerald-600","bg_class":"bg-emerald-50 dark:bg-emerald-500/10"},
    {"label":"EBITDA","value":"$350,000","trend":"+11.4%","is_positive":true,"icon":"Building2","color_class":"text-purple-500","bg_class":"bg-purple-50 dark:bg-purple-500/10"},
    {"label":"Cash Position","value":"$1,850,200","trend":"+5.1%","is_positive":true,"icon":"Wallet","color_class":"text-emerald-600","bg_class":"bg-emerald-50 dark:bg-emerald-500/10"},
    {"label":"Bank Balance","value":"$1,650,000","trend":"+4.8%","is_positive":true,"icon":"Banknote","color_class":"text-blue-600","bg_class":"bg-blue-50 dark:bg-blue-500/10"},
    {"label":"AR Aging (0-30)","value":"$142,500","trend":"-2.4%","is_positive":true,"icon":"Wallet","color_class":"text-indigo-500","bg_class":"bg-indigo-50 dark:bg-indigo-500/10"},
    {"label":"AP Aging (0-30)","value":"$98,200","trend":"+1.2%","is_positive":false,"icon":"Wallet","color_class":"text-rose-500","bg_class":"bg-rose-50 dark:bg-rose-500/10"},
    {"label":"Daily Cash Flow","value":"$45,000","trend":"+18.5%","is_positive":true,"icon":"TrendingUp","color_class":"text-emerald-500","bg_class":"bg-emerald-50 dark:bg-emerald-500/10"},
    {"label":"Budget vs Actual","value":"98.5%","trend":"+1.5%","is_positive":true,"icon":"Activity","color_class":"text-amber-500","bg_class":"bg-amber-50 dark:bg-amber-500/10"}
  ]'::jsonb,
  '[
    {"month":"Jan","revenue":420000,"expense":320000},
    {"month":"Feb","revenue":380000,"expense":310000},
    {"month":"Mar","revenue":450000,"expense":340000},
    {"month":"Apr","revenue":480000,"expense":360000},
    {"month":"May","revenue":510000,"expense":380000},
    {"month":"Jun","revenue":550000,"expense":395000}
  ]'::jsonb,
  '[
    {"name":"Rooms","value":245000,"color":"#6366f1"},
    {"name":"F&B","value":142000,"color":"#10b981"},
    {"name":"Events","value":85000,"color":"#f59e0b"},
    {"name":"Laundry","value":24000,"color":"#ec4899"},
    {"name":"Other","value":12000,"color":"#94a3b8"}
  ]'::jsonb,
  '[
    {"range":"Current","amount":85000},
    {"range":"30 Days","amount":24000},
    {"range":"60 Days","amount":12000},
    {"range":"90 Days","amount":3200}
  ]'::jsonb,
  '[
    {"type":"Overdue Receivables","message":"12 invoices over 60 days totaling $15,200 require immediate collection action.","severity":"high","icon":"AlertCircle","color":"text-rose-500","bg":"bg-rose-50 dark:bg-rose-500/10","border":"border-rose-200 dark:border-rose-500/20"},
    {"type":"Overdue Payables","message":"3 vendor payments past due totaling $8,400 — risk of supplier credit hold.","severity":"high","icon":"AlertTriangle","color":"text-amber-500","bg":"bg-amber-50 dark:bg-amber-500/10","border":"border-amber-200 dark:border-amber-500/20"},
    {"type":"Cash Shortage","message":"Petty cash float for Front Office is $450 below required minimum.","severity":"medium","icon":"Wallet","color":"text-orange-500","bg":"bg-orange-50 dark:bg-orange-500/10","border":"border-orange-200 dark:border-orange-500/20"},
    {"type":"Budget Exceeded","message":"Marketing department has exceeded Q2 budget by 8.5% ($4,200 over).","severity":"medium","icon":"TrendingUp","color":"text-purple-500","bg":"bg-purple-50 dark:bg-purple-500/10","border":"border-purple-200 dark:border-purple-500/20"},
    {"type":"Bank Reconciliation Pending","message":"CBE Operating account has 15 unreconciled statement lines for May.","severity":"low","icon":"Building2","color":"text-blue-500","bg":"bg-blue-50 dark:bg-blue-500/10","border":"border-blue-200 dark:border-blue-500/20"},
    {"type":"Tax Filing Due","message":"VAT return for June 2024 due to ERCA by July 20 — 12 days remaining.","severity":"high","icon":"FileWarning","color":"text-rose-600","bg":"bg-rose-50 dark:bg-rose-500/10","border":"border-rose-200 dark:border-rose-500/20"},
    {"type":"Period Close Pending","message":"May 2024 accounting period is open — 6 of 16 close checklist items incomplete.","severity":"medium","icon":"Clock","color":"text-indigo-500","bg":"bg-indigo-50 dark:bg-indigo-500/10","border":"border-indigo-200 dark:border-indigo-500/20"},
    {"type":"Approval Queue","message":"5 journal entries and 2 vendor payments awaiting Finance Manager approval.","severity":"low","icon":"CheckSquare","color":"text-emerald-500","bg":"bg-emerald-50 dark:bg-emerald-500/10","border":"border-emerald-200 dark:border-emerald-500/20"},
    {"type":"Suspense Account Balance","message":"Suspense account 9999 has a non-zero balance of $2,340 — requires clearing.","severity":"medium","icon":"Scale","color":"text-amber-600","bg":"bg-amber-50 dark:bg-amber-500/10","border":"border-amber-200 dark:border-amber-500/20"}
  ]'::jsonb,
  '[
    {"bank":"Chase Operating","acc":"...4920","type":"Primary Operational","bal":"$1,850,200","color":"border-l-emerald-500"},
    {"bank":"Wells Fargo","acc":"...8812","type":"Payroll Fund","bal":"$450,100","color":"border-l-indigo-500"},
    {"bank":"AMEX Settlement","acc":"...1104","type":"Merchant Sync","bal":"$125,400","color":"border-l-amber-500"}
  ]'::jsonb,
  '[
    {"name":"Debt-to-Equity","value":"0.42"},
    {"name":"Current Ratio","value":"2.81"},
    {"name":"Burn Rate","value":"$8.4k"}
  ]'::jsonb
)
ON CONFLICT (property_id, snapshot_date) DO NOTHING;

COMMIT;

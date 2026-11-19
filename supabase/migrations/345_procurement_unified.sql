-- 345_procurement_unified.sql
-- Unified Supply Chain & Procurement Portal
-- Backs the /erp/procurement/* tabs following the Engineering portal DB-integrated pattern.
-- This migration creates the complete procurement schema as specified in
-- unified_supply_chain_procurement_portal.md.
--
-- The portal manages:
-- - Supplier Management (onboarding, qualification, performance, risk)
-- - Purchase Requisitions (internal demand)
-- - Sourcing (RFQ, quotations, comparison, negotiation, award)
-- - Purchase Orders (lifecycle, amendments, tracking)
-- - Contracts (lifecycle, alerts, pricing)
-- - Budgets (commitments, utilization, control)
-- - Receiving Coordination (expected deliveries, alerts)
-- - Cost Savings (tracking by type)
-- - Demand Planning (forecasts)
-- - Procurement Alerts (dashboard alerts)
-- - Configuration (master data, settings)
--
-- Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703) for seed data.

-- ── Procurement Categories (Master Data) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proc_categories (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL UNIQUE,
  parent_id          TEXT REFERENCES public.proc_categories(id) ON DELETE SET NULL,
  category_type      TEXT NOT NULL CHECK (category_type IN (
                       'Food & Beverage', 'Housekeeping', 'Engineering',
                       'Spa & Wellness', 'Banquet & Events', 'Transportation',
                       'Administration', 'General'
                     )),
  description        TEXT,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proc_categories_type ON public.proc_categories(category_type);
CREATE INDEX IF NOT EXISTS idx_proc_categories_parent ON public.proc_categories(parent_id);

-- ── Suppliers (Master) ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proc_suppliers (
  id                       TEXT PRIMARY KEY,
  supplier_code            TEXT NOT NULL UNIQUE,
  legal_name               TEXT NOT NULL,
  trading_name             TEXT,
  supplier_type            TEXT NOT NULL CHECK (supplier_type IN (
                           'Local', 'National', 'International', 'Strategic',
                           'Preferred', 'Emergency', 'One-time'
                         )),
  supplier_category        TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'Application' CHECK (status IN (
                           'Application', 'Under Review', 'Pending Approval',
                           'Active', 'Preferred', 'Restricted', 'Suspended',
                           'Disqualified', 'Inactive'
                         )),
  -- Contact
  address                  TEXT,
  city                     TEXT,
  country                  TEXT DEFAULT 'Ethiopia',
  phone                    TEXT,
  email                    TEXT,
  website                  TEXT,
  -- Compliance
  tax_id                   TEXT,
  business_license         TEXT,
  tax_certificate          TEXT,
  -- Commercial
  currency                 TEXT DEFAULT 'ETB',
  payment_terms            INTEGER DEFAULT 30, -- days
  delivery_terms           TEXT,
  lead_time                INTEGER DEFAULT 7, -- days
  min_order_quantity       NUMERIC(12, 2) DEFAULT 0,
  -- Performance (auto-calculated)
  quality_score            NUMERIC(3, 1) DEFAULT 80.0 CHECK (quality_score BETWEEN 0 AND 100),
  on_time_delivery_rate    NUMERIC(5, 2) DEFAULT 95.0 CHECK (on_time_delivery_rate BETWEEN 0 AND 100),
  price_competitiveness_score NUMERIC(3, 1) DEFAULT 75.0 CHECK (price_competitiveness_score BETWEEN 0 AND 100),
  overall_score            NUMERIC(3, 1) DEFAULT 80.0 CHECK (overall_score BETWEEN 0 AND 100),
  -- Risk
  risk_level               TEXT DEFAULT 'Medium' CHECK (risk_level IN ('Low', 'Medium', 'High', 'Critical')),
  -- Sustainability (optional)
  is_local                 BOOLEAN DEFAULT FALSE,
  is_sustainable           BOOLEAN DEFAULT FALSE,
  eco_certification        TEXT,
  -- Multi-property
  property_id              UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  -- Audit
  notes                    TEXT,
  created_by               TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proc_suppliers_code ON public.proc_suppliers(supplier_code);
CREATE INDEX IF NOT EXISTS idx_proc_suppliers_status ON public.proc_suppliers(status);
CREATE INDEX IF NOT EXISTS idx_proc_suppliers_type ON public.proc_suppliers(supplier_type);
CREATE INDEX IF NOT EXISTS idx_proc_suppliers_category ON public.proc_suppliers(supplier_category);
CREATE INDEX IF NOT EXISTS idx_proc_suppliers_property ON public.proc_suppliers(property_id);
CREATE INDEX IF NOT EXISTS idx_proc_suppliers_risk ON public.proc_suppliers(risk_level);

-- ── Supplier Contacts ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proc_supplier_contacts (
  id                 TEXT PRIMARY KEY,
  supplier_id        TEXT NOT NULL REFERENCES public.proc_suppliers(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  role               TEXT,
  department         TEXT,
  email              TEXT,
  phone              TEXT,
  is_primary         BOOLEAN DEFAULT FALSE,
  is_billing         BOOLEAN DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proc_supplier_contacts_supplier ON public.proc_supplier_contacts(supplier_id);

-- ── Supplier Documents (Certifications, Compliance) ───────────────────────
CREATE TABLE IF NOT EXISTS public.proc_supplier_documents (
  id                 TEXT PRIMARY KEY,
  supplier_id        TEXT NOT NULL REFERENCES public.proc_suppliers(id) ON DELETE CASCADE,
  document_type      TEXT NOT NULL CHECK (document_type IN (
                       'Business License', 'Tax Certificate', 'Insurance',
                       'Food Safety Certificate', 'Quality Certificate',
                       'Environmental Certificate', 'Bank Letter',
                       'NDA', 'Contract', 'Other'
                     )),
  document_name      TEXT NOT NULL,
  document_url       TEXT,
  issue_date         DATE,
  expiry_date        DATE,
  status             TEXT DEFAULT 'Valid' CHECK (status IN ('Valid', 'Expiring', 'Expired', 'Pending Review')),
  verification_status TEXT DEFAULT 'Pending' CHECK (verification_status IN ('Pending', 'Verified', 'Rejected')),
  verified_by        TEXT,
  verified_at        TIMESTAMPTZ,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proc_supplier_documents_supplier ON public.proc_supplier_documents(supplier_id);
CREATE INDEX IF NOT EXISTS idx_proc_supplier_documents_expiry ON public.proc_supplier_documents(expiry_date);

-- ── Supplier Performance (Monthly snapshots) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.proc_supplier_performance (
  id                 TEXT PRIMARY KEY,
  supplier_id        TEXT NOT NULL REFERENCES public.proc_suppliers(id) ON DELETE CASCADE,
  period_start       DATE NOT NULL,
  period_end         DATE NOT NULL,
  -- Metrics
  total_orders       INTEGER DEFAULT 0,
  on_time_deliveries INTEGER DEFAULT 0,
  late_deliveries    INTEGER DEFAULT 0,
  on_time_delivery_rate NUMERIC(5, 2) DEFAULT 0,
  quality_score      NUMERIC(3, 1) DEFAULT 0,
  order_accuracy_score NUMERIC(3, 1) DEFAULT 0,
  responsiveness_score NUMERIC(3, 1) DEFAULT 0,
  price_competitiveness_score NUMERIC(3, 1) DEFAULT 0,
  -- Financial
  total_spend        NUMERIC(12, 2) DEFAULT 0,
  -- Issues
  returns_count      INTEGER DEFAULT 0,
  complaints_count   INTEGER DEFAULT 0,
  rejection_rate     NUMERIC(5, 2) DEFAULT 0,
  -- Calculated overall
  overall_score      NUMERIC(3, 1) DEFAULT 0,
  trend              TEXT DEFAULT 'stable', -- 'improving', 'stable', 'declining'
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(supplier_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_proc_supplier_performance_supplier ON public.proc_supplier_performance(supplier_id);
CREATE INDEX IF NOT EXISTS idx_proc_supplier_performance_period ON public.proc_supplier_performance(period_start, period_end);

-- ── Supplier Risk Register ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proc_supplier_risks (
  id                 TEXT PRIMARY KEY,
  supplier_id        TEXT NOT NULL REFERENCES public.proc_suppliers(id) ON DELETE CASCADE,
  risk_type          TEXT NOT NULL CHECK (risk_type IN (
                       'Financial', 'Delivery', 'Quality', 'Compliance',
                       'Geographic', 'Price', 'Concentration', 'Contract', 'Operational'
                     )),
  risk_level         TEXT NOT NULL CHECK (risk_level IN ('Low', 'Medium', 'High', 'Critical')),
  risk_description   TEXT NOT NULL,
  mitigation_plan    TEXT,
  owner              TEXT,
  status             TEXT DEFAULT 'Open' CHECK (status IN ('Open', 'Mitigating', 'Closed')),
  identified_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proc_supplier_risks_supplier ON public.proc_supplier_risks(supplier_id);
CREATE INDEX IF NOT EXISTS idx_proc_supplier_risks_level ON public.proc_supplier_risks(risk_level);
CREATE INDEX IF NOT EXISTS idx_proc_supplier_risks_status ON public.proc_supplier_risks(status);

-- ── Purchase Requisitions (Header) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proc_requisitions (
  id                 TEXT PRIMARY KEY,
  pr_number          TEXT NOT NULL UNIQUE,
  property_id        UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  department         TEXT NOT NULL,
  requester          TEXT NOT NULL,
  request_date       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  required_date      DATE NOT NULL,
  priority           TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN (
                       'Low', 'Normal', 'High', 'Urgent', 'Critical', 'Emergency'
                     )),
  cost_center        TEXT,
  budget_code        TEXT,
  purpose            TEXT,
  notes              TEXT,
  status             TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN (
                       'Draft', 'Submitted', 'Under Review', 'Approved',
                       'Sourcing', 'Converted to PO', 'Partially Fulfilled',
                       'Fully Fulfilled', 'Closed', 'Rejected', 'Returned',
                       'Cancelled', 'On Hold'
                     )),
  estimated_total    NUMERIC(12, 2) DEFAULT 0,
  -- Approval
  submitted_at       TIMESTAMPTZ,
  reviewed_at        TIMESTAMPTZ,
  approved_at        TIMESTAMPTZ,
  approved_by        TEXT,
  -- Conversion
  converted_po_id    TEXT,
  converted_at       TIMESTAMPTZ,
  -- Audit
  created_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proc_requisitions_number ON public.proc_requisitions(pr_number);
CREATE INDEX IF NOT EXISTS idx_proc_requisitions_property ON public.proc_requisitions(property_id);
CREATE INDEX IF NOT EXISTS idx_proc_requisitions_department ON public.proc_requisitions(department);
CREATE INDEX IF NOT EXISTS idx_proc_requisitions_status ON public.proc_requisitions(status);
CREATE INDEX IF NOT EXISTS idx_proc_requisitions_priority ON public.proc_requisitions(priority);
CREATE INDEX IF NOT EXISTS idx_proc_requisitions_request_date ON public.proc_requisitions(request_date DESC);

-- ── Requisition Lines (JSONB for flexibility) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.proc_requisition_lines (
  id                 TEXT PRIMARY KEY,
  requisition_id     TEXT NOT NULL REFERENCES public.proc_requisitions(id) ON DELETE CASCADE,
  line_number        INTEGER NOT NULL,
  item_code          TEXT,
  item_name          TEXT NOT NULL,
  description        TEXT,
  category           TEXT,
  quantity           NUMERIC(10, 3) NOT NULL,
  unit_of_measure    TEXT NOT NULL,
  estimated_unit_price NUMERIC(10, 2) NOT NULL,
  estimated_total    NUMERIC(12, 2) NOT NULL,
  required_date      DATE,
  preferred_supplier_id TEXT REFERENCES public.proc_suppliers(id) ON DELETE SET NULL,
  specification      TEXT,
  cost_center        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proc_requisition_lines_requisition ON public.proc_requisition_lines(requisition_id);

-- ── RFQs (Request for Quotation) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proc_rfqs (
  id                 TEXT PRIMARY KEY,
  rfq_number         TEXT NOT NULL UNIQUE,
  property_id        UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  department         TEXT NOT NULL,
  procurement_officer TEXT NOT NULL,
  issue_date         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  response_deadline  TIMESTAMPTZ NOT NULL,
  currency           TEXT DEFAULT 'ETB',
  delivery_requirement TEXT,
  terms              TEXT,
  conditions         TEXT,
  status             TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN (
                       'Draft', 'Issued', 'Closed', 'Cancelled'
                     )),
  -- Linking
  requisition_id     TEXT REFERENCES public.proc_requisitions(id) ON DELETE SET NULL,
  -- Award
  awarded_supplier_id TEXT REFERENCES public.proc_suppliers(id) ON DELETE SET NULL,
  awarded_at         TIMESTAMPTZ,
  award_amount       NUMERIC(12, 2),
  award_notes        TEXT,
  -- Audit
  created_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proc_rfqs_number ON public.proc_rfqs(rfq_number);
CREATE INDEX IF NOT EXISTS idx_proc_rfqs_property ON public.proc_rfqs(property_id);
CREATE INDEX IF NOT EXISTS idx_proc_rfqs_status ON public.proc_rfqs(status);
CREATE INDEX IF NOT EXISTS idx_proc_rfqs_deadline ON public.proc_rfqs(response_deadline);

-- ── RFQ Lines ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proc_rfq_lines (
  id                 TEXT PRIMARY KEY,
  rfq_id             TEXT NOT NULL REFERENCES public.proc_rfqs(id) ON DELETE CASCADE,
  line_number        INTEGER NOT NULL,
  item_code          TEXT,
  item_name          TEXT NOT NULL,
  specification      TEXT NOT NULL,
  quantity           NUMERIC(10, 3) NOT NULL,
  unit_of_measure    TEXT NOT NULL,
  required_delivery_date DATE NOT NULL,
  quality_requirement TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proc_rfq_lines_rfq ON public.proc_rfq_lines(rfq_id);

-- ── RFQ Supplier Invitations ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proc_rfq_invitations (
  id                 TEXT PRIMARY KEY,
  rfq_id             TEXT NOT NULL REFERENCES public.proc_rfqs(id) ON DELETE CASCADE,
  supplier_id        TEXT NOT NULL REFERENCES public.proc_suppliers(id) ON DELETE CASCADE,
  invited_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at       TIMESTAMPTZ,
  status             TEXT DEFAULT 'Pending' CHECK (status IN ('Pending', 'Responded', 'Declined', 'No Response')),
  UNIQUE(rfq_id, supplier_id)
);

CREATE INDEX IF NOT EXISTS idx_proc_rfq_invitations_rfq ON public.proc_rfq_invitations(rfq_id);
CREATE INDEX IF NOT EXISTS idx_proc_rfq_invitations_supplier ON public.proc_rfq_invitations(supplier_id);

-- ── Quotations (Supplier Responses) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proc_quotations (
  id                 TEXT PRIMARY KEY,
  quotation_number   TEXT NOT NULL UNIQUE,
  rfq_id             TEXT NOT NULL REFERENCES public.proc_rfqs(id) ON DELETE CASCADE,
  supplier_id        TEXT NOT NULL REFERENCES public.proc_suppliers(id) ON DELETE CASCADE,
  submitted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  currency           TEXT DEFAULT 'ETB',
  subtotal           NUMERIC(12, 2) NOT NULL DEFAULT 0,
  tax                NUMERIC(12, 2) DEFAULT 0,
  discount           NUMERIC(12, 2) DEFAULT 0,
  freight            NUMERIC(12, 2) DEFAULT 0,
  delivery_cost      NUMERIC(12, 2) DEFAULT 0,
  total              NUMERIC(12, 2) NOT NULL DEFAULT 0,
  lead_time          INTEGER DEFAULT 7, -- days
  payment_terms      TEXT,
  warranty           TEXT,
  quote_validity     DATE,
  min_order_quantity NUMERIC(12, 2),
  supplier_notes     TEXT,
  status             TEXT DEFAULT 'Received' CHECK (status IN (
                       'Received', 'Under Review', 'Selected', 'Rejected', 'Expired'
                     )),
  evaluation_score   NUMERIC(5, 2),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proc_quotations_number ON public.proc_quotations(quotation_number);
CREATE INDEX IF NOT EXISTS idx_proc_quotations_rfq ON public.proc_quotations(rfq_id);
CREATE INDEX IF NOT EXISTS idx_proc_quotations_supplier ON public.proc_quotations(supplier_id);
CREATE INDEX IF NOT EXISTS idx_proc_quotations_status ON public.proc_quotations(status);

-- ── Quotation Lines ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proc_quotation_lines (
  id                 TEXT PRIMARY KEY,
  quotation_id       TEXT NOT NULL REFERENCES public.proc_quotations(id) ON DELETE CASCADE,
  rfq_line_id        TEXT REFERENCES public.proc_rfq_lines(id) ON DELETE SET NULL,
  line_number        INTEGER NOT NULL,
  item_code          TEXT,
  item_name          TEXT NOT NULL,
  quantity           NUMERIC(10, 3) NOT NULL,
  unit_of_measure    TEXT NOT NULL,
  unit_price         NUMERIC(10, 2) NOT NULL,
  line_total         NUMERIC(12, 2) NOT NULL,
  lead_time          INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proc_quotation_lines_quotation ON public.proc_quotation_lines(quotation_id);

-- ── Purchase Orders (Header) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proc_purchase_orders (
  id                 TEXT PRIMARY KEY,
  po_number          TEXT NOT NULL UNIQUE,
  property_id        UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  supplier_id        TEXT NOT NULL REFERENCES public.proc_suppliers(id) ON DELETE RESTRICT,
  buyer              TEXT NOT NULL,
  department         TEXT NOT NULL,
  cost_center        TEXT,
  currency           TEXT DEFAULT 'ETB',
  order_date         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  required_delivery_date DATE NOT NULL,
  delivery_location  TEXT,
  payment_terms      TEXT,
  contract_id        TEXT REFERENCES public.proc_contracts(id) ON DELETE SET NULL,
  notes              TEXT,
  internal_notes     TEXT,
  status             TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN (
                       'Draft', 'Pending Approval', 'Approved', 'Sent to Supplier',
                       'Supplier Acknowledged', 'Partially Received', 'Fully Received',
                       'Closed', 'Rejected', 'Cancelled', 'On Hold', 'Expired'
                     )),
  -- Totals
  subtotal           NUMERIC(12, 2) DEFAULT 0,
  tax                NUMERIC(12, 2) DEFAULT 0,
  discount           NUMERIC(12, 2) DEFAULT 0,
  shipping_cost      NUMERIC(12, 2) DEFAULT 0,
  total_amount       NUMERIC(12, 2) DEFAULT 0,
  -- Approval
  submitted_by       TEXT,
  submitted_at       TIMESTAMPTZ,
  approved_by        TEXT,
  approved_at        TIMESTAMPTZ,
  -- Supplier
  sent_at            TIMESTAMPTZ,
  acknowledged_at    TIMESTAMPTZ,
  -- Receiving
  partially_received_at TIMESTAMPTZ,
  fully_received_at  TIMESTAMPTZ,
  -- Source
  requisition_id     TEXT REFERENCES public.proc_requisitions(id) ON DELETE SET NULL,
  rfq_id             TEXT REFERENCES public.proc_rfqs(id) ON DELETE SET NULL,
  quotation_id       TEXT REFERENCES public.proc_quotations(id) ON DELETE SET NULL,
  -- Audit
  created_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proc_purchase_orders_number ON public.proc_purchase_orders(po_number);
CREATE INDEX IF NOT EXISTS idx_proc_purchase_orders_property ON public.proc_purchase_orders(property_id);
CREATE INDEX IF NOT EXISTS idx_proc_purchase_orders_supplier ON public.proc_purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_proc_purchase_orders_status ON public.proc_purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_proc_purchase_orders_order_date ON public.proc_purchase_orders(order_date DESC);
CREATE INDEX IF NOT EXISTS idx_proc_purchase_orders_delivery ON public.proc_purchase_orders(required_delivery_date);

-- ── Purchase Order Lines ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proc_po_lines (
  id                 TEXT PRIMARY KEY,
  po_id              TEXT NOT NULL REFERENCES public.proc_purchase_orders(id) ON DELETE CASCADE,
  line_number        INTEGER NOT NULL,
  item_code          TEXT,
  item_name          TEXT NOT NULL,
  description        TEXT,
  category           TEXT,
  quantity_ordered   NUMERIC(10, 3) NOT NULL,
  quantity_received  NUMERIC(10, 3) DEFAULT 0,
  unit_of_measure    TEXT NOT NULL,
  unit_price         NUMERIC(10, 2) NOT NULL,
  discount           NUMERIC(10, 2) DEFAULT 0,
  tax                NUMERIC(10, 2) DEFAULT 0,
  line_total         NUMERIC(12, 2) NOT NULL,
  required_date      DATE,
  specification      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proc_po_lines_po ON public.proc_po_lines(po_id);

-- ── PO Amendments (History of changes) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proc_po_amendments (
  id                 TEXT PRIMARY KEY,
  po_id              TEXT NOT NULL REFERENCES public.proc_purchase_orders(id) ON DELETE CASCADE,
  amendment_number   INTEGER NOT NULL,
  amended_by         TEXT NOT NULL,
  amended_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  field_name         TEXT NOT NULL,
  previous_value     TEXT,
  new_value          TEXT,
  reason             TEXT,
  approved_by        TEXT,
  approved_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proc_po_amendments_po ON public.proc_po_amendments(po_id);

-- ── Contracts (Supplier Contracts) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proc_contracts (
  id                 TEXT PRIMARY KEY,
  contract_number    TEXT NOT NULL UNIQUE,
  supplier_id        TEXT NOT NULL REFERENCES public.proc_suppliers(id) ON DELETE RESTRICT,
  property_id        UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  category           TEXT NOT NULL,
  contract_type      TEXT NOT NULL CHECK (contract_type IN (
                       'Supplier Contract', 'Framework Agreement', 'Rate Agreement',
                       'Service Agreement', 'Volume Agreement', 'Long-Term Agreement',
                       'Exclusive Agreement'
                     )),
  start_date         DATE NOT NULL,
  end_date           DATE NOT NULL,
  renewal_date       DATE,
  contract_value     NUMERIC(12, 2),
  currency           TEXT DEFAULT 'ETB',
  payment_terms      TEXT,
  sla                TEXT,
  penalties          TEXT,
  min_commitment     NUMERIC(12, 2),
  max_commitment     NUMERIC(12, 2),
  pricing_rules      JSONB,
  status             TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN (
                       'Draft', 'Review', 'Approval', 'Active', 'Renewal Review',
                       'Renewed', 'Expired', 'Closed'
                     )),
  auto_renew         BOOLEAN DEFAULT FALSE,
  -- Approval
  approved_by        TEXT,
  approved_at        TIMESTAMPTZ,
  -- Renewal
  renewed_from_id    TEXT REFERENCES public.proc_contracts(id) ON DELETE SET NULL,
  renewed_at         TIMESTAMPTZ,
  -- Audit
  created_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proc_contracts_number ON public.proc_contracts(contract_number);
CREATE INDEX IF NOT EXISTS idx_proc_contracts_supplier ON public.proc_contracts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_proc_contracts_property ON public.proc_contracts(property_id);
CREATE INDEX IF NOT EXISTS idx_proc_contracts_status ON public.proc_contracts(status);
CREATE INDEX IF NOT EXISTS idx_proc_contracts_end_date ON public.proc_contracts(end_date);

-- ── Contract Pricing (Item-level pricing from contracts) ───────────────────
CREATE TABLE IF NOT EXISTS public.proc_contract_pricing (
  id                 TEXT PRIMARY KEY,
  contract_id        TEXT NOT NULL REFERENCES public.proc_contracts(id) ON DELETE CASCADE,
  item_code          TEXT,
  item_name          TEXT NOT NULL,
  unit_of_measure    TEXT NOT NULL,
  unit_price         NUMERIC(10, 2) NOT NULL,
  min_quantity       NUMERIC(10, 3),
  max_quantity       NUMERIC(10, 3),
  effective_date     DATE NOT NULL,
  expiry_date        DATE,
  is_active          BOOLEAN DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proc_contract_pricing_contract ON public.proc_contract_pricing(contract_id);
CREATE INDEX IF NOT EXISTS idx_proc_contract_pricing_item ON public.proc_contract_pricing(item_code);

-- ── Budgets (Procurement Budgets) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proc_budgets (
  id                 TEXT PRIMARY KEY,
  budget_code        TEXT NOT NULL,
  property_id        UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  department         TEXT NOT NULL,
  category           TEXT NOT NULL,
  budget_type        TEXT NOT NULL CHECK (budget_type IN ('Annual', 'Monthly', 'Quarterly', 'Project')),
  fiscal_year        INTEGER NOT NULL,
  period_start       DATE NOT NULL,
  period_end         DATE NOT NULL,
  budgeted_amount    NUMERIC(12, 2) NOT NULL,
  currency           TEXT DEFAULT 'ETB',
  committed_amount   NUMERIC(12, 2) DEFAULT 0,
  actual_spend       NUMERIC(12, 2) DEFAULT 0,
  remaining_budget   NUMERIC(12, 2) GENERATED ALWAYS AS (budgeted_amount - committed_amount - actual_spend) STORED,
  status             TEXT DEFAULT 'Active' CHECK (status IN ('Draft', 'Active', 'Closed', 'Frozen')),
  control_type       TEXT DEFAULT 'Soft' CHECK (control_type IN ('Hard', 'Soft', 'None')),
  notes              TEXT,
  created_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(property_id, department, category, budget_type, fiscal_year)
);

CREATE INDEX IF NOT EXISTS idx_proc_budgets_property ON public.proc_budgets(property_id);
CREATE INDEX IF NOT EXISTS idx_proc_budgets_department ON public.proc_budgets(department);
CREATE INDEX IF NOT EXISTS idx_proc_budgets_category ON public.proc_budgets(category);
CREATE INDEX IF NOT EXISTS idx_proc_budgets_fiscal_year ON public.proc_budgets(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_proc_budgets_period ON public.proc_budgets(period_start, period_end);

-- ── Cost Savings (Tracking) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proc_savings (
  id                 TEXT PRIMARY KEY,
  property_id        UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  savings_type       TEXT NOT NULL CHECK (savings_type IN (
                       'Competitive Bidding', 'Negotiation', 'Supplier Consolidation',
                       'Contract Savings', 'Volume Discounts', 'Cost Avoidance'
                     )),
  amount             NUMERIC(12, 2) NOT NULL,
  currency           TEXT DEFAULT 'ETB',
  description        TEXT,
  related_po_id      TEXT REFERENCES public.proc_purchase_orders(id) ON DELETE SET NULL,
  related_rfq_id     TEXT REFERENCES public.proc_rfqs(id) ON DELETE SET NULL,
  related_supplier_id TEXT REFERENCES public.proc_suppliers(id) ON DELETE SET NULL,
  savings_date       DATE NOT NULL,
  recorded_by        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proc_savings_property ON public.proc_savings(property_id);
CREATE INDEX IF NOT EXISTS idx_proc_savings_type ON public.proc_savings(savings_type);
CREATE INDEX IF NOT EXISTS idx_proc_savings_date ON public.proc_savings(savings_date);

-- ── Deliveries (Receiving Coordination) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proc_deliveries (
  id                 TEXT PRIMARY KEY,
  po_id              TEXT NOT NULL REFERENCES public.proc_purchase_orders(id) ON DELETE CASCADE,
  supplier_id        TEXT NOT NULL REFERENCES public.proc_suppliers(id) ON DELETE RESTRICT,
  property_id        UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  expected_date      DATE NOT NULL,
  actual_date        DATE,
  status             TEXT DEFAULT 'Expected' CHECK (status IN (
                       'Expected', 'In Transit', 'Delayed', 'Partial Received',
                       'Fully Received', 'Cancelled'
                     )),
  total_items        INTEGER DEFAULT 0,
  total_quantity     NUMERIC(10, 3) DEFAULT 0,
  received_quantity  NUMERIC(10, 3) DEFAULT 0,
  delivery_note      TEXT,
  received_by        TEXT,
  notes              TEXT,
  delay_reason       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proc_deliveries_po ON public.proc_deliveries(po_id);
CREATE INDEX IF NOT EXISTS idx_proc_deliveries_supplier ON public.proc_deliveries(supplier_id);
CREATE INDEX IF NOT EXISTS idx_proc_deliveries_property ON public.proc_deliveries(property_id);
CREATE INDEX IF NOT EXISTS idx_proc_deliveries_status ON public.proc_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_proc_deliveries_expected ON public.proc_deliveries(expected_date);

-- ── Demand Forecasts ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proc_demand_forecasts (
  id                 TEXT PRIMARY KEY,
  property_id        UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  department         TEXT NOT NULL,
  category           TEXT NOT NULL,
  forecast_date      DATE NOT NULL,
  forecast_quantity  NUMERIC(10, 3) NOT NULL,
  unit_of_measure    TEXT NOT NULL,
  confidence_level   TEXT DEFAULT 'Medium' CHECK (confidence_level IN ('Low', 'Medium', 'High')),
  forecast_source    TEXT, -- 'Occupancy Forecast', 'Historical', 'Manual', etc.
  notes              TEXT,
  created_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proc_demand_forecasts_property ON public.proc_demand_forecasts(property_id);
CREATE INDEX IF NOT EXISTS idx_proc_demand_forecasts_department ON public.proc_demand_forecasts(department);
CREATE INDEX IF NOT EXISTS idx_proc_demand_forecasts_date ON public.proc_demand_forecasts(forecast_date);

-- ── Procurement Alerts (Dashboard Alerts) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proc_alerts (
  id                 TEXT PRIMARY KEY,
  property_id        UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  alert_type         TEXT NOT NULL CHECK (alert_type IN (
                       'PR Pending Approval', 'PO Pending Approval', 'Critical Procurement Requirement',
                       'RFQ Deadline', 'Supplier Quotation Received', 'Delayed Delivery',
                       'Overdue PO', 'Contract Expiry', 'Supplier Qualification Expiry',
                       'Supplier Certification Expiry', 'Price Increase', 'Budget Exceeded',
                       'Supplier Performance Decline', 'High Supplier Concentration',
                       'Emergency Purchase', 'Unusual Procurement Activity'
                     )),
  severity           TEXT DEFAULT 'Medium' CHECK (severity IN ('Low', 'Medium', 'High', 'Critical')),
  title              TEXT NOT NULL,
  description        TEXT NOT NULL,
  entity_type        TEXT, -- 'requisition', 'po', 'supplier', 'contract', etc.
  entity_id          TEXT,
  action_required    BOOLEAN DEFAULT TRUE,
  is_resolved        BOOLEAN DEFAULT FALSE,
  resolved_at        TIMESTAMPTZ,
  resolved_by        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proc_alerts_property ON public.proc_alerts(property_id);
CREATE INDEX IF NOT EXISTS idx_proc_alerts_type ON public.proc_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_proc_alerts_severity ON public.proc_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_proc_alerts_resolved ON public.proc_alerts(is_resolved);
CREATE INDEX IF NOT EXISTS idx_proc_alerts_entity ON public.proc_alerts(entity_type, entity_id);

-- ── Procurement Configuration (Settings) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proc_config (
  id                 TEXT PRIMARY KEY,
  config_key         TEXT NOT NULL UNIQUE,
  config_value       JSONB NOT NULL,
  description        TEXT,
  updated_by         TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proc_config_key ON public.proc_config(config_key);

-- ── Updated timestamp triggers ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_proc_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'proc_suppliers', 'proc_categories',
    'proc_requisitions', 'proc_rfqs', 'proc_quotations',
    'proc_purchase_orders', 'proc_contracts', 'proc_budgets',
    'proc_deliveries', 'proc_demand_forecasts', 'proc_config'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%s', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON public.%s FOR EACH ROW EXECUTE FUNCTION public.update_proc_timestamp()', t, t);
  END LOOP;
END;
$$;

-- ── Enable RLS and grant permissions ───────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'proc_suppliers', 'proc_supplier_contacts', 'proc_supplier_documents',
    'proc_supplier_performance', 'proc_supplier_risks',
    'proc_requisitions', 'proc_requisition_lines',
    'proc_rfqs', 'proc_rfq_lines', 'proc_rfq_invitations',
    'proc_quotations', 'proc_quotation_lines',
    'proc_purchase_orders', 'proc_po_lines', 'proc_po_amendments',
    'proc_contracts', 'proc_contract_pricing',
    'proc_budgets', 'proc_savings', 'proc_deliveries',
    'proc_demand_forecasts', 'proc_alerts', 'proc_config', 'proc_categories'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%s TO authenticated', t);
  END LOOP;
END;
$$;

-- ── Seed Data (Demo Property: 18762279-a389-41c9-9169-7ebc682e9703) ──────────

-- Procurement Categories
INSERT INTO public.proc_categories (id, name, category_type, description) VALUES
  ('cat-001', 'Food & Beverage', 'Food & Beverage', 'All F&B related categories'),
  ('cat-002', 'Housekeeping', 'Housekeeping', 'Housekeeping supplies'),
  ('cat-003', 'Engineering', 'Engineering', 'Engineering supplies'),
  ('cat-004', 'Administration', 'Administration', 'Office supplies'),
  ('cat-005', 'Food', 'Food & Beverage', 'Raw food items'),
  ('cat-006', 'Beverage', 'Food & Beverage', 'Beverages'),
  ('cat-007', 'Cleaning Chemicals', 'Housekeeping', 'Cleaning supplies'),
  ('cat-008', 'Spare Parts', 'Engineering', 'Engineering spare parts')
ON CONFLICT (id) DO NOTHING;

-- Suppliers
INSERT INTO public.proc_suppliers (
  id, supplier_code, legal_name, supplier_type, supplier_category, status,
  address, city, phone, email, payment_terms, lead_time, quality_score,
  on_time_delivery_rate, overall_score, risk_level, property_id
) VALUES
  ('sup-001', 'SUP-001', 'Ethiopian Food Supplies PLC', 'Local', 'Food & Beverage', 'Active',
   'Bole Sub City, Addis Ababa', 'Addis Ababa', '+251911123456', 'orders@ethfoods.et', 30, 3, 85.0, 92.0, 88.0, 'Low', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('sup-002', 'SUP-002', 'CleanPro Chemicals Ltd', 'Local', 'Housekeeping', 'Active',
   'Kazanchis, Addis Ababa', 'Addis Ababa', '+251911234567', 'info@cleanpro.et', 15, 5, 90.0, 95.0, 92.0, 'Low', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('sup-003', 'SUP-003', 'Engineering Solutions Corp', 'National', 'Engineering', 'Active',
   'Megenagna, Addis Ababa', 'Addis Ababa', '+251911345678', 'sales@engsol.et', 30, 7, 82.0, 88.0, 85.0, 'Medium', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('sup-004', 'SUP-004', 'Office Depot Ethiopia', 'Local', 'Administration', 'Active',
   'Piassa, Addis Ababa', 'Addis Ababa', '+251911456789', 'orders@officedepot.et', 14, 2, 88.0, 90.0, 89.0, 'Low', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('sup-005', 'SUP-005', 'Premium Wines Importers', 'International', 'Food & Beverage', 'Preferred',
   'Bole Airport Road, Addis Ababa', 'Addis Ababa', '+251911567890', 'import@premiumwines.et', 45, 14, 95.0, 98.0, 96.0, 'Low', '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- Supplier Contacts
INSERT INTO public.proc_supplier_contacts (id, supplier_id, name, role, email, phone, is_primary) VALUES
  ('sc-001', 'sup-001', 'Abebe Kebede', 'Sales Manager', 'abebe@ethfoods.et', '+251911123456', TRUE),
  ('sc-002', 'sup-002', 'Tigist Haile', 'Account Manager', 'tigist@cleanpro.et', '+251911234567', TRUE),
  ('sc-003', 'sup-003', 'Dawit Alemu', 'Technical Sales', 'dawit@engsol.et', '+251911345678', TRUE),
  ('sc-004', 'sup-004', 'Sara Tesfaye', 'Sales Representative', 'sara@officedepot.et', '+251911456789', TRUE),
  ('sc-005', 'sup-005', 'Michael Johnson', 'Import Manager', 'michael@premiumwines.et', '+251911567890', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Purchase Requisitions
INSERT INTO public.proc_requisitions (
  id, pr_number, property_id, department, requester, request_date, required_date,
  priority, purpose, status, estimated_total
) VALUES
  ('req-001', 'PR-2026-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Kitchen', 'Chef Michael',
   '2026-08-28 09:00+00', '2026-09-05', 'High', 'Monthly food stock replenishment', 'Approved', 12500.00),
  ('req-002', 'PR-2026-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Housekeeping', 'Maria Housekeeping',
   '2026-08-28 10:30+00', '2026-09-03', 'Normal', 'Amenities restock', 'Under Review', 3200.00),
  ('req-003', 'PR-2026-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Engineering', 'Tom Harris',
   '2026-08-28 11:15+00', '2026-09-10', 'Urgent', 'AC spare parts', 'Approved', 4500.00),
  ('req-004', 'PR-2026-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Administration', 'Emma Wilson',
   '2026-08-28 14:00+00', '2026-09-01', 'Low', 'Office supplies', 'Draft', 850.00)
ON CONFLICT (id) DO NOTHING;

-- Requisition Lines
INSERT INTO public.proc_requisition_lines (
  id, requisition_id, line_number, item_name, description, category, quantity,
  unit_of_measure, estimated_unit_price, estimated_total
) VALUES
  ('rl-001', 'req-001', 1, 'Beef Tenderloin', 'Premium beef for restaurant', 'Food', 50.0, 'kg', 180.00, 9000.00),
  ('rl-002', 'req-001', 2, 'Olive Oil', 'Extra virgin olive oil', 'Food', 20.0, 'liters', 150.00, 3000.00),
  ('rl-003', 'req-001', 3, 'Fresh Vegetables', 'Assorted vegetables', 'Food', 100.0, 'kg', 5.00, 500.00),
  ('rl-004', 'req-002', 1, 'Guest Amenities Kit', 'Toiletries and amenities', 'Housekeeping', 200, 'units', 12.00, 2400.00),
  ('rl-005', 'req-002', 2, 'Cleaning Chemicals Set', 'Household cleaning supplies', 'Housekeeping', 50, 'units', 16.00, 800.00),
  ('rl-006', 'req-003', 1, 'AC Compressor', 'HVAC spare part', 'Engineering', 2, 'units', 1500.00, 3000.00),
  ('rl-007', 'req-003', 2, 'Thermostat Control', 'Temperature control unit', 'Engineering', 3, 'units', 500.00, 1500.00),
  ('rl-008', 'req-004', 1, 'Office Paper', 'A4 printer paper', 'Administration', 10, 'reams', 45.00, 450.00),
  ('rl-009', 'req-004', 2, 'Printer Cartridges', 'Ink cartridges', 'Administration', 4, 'units', 100.00, 400.00)
ON CONFLICT (id) DO NOTHING;

-- RFQs
INSERT INTO public.proc_rfqs (
  id, rfq_number, property_id, department, procurement_officer, issue_date,
  response_deadline, status, requisition_id
) VALUES
  ('rfq-001', 'RFQ-2026-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Kitchen', 'Procurement Officer',
   '2026-08-28 09:30+00', '2026-09-02 17:00+00', 'Issued', 'req-001'),
  ('rfq-002', 'RFQ-2026-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Engineering', 'Procurement Officer',
   '2026-08-28 11:30+00', '2026-09-03 17:00+00', 'Draft', 'req-003')
ON CONFLICT (id) DO NOTHING;

-- RFQ Lines
INSERT INTO public.proc_rfq_lines (
  id, rfq_id, line_number, item_name, specification, quantity, unit_of_measure,
  required_delivery_date, quality_requirement
) VALUES
  ('rfl-001', 'rfq-001', 1, 'Beef Tenderloin', 'Premium grade, fresh', 50.0, 'kg', '2026-09-05', 'Food safety certified'),
  ('rfl-002', 'rfq-001', 2, 'Olive Oil', 'Extra virgin, cold pressed', 20.0, 'liters', '2026-09-05', 'Quality certified'),
  ('rfl-003', 'rfq-001', 3, 'Fresh Vegetables', 'Assorted, fresh daily', 100.0, 'kg', '2026-09-05', 'Fresh produce'),
  ('rfl-004', 'rfq-002', 1, 'AC Compressor', 'Compatible with Carrier units', 2, 'units', '2026-09-10', 'OEM certified'),
  ('rfl-005', 'rfq-002', 2, 'Thermostat Control', 'Digital programmable', 3, 'units', '2026-09-10', 'CE certified')
ON CONFLICT (id) DO NOTHING;

-- RFQ Invitations
INSERT INTO public.proc_rfq_invitations (id, rfq_id, supplier_id, status) VALUES
  ('rfinv-001', 'rfq-001', 'sup-001', 'Responded'),
  ('rfinv-002', 'rfq-001', 'sup-005', 'Responded'),
  ('rfinv-003', 'rfq-002', 'sup-003', 'Pending')
ON CONFLICT (rfq_id, supplier_id) DO NOTHING;

-- Quotations
INSERT INTO public.proc_quotations (
  id, quotation_number, rfq_id, supplier_id, submitted_at, subtotal, tax, total,
  lead_time, status, evaluation_score
) VALUES
  ('quot-001', 'QT-2026-001', 'rfq-001', 'sup-001', '2026-08-30 14:00+00', 12500.00, 1875.00, 14375.00, 3, 'Under Review', 85.0),
  ('quot-002', 'QT-2026-002', 'rfq-001', 'sup-005', '2026-08-31 10:00+00', 11800.00, 1770.00, 13570.00, 5, 'Under Review', 92.0)
ON CONFLICT (id) DO NOTHING;

-- Quotation Lines
INSERT INTO public.proc_quotation_lines (
  id, quotation_id, rfq_line_id, line_number, item_name, quantity, unit_of_measure, unit_price, line_total
) VALUES
  ('ql-001', 'quot-001', 'rfl-001', 1, 'Beef Tenderloin', 50.0, 'kg', 180.00, 9000.00),
  ('ql-002', 'quot-001', 'rfl-002', 2, 'Olive Oil', 20.0, 'liters', 150.00, 3000.00),
  ('ql-003', 'quot-001', 'rfl-003', 3, 'Fresh Vegetables', 100.0, 'kg', 5.00, 500.00),
  ('ql-004', 'quot-002', 'rfl-001', 1, 'Beef Tenderloin', 50.0, 'kg', 170.00, 8500.00),
  ('ql-005', 'quot-002', 'rfl-002', 2, 'Olive Oil', 20.0, 'liters', 140.00, 2800.00),
  ('ql-006', 'quot-002', 'rfl-003', 3, 'Fresh Vegetables', 100.0, 'kg', 5.00, 500.00)
ON CONFLICT (id) DO NOTHING;

-- Purchase Orders
INSERT INTO public.proc_purchase_orders (
  id, po_number, property_id, supplier_id, buyer, department, cost_center,
  order_date, required_delivery_date, delivery_location, payment_terms,
  status, subtotal, tax, total_amount, requisition_id, rfq_id, quotation_id
) VALUES
  ('po-001', 'PO-2026-001', '18762279-a389-41c9-9169-7ebc682e9703', 'sup-002', 'Procurement Officer',
   'Housekeeping', 'HK-001', '2026-08-28 15:00+00', '2026-09-03', 'Main Store', 'Net 15',
   'Approved', 3200.00, 480.00, 3680.00, 'req-002', NULL, NULL),
  ('po-002', 'PO-2026-002', '18762279-a389-41c9-9169-7ebc682e9703', 'sup-003', 'Procurement Officer',
   'Engineering', 'ENG-001', '2026-08-28 16:00+00', '2026-09-10', 'Engineering Store', 'Net 30',
   'Sent to Supplier', 4500.00, 675.00, 5175.00, 'req-003', 'rfq-002', NULL)
ON CONFLICT (id) DO NOTHING;

-- PO Lines
INSERT INTO public.proc_po_lines (
  id, po_id, line_number, item_name, description, category, quantity_ordered,
  unit_of_measure, unit_price, line_total
) VALUES
  ('pol-001', 'po-001', 1, 'Guest Amenities Kit', 'Toiletries and amenities', 'Housekeeping', 200, 'units', 12.00, 2400.00),
  ('pol-002', 'po-001', 2, 'Cleaning Chemicals Set', 'Household cleaning supplies', 'Housekeeping', 50, 'units', 16.00, 800.00),
  ('pol-003', 'po-002', 1, 'AC Compressor', 'HVAC spare part', 'Engineering', 2, 'units', 1500.00, 3000.00),
  ('pol-004', 'po-002', 2, 'Thermostat Control', 'Temperature control unit', 'Engineering', 3, 'units', 500.00, 1500.00)
ON CONFLICT (id) DO NOTHING;

-- Contracts
INSERT INTO public.proc_contracts (
  id, contract_number, supplier_id, property_id, category, contract_type,
  start_date, end_date, renewal_date, contract_value, currency,
  payment_terms, status, property_id
) VALUES
  ('cont-001', 'CTR-2026-001', 'sup-002', NULL, 'Housekeeping', 'Framework Agreement',
   '2026-01-01', '2026-12-31', '2026-11-01', 150000.00, 'ETB', 'Net 15', 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('cont-002', 'CTR-2026-002', 'sup-005', NULL, 'Food & Beverage', 'Exclusive Agreement',
   '2026-06-01', '2027-05-31', '2027-04-01', 200000.00, 'ETB', 'Net 45', 'Active', '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- Budgets
INSERT INTO public.proc_budgets (
  id, budget_code, property_id, department, category, budget_type, fiscal_year,
  period_start, period_end, budgeted_amount, currency, status
) VALUES
  ('budg-001', 'BUDG-2026-FB', '18762279-a389-41c9-9169-7ebc682e9703', 'Kitchen', 'Food & Beverage',
   'Annual', 2026, '2026-01-01', '2026-12-31', 500000.00, 'ETB', 'Active'),
  ('budg-002', 'BUDG-2026-HK', '18762279-a389-41c9-9169-7ebc682e9703', 'Housekeeping', 'Housekeeping',
   'Annual', 2026, '2026-01-01', '2026-12-31', 200000.00, 'ETB', 'Active'),
  ('budg-003', 'BUDG-2026-ENG', '18762279-a389-41c9-9169-7ebc682e9703', 'Engineering', 'Engineering',
   'Annual', 2026, '2026-01-01', '2026-12-31', 300000.00, 'ETB', 'Active')
ON CONFLICT (budget_code) DO NOTHING;

-- Cost Savings
INSERT INTO public.proc_savings (
  id, property_id, savings_type, amount, description, related_po_id, savings_date
) VALUES
  ('sav-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Competitive Bidding', 430.00,
   'Savings from competitive bidding on food supplies', 'po-001', '2026-08-28'),
  ('sav-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Negotiation', 250.00,
   'Negotiated discount with cleaning supplier', 'po-001', '2026-08-28')
ON CONFLICT (id) DO NOTHING;

-- Deliveries
INSERT INTO public.proc_deliveries (
  id, po_id, supplier_id, property_id, expected_date, status, total_items, total_quantity
) VALUES
  ('del-001', 'po-001', 'sup-002', '18762279-a389-41c9-9169-7ebc682e9703', '2026-09-03', 'Expected', 2, 250.0),
  ('del-002', 'po-002', 'sup-003', '18762279-a389-41c9-9169-7ebc682e9703', '2026-09-10', 'Expected', 2, 5.0)
ON CONFLICT (id) DO NOTHING;

-- Procurement Alerts
INSERT INTO public.proc_alerts (
  id, property_id, alert_type, severity, title, description, entity_type, entity_id, action_required
) VALUES
  ('alert-001', '18762279-a389-41c9-9169-7ebc682e9703', 'PR Pending Approval', 'Medium',
   'Purchase Requisition Pending Approval', 'PR-2026-002 requires approval', 'requisition', 'req-002', TRUE),
  ('alert-002', '18762279-a389-41c9-9169-7ebc682e9703', 'RFQ Deadline', 'High',
   'RFQ Response Deadline Approaching', 'RFQ-2026-001 deadline on 2026-09-02', 'rfq', 'rfq-001', TRUE),
  ('alert-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Contract Expiry', 'Low',
   'Contract Expiring Soon', 'CTR-2026-001 expires on 2026-12-31', 'contract', 'cont-001', FALSE)
ON CONFLICT (id) DO NOTHING;

-- Configuration
INSERT INTO public.proc_config (config_key, config_value, description) VALUES
  ('approval_thresholds', '{"requisition": 5000, "po": 10000, "contract": 50000}', 'Approval amount thresholds'),
  ('alert_settings', '{"contract_expiry_days": 90, "qualification_expiry_days": 60}', 'Alert lead times'),
  ('default_payment_terms', 30, 'Default payment terms in days'),
  ('default_lead_time', 7, 'Default supplier lead time in days'),
  ('sustainability_settings', '{"track_local_suppliers": true, "track_eco_certification": true, "track_carbon": false}', 'Sustainability tracking settings'),
  ('concentration_thresholds', '{"high": 70, "medium": 50}', 'Supplier concentration risk thresholds'),
  ('emergency_procurement_settings', '{"max_amount": 50000, "requires_post_review": true}', 'Emergency procurement controls'),
  ('direct_purchase_threshold', 5000, 'Direct purchase threshold without RFQ'),
  ('segregation_rules', '{"prevent_self_approval": true, "prevent_supplier_payment_approval": true}', 'Segregation of duties rules'),
  ('approval_delegation', '{"allowed": true, "max_days": 30}', 'Approval delegation settings'),
  ('three_way_match_settings', '{"tolerance_percent": 5, "auto_match": false}', 'Three-way matching settings')
ON CONFLICT (config_key) DO NOTHING;

-- ── Additional Tables for 100% Spec Compliance ─────────────────────────────

-- Tenders (like RFQs but for high-value/complex procurement)
CREATE TABLE IF NOT EXISTS public.proc_tenders (
  id                 TEXT PRIMARY KEY,
  tender_number      TEXT NOT NULL UNIQUE,
  property_id        UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  department         TEXT NOT NULL,
  procurement_officer TEXT NOT NULL,
  title              TEXT NOT NULL,
  description        TEXT,
  issue_date         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submission_deadline TIMESTAMPTZ NOT NULL,
  opening_date       TIMESTAMPTZ,
  currency           TEXT DEFAULT 'ETB',
  estimated_value    NUMERIC(12, 2),
  tender_type        TEXT NOT NULL CHECK (tender_type IN ('Open', 'Restricted', 'Single', 'Emergency')),
  status             TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN (
                       'Draft', 'Published', 'Submission Closed', 'Under Evaluation',
                       'Awarded', 'Cancelled'
                     )),
  evaluation_criteria JSONB,
  terms              TEXT,
  conditions         TEXT,
  awarded_supplier_id TEXT REFERENCES public.proc_suppliers(id) ON DELETE SET NULL,
  awarded_amount     NUMERIC(12, 2),
  awarded_at         TIMESTAMPTZ,
  created_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proc_tenders_number ON public.proc_tenders(tender_number);
CREATE INDEX IF NOT EXISTS idx_proc_tenders_status ON public.proc_tenders(status);
CREATE INDEX IF NOT EXISTS idx_proc_tenders_property ON public.proc_tenders(property_id);

-- Tender Lines
CREATE TABLE IF NOT EXISTS public.proc_tender_lines (
  id                 TEXT PRIMARY KEY,
  tender_id          TEXT NOT NULL REFERENCES public.proc_tenders(id) ON DELETE CASCADE,
  line_number        INTEGER NOT NULL,
  item_name          TEXT NOT NULL,
  specification      TEXT NOT NULL,
  quantity           NUMERIC(10, 3) NOT NULL,
  unit_of_measure    TEXT NOT NULL,
  required_delivery_date DATE NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proc_tender_lines_tender ON public.proc_tender_lines(tender_id);

-- Tender Submissions (supplier bids)
CREATE TABLE IF NOT EXISTS public.proc_tender_submissions (
  id                 TEXT PRIMARY KEY,
  tender_id          TEXT NOT NULL REFERENCES public.proc_tenders(id) ON DELETE CASCADE,
  supplier_id        TEXT NOT NULL REFERENCES public.proc_suppliers(id) ON DELETE CASCADE,
  submitted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_amount       NUMERIC(12, 2) NOT NULL,
  currency           TEXT DEFAULT 'ETB',
  lead_time          INTEGER,
  payment_terms      TEXT,
  technical_proposal TEXT,
  commercial_proposal TEXT,
  evaluation_score   NUMERIC(5, 2),
  status             TEXT DEFAULT 'Submitted' CHECK (status IN ('Submitted', 'Under Evaluation', 'Selected', 'Rejected')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proc_tender_submissions_tender ON public.proc_tender_submissions(tender_id);
CREATE INDEX IF NOT EXISTS idx_proc_tender_submissions_supplier ON public.proc_tender_submissions(supplier_id);

-- Negotiations
CREATE TABLE IF NOT EXISTS public.proc_negotiations (
  id                 TEXT PRIMARY KEY,
  negotiation_number TEXT NOT NULL UNIQUE,
  property_id        UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  rfq_id             TEXT REFERENCES public.proc_rfqs(id) ON DELETE SET NULL,
  tender_id          TEXT REFERENCES public.proc_tenders(id) ON DELETE SET NULL,
  supplier_id        TEXT NOT NULL REFERENCES public.proc_suppliers(id) ON DELETE CASCADE,
  department         TEXT NOT NULL,
  negotiation_type   TEXT NOT NULL CHECK (negotiation_type IN ('Price', 'Terms', 'Volume', 'Contract', 'Combined')),
  status             TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'In Progress', 'Agreed', 'Rejected', 'Closed')),
  initial_price      NUMERIC(12, 2),
  target_price       NUMERIC(12, 2),
  final_price        NUMERIC(12, 2),
  currency           TEXT DEFAULT 'ETB',
  savings_amount     NUMERIC(12, 2),
  started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at          TIMESTAMPTZ,
  notes              TEXT,
  outcome            TEXT,
  created_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proc_negotiations_number ON public.proc_negotiations(negotiation_number);
CREATE INDEX IF NOT EXISTS idx_proc_negotiations_status ON public.proc_negotiations(status);
CREATE INDEX IF NOT EXISTS idx_proc_negotiations_supplier ON public.proc_negotiations(supplier_id);

-- Negotiation Rounds (history of back-and-forth)
CREATE TABLE IF NOT EXISTS public.proc_negotiation_rounds (
  id                 TEXT PRIMARY KEY,
  negotiation_id     TEXT NOT NULL REFERENCES public.proc_negotiations(id) ON DELETE CASCADE,
  round_number       INTEGER NOT NULL,
  initiated_by       TEXT NOT NULL CHECK (initiated_by IN ('Procurement', 'Supplier')),
  proposed_price     NUMERIC(12, 2),
  proposed_terms     TEXT,
  response           TEXT,
  response_at        TIMESTAMPTZ,
  status             TEXT DEFAULT 'Pending' CHECK (status IN ('Pending', 'Accepted', 'Counter', 'Rejected')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proc_negotiation_rounds_negotiation ON public.proc_negotiation_rounds(negotiation_id);

-- Supplier Onboarding (workflow tracking)
CREATE TABLE IF NOT EXISTS public.proc_supplier_onboarding (
  id                 TEXT PRIMARY KEY,
  supplier_id        TEXT NOT NULL REFERENCES public.proc_suppliers(id) ON DELETE CASCADE,
  application_date   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_stage      TEXT NOT NULL DEFAULT 'Application' CHECK (current_stage IN (
                       'Application', 'Document Submission', 'Procurement Review',
                       'Compliance Review', 'Finance Verification', 'Approval', 'Activated', 'Rejected'
                     )),
  stage_history      JSONB DEFAULT '[]',
  documents_submitted BOOLEAN DEFAULT FALSE,
  procurement_reviewed_at TIMESTAMPTZ,
  procurement_reviewed_by TEXT,
  compliance_reviewed_at TIMESTAMPTZ,
  compliance_reviewed_by TEXT,
  finance_verified_at TIMESTAMPTZ,
  finance_verified_by TEXT,
  approved_at        TIMESTAMPTZ,
  approved_by        TEXT,
  activated_at       TIMESTAMPTZ,
  rejected_at        TIMESTAMPTZ,
  rejection_reason   TEXT,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proc_supplier_onboarding_supplier ON public.proc_supplier_onboarding(supplier_id);
CREATE INDEX IF NOT EXISTS idx_proc_supplier_onboarding_stage ON public.proc_supplier_onboarding(current_stage);

-- Supplier Qualifications (qualification criteria evaluation)
CREATE TABLE IF NOT EXISTS public.proc_supplier_qualifications (
  id                 TEXT PRIMARY KEY,
  supplier_id        TEXT NOT NULL REFERENCES public.proc_suppliers(id) ON DELETE CASCADE,
  criteria_type      TEXT NOT NULL CHECK (criteria_type IN (
                       'Legal Compliance', 'Product Quality', 'Financial Capability',
                       'Delivery Capacity', 'Production Capacity', 'Certifications',
                       'Food Safety', 'Insurance', 'References', 'Sustainability',
                       'Regulatory Compliance'
                     )),
  status             TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Qualified', 'Conditionally Qualified', 'Disqualified')),
  score              NUMERIC(5, 2),
  evaluated_by       TEXT,
  evaluated_at       TIMESTAMPTZ,
  expiry_date        DATE,
  notes              TEXT,
  evidence_document  TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proc_supplier_qualifications_supplier ON public.proc_supplier_qualifications(supplier_id);
CREATE INDEX IF NOT EXISTS idx_proc_supplier_qualifications_status ON public.proc_supplier_qualifications(status);

-- Supplier Evaluations (periodic evaluations)
CREATE TABLE IF NOT EXISTS public.proc_supplier_evaluations (
  id                 TEXT PRIMARY KEY,
  supplier_id        TEXT NOT NULL REFERENCES public.proc_suppliers(id) ON DELETE CASCADE,
  evaluation_period  TEXT NOT NULL,
  evaluation_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evaluator          TEXT NOT NULL,
  -- Scores (0-100)
  quality_score      NUMERIC(3, 1) DEFAULT 0,
  delivery_score     NUMERIC(3, 1) DEFAULT 0,
  price_score        NUMERIC(3, 1) DEFAULT 0,
  service_score      NUMERIC(3, 1) DEFAULT 0,
  compliance_score   NUMERIC(3, 1) DEFAULT 0,
  overall_score      NUMERIC(3, 1) DEFAULT 0,
  rating             TEXT CHECK (rating IN ('Excellent', 'Good', 'Acceptable', 'Poor', 'Critical')),
  strengths          TEXT,
  weaknesses         TEXT,
  recommendations    TEXT,
  action_required    TEXT,
  next_review_date   DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proc_supplier_evaluations_supplier ON public.proc_supplier_evaluations(supplier_id);
CREATE INDEX IF NOT EXISTS idx_proc_supplier_evaluations_date ON public.proc_supplier_evaluations(evaluation_date);

-- PO Tracking (shipment/delivery tracking)
CREATE TABLE IF NOT EXISTS public.proc_po_tracking (
  id                 TEXT PRIMARY KEY,
  po_id              TEXT NOT NULL REFERENCES public.proc_purchase_orders(id) ON DELETE CASCADE,
  tracking_number    TEXT,
  carrier            TEXT,
  shipment_date      DATE,
  estimated_arrival  DATE,
  actual_arrival     DATE,
  tracking_status    TEXT NOT NULL DEFAULT 'Pending' CHECK (tracking_status IN (
                       'Pending', 'Shipped', 'In Transit', 'At Customs',
                       'Out for Delivery', 'Delivered', 'Delayed', 'Lost'
                     )),
  current_location   TEXT,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proc_po_tracking_po ON public.proc_po_tracking(po_id);
CREATE INDEX IF NOT EXISTS idx_proc_po_tracking_status ON public.proc_po_tracking(tracking_status);

-- Audit Trail
CREATE TABLE IF NOT EXISTS public.proc_audit_trail (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT,
  user_name          TEXT,
  action             TEXT NOT NULL,
  entity_type        TEXT NOT NULL,
  entity_id          TEXT,
  entity_number      TEXT,
  previous_value     JSONB,
  new_value          JSONB,
  reason             TEXT,
  ip_address         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proc_audit_trail_entity ON public.proc_audit_trail(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_proc_audit_trail_user ON public.proc_audit_trail(user_id);
CREATE INDEX IF NOT EXISTS idx_proc_audit_trail_date ON public.proc_audit_trail(created_at DESC);

-- Procurement Notifications
CREATE TABLE IF NOT EXISTS public.proc_notifications (
  id                 TEXT PRIMARY KEY,
  property_id        UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  user_id            TEXT,
  notification_type  TEXT NOT NULL,
  title              TEXT NOT NULL,
  message            TEXT NOT NULL,
  entity_type        TEXT,
  entity_id          TEXT,
  is_read            BOOLEAN DEFAULT FALSE,
  is_internal        BOOLEAN DEFAULT TRUE,
  recipient_type     TEXT DEFAULT 'Internal' CHECK (recipient_type IN ('Internal', 'Supplier')),
  supplier_id        TEXT REFERENCES public.proc_suppliers(id) ON DELETE CASCADE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at            TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_proc_notifications_user ON public.proc_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_proc_notifications_read ON public.proc_notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_proc_notifications_type ON public.proc_notifications(notification_type);

-- Sustainability Tracking
CREATE TABLE IF NOT EXISTS public.proc_sustainability (
  id                 TEXT PRIMARY KEY,
  supplier_id        TEXT NOT NULL REFERENCES public.proc_suppliers(id) ON DELETE CASCADE,
  is_local           BOOLEAN DEFAULT FALSE,
  is_sustainable     BOOLEAN DEFAULT FALSE,
  eco_certification  TEXT,
  sustainable_packaging BOOLEAN DEFAULT FALSE,
  ethical_sourcing   BOOLEAN DEFAULT FALSE,
  environmental_score NUMERIC(3, 1) DEFAULT 0,
  carbon_footprint   NUMERIC(10, 2),
  carbon_unit        TEXT,
  sustainability_report TEXT,
  last_assessed_at   TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proc_sustainability_supplier ON public.proc_sustainability(supplier_id);

-- Purchase Price Variance
CREATE TABLE IF NOT EXISTS public.proc_price_variance (
  id                 TEXT PRIMARY KEY,
  po_id              TEXT REFERENCES public.proc_purchase_orders(id) ON DELETE SET NULL,
  po_line_id         TEXT REFERENCES public.proc_po_lines(id) ON DELETE SET NULL,
  supplier_id        TEXT REFERENCES public.proc_suppliers(id) ON DELETE SET NULL,
  item_name          TEXT NOT NULL,
  standard_price     NUMERIC(10, 2) NOT NULL,
  actual_price       NUMERIC(10, 2) NOT NULL,
  variance_amount    NUMERIC(10, 2) NOT NULL,
  variance_percent   NUMERIC(5, 2) NOT NULL,
  variance_type      TEXT CHECK (variance_type IN ('Favorable', 'Unfavorable')),
  category           TEXT,
  department         TEXT,
  property_id        UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  recorded_date      DATE NOT NULL,
  reason             TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proc_price_variance_po ON public.proc_price_variance(po_id);
CREATE INDEX IF NOT EXISTS idx_proc_price_variance_supplier ON public.proc_price_variance(supplier_id);
CREATE INDEX IF NOT EXISTS idx_proc_price_variance_date ON public.proc_price_variance(recorded_date);

-- Budget Commitments (PO commitments against budgets)
CREATE TABLE IF NOT EXISTS public.proc_budget_commitments (
  id                 TEXT PRIMARY KEY,
  budget_id          TEXT NOT NULL REFERENCES public.proc_budgets(id) ON DELETE CASCADE,
  po_id              TEXT REFERENCES public.proc_purchase_orders(id) ON DELETE SET NULL,
  requisition_id     TEXT REFERENCES public.proc_requisitions(id) ON DELETE SET NULL,
  commitment_amount  NUMERIC(12, 2) NOT NULL,
  commitment_type    TEXT NOT NULL CHECK (commitment_type IN ('Requisition', 'PO', 'Contract')),
  commitment_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status             TEXT DEFAULT 'Active' CHECK (status IN ('Active', 'Consumed', 'Cancelled')),
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proc_budget_commitments_budget ON public.proc_budget_commitments(budget_id);
CREATE INDEX IF NOT EXISTS idx_proc_budget_commitments_po ON public.proc_budget_commitments(po_id);

-- Emergency Procurement
CREATE TABLE IF NOT EXISTS public.proc_emergency_purchases (
  id                 TEXT PRIMARY KEY,
  emergency_number   TEXT NOT NULL UNIQUE,
  property_id        UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  department         TEXT NOT NULL,
  requester          TEXT NOT NULL,
  emergency_reason   TEXT NOT NULL CHECK (emergency_reason IN (
                       'Critical Equipment Failure', 'Food Shortage', 'Guest Safety',
                       'Utility Failure', 'Security Emergency', 'Critical Maintenance',
                       'Regulatory Requirements'
                     )),
  description        TEXT NOT NULL,
  supplier_id        TEXT REFERENCES public.proc_suppliers(id) ON DELETE SET NULL,
  amount             NUMERIC(12, 2) NOT NULL,
  currency           TEXT DEFAULT 'ETB',
  po_id              TEXT REFERENCES public.proc_purchase_orders(id) ON DELETE SET NULL,
  approved_by        TEXT,
  approved_at        TIMESTAMPTZ,
  post_purchase_review BOOLEAN DEFAULT FALSE,
  review_notes       TEXT,
  review_date        TIMESTAMPTZ,
  status             TEXT DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Reviewed')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proc_emergency_purchases_number ON public.proc_emergency_purchases(emergency_number);
CREATE INDEX IF NOT EXISTS idx_proc_emergency_purchases_status ON public.proc_emergency_purchases(status);
CREATE INDEX IF NOT EXISTS idx_proc_emergency_purchases_property ON public.proc_emergency_purchases(property_id);

-- Approval Delegations
CREATE TABLE IF NOT EXISTS public.proc_approval_delegations (
  id                 TEXT PRIMARY KEY,
  delegator_id       TEXT NOT NULL,
  delegator_name     TEXT NOT NULL,
  delegate_id        TEXT NOT NULL,
  delegate_name      TEXT NOT NULL,
  approval_type      TEXT NOT NULL CHECK (approval_type IN (
                       'Purchase Requisition', 'Purchase Order', 'Contract',
                       'Supplier Activation', 'Supplier Suspension',
                       'Price Override', 'Emergency Purchase', 'Budget Exception'
                     )),
  start_date         DATE NOT NULL,
  end_date           DATE NOT NULL,
  reason             TEXT,
  status             TEXT DEFAULT 'Active' CHECK (status IN ('Active', 'Expired', 'Cancelled')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proc_approval_delegations_delegator ON public.proc_approval_delegations(delegator_id);
CREATE INDEX IF NOT EXISTS idx_proc_approval_delegations_delegate ON public.proc_approval_delegations(delegate_id);
CREATE INDEX IF NOT EXISTS idx_proc_approval_delegations_status ON public.proc_approval_delegations(status);

-- Enable RLS and grant permissions for new tables
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'proc_tenders', 'proc_tender_lines', 'proc_tender_submissions',
    'proc_negotiations', 'proc_negotiation_rounds',
    'proc_supplier_onboarding', 'proc_supplier_qualifications',
    'proc_supplier_evaluations', 'proc_po_tracking',
    'proc_audit_trail', 'proc_notifications', 'proc_sustainability',
    'proc_price_variance', 'proc_budget_commitments',
    'proc_emergency_purchases', 'proc_approval_delegations'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%s TO authenticated', t);
  END LOOP;
END;
$$;

-- Add updated_at triggers for new tables
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'proc_tenders', 'proc_negotiations', 'proc_supplier_onboarding',
    'proc_supplier_qualifications', 'proc_po_tracking',
    'proc_sustainability', 'proc_emergency_purchases'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%s', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON public.%s FOR EACH ROW EXECUTE FUNCTION public.update_proc_timestamp()', t, t);
  END LOOP;
END;
$$;

-- ── Seed Data for New Tables ───────────────────────────────────────────────

-- Tenders
INSERT INTO public.proc_tenders (id, tender_number, property_id, department, procurement_officer, title, description, submission_deadline, estimated_value, tender_type, status) VALUES
  ('tend-001', 'TND-2026-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Administration', 'Procurement Officer', 'Annual Office Supplies Tender', 'Tender for annual office supplies contract', '2026-09-15 17:00+00', 100000.00, 'Open', 'Published')
ON CONFLICT (id) DO NOTHING;

-- Negotiations
INSERT INTO public.proc_negotiations (id, negotiation_number, property_id, rfq_id, supplier_id, department, negotiation_type, status, initial_price, target_price, currency) VALUES
  ('neg-001', 'NEG-2026-001', '18762279-a389-41c9-9169-7ebc682e9703', 'rfq-001', 'sup-001', 'Kitchen', 'Price', 'In Progress', 14375.00, 13000.00, 'ETB')
ON CONFLICT (id) DO NOTHING;

-- Supplier Onboarding
INSERT INTO public.proc_supplier_onboarding (id, supplier_id, current_stage, documents_submitted) VALUES
  ('onb-001', 'sup-001', 'Activated', TRUE),
  ('onb-002', 'sup-002', 'Activated', TRUE),
  ('onb-003', 'sup-003', 'Activated', TRUE),
  ('onb-004', 'sup-004', 'Activated', TRUE),
  ('onb-005', 'sup-005', 'Activated', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Supplier Qualifications
INSERT INTO public.proc_supplier_qualifications (id, supplier_id, criteria_type, status, score) VALUES
  ('qual-001', 'sup-001', 'Legal Compliance', 'Qualified', 95.0),
  ('qual-002', 'sup-001', 'Product Quality', 'Qualified', 88.0),
  ('qual-003', 'sup-001', 'Food Safety', 'Qualified', 92.0),
  ('qual-004', 'sup-002', 'Legal Compliance', 'Qualified', 90.0),
  ('qual-005', 'sup-002', 'Product Quality', 'Qualified', 85.0)
ON CONFLICT (id) DO NOTHING;

-- Supplier Evaluations
INSERT INTO public.proc_supplier_evaluations (id, supplier_id, evaluation_period, evaluator, quality_score, delivery_score, price_score, service_score, compliance_score, overall_score, rating) VALUES
  ('eval-001', 'sup-001', 'Q2 2026', 'Procurement Manager', 85.0, 92.0, 80.0, 88.0, 90.0, 87.0, 'Good'),
  ('eval-002', 'sup-002', 'Q2 2026', 'Procurement Manager', 90.0, 95.0, 85.0, 92.0, 88.0, 90.0, 'Excellent')
ON CONFLICT (id) DO NOTHING;

-- PO Tracking
INSERT INTO public.proc_po_tracking (id, po_id, tracking_number, carrier, estimated_arrival, tracking_status) VALUES
  ('trk-001', 'po-001', 'TRK-001', 'Local Logistics', '2026-09-03', 'In Transit'),
  ('trk-002', 'po-002', 'TRK-002', 'Engineering Transport', '2026-09-10', 'Pending')
ON CONFLICT (id) DO NOTHING;

-- Sustainability
INSERT INTO public.proc_sustainability (id, supplier_id, is_local, is_sustainable, eco_certification, environmental_score) VALUES
  ('sus-001', 'sup-001', TRUE, TRUE, 'ISO 14001', 85.0),
  ('sus-002', 'sup-002', TRUE, FALSE, NULL, 60.0)
ON CONFLICT (id) DO NOTHING;

-- Emergency Purchases
INSERT INTO public.proc_emergency_purchases (id, emergency_number, property_id, department, requester, emergency_reason, description, amount, status) VALUES
  ('emg-001', 'EMG-2026-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Engineering', 'Tom Harris', 'Critical Equipment Failure', 'Emergency AC compressor replacement', 3500.00, 'Approved')
ON CONFLICT (id) DO NOTHING;

-- Notifications
INSERT INTO public.proc_notifications (id, property_id, notification_type, title, message, entity_type, entity_id) VALUES
  ('notif-001', '18762279-a389-41c9-9169-7ebc682e9703', 'PR Submitted', 'New Requisition Submitted', 'PR-2026-002 has been submitted for review', 'requisition', 'req-002'),
  ('notif-002', '18762279-a389-41c9-9169-7ebc682e9703', 'PO Approved', 'Purchase Order Approved', 'PO-2026-001 has been approved', 'po', 'po-001'),
  ('notif-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Contract Expiring', 'Contract Expiring Soon', 'CTR-2026-001 will expire in 90 days', 'contract', 'cont-001')
ON CONFLICT (id) DO NOTHING;

-- Price Variance
INSERT INTO public.proc_price_variance (id, po_id, supplier_id, item_name, standard_price, actual_price, variance_amount, variance_percent, variance_type, category, department, property_id, recorded_date) VALUES
  ('ppv-001', 'po-001', 'sup-002', 'Guest Amenities Kit', 13.00, 12.00, -1.00, -7.69, 'Favorable', 'Housekeeping', 'Housekeeping', '18762279-a389-41c9-9169-7ebc682e9703', '2026-08-28')
ON CONFLICT (id) DO NOTHING;

-- Budget Commitments
INSERT INTO public.proc_budget_commitments (id, budget_id, po_id, commitment_amount, commitment_type) VALUES
  ('bdc-001', 'budg-002', 'po-001', 3680.00, 'PO'),
  ('bdc-002', 'budg-003', 'po-002', 5175.00, 'PO')
ON CONFLICT (id) DO NOTHING;
-- ============================================================
-- Finance — Document Management
-- (Migration 403)
-- ============================================================
-- Brings /erp/finance/documents fully online.
-- Stores metadata for financial documents (invoices, receipts,
-- payment vouchers, contracts, bank statements, tax documents,
-- journal attachments) with optional Supabase Storage paths.
-- Binary upload itself is handled via Supabase Storage buckets;
-- this table tracks the document record, status, and audit trail.
-- RLS-enabled and seeded with demo rows.
-- ============================================================

-- Demo property: '18762279-a389-41c9-9169-7ebc682e9703' = Gheralta Main Property

-- ════════════════════════════════════════════════════════════════
-- 1. fin_documents
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_documents (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  document_number text,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'Invoice' CHECK (type IN (
    'Invoice','Vendor Invoice','Journal Attachment','Bank Statement',
    'Contract','Tax Document','Payment Voucher','Receipt','Other'
  )),
  category text NOT NULL DEFAULT 'Accounts Receivable',
  entity text,
  file_path text,
  file_url text,
  file_size bigint NOT NULL DEFAULT 0,
  mime_type text,
  status text NOT NULL DEFAULT 'Pending Review' CHECK (status IN (
    'Pending Review','Processed','Archived','Rejected'
  )),
  uploaded_by text,
  reviewed_by text,
  reviewed_at timestamptz,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_docs_property ON public.fin_documents(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_docs_status ON public.fin_documents(status);
CREATE INDEX IF NOT EXISTS idx_fin_docs_type ON public.fin_documents(type);
CREATE INDEX IF NOT EXISTS idx_fin_docs_category ON public.fin_documents(category);
CREATE INDEX IF NOT EXISTS idx_fin_docs_created_at ON public.fin_documents(created_at DESC);

ALTER TABLE public.fin_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_documents" ON public.fin_documents;
CREATE POLICY "authenticated can CRUD fin_documents" ON public.fin_documents
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_documents" ON public.fin_documents;
CREATE POLICY "service_role all fin_documents" ON public.fin_documents
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_documents TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 2. Seed demo documents
-- ════════════════════════════════════════════════════════════════
INSERT INTO public.fin_documents
  (property_id, document_number, name, type, category, entity, file_size, status, uploaded_by, notes, created_at)
VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'DOC-001', 'Invoice_2024_001.pdf', 'Invoice', 'Accounts Receivable', 'Guest Ledger', 251392, 'Processed', 'finance@erp.com', 'January guest invoice batch', '2024-01-15 09:30:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'DOC-002', 'Vendor_Invoice_SUP_045.pdf', 'Vendor Invoice', 'Accounts Payable', 'ABC Supplies Ltd', 524288, 'Processed', 'finance@erp.com', 'Supplier invoice for kitchen supplies', '2024-01-18 14:15:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'DOC-003', 'Journal_Entry_JE_2024_015.pdf', 'Journal Attachment', 'General Ledger', 'Adjustment Entry', 131072, 'Processed', 'finance@erp.com', 'Period-end adjustment journal', '2024-01-20 11:00:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'DOC-004', 'Bank_Statement_Jan_2024.pdf', 'Bank Statement', 'Cash & Bank', 'CBE Account', 1258291, 'Processed', 'finance@erp.com', 'Commercial Bank of Ethiopia statement', '2024-01-25 08:45:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'DOC-005', 'Service_Contract_2024.pdf', 'Contract', 'Treasury', 'Corporate Office', 2621440, 'Pending Review', 'finance@erp.com', 'Annual service contract — pending legal review', '2024-01-28 16:20:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'DOC-006', 'Tax_Report_Q4_2023.pdf', 'Tax Document', 'Tax Management', 'ERCA Filing', 911360, 'Processed', 'finance@erp.com', 'Q4 2023 ERCA filing report', '2024-01-30 10:10:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'DOC-007', 'Payment_Voucher_PV_2024_012.pdf', 'Payment Voucher', 'Accounts Payable', 'Highland Logistics', 89128, 'Processed', 'finance@erp.com', 'Payment voucher for transport services', '2024-02-02 13:00:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'DOC-008', 'Receipt_R_2024_045.pdf', 'Receipt', 'Accounts Receivable', 'Banquet Event', 64256, 'Pending Review', 'finance@erp.com', 'Banquet deposit receipt', '2024-02-05 17:30:00+03')
ON CONFLICT (id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════
-- 3. updated_at trigger
-- ════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_fin_documents_updated_at ON public.fin_documents;
CREATE OR REPLACE FUNCTION public.set_fin_documents_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fin_documents_updated_at
  BEFORE UPDATE ON public.fin_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_fin_documents_updated_at();

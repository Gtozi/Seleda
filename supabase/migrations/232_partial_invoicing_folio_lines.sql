-- Migration 232: Partial invoicing support
-- Adds invoice_id to folio_lines so individual charge lines can be tracked
-- as invoiced, enabling partial (line-level) invoicing on a folio.

-- 1. Add invoice_id column to folio_lines
ALTER TABLE folio_lines
ADD COLUMN IF NOT EXISTS invoice_id text REFERENCES invoice_documents(id) ON DELETE SET NULL;

-- 2. Index for quick "which lines are on this invoice?" lookups
CREATE INDEX IF NOT EXISTS idx_folio_lines_invoice_id ON folio_lines(invoice_id);

-- 3. Comment
COMMENT ON COLUMN folio_lines.invoice_id IS 'References the invoice document this line was invoiced on, if any. NULL means not yet invoiced.';

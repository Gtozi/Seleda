-- Migration 239: Add parent_folio_id for Company → Group folio hierarchy
ALTER TABLE public.folios ADD COLUMN IF NOT EXISTS parent_folio_id text REFERENCES public.folios(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_folios_parent_folio_id ON public.folios(parent_folio_id) WHERE parent_folio_id IS NOT NULL;

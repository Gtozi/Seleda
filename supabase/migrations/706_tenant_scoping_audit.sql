-- Migration: Tenant Scoping Audit and Cleanup
-- This script identifies and fixes tenant scoping issues

-- ============================================================
-- PART 1: AUDIT - Find tables without tenant_id
-- ============================================================

-- Create a temporary table to store audit results
CREATE TEMP TABLE tenant_audit_results (
  table_name TEXT,
  issue_type TEXT,
  details TEXT,
  row_count BIGINT
);

-- Find tables WITHOUT tenant_id column
INSERT INTO tenant_audit_results (table_name, issue_type, details, row_count)
SELECT 
  t.table_name,
  'MISSING_TENANT_ID',
  'Table does not have tenant_id column',
  (SELECT COUNT(*) FROM information_schema.columns c WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name)
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = t.table_schema
      AND c.table_name = t.table_name
      AND c.column_name = 'tenant_id'
  )
ORDER BY t.table_name;

-- ============================================================
-- PART 2: AUDIT - Find NULL tenant_id values
-- ============================================================

-- This requires dynamic SQL to count NULLs per table
-- We'll use a DO block to iterate through tables with tenant_id
DO $$
DECLARE
  tbl RECORD;
  null_count BIGINT;
BEGIN
  FOR tbl IN 
    SELECT table_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND column_name = 'tenant_id'
  LOOP
    BEGIN
      EXECUTE format('SELECT COUNT(*) FROM %I WHERE tenant_id IS NULL', tbl.table_name) INTO null_count;
      IF null_count > 0 THEN
        INSERT INTO tenant_audit_results (table_name, issue_type, details, row_count)
        VALUES (tbl.table_name, 'HAS_NULL_TENANT_ID', 'Rows with NULL tenant_id', null_count);
      END IF;
    EXCEPTION WHEN undefined_table THEN
      -- Table might not exist or have different schema
      NULL;
    END;
  END LOOP;
END $$;

-- ============================================================
-- PART 3: REPORT - Show audit results
-- ============================================================

SELECT * FROM tenant_audit_results ORDER BY issue_type, table_name;

-- ============================================================
-- PART 4: CLEANUP - Fix NULL tenant_id values
-- ============================================================

-- WARNING: This will assign orphaned data to a default tenant
-- Make sure you have a default tenant or create one first

-- Option A: Delete orphaned data (if it's not needed)
-- DO $$
-- DECLARE
--   tbl RECORD;
-- BEGIN
--   FOR tbl IN 
--     SELECT table_name 
--     FROM information_schema.columns 
--     WHERE table_schema = 'public' AND column_name = 'tenant_id'
--   LOOP
--     BEGIN
--       EXECUTE format('DELETE FROM %I WHERE tenant_id IS NULL', tbl.table_name);
--     EXCEPTION WHEN undefined_table THEN NULL;
--     END;
--   END LOOP;
-- END $$;

-- Option B: Assign to a default tenant (uncomment and set your tenant ID)
-- DO $$
-- DECLARE
--   default_tenant_id UUID := 'YOUR_DEFAULT_TENANT_ID_HERE';
--   tbl RECORD;
-- BEGIN
--   FOR tbl IN 
--     SELECT table_name 
--     FROM information_schema.columns 
--     WHERE table_schema = 'public' AND column_name = 'tenant_id'
--   LOOP
--     BEGIN
--       EXECUTE format('UPDATE %I SET tenant_id = %L WHERE tenant_id IS NULL', tbl.table_name, default_tenant_id);
--     EXCEPTION WHEN undefined_table THEN NULL;
--     END;
--   END LOOP;
-- END $$;

-- ============================================================
-- PART 5: FIX - Add tenant_id to missing tables
-- ============================================================

-- WARNING: Only run this after reviewing the audit results
-- This will add tenant_id column to tables that are missing it
-- You may need to manually populate values for existing rows

-- Example for a specific table (uncomment and modify as needed):
-- ALTER TABLE table_name ADD COLUMN tenant_id UUID REFERENCES tenants(id);
-- CREATE INDEX idx_table_name_tenant_id ON table_name(tenant_id);

-- To add tenant_id to ALL missing tables automatically:
-- DO $$
-- DECLARE
--   tbl RECORD;
-- BEGIN
--   FOR tbl IN 
--     SELECT t.table_name
--     FROM information_schema.tables t
--     WHERE t.table_schema = 'public'
--       AND t.table_type = 'BASE TABLE'
--       AND NOT EXISTS (
--         SELECT 1 FROM information_schema.columns c
--         WHERE c.table_schema = t.table_schema
--           AND c.table_name = t.table_name
--           AND c.column_name = 'tenant_id'
--       )
--   LOOP
--     BEGIN
--       EXECUTE format('ALTER TABLE %I ADD COLUMN tenant_id UUID REFERENCES tenants(id)', tbl.table_name);
--       EXECUTE format('CREATE INDEX idx_%I_tenant_id ON %I(tenant_id)', tbl.table_name, tbl.table_name);
--     EXCEPTION WHEN duplicate_column THEN NULL;
--     END;
--   END LOOP;
-- END $$;

-- ============================================================
-- PART 6: VERIFY - Check final state
-- ============================================================

-- Re-run audit to verify fixes
SELECT 'AUDIT COMPLETE' as status;
SELECT COUNT(*) as tables_with_tenant_id FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenant_id';
SELECT COUNT(*) as tables_without_tenant_id FROM information_schema.tables t WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name AND c.column_name = 'tenant_id');

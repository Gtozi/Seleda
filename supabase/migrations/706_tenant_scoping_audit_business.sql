-- Migration: Tenant Scoping Audit - Business Tables Only
-- This script identifies business data tables that likely need tenant_id

-- ============================================================
-- PART 1: Categorize tables without tenant_id
-- ============================================================

-- Create a temporary table to categorize tables
CREATE TEMP TABLE table_categories (
  table_name TEXT PRIMARY KEY,
  category TEXT,
  needs_tenant_id BOOLEAN,
  reason TEXT
);

-- Business data tables (likely need tenant_id)
INSERT INTO table_categories (table_name, category, needs_tenant_id, reason)
SELECT 
  t.table_name,
  'BUSINESS_DATA',
  TRUE,
  'Contains business/operational data'
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = t.table_schema
      AND c.table_name = t.table_name
      AND c.column_name = 'tenant_id'
  )
  AND (
    -- Pattern matching for business tables
    t.table_name ~ '(reservation|guest|folio|booking|order|invoice|payment|journal|account|inventory|stock|menu|recipe|ingredient|vendor|outlet|property|room|housekeeping|hk_|engineering|work_order|maintenance|spa|transport|banquet|event|sales|lead|proposal|contract|report|audit|alert|metric|employee|hr_|payroll|attendance|leave|shift|training|performance|onboarding|recruitment|document|career|health|relation|workflow|analytics|dashboard|configuration|setting|profile|preference|notification|message|communication|feedback|review|rating|survey|form|template|schedule|calendar|forecast|rate|pricing|channel|distribution|yield|revenue|expense|cost|budget|tax|vat|asset|depreciation|bank|reconciliation|treasury|payable|receivable|ledger|posting|period|close|statement|balance|trial|general|subledger|fixed_asset|cashier|shift|till|pos|kds|kitchen|bar|restaurant|dining|room_service|minibar|laundry|amenity|linen|supplies|consumable|spare_part|tool|equipment|calibration|inspection|safety|compliance|incident|emergency|escalation|approval|task|assignment|checklist|sop|procedure|policy|standard|quality|audit_trail|log|history|snapshot|backup|restore|migration|seed|default|template|master|reference|lookup|code|type|status|category|classification|tag|label|group|organization|department|division|team|role|permission|access|security|user|session|token|credential|api_key|integration|webhook|sync|queue|job|task|worker|scheduler|cron|batch|process|job|workflow|pipeline|etl|import|export|upload|download|file|document|attachment|image|photo|media|asset|resource|static|public|private|shared|tenant|organization|property|building|floor|room|area|zone|location|site|facility|venue|space|hall|ballroom|conference|meeting|banquet|catering|event|function|celebration|party|gathering|reception|ceremony|wedding|conference|seminar|workshop|training|orientation|onboarding|offboarding|transfer|promotion|demotion|termination|retirement|resignation|leave|absence|holiday|vacation|sick|personal|family|maternity|paternity|bereavement|jury|military|study|training|development|education|certification|license|permit|credential|qualification|skill|competency|assessment|evaluation|appraisal|review|feedback|coaching|mentoring|career|path|progression|succession|planning|strategy|objective|goal|target|kpi|metric|measure|indicator|benchmark|baseline|variance|analysis|report|dashboard|visualization|chart|graph|table|matrix|pivot|summary|detail|drill|down|up|across|through|filter|sort|search|query|view|form|screen|page|dialog|modal|popup|notification|alert|message|email|sms|push|notification|reminder|alert|warning|error|info|success|debug|trace|audit|log|history|record|entry|transaction|event|activity|action|operation|process|procedure|workflow|business|rule|validation|constraint|trigger|function|procedure|package|schema|database|table|view|index|sequence|trigger|function|procedure|package|type|domain|enum|composite|array|range|interval|timestamp|date|time|datetime|json|jsonb|xml|text|varchar|char|integer|bigint|smallint|numeric|decimal|real|double|precision|boolean|bit|serial|bigserial|uuid|inet|cidr|macaddr|point|line|lseg|box|path|polygon|circle|money)
  )
  -- Exclude system/junction patterns
  AND t.table_name !~ '^(pg_|information_schema|_prisma|drizzle_|knex_|typeorm_|sequelize_|migration|seed_|fixture_|test_|spec_|__|audit_log_system|system_)'
  AND t.table_name !~ '_junction$|_link$|_map$|_assoc$|_pivot$'
ORDER BY t.table_name;

-- Junction tables (may need tenant_id or reference via parent)
INSERT INTO table_categories (table_name, category, needs_tenant_id, reason)
SELECT 
  t.table_name,
  'JUNCTION_TABLE',
  FALSE, -- Usually references via parent tables
  'Junction/association table - may inherit tenant from parent'
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = t.table_schema
      AND c.table_name = t.table_name
      AND c.column_name = 'tenant_id'
  )
  AND t.table_name ~ '(_junction|_link|_map|_assoc|_pivot|_line|_detail|_item|_entry|_record|_log|_history|_audit|_event|_activity|_action|_operation|_process|_procedure|_workflow|_rule|_validation|_constraint|_trigger|_function|_package|_schema|_database|_table|_view|_index|_sequence|_type|_domain|_enum|_composite|_array|_range|_interval|_timestamp|_date|_time|_datetime|_json|_jsonb|_xml|_text|_varchar|_char|_integer|_bigint|_smallint|_numeric|_decimal|_real|_double|_precision|_boolean|_bit|_serial|_bigserial|_uuid|_inet|_cidr|_macaddr|_point|_line|_lseg|_box|_path|_polygon|_circle|_money)$'
ORDER BY t.table_name;

-- System tables (don't need tenant_id)
INSERT INTO table_categories (table_name, category, needs_tenant_id, reason)
SELECT 
  t.table_name,
  'SYSTEM_TABLE',
  FALSE,
  'System/internal table - does not need tenant scoping'
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = t.table_schema
      AND c.table_name = t.table_name
      AND c.column_name = 'tenant_id'
  )
  AND (
    t.table_name ~ '^(pg_|information_schema|_prisma|drizzle_|knex_|typeorm_|sequelize_|migration|seed_|fixture_|test_|spec_|__|audit_log_system|system_)'
    OR t.table_name ~ '(migration|schema_migrations|knex_migrations|typeorm_migrations|sequelize_meta|drizzle_migrations|prisma_migrations)'
  )
ORDER BY t.table_name;

-- Remaining uncategorized tables
INSERT INTO table_categories (table_name, category, needs_tenant_id, reason)
SELECT 
  t.table_name,
  'UNCATEGORIZED',
  NULL, -- Needs manual review
  'Could not categorize - review manually'
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = t.table_schema
      AND c.table_name = t.table_name
      AND c.column_name = 'tenant_id'
  )
  AND NOT EXISTS (
    SELECT 1 FROM table_categories tc WHERE tc.table_name = t.table_name
  )
ORDER BY t.table_name;

-- ============================================================
-- PART 2: Report categorized tables
-- ============================================================

-- Summary by category
SELECT 
  category,
  COUNT(*) as table_count,
  SUM(CASE WHEN needs_tenant_id = TRUE THEN 1 ELSE 0 END) as needs_tenant_id_count,
  SUM(CASE WHEN needs_tenant_id = FALSE THEN 1 ELSE 0 END) as does_not_need_count,
  SUM(CASE WHEN needs_tenant_id IS NULL THEN 1 ELSE 0 END) as needs_review_count
FROM table_categories
GROUP BY category
ORDER BY category;

-- Business tables that need tenant_id (top 50)
SELECT 
  table_name,
  category,
  reason
FROM table_categories
WHERE needs_tenant_id = TRUE
ORDER BY table_name
LIMIT 50;

-- Junction tables (for reference)
SELECT 
  table_name,
  category,
  reason
FROM table_categories
WHERE category = 'JUNCTION_TABLE'
ORDER BY table_name
LIMIT 30;

-- System tables (for reference)
SELECT 
  table_name,
  category,
  reason
FROM table_categories
WHERE category = 'SYSTEM_TABLE'
ORDER BY table_name
LIMIT 20;

-- Uncategorized tables (need manual review)
SELECT 
  table_name,
  category,
  reason
FROM table_categories
WHERE category = 'UNCATEGORIZED'
ORDER BY table_name;

-- ============================================================
-- PART 3: Generate ALTER statements for business tables
-- ============================================================

-- Generate ALTER TABLE statements for tables that need tenant_id
SELECT 
  'ALTER TABLE ' || table_name || ' ADD COLUMN tenant_id UUID REFERENCES tenants(id);' as alter_statement,
  'CREATE INDEX idx_' || table_name || '_tenant_id ON ' || table_name || '(tenant_id);' as index_statement
FROM table_categories
WHERE needs_tenant_id = TRUE
ORDER BY table_name;

-- ============================================================
-- PART 4: Cleanup temp table
-- ============================================================

DROP TABLE table_categories;

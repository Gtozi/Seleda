-- Migration: Tenant Scoping Audit - Simplified
-- This script identifies business tables that likely need tenant_id

-- ============================================================
-- PART 1: Find tables without tenant_id and categorize them
-- ============================================================

-- Create a temporary table to store results
CREATE TEMP TABLE table_audit (
  table_name TEXT PRIMARY KEY,
  has_tenant_id BOOLEAN,
  category TEXT,
  row_count BIGINT
);

-- Get all tables and check if they have tenant_id
INSERT INTO table_audit (table_name, has_tenant_id, category, row_count)
SELECT 
  t.table_name,
  EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = t.table_schema
      AND c.table_name = t.table_name
      AND c.column_name = 'tenant_id'
  ) as has_tenant_id,
  CASE
    -- System tables
    WHEN t.table_name LIKE 'pg_%' OR
         t.table_name LIKE 'information_schema%' OR
         t.table_name LIKE '_prisma%' OR
         t.table_name LIKE 'drizzle_%' OR
         t.table_name LIKE 'knex_%' OR
         t.table_name LIKE 'typeorm_%' OR
         t.table_name LIKE 'sequelize_%' OR
         t.table_name LIKE 'migration%' OR
         t.table_name LIKE 'seed_%' OR
         t.table_name LIKE 'fixture_%' OR
         t.table_name LIKE 'test_%' OR
         t.table_name LIKE 'spec_%' OR
         t.table_name LIKE '__%' OR
         t.table_name LIKE 'audit_log_system%' OR
         t.table_name LIKE 'system_%' OR
         t.table_name LIKE '%_migrations'
    THEN 'SYSTEM'
    
    -- Junction tables (common patterns)
    WHEN t.table_name LIKE '%_junction' OR
         t.table_name LIKE '%_link' OR
         t.table_name LIKE '%_map' OR
         t.table_name LIKE '%_assoc' OR
         t.table_name LIKE '%_pivot' OR
         t.table_name LIKE '%_line' OR
         t.table_name LIKE '%_detail' OR
         t.table_name LIKE '%_item' OR
         t.table_name LIKE '%_entry' OR
         t.table_name LIKE '%_record' OR
         t.table_name LIKE '%_log' OR
         t.table_name LIKE '%_history' OR
         t.table_name LIKE '%_audit' OR
         t.table_name LIKE '%_event' OR
         t.table_name LIKE '%_activity'
    THEN 'JUNCTION'
    
    -- Business tables (common hotel/ERP patterns)
    WHEN t.table_name LIKE '%reservation%' OR
         t.table_name LIKE '%guest%' OR
         t.table_name LIKE '%folio%' OR
         t.table_name LIKE '%booking%' OR
         t.table_name LIKE '%order%' OR
         t.table_name LIKE '%invoice%' OR
         t.table_name LIKE '%payment%' OR
         t.table_name LIKE '%journal%' OR
         t.table_name LIKE '%account%' OR
         t.table_name LIKE '%inventory%' OR
         t.table_name LIKE '%stock%' OR
         t.table_name LIKE '%menu%' OR
         t.table_name LIKE '%recipe%' OR
         t.table_name LIKE '%ingredient%' OR
         t.table_name LIKE '%vendor%' OR
         t.table_name LIKE '%outlet%' OR
         t.table_name LIKE '%property%' OR
         t.table_name LIKE '%room%' OR
         t.table_name LIKE '%housekeeping%' OR
         t.table_name LIKE '%hk_%' OR
         t.table_name LIKE '%engineering%' OR
         t.table_name LIKE '%work_order%' OR
         t.table_name LIKE '%maintenance%' OR
         t.table_name LIKE '%spa%' OR
         t.table_name LIKE '%transport%' OR
         t.table_name LIKE '%banquet%' OR
         t.table_name LIKE '%event%' OR
         t.table_name LIKE '%sales%' OR
         t.table_name LIKE '%lead%' OR
         t.table_name LIKE '%proposal%' OR
         t.table_name LIKE '%contract%' OR
         t.table_name LIKE '%report%' OR
         t.table_name LIKE '%audit%' OR
         t.table_name LIKE '%alert%' OR
         t.table_name LIKE '%metric%' OR
         t.table_name LIKE '%employee%' OR
         t.table_name LIKE '%hr_%' OR
         t.table_name LIKE '%payroll%' OR
         t.table_name LIKE '%attendance%' OR
         t.table_name LIKE '%leave%' OR
         t.table_name LIKE '%shift%' OR
         t.table_name LIKE '%training%' OR
         t.table_name LIKE '%performance%' OR
         t.table_name LIKE '%onboarding%' OR
         t.table_name LIKE '%recruitment%' OR
         t.table_name LIKE '%document%' OR
         t.table_name LIKE '%career%' OR
         t.table_name LIKE '%health%' OR
         t.table_name LIKE '%relation%' OR
         t.table_name LIKE '%workflow%' OR
         t.table_name LIKE '%analytics%' OR
         t.table_name LIKE '%dashboard%' OR
         t.table_name LIKE '%configuration%' OR
         t.table_name LIKE '%setting%' OR
         t.table_name LIKE '%profile%' OR
         t.table_name LIKE '%preference%' OR
         t.table_name LIKE '%notification%' OR
         t.table_name LIKE '%message%' OR
         t.table_name LIKE '%communication%' OR
         t.table_name LIKE '%feedback%' OR
         t.table_name LIKE '%review%' OR
         t.table_name LIKE '%rating%' OR
         t.table_name LIKE '%survey%' OR
         t.table_name LIKE '%form%' OR
         t.table_name LIKE '%template%' OR
         t.table_name LIKE '%schedule%' OR
         t.table_name LIKE '%calendar%' OR
         t.table_name LIKE '%forecast%' OR
         t.table_name LIKE '%rate%' OR
         t.table_name LIKE '%pricing%' OR
         t.table_name LIKE '%channel%' OR
         t.table_name LIKE '%distribution%' OR
         t.table_name LIKE '%yield%' OR
         t.table_name LIKE '%revenue%' OR
         t.table_name LIKE '%expense%' OR
         t.table_name LIKE '%cost%' OR
         t.table_name LIKE '%budget%' OR
         t.table_name LIKE '%tax%' OR
         t.table_name LIKE '%vat%' OR
         t.table_name LIKE '%asset%' OR
         t.table_name LIKE '%depreciation%' OR
         t.table_name LIKE '%bank%' OR
         t.table_name LIKE '%reconciliation%' OR
         t.table_name LIKE '%treasury%' OR
         t.table_name LIKE '%payable%' OR
         t.table_name LIKE '%receivable%' OR
         t.table_name LIKE '%ledger%' OR
         t.table_name LIKE '%posting%' OR
         t.table_name LIKE '%period%' OR
         t.table_name LIKE '%close%' OR
         t.table_name LIKE '%statement%' OR
         t.table_name LIKE '%balance%' OR
         t.table_name LIKE '%trial%' OR
         t.table_name LIKE '%general%' OR
         t.table_name LIKE '%subledger%' OR
         t.table_name LIKE '%fixed_asset%' OR
         t.table_name LIKE '%cashier%' OR
         t.table_name LIKE '%till%' OR
         t.table_name LIKE '%pos%' OR
         t.table_name LIKE '%kds%' OR
         t.table_name LIKE '%kitchen%' OR
         t.table_name LIKE '%bar%' OR
         t.table_name LIKE '%restaurant%' OR
         t.table_name LIKE '%dining%' OR
         t.table_name LIKE '%room_service%' OR
         t.table_name LIKE '%minibar%' OR
         t.table_name LIKE '%laundry%' OR
         t.table_name LIKE '%amenity%' OR
         t.table_name LIKE '%linen%' OR
         t.table_name LIKE '%supplies%' OR
         t.table_name LIKE '%consumable%' OR
         t.table_name LIKE '%spare_part%' OR
         t.table_name LIKE '%tool%' OR
         t.table_name LIKE '%equipment%' OR
         t.table_name LIKE '%calibration%' OR
         t.table_name LIKE '%inspection%' OR
         t.table_name LIKE '%safety%' OR
         t.table_name LIKE '%compliance%' OR
         t.table_name LIKE '%incident%' OR
         t.table_name LIKE '%emergency%' OR
         t.table_name LIKE '%escalation%' OR
         t.table_name LIKE '%approval%' OR
         t.table_name LIKE '%task%' OR
         t.table_name LIKE '%assignment%' OR
         t.table_name LIKE '%checklist%' OR
         t.table_name LIKE '%sop%' OR
         t.table_name LIKE '%procedure%' OR
         t.table_name LIKE '%policy%' OR
         t.table_name LIKE '%standard%' OR
         t.table_name LIKE '%quality%' OR
         t.table_name LIKE '%audit_trail%' OR
         t.table_name LIKE '%log%' OR
         t.table_name LIKE '%history%' OR
         t.table_name LIKE '%snapshot%' OR
         t.table_name LIKE '%backup%' OR
         t.table_name LIKE '%restore%' OR
         t.table_name LIKE '%seed%' OR
         t.table_name LIKE '%default%' OR
         t.table_name LIKE '%template%' OR
         t.table_name LIKE '%master%' OR
         t.table_name LIKE '%reference%' OR
         t.table_name LIKE '%lookup%' OR
         t.table_name LIKE '%code%' OR
         t.table_name LIKE '%type%' OR
         t.table_name LIKE '%status%' OR
         t.table_name LIKE '%category%' OR
         t.table_name LIKE '%classification%' OR
         t.table_name LIKE '%tag%' OR
         t.table_name LIKE '%label%' OR
         t.table_name LIKE '%group%' OR
         t.table_name LIKE '%organization%' OR
         t.table_name LIKE '%department%' OR
         t.table_name LIKE '%division%' OR
         t.table_name LIKE '%team%' OR
         t.table_name LIKE '%role%' OR
         t.table_name LIKE '%permission%' OR
         t.table_name LIKE '%access%' OR
         t.table_name LIKE '%security%' OR
         t.table_name LIKE '%user%' OR
         t.table_name LIKE '%session%' OR
         t.table_name LIKE '%token%' OR
         t.table_name LIKE '%credential%' OR
         t.table_name LIKE '%api_key%' OR
         t.table_name LIKE '%integration%' OR
         t.table_name LIKE '%webhook%' OR
         t.table_name LIKE '%sync%' OR
         t.table_name LIKE '%queue%' OR
         t.table_name LIKE '%job%' OR
         t.table_name LIKE '%worker%' OR
         t.table_name LIKE '%scheduler%' OR
         t.table_name LIKE '%cron%' OR
         t.table_name LIKE '%batch%' OR
         t.table_name LIKE '%process%' OR
         t.table_name LIKE '%pipeline%' OR
         t.table_name LIKE '%etl%' OR
         t.table_name LIKE '%import%' OR
         t.table_name LIKE '%export%' OR
         t.table_name LIKE '%upload%' OR
         t.table_name LIKE '%download%' OR
         t.table_name LIKE '%file%' OR
         t.table_name LIKE '%document%' OR
         t.table_name LIKE '%attachment%' OR
         t.table_name LIKE '%image%' OR
         t.table_name LIKE '%photo%' OR
         t.table_name LIKE '%media%' OR
         t.table_name LIKE '%asset%' OR
         t.table_name LIKE '%resource%' OR
         t.table_name LIKE '%static%' OR
         t.table_name LIKE '%public%' OR
         t.table_name LIKE '%private%' OR
         t.table_name LIKE '%shared%' OR
         t.table_name LIKE '%tenant%' OR
         t.table_name LIKE '%property%' OR
         t.table_name LIKE '%building%' OR
         t.table_name LIKE '%floor%' OR
         t.table_name LIKE '%room%' OR
         t.table_name LIKE '%area%' OR
         t.table_name LIKE '%zone%' OR
         t.table_name LIKE '%location%' OR
         t.table_name LIKE '%site%' OR
         t.table_name LIKE '%facility%' OR
         t.table_name LIKE '%venue%' OR
         t.table_name LIKE '%space%' OR
         t.table_name LIKE '%hall%' OR
         t.table_name LIKE '%ballroom%' OR
         t.table_name LIKE '%conference%' OR
         t.table_name LIKE '%meeting%' OR
         t.table_name LIKE '%banquet%' OR
         t.table_name LIKE '%catering%' OR
         t.table_name LIKE '%event%' OR
         t.table_name LIKE '%function%' OR
         t.table_name LIKE '%celebration%' OR
         t.table_name LIKE '%party%' OR
         t.table_name LIKE '%gathering%' OR
         t.table_name LIKE '%reception%' OR
         t.table_name LIKE '%ceremony%' OR
         t.table_name LIKE '%wedding%' OR
         t.table_name LIKE '%seminar%' OR
         t.table_name LIKE '%workshop%' OR
         t.table_name LIKE '%orientation%' OR
         t.table_name LIKE '%offboarding%' OR
         t.table_name LIKE '%transfer%' OR
         t.table_name LIKE '%promotion%' OR
         t.table_name LIKE '%demotion%' OR
         t.table_name LIKE '%termination%' OR
         t.table_name LIKE '%retirement%' OR
         t.table_name LIKE '%resignation%' OR
         t.table_name LIKE '%absence%' OR
         t.table_name LIKE '%holiday%' OR
         t.table_name LIKE '%vacation%' OR
         t.table_name LIKE '%sick%' OR
         t.table_name LIKE '%personal%' OR
         t.table_name LIKE '%family%' OR
         t.table_name LIKE '%maternity%' OR
         t.table_name LIKE '%paternity%' OR
         t.table_name LIKE '%bereavement%' OR
         t.table_name LIKE '%jury%' OR
         t.table_name LIKE '%military%' OR
         t.table_name LIKE '%study%' OR
         t.table_name LIKE '%development%' OR
         t.table_name LIKE '%education%' OR
         t.table_name LIKE '%certification%' OR
         t.table_name LIKE '%license%' OR
         t.table_name LIKE '%permit%' OR
         t.table_name LIKE '%credential%' OR
         t.table_name LIKE '%qualification%' OR
         t.table_name LIKE '%skill%' OR
         t.table_name LIKE '%competency%' OR
         t.table_name LIKE '%assessment%' OR
         t.table_name LIKE '%evaluation%' OR
         t.table_name LIKE '%appraisal%' OR
         t.table_name LIKE '%coaching%' OR
         t.table_name LIKE '%mentoring%' OR
         t.table_name LIKE '%path%' OR
         t.table_name LIKE '%progression%' OR
         t.table_name LIKE '%succession%' OR
         t.table_name LIKE '%planning%' OR
         t.table_name LIKE '%strategy%' OR
         t.table_name LIKE '%objective%' OR
         t.table_name LIKE '%goal%' OR
         t.table_name LIKE '%target%' OR
         t.table_name LIKE '%kpi%' OR
         t.table_name LIKE '%measure%' OR
         t.table_name LIKE '%indicator%' OR
         t.table_name LIKE '%benchmark%' OR
         t.table_name LIKE '%baseline%' OR
         t.table_name LIKE '%variance%' OR
         t.table_name LIKE '%analysis%' OR
         t.table_name LIKE '%visualization%' OR
         t.table_name LIKE '%chart%' OR
         t.table_name LIKE '%graph%' OR
         t.table_name LIKE '%matrix%' OR
         t.table_name LIKE '%pivot%' OR
         t.table_name LIKE '%summary%' OR
         t.table_name LIKE '%detail%' OR
         t.table_name LIKE '%drill%' OR
         t.table_name LIKE '%down%' OR
         t.table_name LIKE '%up%' OR
         t.table_name LIKE '%across%' OR
         t.table_name LIKE '%through%' OR
         t.table_name LIKE '%filter%' OR
         t.table_name LIKE '%sort%' OR
         t.table_name LIKE '%search%' OR
         t.table_name LIKE '%query%' OR
         t.table_name LIKE '%view%' OR
         t.table_name LIKE '%screen%' OR
         t.table_name LIKE '%page%' OR
         t.table_name LIKE '%dialog%' OR
         t.table_name LIKE '%modal%' OR
         t.table_name LIKE '%popup%' OR
         t.table_name LIKE '%reminder%' OR
         t.table_name LIKE '%warning%' OR
         t.table_name LIKE '%error%' OR
         t.table_name LIKE '%info%' OR
         t.table_name LIKE '%success%' OR
         t.table_name LIKE '%debug%' OR
         t.table_name LIKE '%trace%' OR
         t.table_name LIKE '%transaction%' OR
         t.table_name LIKE '%rule%' OR
         t.table_name LIKE '%validation%' OR
         t.table_name LIKE '%constraint%' OR
         t.table_name LIKE '%trigger%' OR
         t.table_name LIKE '%function%' OR
         t.table_name LIKE '%package%' OR
         t.table_name LIKE '%schema%' OR
         t.table_name LIKE '%database%' OR
         t.table_name LIKE '%view%' OR
         t.table_name LIKE '%index%' OR
         t.table_name LIKE '%sequence%' OR
         t.table_name LIKE '%domain%' OR
         t.table_name LIKE '%enum%' OR
         t.table_name LIKE '%composite%' OR
         t.table_name LIKE '%array%' OR
         t.table_name LIKE '%range%' OR
         t.table_name LIKE '%interval%' OR
         t.table_name LIKE '%timestamp%' OR
         t.table_name LIKE '%date%' OR
         t.table_name LIKE '%time%' OR
         t.table_name LIKE '%datetime%' OR
         t.table_name LIKE '%json%' OR
         t.table_name LIKE '%jsonb%' OR
         t.table_name LIKE '%xml%' OR
         t.table_name LIKE '%text%' OR
         t.table_name LIKE '%varchar%' OR
         t.table_name LIKE '%char%' OR
         t.table_name LIKE '%integer%' OR
         t.table_name LIKE '%bigint%' OR
         t.table_name LIKE '%smallint%' OR
         t.table_name LIKE '%numeric%' OR
         t.table_name LIKE '%decimal%' OR
         t.table_name LIKE '%real%' OR
         t.table_name LIKE '%double%' OR
         t.table_name LIKE '%precision%' OR
         t.table_name LIKE '%boolean%' OR
         t.table_name LIKE '%bit%' OR
         t.table_name LIKE '%serial%' OR
         t.table_name LIKE '%bigserial%' OR
         t.table_name LIKE '%uuid%' OR
         t.table_name LIKE '%inet%' OR
         t.table_name LIKE '%cidr%' OR
         t.table_name LIKE '%macaddr%' OR
         t.table_name LIKE '%point%' OR
         t.table_name LIKE '%line%' OR
         t.table_name LIKE '%lseg%' OR
         t.table_name LIKE '%box%' OR
         t.table_name LIKE '%path%' OR
         t.table_name LIKE '%polygon%' OR
         t.table_name LIKE '%circle%' OR
         t.table_name LIKE '%money%'
    THEN 'BUSINESS'
    
    ELSE 'OTHER'
  END as category,
  0 as row_count -- Will be populated later if needed
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
ORDER BY t.table_name;

-- ============================================================
-- PART 2: Summary by category
-- ============================================================

SELECT 
  category,
  COUNT(*) as table_count,
  SUM(CASE WHEN has_tenant_id = TRUE THEN 1 ELSE 0 END) as has_tenant_id,
  SUM(CASE WHEN has_tenant_id = FALSE THEN 1 ELSE 0 END) as missing_tenant_id
FROM table_audit
GROUP BY category
ORDER BY category;

-- ============================================================
-- PART 3: Business tables missing tenant_id (TOP 100)
-- ============================================================

SELECT 
  table_name,
  category
FROM table_audit
WHERE has_tenant_id = FALSE
  AND category = 'BUSINESS'
ORDER BY table_name
LIMIT 100;

-- ============================================================
-- PART 4: Generate ALTER statements for business tables
-- ============================================================

SELECT 
  'ALTER TABLE ' || table_name || ' ADD COLUMN tenant_id UUID REFERENCES tenants(id);' as alter_statement,
  'CREATE INDEX idx_' || table_name || '_tenant_id ON ' || table_name || '(tenant_id);' as index_statement
FROM table_audit
WHERE has_tenant_id = FALSE
  AND category = 'BUSINESS'
ORDER BY table_name;

-- ============================================================
-- PART 5: Cleanup
-- ============================================================

DROP TABLE table_audit;

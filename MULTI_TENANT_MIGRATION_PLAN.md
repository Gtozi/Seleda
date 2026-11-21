# Multi-Tenant Migration Plan for SELEDA ERP

## Overview
Transform SELEDA ERP from property-based isolation to full multi-tenant SaaS architecture using row-level security (RLS) with tenant_id columns.

## Requirements (from user)
- **Multi-tenancy Type**: Row-level (shared DB) - tenants share tables with tenant_id columns and RLS policies
- **Cross-tenant Access**: Super-admins only - only system administrators can switch between tenants
- **Data Migration**: Yes, migrate all data - transform all existing property-based data to the new tenant model

## Current State Analysis

### Existing Infrastructure
- `organizations` table exists (UUID primary key)
- `properties` table exists with `org_id` FK to organizations
- `system_users` has `property_id` column
- 339 files reference `property_id` across migrations
- Some RLS policies already exist for organizations/properties
- Text-based primary keys for most tables (id TEXT)
- Session management in `sessionService.ts`

### Migration Strategy
1. **Phase 1**: Create tenant infrastructure (tenants table, user assignments)
2. **Phase 2**: Add tenant_id columns to all data tables
3. **Phase 3**: Migrate existing properties to tenants
4. **Phase 4**: Add RLS policies for tenant isolation
5. **Phase 5**: Update authentication to include tenant context
6. **Phase 6**: Update backend routes for tenant filtering
7. **Phase 7**: Add tenant switcher UI for super-admins
8. **Phase 8**: Testing and validation

## Schema Design

### 1. Tenants Table
Repurpose existing `organizations` table as the tenant table, or create new `tenants` table:

```sql
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  legal_name TEXT,
  code TEXT UNIQUE NOT NULL,
  tax_id TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive', 'Suspended')),
  settings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tenants_code ON tenants(code);
CREATE INDEX idx_tenants_status ON tenants(status);
```

### 2. Tenant User Assignments Table
```sql
CREATE TABLE IF NOT EXISTS tenant_user_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES system_users(id) ON DELETE CASCADE,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_super_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);

CREATE INDEX idx_tenant_assignments_user ON tenant_user_assignments(user_id);
CREATE INDEX idx_tenant_assignments_tenant ON tenant_user_assignments(tenant_id);
CREATE INDEX idx_tenant_assignments_default ON tenant_user_assignments(user_id) WHERE is_default = true;
```

### 3. Add tenant_id to System Tables
```sql
-- Global tables (shared across tenants)
-- These do NOT get tenant_id:
-- - tenants
-- - tenant_user_assignments
-- - system_users (users can belong to multiple tenants)
-- - user_sessions (session will have active_tenant_id)
-- - roles, permissions, role_permissions (system-wide)
-- - organizations (becomes tenants table)

-- Data tables (tenant-scoped) - add tenant_id:
-- - properties (tenant_id FK to tenants)
-- - rooms
-- - guests
-- - reservations
-- - folios, folio_lines, folio_payments
-- - rate_plans, seasons, packages
-- - inventory_* tables
-- - All department-specific tables (HK, F&B, Engineering, Security, etc.)
-- - All operational tables (audit_events, etc.)
```

### 4. Session Enhancement
Add `active_tenant_id` to user_sessions:
```sql
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS active_tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
CREATE INDEX idx_user_sessions_tenant ON user_sessions(active_tenant_id);
```

### 5. RLS Policy Pattern
For each tenant-scoped table:
```sql
ALTER TABLE [table_name] ENABLE ROW LEVEL SECURITY;

-- Read policy: users can only see their tenant's data
CREATE POLICY "[table]_tenant_read" ON [table_name]
  FOR SELECT TO authenticated
  USING (
    tenant_id = (
      SELECT active_tenant_id 
      FROM user_sessions 
      WHERE token_hash = current_setting('app.session_token_hash', true)
    )
    OR
    EXISTS (
      SELECT 1 FROM tenant_user_assignments tua
      JOIN user_sessions us ON us.user_id = tua.user_id
      WHERE us.token_hash = current_setting('app.session_token_hash', true)
        AND tua.tenant_id = [table_name].tenant_id
        AND tua.is_super_admin = true
    )
  );

-- Write policy: users can only write to their tenant's data
CREATE POLICY "[table]_tenant_write" ON [table_name]
  FOR ALL TO authenticated
  USING (
    tenant_id = (
      SELECT active_tenant_id 
      FROM user_sessions 
      WHERE token_hash = current_setting('app.session_token_hash', true)
    )
  )
  WITH CHECK (
    tenant_id = (
      SELECT active_tenant_id 
      FROM user_sessions 
      WHERE token_hash = current_setting('app.session_token_hash', true)
    )
  );
```

## Backend Changes

### 1. Authentication (sessionService.ts)
- Add `activeTenantId` to User type
- Include `active_tenant_id` in session creation
- Validate tenant assignment on session retrieval
- Add function to switch active tenant (super-admins only)

### 2. Route Middleware
- Add tenant context to all route handlers
- Set `app.session_token_hash` for RLS policies
- Filter all queries by tenant_id
- Validate tenant access before operations

### 3. API Response Headers
- Add `X-Tenant-ID` header to all responses
- Add `X-Tenant-Name` header for debugging

## Frontend Changes

### 1. Tenant Switcher (Super-Admin Only)
- Add dropdown in header (next to property switcher)
- Show all assigned tenants
- Highlight current active tenant
- API call to switch tenant: `POST /api/auth/switch-tenant`

### 2. User Type Updates
- Add `activeTenantId` to User interface
- Add `availableTenants` array to User interface

### 3. Route Guards
- Ensure tenant context is loaded before rendering
- Show error if no tenant assignment

## Migration Phases

### Phase 1: Tenant Infrastructure (Migration 700)
- Create `tenants` table
- Create `tenant_user_assignments` table
- Add `active_tenant_id` to `user_sessions`
- Create indexes

### Phase 2: Add tenant_id Columns (Migration 701)
- Add `tenant_id` to all data tables
- Add foreign key constraints to `tenants` table
- Create indexes on `tenant_id` columns

### Phase 3: Data Migration (Migration 702)
- Map existing `organizations` to `tenants`
- Assign all `properties` to their organization's tenant
- Set `tenant_id` on all existing data based on `property_id`
- Create `tenant_user_assignments` for all users based on their `property_id`
- Set default tenant for each user

### Phase 4: RLS Policies (Migration 703)
- Enable RLS on all tenant-scoped tables
- Create read policies
- Create write policies
- Test policy effectiveness

### Phase 5: Backend Updates (Code changes)
- Update `sessionService.ts` for tenant context
- Add tenant middleware to all routes
- Update query builders to include tenant filtering
- Add tenant switch endpoint

### Phase 6: Frontend Updates (Code changes)
- Add tenant switcher component
- Update User type definitions
- Add tenant context to API calls
- Update route guards

### Phase 7: Testing
- Test tenant isolation
- Test super-admin cross-tenant access
- Test data integrity
- Test performance impact

## Rollback Plan
If migration fails:
1. Disable RLS policies
2. Drop tenant_id columns (with CASCADE)
3. Drop tenant tables
4. Restore from backup

## Performance Considerations
- Indexes on all tenant_id columns
- Partitioning for large tables (optional, later phase)
- Query optimization for tenant-filtered queries
- Connection pooling per tenant (optional, later phase)

## Security Considerations
- Tenant isolation enforced at database level (RLS)
- Server-side validation of tenant access
- Audit logging for cross-tenant access
- No tenant_id in client-side storage (use session cookie only)

## Success Criteria
- All data is properly scoped to tenants
- Users can only access their assigned tenant's data
- Super-admins can switch between tenants
- No data leakage between tenants
- Performance impact is minimal (<10% query slowdown)
- All existing functionality works with tenant context

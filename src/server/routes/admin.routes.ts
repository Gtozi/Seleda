/**
 * Admin Routes
 * Super-admin only routes for platform management
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { writeAuditEvent } from '../services/sessionService';
import { getGlobalSettings } from '../services/settingsService';
import { isValidTenantCode, invalidateTenantCache } from '../middleware/tenant';
import { invalidateTenantScopeCache, runWithTenantStore } from '../services/tenantScope';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const router = Router();

// Middleware to ensure only super-admins can access
const requireSuperAdmin = async (req: any, res: any, next: any) => {
  if (!req.user?.isSuperAdmin) {
    return res.status(403).json({ error: 'Super admin access required' });
  }
  next();
};

// Get all tenants (super-admin only)
router.get('/tenants', authenticate, requireSuperAdmin, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  try {
    const { data: tenants, error } = await supabaseAdmin
      .from('tenants')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ tenants: tenants || [] });
  } catch (error) {
    console.error('Error fetching tenants:', error);
    res.status(500).json({ error: 'Failed to fetch tenants' });
  }
});

// Create new tenant (super-admin only)
router.post('/tenants', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { name, code, legalName, email, phone } = req.body || {};

  if (!name || !code) {
    return res.status(400).json({ error: 'Name and code are required' });
  }

  const normalizedCode = String(code).toLowerCase();
  if (!isValidTenantCode(normalizedCode)) {
    return res.status(400).json({
      error: 'Invalid tenant code — use lowercase letters, numbers and hyphens only (it becomes the <code>.seledabet.com subdomain); reserved names like admin/www are not allowed',
    });
  }

  try {
    const { data: tenant, error } = await supabaseAdmin
      .from('tenants')
      .insert({
        name,
        code: normalizedCode,
        legal_name: legalName || null,
        email: email || null,
        phone: phone || null,
        status: 'Active',
        settings: {},
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') { // Unique violation
        return res.status(409).json({ error: 'Tenant code already exists' });
      }
      return res.status(500).json({ error: error.message });
    }

    await writeAuditEvent({
      req,
      user: req.user,
      action: 'tenant.create',
      entityType: 'tenant',
      entityId: tenant.id,
      module: 'admin',
      details: { name, code },
    });

    res.status(201).json({ tenant });
  } catch (error) {
    console.error('Error creating tenant:', error);
    res.status(500).json({ error: 'Failed to create tenant' });
  }
});

// Get tenant details (super-admin only)
router.get('/tenants/:tenantId', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { tenantId } = req.params;

  try {
    const { data: tenant, error } = await supabaseAdmin
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .single();

    if (error || !tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Get user count for this tenant
    const { count: userCount } = await supabaseAdmin
      .from('tenant_user_assignments')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    // Get property count for this tenant
    const { count: propertyCount } = await supabaseAdmin
      .from('properties')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    res.json({
      tenant,
      stats: {
        userCount: userCount || 0,
        propertyCount: propertyCount || 0,
      },
    });
  } catch (error) {
    console.error('Error fetching tenant:', error);
    res.status(500).json({ error: 'Failed to fetch tenant' });
  }
});

// Update tenant (super-admin only)
router.patch('/tenants/:tenantId', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { tenantId } = req.params;
  const { name, code, legalName, email, phone, status, settings } = req.body || {};

  if (code !== undefined) {
    const normalizedCode = String(code).toLowerCase();
    if (!isValidTenantCode(normalizedCode)) {
      return res.status(400).json({
        error: 'Invalid tenant code — use lowercase letters, numbers and hyphens only; reserved names like admin/www are not allowed',
      });
    }
  }

  try {
    const updates: any = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (code !== undefined) updates.code = String(code).toLowerCase();
    if (legalName !== undefined) updates.legal_name = legalName;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;
    if (status !== undefined) updates.status = status;
    if (settings !== undefined) updates.settings = settings;

    const { data: tenant, error } = await supabaseAdmin
      .from('tenants')
      .update(updates)
      .eq('id', tenantId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    await writeAuditEvent({
      req,
      user: req.user,
      action: 'tenant.update',
      entityType: 'tenant',
      entityId: tenantId,
      module: 'admin',
      details: { updates },
    });

    invalidateTenantCache();
    invalidateTenantScopeCache();
    res.json({ tenant });
  } catch (error) {
    console.error('Error updating tenant:', error);
    res.status(500).json({ error: 'Failed to update tenant' });
  }
});

// Delete tenant (super-admin only)
router.delete('/tenants/:tenantId', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { tenantId } = req.params;

  try {
    // Check if tenant has any data
    const { count: userCount } = await supabaseAdmin
      .from('tenant_user_assignments')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    const { count: propertyCount } = await supabaseAdmin
      .from('properties')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    if ((userCount || 0) > 0 || (propertyCount || 0) > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete tenant with existing users or properties. Please migrate data first.' 
      });
    }

    const { error } = await supabaseAdmin
      .from('tenants')
      .delete()
      .eq('id', tenantId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    await writeAuditEvent({
      req,
      user: req.user,
      action: 'tenant.delete',
      entityType: 'tenant',
      entityId: tenantId,
      module: 'admin',
    });

    invalidateTenantCache();
    invalidateTenantScopeCache();
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting tenant:', error);
    res.status(500).json({ error: 'Failed to delete tenant' });
  }
});

// Get users for a specific tenant (super-admin only)
router.get('/tenants/:tenantId/users', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { tenantId } = req.params;

  try {
    const { data: assignments, error } = await supabaseAdmin
      .from('tenant_user_assignments')
      .select('user_id, is_default, is_super_admin, system_users (id, name, email, role, status)')
      .eq('tenant_id', tenantId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const users = (assignments || []).map((a: any) => ({
      ...a.system_users,
      isDefault: a.is_default,
      isSuperAdmin: a.is_super_admin,
    }));

    res.json({ users });
  } catch (error) {
    console.error('Error fetching tenant users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Create a new user account and assign it to a tenant (super-admin only).
// Used by the Super Admin portal to give each tenant its own admin/staff
// login. The user must change the password on first login.
router.post('/tenants/:tenantId/users/create', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { tenantId } = req.params;
  const { name, email, username, password, role = 'admin', isDefault = true, isSuperAdmin = false, mobileNumber, department } = req.body || {};

  if (!name || !email) {
    return res.status(400).json({ error: 'name and email are required' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }

  try {
    // Tenant must exist and be active
    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .select('id, code, status')
      .eq('id', tenantId)
      .maybeSingle();
    if (tenantError) return res.status(500).json({ error: tenantError.message });
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    if (tenant.status !== 'Active') return res.status(400).json({ error: 'Tenant is not active' });

    // Email/username must be unique across system_users
    const { data: existing } = await supabaseAdmin
      .from('system_users')
      .select('id')
      .or(`email.eq.${normalizedEmail},username.eq.${String(username || '').trim() || '∅'}`)
      .limit(1);
    if (existing && existing.length > 0) {
      return res.status(409).json({ error: 'A user with this email or username already exists' });
    }

    // Generate a temporary password when none is supplied — returned once.
    const tempPassword = password || `Tmp-${crypto.randomBytes(6).toString('base64url')}!`;
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const userId = crypto.randomUUID();

    const { data: newUser, error: userError } = await supabaseAdmin
      .from('system_users')
      .insert({
        id: userId,
        name: String(name).trim(),
        email: normalizedEmail,
        username: username ? String(username).trim() : null,
        password_hash: passwordHash,
        role: String(role),
        status: 'Active',
        avatar_initials: String(name).trim().slice(0, 2).toUpperCase(),
        mobile_number: mobileNumber || null,
        department: department || null,
        force_password_change: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select('id, name, email, role, status')
      .single();

    if (userError) {
      return res.status(500).json({ error: userError.message });
    }

    // If this is the tenant's first/default user, make it the default tenant
    // for the account and clear other defaults.
    if (isDefault) {
      await supabaseAdmin
        .from('tenant_user_assignments')
        .update({ is_default: false })
        .eq('user_id', userId);
    }

    const { error: assignError } = await supabaseAdmin
      .from('tenant_user_assignments')
      .insert({
        user_id: userId,
        tenant_id: tenantId,
        is_default: isDefault,
        is_super_admin: isSuperAdmin === true,
        created_at: new Date().toISOString(),
      });

    if (assignError) {
      // Roll back the user so we don't leave an orphaned account.
      await supabaseAdmin.from('system_users').delete().eq('id', userId);
      return res.status(500).json({ error: assignError.message });
    }

    await writeAuditEvent({
      req,
      user: req.user,
      action: 'tenant.user_create',
      entityType: 'system_user',
      entityId: userId,
      module: 'admin',
      details: { tenantId, tenantCode: tenant.code, email: normalizedEmail, role, isSuperAdmin: isSuperAdmin === true },
    });

    res.status(201).json({
      user: newUser,
      tenantId,
      temporaryPassword: password ? undefined : tempPassword,
      mustChangePassword: true,
    });
  } catch (error) {
    console.error('Error creating tenant user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Assign user to tenant (super-admin only)
router.post('/tenants/:tenantId/users', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { tenantId } = req.params;
  const { userId, isDefault = false, isSuperAdmin = false } = req.body || {};

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    // If setting as default, unset other defaults for this user
    if (isDefault) {
      await supabaseAdmin
        .from('tenant_user_assignments')
        .update({ is_default: false })
        .eq('user_id', userId);
    }

    const { data: assignment, error } = await supabaseAdmin
      .from('tenant_user_assignments')
      .upsert({
        user_id: userId,
        tenant_id: tenantId,
        is_default: isDefault,
        is_super_admin: isSuperAdmin,
      }, {
        onConflict: 'user_id,tenant_id',
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    await writeAuditEvent({
      req,
      user: req.user,
      action: 'tenant.user_assign',
      entityType: 'tenant_user_assignment',
      entityId: assignment.id,
      module: 'admin',
      details: { tenantId, userId, isDefault, isSuperAdmin },
    });

    res.status(201).json({ assignment });
  } catch (error) {
    console.error('Error assigning user to tenant:', error);
    res.status(500).json({ error: 'Failed to assign user' });
  }
});

// Remove user from tenant (super-admin only)
router.delete('/tenants/:tenantId/users/:userId', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { tenantId, userId } = req.params;

  try {
    const { error } = await supabaseAdmin
      .from('tenant_user_assignments')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('user_id', userId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    await writeAuditEvent({
      req,
      user: req.user,
      action: 'tenant.user_remove',
      entityType: 'tenant_user_assignment',
      entityId: `${tenantId}:${userId}`,
      module: 'admin',
      details: { tenantId, userId },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error removing user from tenant:', error);
    res.status(500).json({ error: 'Failed to remove user' });
  }
});

// Get portal settings for a tenant (super-admin only)
router.get('/tenants/:tenantId/portal-settings', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { tenantId } = req.params;

  try {
    const { data: tenant, error } = await supabaseAdmin
      .from('tenants')
      .select('settings')
      .eq('id', tenantId)
      .single();

    if (error || !tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const portalSettings = tenant.settings?.portal || {};
    res.json({ settings: portalSettings });
  } catch (error) {
    console.error('Error fetching portal settings:', error);
    res.status(500).json({ error: 'Failed to fetch portal settings' });
  }
});

// Update portal settings for a tenant (super-admin only)
router.patch('/tenants/:tenantId/portal-settings', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { tenantId } = req.params;
  const { enabled, customDomain, features } = req.body || {};

  try {
    // Get current tenant settings
    const { data: tenant, error: fetchError } = await supabaseAdmin
      .from('tenants')
      .select('settings')
      .eq('id', tenantId)
      .single();

    if (fetchError || !tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Update portal settings
    const currentSettings = tenant.settings || {};
    const portalSettings = currentSettings.portal || {};
    
    const updatedPortalSettings = {
      ...portalSettings,
      ...(enabled !== undefined && { enabled }),
      ...(customDomain !== undefined && { customDomain }),
      ...(features !== undefined && { features }),
    };

    const updatedSettings = {
      ...currentSettings,
      portal: updatedPortalSettings,
    };

    const { data: updatedTenant, error: updateError } = await supabaseAdmin
      .from('tenants')
      .update({ 
        settings: updatedSettings,
        updated_at: new Date().toISOString()
      })
      .eq('id', tenantId)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    await writeAuditEvent({
      req,
      user: req.user,
      action: 'tenant.portal_settings_update',
      entityType: 'tenant',
      entityId: tenantId,
      module: 'admin',
      details: { portalSettings: updatedPortalSettings },
    });

    res.json({ tenant: updatedTenant, settings: updatedPortalSettings });
  } catch (error) {
    console.error('Error updating portal settings:', error);
    res.status(500).json({ error: 'Failed to update portal settings' });
  }
});

// Get module toggles for a tenant (super-admin only)
router.get('/tenants/:tenantId/module-toggles', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { tenantId } = req.params;

  try {
    const { data: tenant, error } = await supabaseAdmin
      .from('tenants')
      .select('settings')
      .eq('id', tenantId)
      .single();

    if (error || !tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const moduleToggles = tenant.settings?.moduleToggles || {};
    const globalSettings = await getGlobalSettings();
    res.json({
      moduleToggles,
      globalToggles: globalSettings?.module_toggles || {},
    });
  } catch (error) {
    console.error('Error fetching module toggles:', error);
    res.status(500).json({ error: 'Failed to fetch module toggles' });
  }
});

// Update module toggles for a tenant (super-admin only)
router.patch('/tenants/:tenantId/module-toggles', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { tenantId } = req.params;
  const { moduleToggles } = req.body || {};

  if (!moduleToggles || typeof moduleToggles !== 'object') {
    return res.status(400).json({ error: 'moduleToggles object is required' });
  }

  try {
    // Get current tenant settings
    const { data: tenant, error: fetchError } = await supabaseAdmin
      .from('tenants')
      .select('settings')
      .eq('id', tenantId)
      .single();

    if (fetchError || !tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Update module toggles
    const currentSettings = tenant.settings || {};
    const updatedSettings = {
      ...currentSettings,
      moduleToggles,
    };

    const { data: updatedTenant, error: updateError } = await supabaseAdmin
      .from('tenants')
      .update({ 
        settings: updatedSettings,
        updated_at: new Date().toISOString()
      })
      .eq('id', tenantId)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    await writeAuditEvent({
      req,
      user: req.user,
      action: 'tenant.module_toggles_update',
      entityType: 'tenant',
      entityId: tenantId,
      module: 'admin',
      details: { moduleToggles },
    });

    invalidateTenantCache();
    invalidateTenantScopeCache();
    res.json({ tenant: updatedTenant, moduleToggles });
  } catch (error) {
    console.error('Error updating module toggles:', error);
    res.status(500).json({ error: 'Failed to update module toggles' });
  }
});

// Get platform statistics (super-admin only)
router.get('/stats', authenticate, requireSuperAdmin, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  try {
    // Get tenant count
    const { count: tenantCount } = await supabaseAdmin
      .from('tenants')
      .select('*', { count: 'exact', head: true });

    // Get active tenant count
    const { count: activeTenantCount } = await supabaseAdmin
      .from('tenants')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'Active');

    // Get total user count
    const { count: userCount } = await supabaseAdmin
      .from('system_users')
      .select('*', { count: 'exact', head: true });

    // Get total property count
    const { count: propertyCount } = await supabaseAdmin
      .from('properties')
      .select('*', { count: 'exact', head: true });

    res.json({
      stats: {
        totalTenants: tenantCount || 0,
        activeTenants: activeTenantCount || 0,
        totalUsers: userCount || 0,
        totalProperties: propertyCount || 0,
      },
    });
  } catch (error) {
    console.error('Error fetching platform stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// ── Tenant & Property hierarchy ─────────────────────────────────────────
// Powers Admin → Tenant & Property (PropertyManager / OrganizationHierarchyManager).
// Organizations are platform-level entities; properties are tenant-scoped via
// the ALS interceptor (insert stamps tenant_id, update/delete stay in-tenant).

const FOOTPRINT_METRICS: { portal: string; metric: string; table: string }[] = [
  { portal: 'Front Office', metric: 'Rooms', table: 'rooms' },
  { portal: 'Front Office', metric: 'Reservations', table: 'reservations' },
  { portal: 'Front Office', metric: 'Guests', table: 'guests' },
  { portal: 'Front Office', metric: 'Folios', table: 'folios' },
  { portal: 'Housekeeping', metric: 'Tasks', table: 'housekeeping_task_mgmt' },
  { portal: 'Housekeeping', metric: 'Guest Requests', table: 'guest_requests' },
  { portal: 'F&B', metric: 'Outlets', table: 'outlets' },
  { portal: 'F&B', metric: 'Menu Items', table: 'menu_items' },
  { portal: 'Spa & Wellness', metric: 'Appointments', table: 'spa_appointments' },
  { portal: 'Engineering', metric: 'Work Requests', table: 'work_requests' },
  { portal: 'Banquets & Events', metric: 'Events', table: 'banquet_events' },
  { portal: 'Finance', metric: 'Journal Entries', table: 'journal_entries' },
  { portal: 'HR', metric: 'Employees', table: 'employees' },
  { portal: 'Inventory', metric: 'Items', table: 'inventory_items' },
  { portal: 'Transport', metric: 'Requests', table: 'transport_requests' },
];

// Live org → property tree plus per-property row counts across every portal.
router.get('/tenant-overview', authenticate, requireSuperAdmin, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  try {
    const [orgsRes, propsRes] = await Promise.all([
      supabaseAdmin.from('organizations').select('*').order('org_name'),
      supabaseAdmin.from('properties').select('*').order('property_name'),
    ]);
    if (orgsRes.error) return res.status(500).json({ error: orgsRes.error.message });
    if (propsRes.error) return res.status(500).json({ error: propsRes.error.message });

    const properties = propsRes.data || [];

    // Footprint counts run outside the request ALS scope: some portal tables
    // are outlet-keyed in the interceptor, and we want raw per-property counts.
    // The properties list itself is already tenant-filtered, so this stays
    // correctly scoped.
    const footprints = await runWithTenantStore(async () => {
      const map: Record<string, any[]> = {};
      await Promise.all(properties.map(async (p: any) => {
        map[p.id] = await Promise.all(FOOTPRINT_METRICS.map(async (m) => {
          const { count, error } = await supabaseAdmin!
            .from(m.table)
            .select('id', { count: 'exact', head: true })
            .eq('property_id', p.id);
          return { portal: m.portal, metric: m.metric, table: m.table, count: error ? null : (count ?? 0) };
        }));
      }));
      return map;
    });

    res.json({ organizations: orgsRes.data || [], properties, footprints });
  } catch (error) {
    console.error('Error fetching tenant overview:', error);
    res.status(500).json({ error: 'Failed to fetch tenant overview' });
  }
});

const orgPayload = (body: any) => {
  const out: Record<string, any> = {};
  if (body.name !== undefined) out.org_name = body.name;
  if (body.code !== undefined) out.org_code = body.code;
  if (body.description !== undefined) out.description = body.description || null;
  if (body.email !== undefined) out.contact_email = body.email || null;
  if (body.phone !== undefined) out.contact_phone = body.phone || null;
  if (body.isActive !== undefined) out.is_active = !!body.isActive;
  if (body.billingAddress !== undefined) out.billing_address = body.billingAddress || null;
  return out;
};

router.post('/organizations', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const payload = orgPayload(req.body || {});
  if (!payload.org_name) return res.status(400).json({ error: 'name is required' });
  const { data, error } = await supabaseAdmin.from('organizations').insert(payload).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ organization: data });
});

router.patch('/organizations/:id', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const payload = orgPayload(req.body || {});
  if (!Object.keys(payload).length) return res.status(400).json({ error: 'Nothing to update' });
  payload.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('organizations').update(payload).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ organization: data });
});

const propPayload = (body: any) => {
  const out: Record<string, any> = {};
  if (body.organizationId !== undefined) out.organization_id = body.organizationId || null;
  if (body.name !== undefined) out.property_name = body.name;
  if (body.code !== undefined) out.property_code = body.code;
  if (body.propertyType !== undefined) out.property_type = body.propertyType || null;
  if (body.starRating !== undefined) out.star_rating = body.starRating ?? null;
  if (body.timezone !== undefined) out.timezone = body.timezone || null;
  if (body.currency !== undefined) out.currency_code = body.currency || null;
  if (body.email !== undefined) out.contact_email = body.email || null;
  if (body.phone !== undefined) out.contact_phone = body.phone || null;
  if (body.isActive !== undefined) out.is_active = !!body.isActive;
  if (body.address !== undefined && body.address && typeof body.address === 'object') out.address = body.address;
  return out;
};

router.post('/properties', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const body = req.body || {};
  const payload = propPayload(body);
  if (!payload.property_name) return res.status(400).json({ error: 'name is required' });
  payload.property_code = payload.property_code || String(payload.property_name).toUpperCase().replace(/\s+/g, '-').slice(0, 12);
  // tenant_id is stamped by the ALS interceptor for tenant-scoped requests;
  // fall back to the request tenant / caller's active tenant otherwise.
  if (!payload.tenant_id) payload.tenant_id = req.tenant?.id || req.user?.activeTenantId || null;
  const { data, error } = await supabaseAdmin.from('properties').insert(payload).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ property: data });
});

router.patch('/properties/:id', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const body = req.body || {};
  const payload = propPayload(body);
  // Merge address JSONB so partial updates never clobber other keys.
  if (payload.address) {
    const { data: existing } = await supabaseAdmin.from('properties').select('address').eq('id', req.params.id).single();
    payload.address = { ...(existing?.address || {}), ...payload.address };
  }
  if (!Object.keys(payload).length) return res.status(400).json({ error: 'Nothing to update' });
  payload.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('properties').update(payload).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ property: data });
});

export default router;

/**
 * Admin Routes
 * Super-admin only routes for platform management
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { writeAuditEvent, processApiIntegrationsOnRead, processApiIntegrationsOnWrite } from '../services/sessionService';
import { getGlobalSettings, invalidateGlobalSettingsCache } from '../services/settingsService';
import { isValidTenantCode, invalidateTenantCache } from '../middleware/tenant';
import { isAdminSubdomain } from '../middleware/subdomain';
import { mergeTenantErpSettings } from './settings.routes';
import { invalidateTenantScopeCache, runWithTenantStore, getTenantStore } from '../services/tenantScope';
import {
  camelToSnakeRecord,
  snakeToCamelRecord,
  filterKnownColumns,
  mapSystemUserFromDb,
  enrichUserWithDerivedPermissions,
  fetchPasswordPolicy,
  ensurePendingAdminChangesTable,
  resolveTenantPortalFlags,
} from '../services/sharedServices';
import { userApiSchema, roleApiSchema } from '../../schemas/userSchema';
import { processBackupJob, startBackupWorker } from '../services/backupService';
import { validatePassword } from '../../lib/passwordPolicy';
import { dispatchEmail, dispatchSMS } from '../services/salesMessageDispatch';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import cron from 'node-cron';

const router = Router();

startBackupWorker();

// Middleware to ensure only super-admins can access
const requireSuperAdmin = async (req: any, res: any, next: any) => {
  if (!req.user?.isSuperAdmin) {
    return res.status(403).json({ error: 'Super admin access required' });
  }
  next();
};

// Platform super-admins OR tenant admins holding settings:manage. Used for
// endpoints that serve both the SuperAdminPortal and the tenant ERP admin
// portal (e.g. /tenant-overview).
const requireSuperAdminOrSettingsManage = (req: any, res: any, next: any) => {
  if (req.user?.isSuperAdmin) return next();
  return requirePermission('settings:manage')(req, res, next);
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
    // Get tenant info for audit
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id, name, code')
      .eq('id', tenantId)
      .single();

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Purge all tenant data before deleting the tenant.
    // purge_tenant_data() dynamically sweeps every public table that has a
    // tenant_id column (installed by migration 707), so new tables are
    // covered automatically without updating this route.
    const { error: purgeError } = await supabaseAdmin.rpc('purge_tenant_data', {
      p_tenant_id: tenantId,
    });

    if (purgeError) {
      console.error('purge_tenant_data failed:', purgeError);
      return res.status(500).json({ error: `Failed to purge tenant data: ${purgeError.message}` });
    }

    // Delete user sessions for this tenant (keyed by active_tenant_id, not tenant_id)
    await supabaseAdmin
      .from('user_sessions')
      .delete()
      .eq('active_tenant_id', tenantId);

    // 5. Finally delete the tenant
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
      details: { tenantName: tenant.name, tenantCode: tenant.code },
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

// Get ALL users from system_users, including those without tenant assignments (super-admin only)
router.get('/users/all', authenticate, requireSuperAdmin, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  try {
    // Get all users
    const { data: allUsers, error: usersError } = await supabaseAdmin
      .from('system_users')
      .select('id, name, email, username, role, status, created_at')
      .order('created_at', { ascending: false });

    if (usersError) {
      return res.status(500).json({ error: usersError.message });
    }

    // Get all tenant assignments
    const { data: assignments, error: assignError } = await supabaseAdmin
      .from('tenant_user_assignments')
      .select('user_id, tenant_id, is_default, is_super_admin, tenants (id, name, code)');

    if (assignError) {
      return res.status(500).json({ error: assignError.message });
    }

    // Map assignments by user_id
    const assignmentsByUser = new Map<string, any[]>();
    (assignments || []).forEach((a: any) => {
      if (!assignmentsByUser.has(a.user_id)) {
        assignmentsByUser.set(a.user_id, []);
      }
      assignmentsByUser.get(a.user_id)!.push({
        tenantId: a.tenant_id,
        tenantName: a.tenants?.name,
        tenantCode: a.tenants?.code,
        isDefault: a.is_default,
        isSuperAdmin: a.is_super_admin,
      });
    });

    // Combine users with their tenant assignments
    const usersWithTenants = (allUsers || []).map((user: any) => ({
      ...user,
      tenants: assignmentsByUser.get(user.id) || [],
      hasTenant: (assignmentsByUser.get(user.id) || []).length > 0,
    }));

    res.json({ users: usersWithTenants });
  } catch (error) {
    console.error('Error fetching all users:', error);
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
    const [{ data: tenant, error: tenantError }, { data: userRow, error: userError }] = await Promise.all([
      supabaseAdmin.from('tenants').select('id, status').eq('id', tenantId).maybeSingle(),
      supabaseAdmin.from('system_users').select('id').eq('id', userId).maybeSingle(),
    ]);

    if (tenantError) return res.status(500).json({ error: tenantError.message });
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    if (tenant.status !== 'Active') return res.status(400).json({ error: 'Tenant is not active' });
    if (userError) return res.status(500).json({ error: userError.message });
    if (!userRow) return res.status(404).json({ error: 'User not found' });

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
      entityId: assignment?.id || `${tenantId}:${userId}`,
      module: 'admin',
      details: { tenantId, userId, isDefault, isSuperAdmin },
    });

    res.status(201).json({ assignment });
  } catch (error) {
    console.error('Error assigning user to tenant:', error);
    res.status(500).json({ error: 'Failed to assign user' });
  }
});

const ALLOWED_USER_STATUSES = new Set(['Active', 'Inactive', 'Pending', 'Suspended', 'Locked']);

// Update user status / role across the platform (super-admin only)
router.patch('/users/:userId', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { userId } = req.params;
  const { status, role, name } = req.body || {};

  if (status !== undefined && !ALLOWED_USER_STATUSES.has(String(status))) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  if (role !== undefined && !String(role).trim()) {
    return res.status(400).json({ error: 'Role cannot be empty' });
  }
  if (userId === req.user?.id && status !== undefined && status !== 'Active') {
    return res.status(400).json({ error: 'You cannot deactivate or lock your own account' });
  }

  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  if (status !== undefined) {
    updates.status = String(status);
    // Unlocking/reactivating clears prior failed login lockouts
    if (status === 'Active') {
      updates.failed_login_count = 0;
      updates.locked_until = null;
    }
  }
  if (role !== undefined) updates.role = String(role).trim();
  if (name !== undefined && String(name).trim()) updates.name = String(name).trim();

  if (Object.keys(updates).length === 1) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  try {
    const { data: updatedUser, error } = await supabaseAdmin
      .from('system_users')
      .update(updates)
      .eq('id', userId)
      .select('id, name, email, username, role, status')
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    await writeAuditEvent({
      req,
      user: req.user,
      action: 'user.update',
      entityType: 'system_user',
      entityId: userId,
      module: 'admin',
      details: { updates: Object.keys(updates).filter(k => k !== 'updated_at'), status: updatedUser.status, role: updatedUser.role },
    });

    res.json({ user: updatedUser });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
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

// Delete a user: SuperAdmin on admin.* deletes globally; tenant admin removes
// the user from their tenant and only deletes system_users if no other tenants remain.
router.delete('/users/:userId', authenticate, requireSuperAdminOrSettingsManage, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { userId } = req.params;

  if (userId === req.user?.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  const tenantId = resolveScopedTenantId(req);

  try {
    const { data: targetUser, error: lookupError } = await supabaseAdmin
      .from('system_users')
      .select('id, email, name')
      .eq('id', userId)
      .maybeSingle();

    if (lookupError) {
      return res.status(500).json({ error: lookupError.message });
    }
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (tenantId) {
      const { data: membership } = await supabaseAdmin
        .from('tenant_user_assignments')
        .select('user_id')
        .eq('tenant_id', tenantId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!membership) {
        return res.status(404).json({ error: 'User not found in this tenant' });
      }

      await supabaseAdmin
        .from('tenant_user_assignments')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('user_id', userId);

      await supabaseAdmin
        .from('user_sessions')
        .delete()
        .eq('user_id', userId)
        .eq('active_tenant_id', tenantId);

      const { count: remaining } = await supabaseAdmin
        .from('tenant_user_assignments')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      if ((remaining || 0) === 0) {
        await supabaseAdmin.from('user_sessions').delete().eq('user_id', userId);
        await supabaseAdmin.from('system_users').delete().eq('id', userId);
      }

      await writeAuditEvent({
        req,
        user: req.user,
        action: 'tenant.user_remove',
        entityType: 'system_user',
        entityId: userId,
        module: 'admin',
        details: { tenantId, email: targetUser.email, name: targetUser.name },
      });

      return res.json({ success: true });
    }

    // Platform-wide delete (SuperAdmin on admin subdomain)
    await supabaseAdmin
      .from('tenant_user_assignments')
      .delete()
      .eq('user_id', userId);

    await supabaseAdmin
      .from('user_sessions')
      .delete()
      .eq('user_id', userId);

    const { error } = await supabaseAdmin
      .from('system_users')
      .delete()
      .eq('id', userId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    await writeAuditEvent({
      req,
      user: req.user,
      action: 'user.delete',
      entityType: 'system_user',
      entityId: userId,
      module: 'admin',
      details: { userId, email: targetUser.email, name: targetUser.name },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

const buildEffectiveGlobalToggles = (globalSettings: Record<string, any> | null | undefined) => {
  const effective: Record<string, boolean> = { ...(globalSettings?.module_toggles || {}) };
  if (globalSettings?.public_booking_enabled === false) effective.public_booking = false;
  if (globalSettings?.guest_portal_enabled === false) effective.guest = false;
  return effective;
};

const mapPlatformSettingsRow = (row: Record<string, any> | null | undefined) => ({
  maintenanceMode: Boolean(row?.maintenance_mode),
  maintenanceMessage: row?.maintenance_message || '',
  publicBookingEnabled: row?.public_booking_enabled ?? true,
  guestPortalEnabled: row?.guest_portal_enabled ?? true,
  sessionTimeout: Number(row?.session_timeout) || 0,
  maxConcurrentSessions: Number(row?.max_concurrent_sessions) || 3,
  passwordComplexity: (['low', 'medium', 'high'].includes(row?.password_complexity) ? row?.password_complexity : 'medium') as 'low' | 'medium' | 'high',
  forceMfa: Boolean(row?.force_mfa),
  strictPasswordRotation: Boolean(row?.strict_password_rotation),
  backupFrequency: (['daily', 'weekly', 'manual'].includes(row?.backup_frequency) ? row?.backup_frequency : 'daily') as 'daily' | 'weekly' | 'manual',
  systemLogLevel: (['info', 'detailed', 'debug'].includes(row?.system_log_level) ? row?.system_log_level : 'info') as 'info' | 'detailed' | 'debug',
  updatedAt: row?.updated_at || null,
});

// Get module toggles for a tenant (super-admin only)
router.get('/tenants/:tenantId/module-toggles', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { tenantId } = req.params;

  try {
    const [{ data: tenant, error }, globalSettings] = await Promise.all([
      supabaseAdmin
        .from('tenants')
        .select('settings')
        .eq('id', tenantId)
        .single(),
      getGlobalSettings(),
    ]);

    if (error || !tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const moduleToggles = tenant.settings?.moduleToggles || {};
    const flags = resolveTenantPortalFlags(globalSettings, tenant.settings);
    res.json({
      moduleToggles,
      globalToggles: buildEffectiveGlobalToggles(globalSettings),
      portalSettings: flags.portalSettings,
      effectivePortalFlags: {
        publicPortalEnabled: flags.publicPortalEnabled,
        publicBookingEnabled: flags.publicBookingEnabled,
        guestPortalEnabled: flags.guestPortalEnabled,
      },
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
  const { moduleToggles, portalSettings } = req.body || {};

  if (!moduleToggles || typeof moduleToggles !== 'object') {
    return res.status(400).json({ error: 'moduleToggles object is required' });
  }

  try {
    const [{ data: tenant, error: fetchError }, globalSettings] = await Promise.all([
      supabaseAdmin
        .from('tenants')
        .select('settings')
        .eq('id', tenantId)
        .single(),
      getGlobalSettings(),
    ]);

    if (fetchError || !tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const currentSettings = tenant.settings || {};
    const updatedPortal: Record<string, any> = { ...(currentSettings.portal || {}) };
    if (portalSettings && typeof portalSettings === 'object') {
      if (portalSettings.enabled !== undefined) {
        updatedPortal.enabled = Boolean(portalSettings.enabled);
      }
      if (portalSettings.customDomain !== undefined) {
        const trimmed = typeof portalSettings.customDomain === 'string' ? portalSettings.customDomain.trim() : '';
        if (!trimmed) delete updatedPortal.customDomain;
        else updatedPortal.customDomain = trimmed;
      }
    }

    // Keep portal booking/guest flags aligned with their moduleToggles keys
    if (typeof moduleToggles.public_booking === 'boolean') {
      updatedPortal.publicBookingEnabled = moduleToggles.public_booking;
    } else {
      delete updatedPortal.publicBookingEnabled;
    }
    if (typeof moduleToggles.guest === 'boolean') {
      updatedPortal.guestPortalEnabled = moduleToggles.guest;
    } else {
      delete updatedPortal.guestPortalEnabled;
    }

    const updatedSettings = {
      ...currentSettings,
      moduleToggles,
      portal: updatedPortal,
    };

    const { data: updatedTenant, error: updateError } = await supabaseAdmin
      .from('tenants')
      .update({
        settings: updatedSettings,
        updated_at: new Date().toISOString(),
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
      details: { moduleToggles, portal: updatedPortal },
    });

    invalidateTenantCache();
    invalidateTenantScopeCache(tenantId);

    const flags = resolveTenantPortalFlags(globalSettings, updatedSettings);
    res.json({
      tenant: updatedTenant,
      moduleToggles,
      portalSettings: flags.portalSettings,
      effectivePortalFlags: {
        publicPortalEnabled: flags.publicPortalEnabled,
        publicBookingEnabled: flags.publicBookingEnabled,
        guestPortalEnabled: flags.guestPortalEnabled,
      },
    });
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

// Organizations are platform-level rows with no tenant_id — the ALS scope
// interceptor does not filter them. When the request is tenant-scoped,
// restrict the list to orgs that own at least one visible property so tenant
// admins never see other tenants' organizations. The properties query below
// is itself ALS-filtered, so `ids` only contains this tenant's orgs.
const orgsVisibleInScope = async (orgs: any[]): Promise<any[]> => {
  const store = getTenantStore();
  if (!store?.scope || !orgs.length) return orgs;
  const { data: props } = await supabaseAdmin!
    .from('properties')
    .select('organization_id')
    .not('organization_id', 'is', null);
  const ids = new Set((props || []).map((p: any) => p.organization_id));
  return orgs.filter((o: any) => ids.has(o.id));
};

// Live org → property tree plus per-property row counts across every portal.
// Serves both the platform SuperAdminPortal (super-admin, admin subdomain)
// and the tenant ERP admin portal (settings:manage).
router.get('/tenant-overview', authenticate, requireSuperAdminOrSettingsManage, async (_req, res) => {
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

    res.json({ organizations: await orgsVisibleInScope(orgsRes.data || []), properties, footprints });
  } catch (error) {
    console.error('Error fetching tenant overview:', error);
    res.status(500).json({ error: 'Failed to fetch tenant overview' });
  }
});

// NOTE: org/property write routes live in the tenant section below
// (POST/PATCH /organizations, POST/PATCH /properties with settings:manage +
// audit events). Earlier super-admin duplicates were removed — Express
// first-match meant they shadowed the permission-based handlers.

router.delete('/organizations/:id', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { id } = req.params;

  // Count properties platform-wide (outside the ALS tenant scope): an org
  // shared with other tenants must not look empty to a tenant-scoped caller.
  const propCount = await runWithTenantStore(async () => {
    const { count } = await supabaseAdmin!
      .from('properties')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', id);
    return count || 0;
  });

  if (propCount > 0) {
    return res.status(400).json({ error: 'Cannot delete organization with existing properties. Migrate properties first.' });
  }

  const { error } = await supabaseAdmin.from('organizations').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user!, action: 'org.deleted', entityType: 'Organization', entityId: id, module: 'admin' });
  res.json({ success: true });
});

// ── Tenant Data Export / Import / Delete ─────────────────────────────────

const TENANT_DATA_TABLES = [
  'properties', 'rooms', 'room_types', 'rate_plans', 'packages', 'seasons',
  'reservations', 'guests', 'folios', 'folio_lines', 'folio_payments',
  'housekeeping_task_mgmt', 'guest_requests', 'work_requests',
  'spa_appointments', 'fb_table_reservations', 'fb_room_service_orders',
  'banquet_events', 'transport_requests', 'outlets', 'menu_items', 'ingredients',
  'inventory_items', 'inventory_grns', 'inventory_stock_movements',
  'journal_entries', 'journal_lines', 'employees',
];

// Export all data for a tenant (table-by-table JSON dump)
router.get('/tenants/:tenantId/export', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  const { tenantId } = req.params;

  try {
    const exportData: Record<string, any[]> = {};
    for (const table of TENANT_DATA_TABLES) {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select('*')
        .eq('tenant_id', tenantId);
      if (!error && data) exportData[table] = data;
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=tenant-${tenantId}-${Date.now()}.json`);
    res.json({ tenantId, exportedAt: new Date().toISOString(), tables: exportData });
  } catch (error) {
    console.error('Export failed:', error);
    res.status(500).json({ error: 'Export failed' });
  }
});

// Delete all data for a tenant (dangerous - for cleanup before import)
router.delete('/tenants/:tenantId/data', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  const { tenantId } = req.params;

  try {
    const { data: tenant, error: lookupError } = await supabaseAdmin
      .from('tenants')
      .select('id, name, code')
      .eq('id', tenantId)
      .maybeSingle();

    if (lookupError) {
      return res.status(500).json({ error: lookupError.message });
    }
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const { error: purgeError } = await supabaseAdmin.rpc('purge_tenant_data', {
      p_tenant_id: tenantId,
    });

    if (purgeError) {
      console.error('purge_tenant_data failed:', purgeError);
      return res.status(500).json({ error: `Failed to purge tenant data: ${purgeError.message}` });
    }

    await writeAuditEvent({
      req,
      user: req.user,
      action: 'tenant.data_purge',
      entityType: 'tenant',
      entityId: tenantId,
      module: 'admin',
      details: { tenantCode: tenant.code, tenantName: tenant.name },
    });

    invalidateTenantCache();
    invalidateTenantScopeCache(tenantId);
    res.json({ success: true, message: 'All tenant data deleted successfully' });
  } catch (error) {
    console.error('Delete failed:', error);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// Import tenant data from JSON export
router.post('/tenants/:tenantId/import', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  const { tenantId } = req.params;
  const { data } = req.body || {};

  if (!data || typeof data !== 'object' || !data.tables) {
    return res.status(400).json({ error: 'Invalid import data format' });
  }

  try {
    const tables = data.tables as Record<string, any[]>;
    let imported = 0;
    const errors: string[] = [];

    for (const [table, rows] of Object.entries(tables)) {
      if (!Array.isArray(rows) || rows.length === 0) continue;
      if (!TENANT_DATA_TABLES.includes(table)) {
        errors.push(`Skipped unknown table: ${table}`);
        continue;
      }

      const { error } = await supabaseAdmin
        .from(table)
        .upsert(rows.map((r: any) => ({ ...r, tenant_id: tenantId })));
      if (error) {
        errors.push(`${table}: ${error.message}`);
      } else {
        imported += rows.length;
      }
    }

    invalidateTenantScopeCache(tenantId);
    res.json({ success: true, imported, errors });
  } catch (error) {
    console.error('Import failed:', error);
    res.status(500).json({ error: 'Import failed' });
  }
});

// Get platform-wide global settings (super-admin only)
router.get('/platform-settings', authenticate, requireSuperAdmin, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('global_settings')
      .select('*')
      .eq('id', 'main')
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ settings: mapPlatformSettingsRow(data) });
  } catch (error) {
    console.error('Error fetching platform settings:', error);
    res.status(500).json({ error: 'Failed to fetch platform settings' });
  }
});

// Update platform-wide global settings (super-admin only)
router.patch('/platform-settings', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const body = req.body || {};
  const rawUpdates: Record<string, any> = {};

  if (body.maintenanceMode !== undefined) rawUpdates.maintenance_mode = Boolean(body.maintenanceMode);
  if (body.maintenanceMessage !== undefined) {
    rawUpdates.maintenance_message = typeof body.maintenanceMessage === 'string'
      ? body.maintenanceMessage.trim()
      : '';
  }
  if (body.publicBookingEnabled !== undefined) rawUpdates.public_booking_enabled = Boolean(body.publicBookingEnabled);
  if (body.guestPortalEnabled !== undefined) rawUpdates.guest_portal_enabled = Boolean(body.guestPortalEnabled);
  if (body.forceMfa !== undefined) rawUpdates.force_mfa = Boolean(body.forceMfa);
  if (body.strictPasswordRotation !== undefined) rawUpdates.strict_password_rotation = Boolean(body.strictPasswordRotation);

  if (body.sessionTimeout !== undefined) {
    const val = Number(body.sessionTimeout);
    if (!Number.isInteger(val) || val < 0 || val > 43200) {
      return res.status(400).json({ error: 'sessionTimeout must be an integer between 0 and 43200 minutes' });
    }
    rawUpdates.session_timeout = val;
  }

  if (body.maxConcurrentSessions !== undefined) {
    const val = Number(body.maxConcurrentSessions);
    if (!Number.isInteger(val) || val < 1 || val > 50) {
      return res.status(400).json({ error: 'maxConcurrentSessions must be an integer between 1 and 50' });
    }
    rawUpdates.max_concurrent_sessions = val;
  }

  if (body.passwordComplexity !== undefined) {
    if (!['low', 'medium', 'high'].includes(body.passwordComplexity)) {
      return res.status(400).json({ error: 'passwordComplexity must be low, medium, or high' });
    }
    rawUpdates.password_complexity = body.passwordComplexity;
  }

  if (body.backupFrequency !== undefined) {
    if (!['daily', 'weekly', 'manual'].includes(body.backupFrequency)) {
      return res.status(400).json({ error: 'backupFrequency must be daily, weekly, or manual' });
    }
    rawUpdates.backup_frequency = body.backupFrequency;
  }

  if (body.systemLogLevel !== undefined) {
    if (!['info', 'detailed', 'debug'].includes(body.systemLogLevel)) {
      return res.status(400).json({ error: 'systemLogLevel must be info, detailed, or debug' });
    }
    rawUpdates.system_log_level = body.systemLogLevel;
  }

  try {
    const filteredUpdates = await filterKnownColumns(rawUpdates);
    if (Object.keys(filteredUpdates).length === 0) {
      return res.status(400).json({ error: 'No valid platform settings provided' });
    }

    const { data: existing } = await supabaseAdmin
      .from('global_settings')
      .select('id')
      .eq('id', 'main')
      .maybeSingle();

    const query = existing
      ? supabaseAdmin.from('global_settings').update(filteredUpdates).eq('id', 'main').select('*').single()
      : supabaseAdmin.from('global_settings').insert({ id: 'main', ...filteredUpdates }).select('*').single();

    const { data: updated, error } = await query;
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    invalidateGlobalSettingsCache();

    await writeAuditEvent({
      req,
      user: req.user,
      action: 'platform.settings_update',
      entityType: 'global_settings',
      entityId: 'main',
      module: 'admin',
      details: { updatedFields: Object.keys(filteredUpdates) },
    });

    res.json({ settings: mapPlatformSettingsRow(updated) });
  } catch (error) {
    console.error('Error updating platform settings:', error);
    res.status(500).json({ error: 'Failed to update platform settings' });
  }
});

// ═══════════════════════════════════════════════════════════════
// ERP ADMIN ROUTES — Tenant-scoped, permission-gated
// (Restored from pre-multi-tenant refactor)
// ═══════════════════════════════════════════════════════════════

// ── Users ──────────────────────────────────────────────────────

router.get('/users', authenticate, requirePermission('users:manage'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const tenantId = resolveScopedTenantId(req);
    let query = supabaseAdmin.from('system_users').select('*').order('name');
    if (tenantId) {
      const { data: assignments, error: assignErr } = await supabaseAdmin
        .from('tenant_user_assignments')
        .select('user_id')
        .eq('tenant_id', tenantId);
      if (assignErr) return res.status(500).json({ error: assignErr.message });
      const userIds = (assignments || []).map((a: any) => a.user_id).filter(Boolean);
      if (userIds.length === 0) return res.json({ users: [] });
      query = query.in('id', userIds);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    const mapped = (data || []).map(mapSystemUserFromDb);
    const enriched = await Promise.all(mapped.map(u => enrichUserWithDerivedPermissions(u)));
    return res.json({ users: enriched });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/users', authenticate, requirePermission('users:manage'), async (req, res) => {
  const validation = userApiSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: 'Validation failed', details: validation.error.flatten() });
  }

  const body = validation.data;
  if (body.password) {
    const policy = await fetchPasswordPolicy();
    const passwordValidation = validatePassword(body.password, policy);
    if (!passwordValidation.valid) return res.status(400).json({ error: passwordValidation.errors.join('; ') });
  }
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const newId = body.id || `U-${Date.now()}`;
    // No hardcoded fallback — generate a one-time password and return it so the
    // admin can share it; force_password_change makes the user replace it.
    const generatedPassword = !body.password;
    const password = body.password || `Tmp-${crypto.randomBytes(4).toString('base64url')}`;
    const newHash = await bcrypt.hash(password, 10);

    // 1. Create auth user via Supabase Auth Admin API (proper password hashing for GoTrue)
    let authUserId: string | null = null;
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: String(body.email).toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { name: body.full_name, role: body.role },
    });

    if (authError) {
      if (authError.message.includes('already') || authError.message.includes('registered')) {
        const { data: existingAuth } = await supabaseAdmin
          .from('auth.users').select('id').eq('email', String(body.email).toLowerCase()).maybeSingle();
        authUserId = existingAuth?.id || null;
      } else {
        return res.status(400).json({ error: `Auth user creation failed: ${authError.message}` });
      }
    } else {
      authUserId = authData.user.id;
    }

    // 2. Create system_users record
    let customRoleId = body.custom_role_id || null;
    let roleDesc = body.role;
    if (customRoleId) {
      try {
        const { data: roleData } = await supabaseAdmin.from('roles')
          .select('display_name, role_label, name').eq('id', customRoleId).maybeSingle();
        if (roleData) roleDesc = roleData.role_label || roleData.display_name || roleData.name;
      } catch (e) { console.error('Failed to fetch custom role:', e); }
    }
    const { data, error } = await supabaseAdmin.from('system_users').upsert({
      id: newId, name: body.full_name, email: String(body.email).toLowerCase(),
      role: body.role, role_description: roleDesc,
      avatar_initials: body.full_name?.slice(0, 2).toUpperCase() || 'U',
      status: body.is_active ? 'Active' : 'Inactive',
      linked_employee_id: null, username: body.username || null,
      mobile_number: null, department: body.department || null,
      custom_role_id: customRoleId, security_settings: {}, data_restrictions: {},
      allowed_tabs: body.allowed_tabs || [], allowed_settings: body.allowed_settings || {},
      permission_matrix: {}, password_hash: newHash, force_password_change: true,
      auth_user_id: authUserId,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });

    // Bind newly created user to the caller's tenant so they can sign in on this subdomain
    const tenantId = resolveScopedTenantId(req);
    if (tenantId) {
      const { error: assignErr } = await supabaseAdmin.from('tenant_user_assignments').upsert({
        user_id: newId,
        tenant_id: tenantId,
        is_default: true,
        is_super_admin: false,
        created_at: new Date().toISOString(),
      }, { onConflict: 'user_id,tenant_id' });
      if (assignErr) {
        await supabaseAdmin.from('system_users').delete().eq('id', newId);
        return res.status(500).json({ error: assignErr.message });
      }
    }

    await writeAuditEvent({ req, user: req.user!, action: 'user.created', entityType: 'User', entityId: newId, module: 'admin', details: { name: body.full_name, email: body.email, role: body.role, tenantId } });
    return res.json({ success: true, user: mapSystemUserFromDb(data), temporaryPassword: generatedPassword ? password : undefined });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/users/:id', authenticate, requirePermission('users:manage'), async (req, res) => {
  const targetId = req.params.id;
  const partialUserSchema = userApiSchema.partial();
  const validation = partialUserSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: 'Validation failed', details: validation.error.flatten() });
  }

  const updates = validation.data;
  // `status` is not part of userApiSchema (Zod strips unknown keys), so read it
  // from the raw body. Frontend callers send lifecycle statuses like 'Active',
  // 'Suspended', 'Locked' — map them onto system_users.status directly.
  const USER_STATUSES = ['Active', 'Pending', 'Inactive', 'Suspended', 'Locked'];
  const rawStatus = typeof req.body?.status === 'string' ? req.body.status.trim() : undefined;
  let normalizedStatus: string | undefined;
  if (rawStatus !== undefined) {
    normalizedStatus = USER_STATUSES.find(s => s.toLowerCase() === rawStatus.toLowerCase());
    if (!normalizedStatus) {
      return res.status(400).json({ error: `Invalid status '${rawStatus}'. Must be one of: ${USER_STATUSES.join(', ')}` });
    }
  }
  if (req.user!.id === targetId) {
    const privilegedFields: (keyof typeof updates)[] = ['role', 'custom_role_id', 'allowed_tabs', 'allowed_settings'];
    const attemptedPrivilegeChange = privilegedFields.some(f => updates[f] !== undefined);
    if (attemptedPrivilegeChange) {
      await writeAuditEvent({
        req, user: req.user!, action: 'privilege.escalation_blocked',
        entityType: 'User', entityId: targetId, module: 'security', outcome: 'denied',
        details: { attemptedFields: privilegedFields.filter(f => updates[f] !== undefined) }
      });
      for (const f of privilegedFields) delete updates[f];
    }
  }
  if (updates.password) {
    const policy = await fetchPasswordPolicy();
    const pv = validatePassword(updates.password, policy);
    if (!pv.valid) return res.status(400).json({ error: pv.errors.join('; ') });
  }
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const tenantId = resolveScopedTenantId(req);
    if (tenantId) {
      const { data: membership } = await supabaseAdmin
        .from('tenant_user_assignments')
        .select('user_id')
        .eq('tenant_id', tenantId)
        .eq('user_id', targetId)
        .maybeSingle();
      if (!membership) {
        return res.status(404).json({ error: 'User not found in this tenant' });
      }
    }
    if (!req.user?.isSuperAdmin && updates.role && String(updates.role).toLowerCase() === 'super_admin') {
      return res.status(403).json({ error: 'Cannot assign super_admin role' });
    }
    const payload: any = {};
    if (updates.full_name !== undefined) payload.name = updates.full_name;
    if (updates.email !== undefined) payload.email = String(updates.email).toLowerCase();
    if (updates.role !== undefined) { payload.role = updates.role; payload.role_description = updates.role; }
    if (updates.custom_role_id !== undefined) {
      payload.custom_role_id = updates.custom_role_id || null;
      if (updates.custom_role_id) {
        try {
          const { data: roleData } = await supabaseAdmin.from('roles')
            .select('display_name, role_label, name').eq('id', updates.custom_role_id).maybeSingle();
          if (roleData) payload.role_description = roleData.role_label || roleData.display_name || roleData.name;
        } catch (e) { console.error('Failed to fetch custom role for role_description:', e); }
      }
    }
    if (updates.is_active !== undefined) payload.status = updates.is_active ? 'Active' : 'Inactive';
    if (normalizedStatus !== undefined) {
      payload.status = normalizedStatus;
      // Reactivating clears lockout state so the user can sign in immediately.
      if (normalizedStatus === 'Active') {
        payload.failed_login_count = 0;
        payload.locked_until = null;
        payload.mfa_locked_until = null;
        payload.failed_mfa_count = 0;
      }
    }
    if (updates.username !== undefined) payload.username = updates.username || null;
    if (updates.department !== undefined) payload.department = updates.department || null;
    if (updates.allowed_tabs !== undefined) payload.allowed_tabs = updates.allowed_tabs;
    if (updates.allowed_settings !== undefined) payload.allowed_settings = updates.allowed_settings;
    if (updates.password) {
      payload.password_hash = await bcrypt.hash(updates.password, 10);
      payload.force_password_change = false;
      payload.password_updated_at = new Date().toISOString();
    }
    const { data, error } = await supabaseAdmin.from('system_users').update(payload).eq('id', targetId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    await writeAuditEvent({ req, user: req.user!, action: 'user.updated', entityType: 'User', entityId: targetId, module: 'admin', details: { updates: Object.keys(payload) } });
    return res.json({ success: true, user: mapSystemUserFromDb(data) });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// ── Roles ──────────────────────────────────────────────────────

router.get('/roles', authenticate, requirePermission('roles:manage'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    let query = supabaseAdmin
      .from('roles')
      .select('id, name, display_name, description, is_superuser, is_system, is_active, category, department, role_label, parent_role_id, module_access, permissions, role_permissions ( permissions ( code ) )')
      .order('name');
    if (!req.user?.isSuperAdmin) {
      query = query.eq('is_superuser', false);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    const roles = (data || []).map((r: any) => ({
      id: r.id, name: r.name, display_name: r.display_name || r.name,
      description: r.description || '',
      isSystem: r.is_system || false, isSuperuser: r.is_superuser || false,
      isActive: r.is_active !== false, category: r.category || 'custom',
      department: r.department || null, roleLabel: r.role_label || null,
      parentRoleId: r.parent_role_id || null, moduleAccess: r.module_access || [],
      permissions: r.permissions || {},
      rbacPermissionCodes: (r.role_permissions || []).map((rp: any) => rp.permissions?.code).filter(Boolean),
    }));
    return res.json({ roles });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/roles', authenticate, requirePermission('roles:manage'), async (req, res) => {
  const validation = roleApiSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: 'Validation failed', details: validation.error.flatten() });
  }
  const body = validation.data;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    if (!req.user?.isSuperAdmin && body.is_superuser) {
      return res.status(403).json({ error: 'Only Super Admin can create superuser roles' });
    }
    const roleId = body.id || `ROLE-${Date.now()}`;
    const { data, error } = await supabaseAdmin.from('roles').upsert({
      id: roleId, name: body.name, display_name: body.name, description: body.description || '',
      is_superuser: body.is_superuser || false, is_active: body.is_active !== false,
      category: (req.body as any).category || 'custom',
      department: (req.body as any).department || null, role_label: (req.body as any).roleLabel || null,
      parent_role_id: (req.body as any).parentRoleId || null,
      module_access: (req.body as any).moduleAccess || [], permissions: (req.body as any).permissions || {},
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    if ((req.body as any).rbacPermissionCodes !== undefined) {
      try { await syncRolePermissions(roleId, (req.body as any).rbacPermissionCodes, supabaseAdmin); } catch {}
    }
    await writeAuditEvent({ req, user: req.user!, action: 'role.created', entityType: 'Role', entityId: roleId, module: 'admin', details: { name: body.name } });
    return res.json({ success: true, role: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/roles/:id', authenticate, requirePermission('roles:manage'), async (req, res) => {
  const roleId = req.params.id;
  const partialRoleSchema = roleApiSchema.partial();
  const validation = partialRoleSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: 'Validation failed', details: validation.error.flatten() });
  }
  const updates = validation.data;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    if (!req.user?.isSuperAdmin) {
      const { data: existingRole } = await supabaseAdmin.from('roles').select('is_superuser, is_system').eq('id', roleId).maybeSingle();
      if (existingRole?.is_superuser || existingRole?.is_system || updates.is_superuser) {
        return res.status(403).json({ error: 'System and superuser roles are managed by Super Admin' });
      }
    }
    const payload: any = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.name !== undefined) payload.display_name = updates.name;
    if (updates.description !== undefined) payload.description = updates.description;
    if (req.body.department !== undefined) payload.department = req.body.department || null;
    if (req.body.roleLabel !== undefined) payload.role_label = req.body.roleLabel || null;
    if (req.body.parentRoleId !== undefined) payload.parent_role_id = req.body.parentRoleId || null;
    if (req.body.category !== undefined) payload.category = req.body.category;
    if (req.body.moduleAccess !== undefined) payload.module_access = req.body.moduleAccess;
    if (req.body.permissions !== undefined) payload.permissions = req.body.permissions;
    if (updates.is_superuser !== undefined) payload.is_superuser = updates.is_superuser;
    if (updates.is_active !== undefined) payload.is_active = updates.is_active;
    const { data, error } = await supabaseAdmin.from('roles').update(payload).eq('id', roleId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    if (req.body.rbacPermissionCodes !== undefined || req.body.permissions !== undefined) {
      try {
        let permCodes: string[];
        if (req.body.rbacPermissionCodes !== undefined) {
          permCodes = req.body.rbacPermissionCodes;
        } else {
          const permObj = req.body.permissions || {};
          permCodes = Array.isArray(permObj) ? permObj : Object.values(permObj).flat() as string[];
        }
        await syncRolePermissions(roleId, permCodes, supabaseAdmin);
      } catch (syncErr) { console.error('Role permission sync error:', syncErr); }
    }
    await writeAuditEvent({ req, user: req.user!, action: 'role.updated', entityType: 'Role', entityId: roleId, module: 'admin', details: { updates: Object.keys(payload) } });
    return res.json({ success: true, role: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/roles/:id', authenticate, requirePermission('roles:manage'), async (req, res) => {
  const roleId = req.params.id;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    if (!req.user?.isSuperAdmin) {
      const { data: existingRole } = await supabaseAdmin.from('roles').select('is_superuser, is_system').eq('id', roleId).maybeSingle();
      if (existingRole?.is_superuser || existingRole?.is_system) {
        return res.status(403).json({ error: 'System and superuser roles cannot be deleted by tenant admins' });
      }
    }
    await supabaseAdmin.from('role_permissions').delete().eq('role_id', roleId);
    const { error } = await supabaseAdmin.from('roles').delete().eq('id', roleId);
    if (error) return res.status(500).json({ error: error.message });
    await writeAuditEvent({ req, user: req.user!, action: 'role.deleted', entityType: 'Role', entityId: roleId, module: 'admin' });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// ── Permissions ──────────────────────────────────────────────

router.get('/permissions', authenticate, requirePermission('roles:manage'), async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.from('permissions').select('id, code, module, description').order('module').order('code');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ permissions: data || [] });
});

// Sync custom role permissions to the roles/role_permissions tables for RBAC
async function syncRolePermissions(roleId: string, permissionCodes: string[], supa: any) {
  await supa.from('role_permissions').delete().eq('role_id', roleId);
  if (!permissionCodes || permissionCodes.length === 0) return;
  const { data: perms } = await supa.from('permissions').select('id, code').in('code', permissionCodes);
  if (!perms) return;
  const rpRows = perms.map((p: any) => ({ role_id: roleId, permission_id: p.id }));
  if (rpRows.length > 0) await supa.from('role_permissions').insert(rpRows);
}

// ── User Role Assignments ────────────────────────────────────────

router.post('/users/:userId/roles', authenticate, requirePermission('roles:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { roleId, propertyId, organizationId, expiresAt } = req.body;
  if (!roleId) return res.status(400).json({ error: 'roleId is required' });
  const tenantId = resolveScopedTenantId(req);
  if (tenantId) {
    const { data: membership } = await supabaseAdmin
      .from('tenant_user_assignments')
      .select('user_id')
      .eq('tenant_id', tenantId)
      .eq('user_id', req.params.userId)
      .maybeSingle();
    if (!membership) return res.status(404).json({ error: 'User not found in this tenant' });
  }
  if (!req.user?.isSuperAdmin) {
    const { data: roleRow } = await supabaseAdmin.from('roles').select('is_superuser').eq('id', roleId).maybeSingle();
    if (roleRow?.is_superuser) return res.status(403).json({ error: 'Only Super Admin can assign superuser roles' });
  }
  try {
    const { data, error } = await supabaseAdmin.rpc('assign_role_to_user', {
      p_user_id: req.params.userId, p_role_id: roleId,
      p_property_id: propertyId || null, p_organization_id: organizationId || null,
      p_assigned_by: req.user?.id || null, p_expires_at: expiresAt || null
    });
    if (error) return res.status(500).json({ error: error.message });
    await writeAuditEvent({ req, user: req.user!, action: 'role.assigned', entityType: 'UserRoleAssignment', entityId: data, module: 'admin', details: { userId: req.params.userId, roleId, propertyId, organizationId } });
    return res.json({ success: true, assignmentId: data });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});

// ── Module Registry ──────────────────────────────────────────────

// Read-only permission catalog — kept at authenticate-only because
// PermissionChecklist embeds it in non-RBAC screens (e.g. POSOutletManagement)
// whose users may not hold roles:manage.
router.get('/module-registry', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  try {
    const { data, error } = await supabaseAdmin.rpc('get_module_registry');
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || {});
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});

router.get('/modules', authenticate, requirePermission('roles:manage'), async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.from('modules').select('*').order('department').order('sort_order');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ modules: data || [] });
});

router.post('/modules', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { id, department, label, icon, description, sortOrder } = req.body;
  if (!id || !label) return res.status(400).json({ error: 'id and label are required' });
  const { data, error } = await supabaseAdmin.from('modules').upsert({
    id, department: department || 'general', label, icon: icon || '📦',
    description: description || '', sort_order: sortOrder || 0, is_active: true,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user!, action: 'module.created', entityType: 'Module', entityId: id, module: 'admin', details: { label, department } });
  return res.json({ module: data });
});

router.patch('/modules/:id', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { label, icon, description, department, sortOrder, isActive } = req.body;
  const updates: any = { updated_at: new Date().toISOString() };
  if (label !== undefined) updates.label = label;
  if (icon !== undefined) updates.icon = icon;
  if (description !== undefined) updates.description = description;
  if (department !== undefined) updates.department = department;
  if (sortOrder !== undefined) updates.sort_order = sortOrder;
  if (isActive !== undefined) updates.is_active = isActive;
  const { data, error } = await supabaseAdmin.from('modules').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user!, action: 'module.updated', entityType: 'Module', entityId: req.params.id, module: 'admin', details: updates });
  return res.json({ module: data });
});

router.delete('/modules/:id', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { error } = await supabaseAdmin.from('modules').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user!, action: 'module.deleted', entityType: 'Module', entityId: req.params.id, module: 'admin' });
  return res.json({ success: true });
});

// ── Organizations (ERP-level) ────────────────────────────────────

const _pick = (...vals: any[]) => vals.find(v => v !== undefined);
const _nul = (v: any) => (v === '' ? null : v);

const _orgUpdates = (b: any) => {
  const u: any = {};
  const map: Record<string, any> = {
    org_name: _pick(b.orgName, b.name), org_code: _pick(b.orgCode, b.code), description: b.description,
    contact_email: _pick(b.contactEmail, b.email), contact_phone: _pick(b.contactPhone, b.phone),
    billing_address: _pick(b.billingAddress, typeof b.address === 'object' ? b.address : undefined),
    is_active: _pick(b.isActive, b.is_active), logo_url: _pick(b.logoUrl, b.logo_url),
  };
  for (const [k, v] of Object.entries(map)) if (v !== undefined) u[k] = k === 'is_active' || k === 'billing_address' ? v : _nul(v);
  return u;
};

const _propertyUpdates = (b: any) => {
  const u: any = {};
  const map: Record<string, any> = {
    organization_id: _pick(b.organizationId, b.orgId, b.organization_id), property_name: _pick(b.propertyName, b.name),
    property_code: _pick(b.propertyCode, b.code), property_type: _pick(b.propertyType, b.property_type),
    star_rating: b.starRating ?? b.star_rating, address: typeof b.address === 'object' ? b.address : undefined,
    timezone: b.timezone, currency_code: _pick(b.currencyCode, b.currency),
    contact_email: _pick(b.contactEmail, b.email), contact_phone: _pick(b.contactPhone, b.phone),
    is_active: _pick(b.isActive, b.is_active), location_lat: b.locationLat, location_lng: b.locationLng,
  };
  for (const [k, v] of Object.entries(map)) if (v !== undefined) u[k] = k === 'is_active' || k === 'address' ? v : _nul(v);
  return u;
};

router.get('/organizations', authenticate, requirePermission('settings:manage'), async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.from('organizations').select('*').order('org_name');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ organizations: await orgsVisibleInScope(data || []) });
});

router.post('/organizations', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const u = _orgUpdates(req.body);
  if (!u.org_name || !u.org_code) return res.status(400).json({ error: 'name and code are required' });
  const { data, error } = await supabaseAdmin.from('organizations').insert(u).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user!, action: 'org.created', entityType: 'Organization', entityId: data.id, module: 'admin' });
  return res.json({ organization: data });
});

router.patch('/organizations/:id', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const updates = { ..._orgUpdates(req.body), updated_at: new Date().toISOString() };
  const { data, error } = await supabaseAdmin.from('organizations').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user!, action: 'org.updated', entityType: 'Organization', entityId: req.params.id, module: 'admin' });
  return res.json({ organization: data });
});

// ── Properties (ERP-level) ───────────────────────────────────────

router.get('/properties', authenticate, requirePermission('settings:manage'), async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.from('properties').select('*, organizations(*)').order('property_name');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ properties: data || [] });
});

router.post('/properties', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const u = _propertyUpdates(req.body);
  if (!u.property_name || !u.property_code || !u.organization_id) return res.status(400).json({ error: 'organization, name and code are required' });
  const { data, error } = await supabaseAdmin.from('properties').insert(u).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user!, action: 'property.created', entityType: 'Property', entityId: data.id, module: 'admin' });
  return res.json({ property: data });
});

router.patch('/properties/:id', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const updates = { ..._propertyUpdates(req.body), updated_at: new Date().toISOString() };
  // Merge address JSONB so partial updates never clobber other keys.
  if (updates.address) {
    const { data: existing } = await supabaseAdmin.from('properties').select('address').eq('id', req.params.id).single();
    updates.address = { ...(existing?.address || {}), ...updates.address };
  }
  const { data, error } = await supabaseAdmin.from('properties').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user!, action: 'property.updated', entityType: 'Property', entityId: req.params.id, module: 'admin' });
  return res.json({ property: data });
});

// Live per-property footprint across every portal
const PORTAL_FOOTPRINT_ERP: { portal: string; metric: string; table: string }[] = [
  { portal: 'Front Office', metric: 'Rooms', table: 'rooms' },
  { portal: 'Front Office', metric: 'Room Types', table: 'room_types' },
  { portal: 'Front Office', metric: 'Reservations', table: 'reservations' },
  { portal: 'Front Office', metric: 'Guests', table: 'guests' },
  { portal: 'Front Office', metric: 'Guest Requests', table: 'guest_requests' },
  { portal: 'Front Office', metric: 'Rate Plans', table: 'rate_plans' },
  { portal: 'Front Office', metric: 'Packages', table: 'packages' },
  { portal: 'Housekeeping', metric: 'Tasks', table: 'housekeeping_task_mgmt' },
  { portal: 'Housekeeping', metric: 'Linen Stock', table: 'hk_linen_stock' },
  { portal: 'Housekeeping', metric: 'Setup Areas', table: 'hk_property_setup' },
  { portal: 'Food & Beverage', metric: 'Outlets', table: 'outlets' },
  { portal: 'Food & Beverage', metric: 'Menu Items', table: 'menu_items' },
  { portal: 'Food & Beverage', metric: 'Tables', table: 'fb_tables' },
  { portal: 'Food & Beverage', metric: 'Staff', table: 'fb_staff' },
  { portal: 'Food & Beverage', metric: 'Table Reservations', table: 'fb_table_reservations' },
  { portal: 'Spa', metric: 'Treatment Rooms', table: 'spa_rooms' },
  { portal: 'Spa', metric: 'Appointments', table: 'spa_appointments' },
  { portal: 'Engineering', metric: 'Technicians', table: 'eng_technicians' },
  { portal: 'Engineering', metric: 'Room Issues', table: 'eng_room_issues' },
  { portal: 'Engineering', metric: 'Generators', table: 'eng_generators' },
  { portal: 'Banquet', metric: 'Events', table: 'banquet_events' },
  { portal: 'Finance', metric: 'Folios', table: 'folios' },
  { portal: 'Finance', metric: 'Journal Entries', table: 'journal_entries' },
  { portal: 'HR', metric: 'Employees', table: 'employees' },
  { portal: 'Inventory', metric: 'Inventory Items', table: 'inventory_items' },
];

const erpPropertyFootprint = (propertyId: string) => Promise.all(PORTAL_FOOTPRINT_ERP.map(async m => {
  const { count, error } = await supabaseAdmin!.from(m.table).select('*', { count: 'exact', head: true }).eq('property_id', propertyId);
  return { ...m, count: error ? null : (count ?? 0) };
}));

router.get('/properties/:id/footprint', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  return res.json({ footprint: await erpPropertyFootprint(req.params.id) });
});

// ── Settings ───────────────────────────────────────────────────

const COMPLEXITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };

function resolveScopedTenantId(req: any): string | null {
  if (req.user?.isSuperAdmin && isAdminSubdomain(req)) return null;
  return req.tenant?.id || req.user?.activeTenantId || null;
}

router.get('/settings', authenticate, requirePermission('settings:update'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const rawData = await getGlobalSettings();
    if (!rawData) return res.json({ settings: {} });

    const tenantId = resolveScopedTenantId(req);
    let data: Record<string, any> = { ...rawData };
    if (tenantId) {
      let tenantSettings: Record<string, any> | null = req.tenant?.id === tenantId ? (req.tenant?.settings || null) : null;
      if (!tenantSettings) {
        const { data: tRow } = await supabaseAdmin.from('tenants').select('settings').eq('id', tenantId).maybeSingle();
        tenantSettings = tRow?.settings || null;
      }
      data = mergeTenantErpSettings(rawData, tenantSettings);
    }

    const encryptedIntegrations = data.encrypted_api_integrations || data.api_integrations;
    data.api_integrations = processApiIntegrationsOnRead(encryptedIntegrations);
    if (data.encrypted_api_integrations) data.encrypted_api_integrations = undefined;
    return res.json({ settings: snakeToCamelRecord(data) });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/settings', authenticate, requirePermission('settings:update'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const tenantId = resolveScopedTenantId(req);
  const updates = await filterKnownColumns(camelToSnakeRecord(req.body || {}));

  // Tenant-scoped admin: persist overrides inside tenants.settings within
  // SuperAdmin boundaries; never mutate platform-wide global_settings.
  if (tenantId) {
    const [{ data: tenantRow, error: fetchErr }, rawGlobal] = await Promise.all([
      supabaseAdmin.from('tenants').select('id, settings').eq('id', tenantId).maybeSingle(),
      getGlobalSettings(),
    ]);
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });
    if (!tenantRow) return res.status(404).json({ error: 'Tenant not found' });

    const currentSettings: Record<string, any> = tenantRow.settings || {};
    const flags = resolveTenantPortalFlags(rawGlobal, currentSettings);
    const nextAdminToggles: Record<string, boolean> = { ...(currentSettings.adminModuleToggles || {}) };
    const nextErpSettings: Record<string, any> = { ...(currentSettings.erpSettings || {}) };

    // 1. Clamp moduleToggles to SuperAdmin's boundary
    if (updates.module_toggles && typeof updates.module_toggles === 'object') {
      for (const [k, v] of Object.entries(updates.module_toggles)) {
        if (typeof v !== 'boolean') continue;
        // If SuperAdmin locked this key off, tenant admin cannot re-enable it.
        nextAdminToggles[k] = flags.superAdminLockedToggles[k] ? false : v;
      }
      delete updates.module_toggles;
    }

    // 2. Clamp public_booking_enabled & guest_portal_enabled to SuperAdmin boundary
    if (updates.public_booking_enabled !== undefined) {
      nextAdminToggles.public_booking = flags.superAdminLockedToggles.public_booking
        ? false
        : Boolean(updates.public_booking_enabled);
      delete updates.public_booking_enabled;
    }
    if (updates.guest_portal_enabled !== undefined) {
      nextAdminToggles.guest = flags.superAdminLockedToggles.guest
        ? false
        : Boolean(updates.guest_portal_enabled);
      delete updates.guest_portal_enabled;
    }

    // 3. Enforce SuperAdmin security & platform boundaries on remaining fields
    const globalForceMfa = Boolean(rawGlobal?.force_mfa);
    const globalStrictRotation = Boolean(rawGlobal?.strict_password_rotation);
    const globalMinComplexity = COMPLEXITY_RANK[rawGlobal?.password_complexity] ? rawGlobal!.password_complexity : 'medium';
    const globalMaxTimeout = Number(rawGlobal?.session_timeout) || 0;

    if (updates.force_mfa !== undefined && globalForceMfa) {
      updates.force_mfa = true;
    }
    if (updates.strict_password_rotation !== undefined && globalStrictRotation) {
      updates.strict_password_rotation = true;
    }
    if (updates.password_complexity !== undefined) {
      if ((COMPLEXITY_RANK[updates.password_complexity] || 0) < COMPLEXITY_RANK[globalMinComplexity]) {
        updates.password_complexity = globalMinComplexity;
      }
    }
    if (updates.session_timeout !== undefined && globalMaxTimeout > 0) {
      const val = Number(updates.session_timeout) || globalMaxTimeout;
      updates.session_timeout = Math.min(val, globalMaxTimeout);
    }
    if (updates.api_integrations) {
      try {
        updates.encrypted_api_integrations = processApiIntegrationsOnWrite(updates.api_integrations);
        updates.api_integrations = [];
      } catch (e) { console.error('[CRYPTO] Failed to encrypt API integrations on write:', e); }
    }

    // Never allow tenant admin to override platform-locked maintenance mode if platform is in maintenance
    if (rawGlobal?.maintenance_mode && updates.maintenance_mode === false) {
      updates.maintenance_mode = true;
    }

    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined) nextErpSettings[k] = v;
    }

    const updatedSettings = {
      ...currentSettings,
      adminModuleToggles: nextAdminToggles,
      erpSettings: nextErpSettings,
    };

    const { error: updateErr } = await supabaseAdmin
      .from('tenants')
      .update({ settings: updatedSettings, updated_at: new Date().toISOString() })
      .eq('id', tenantId);
    if (updateErr) return res.status(500).json({ error: updateErr.message });

    invalidateTenantCache();
    invalidateTenantScopeCache(tenantId);

    await writeAuditEvent({
      req, user: req.user!, action: 'tenant.settings_updated',
      entityType: 'Tenant', entityId: tenantId, module: 'admin',
      details: { updates: Object.keys(updates), toggleUpdates: Object.keys(nextAdminToggles) },
    });

    const merged = mergeTenantErpSettings(rawGlobal || {}, updatedSettings);
    const encryptedIntegrations = merged.encrypted_api_integrations || merged.api_integrations;
    merged.api_integrations = processApiIntegrationsOnRead(encryptedIntegrations);
    if (merged.encrypted_api_integrations) merged.encrypted_api_integrations = undefined;
    return res.json({ success: true, settings: snakeToCamelRecord(merged) });
  }

  // Platform-wide global_settings update (SuperAdmin on admin subdomain)
  if (updates.api_integrations) {
    try {
      const encrypted = processApiIntegrationsOnWrite(updates.api_integrations);
      updates.encrypted_api_integrations = encrypted;
      updates.api_integrations = [];
    } catch (e) { console.error('[CRYPTO] Failed to encrypt API integrations on write:', e); }
  }
  const { data: existing } = await supabaseAdmin.from('global_settings').select('id').maybeSingle();
  if (existing) {
    const { data, error } = await supabaseAdmin.from('global_settings').update({
      ...updates, updated_at: new Date().toISOString(), updated_by: req.user!.id
    }).eq('id', existing.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    invalidateGlobalSettingsCache();
    await writeAuditEvent({ req, user: req.user!, action: 'settings.updated', entityType: 'GlobalSettings', entityId: existing.id, module: 'admin', details: { updates: Object.keys(updates) } });
    return res.json({ success: true, settings: data ? snakeToCamelRecord(data) : {} });
  } else {
    const newId = crypto.randomUUID();
    const { data, error } = await supabaseAdmin.from('global_settings').insert({
      id: newId, ...updates, created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), created_by: req.user!.id, updated_by: req.user!.id
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    invalidateGlobalSettingsCache();
    await writeAuditEvent({ req, user: req.user!, action: 'settings.created', entityType: 'GlobalSettings', entityId: newId, module: 'admin', details: { updates: Object.keys(updates) } });
    return res.json({ success: true, settings: data ? snakeToCamelRecord(data) : {} });
  }
});

// ── Pending Admin Changes — Executive Governance Approval Queue ──

router.get('/pending-changes', authenticate, requirePermission('settings:update'), async (_req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    let { data, error } = await supabaseAdmin.from('pending_admin_changes').select('*').order('submitted_at', { ascending: false });
    if (error && error.code === '42P01') {
      await ensurePendingAdminChangesTable();
      const result = await supabaseAdmin.from('pending_admin_changes').select('*').order('submitted_at', { ascending: false });
      data = result.data; error = result.error;
    }
    if (error) return res.status(500).json({ error: error.message });
    const mapped = (data || []).map((r: any) => ({
      id: r.id, title: r.title, description: r.description,
      changeType: r.change_type, submittedAt: r.submitted_at,
      submittedBy: r.submitted_by, status: r.status, payload: r.payload,
    }));
    return res.json({ changes: mapped });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/pending-changes', authenticate, async (req, res) => {
  const body = req.body || {};
  if (!body.id || !body.title || !body.changeType || !body.payload) {
    return res.status(400).json({ error: 'id, title, changeType, and payload are required' });
  }
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const row = {
      id: body.id, title: body.title, description: body.description || '',
      change_type: body.changeType, submitted_at: body.submittedAt || new Date().toISOString(),
      submitted_by: body.submittedBy || req.user!.name || req.user!.email,
      status: 'Pending', payload: body.payload,
    };
    let result = await supabaseAdmin.from('pending_admin_changes').insert(row);
    if (result.error && result.error.code === '42P01') {
      await ensurePendingAdminChangesTable();
      result = await supabaseAdmin.from('pending_admin_changes').insert(row);
    }
    if (result.error) return res.status(500).json({ error: result.error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/pending-changes/:id', authenticate, requirePermission('settings:update'), async (req, res) => {
  const changeId = req.params.id;
  const { status } = req.body || {};
  if (status !== 'Approved' && status !== 'Declined') {
    return res.status(400).json({ error: 'status must be Approved or Declined' });
  }
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    let result = await supabaseAdmin.from('pending_admin_changes').update({ status }).eq('id', changeId);
    if (result.error && result.error.code === '42P01') {
      await ensurePendingAdminChangesTable();
      result = await supabaseAdmin.from('pending_admin_changes').update({ status }).eq('id', changeId);
    }
    if (result.error) return res.status(500).json({ error: result.error.message });
    await writeAuditEvent({ req, user: req.user, action: `admin_change.${status.toLowerCase()}`, module: 'governance', details: { changeId, status } });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// ── Backups ──────────────────────────────────────────────────────

router.get('/backups', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const status = req.query.status as string;
  let query = supabaseAdmin.from('backup_jobs').select('*').order('initiated_at', { ascending: false }).limit(50);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ backups: data || [] });
});

router.post('/backups/create', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { backupType, storageLocation, metadata } = req.body;
  if (!backupType) return res.status(400).json({ error: 'backupType is required' });
  const { data, error } = await supabaseAdmin.rpc('create_backup_job', {
    p_backup_type: backupType, p_storage_location: storageLocation || 'supabase',
    p_initiated_by: null,
    p_metadata: { ...(metadata || {}), requestedBy: req.user?.id || null, requestedByName: (req.user as any)?.name || null }
  });
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user!, action: 'backup.created', entityType: 'BackupJob', entityId: data, module: 'admin', details: { backupType, storageLocation } });
  processBackupJob(data).catch(e => console.error('[BackupWorker] immediate run failed:', e?.message));
  return res.json({ success: true, backupId: data });
});

router.get('/backups/:id/download', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data: job, error: jobErr } = await supabaseAdmin.from('backup_jobs').select('id, status, storage_path').eq('id', req.params.id).maybeSingle();
  if (jobErr) return res.status(500).json({ error: jobErr.message });
  if (!job) return res.status(404).json({ error: 'Backup job not found' });
  if (job.status !== 'completed' || !job.storage_path) return res.status(400).json({ error: 'Backup is not completed or has no stored artifact' });
  const manifestPath = job.storage_path.endsWith('/') ? job.storage_path + 'manifest.json' : job.storage_path + '/manifest.json';
  const { data: signed, error: signErr } = await supabaseAdmin.storage.from('backups').createSignedUrl(manifestPath, 3600);
  if (signErr || !signed) return res.status(500).json({ error: signErr?.message || 'Failed to create download URL' });
  return res.json({ url: signed.signedUrl, path: manifestPath, expiresIn: 3600 });
});

router.get('/backups/statistics', authenticate, requirePermission('settings:manage'), async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.from('backup_jobs').select('status, backup_size_bytes, initiated_at').order('initiated_at', { ascending: false }).limit(5000);
  if (error) return res.status(500).json({ error: error.message });
  const rows = data || [];
  const completed = rows.filter(r => r.status === 'completed');
  const sizes = completed.map(r => Number(r.backup_size_bytes) || 0);
  const totalSize = sizes.reduce((a, b) => a + b, 0);
  return res.json({ statistics: {
    total_backups: rows.length, successful_backups: completed.length,
    failed_backups: rows.filter(r => r.status === 'failed').length,
    active_backups: rows.filter(r => r.status === 'running' || r.status === 'pending').length,
    total_size_bytes: totalSize, avg_backup_size_bytes: completed.length ? Math.round(totalSize / completed.length) : 0,
    last_backup_time: rows[0]?.initiated_at || null, last_backup_status: rows[0]?.status || null,
  }});
});

router.get('/backups/restorations', authenticate, requirePermission('settings:manage'), async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.from('backup_restorations').select('*, backup_jobs(backup_type, initiated_at)').order('initiated_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ restorations: data || [] });
});

router.post('/backups/:id/restore', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data: job, error: jobErr } = await supabaseAdmin.from('backup_jobs').select('id, status, backup_type').eq('id', req.params.id).maybeSingle();
  if (jobErr) return res.status(500).json({ error: jobErr.message });
  if (!job) return res.status(404).json({ error: 'Backup job not found' });
  if (job.status !== 'completed') return res.status(400).json({ error: 'Only completed backups can be restored' });
  const { data, error } = await supabaseAdmin.from('backup_restorations').insert({
    backup_job_id: job.id, status: 'pending', initiated_by: null,
    metadata: { requestedBy: req.user?.id || null, backupType: job.backup_type, ...(req.body?.metadata || {}) },
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user!, action: 'backup.restore_requested', entityType: 'BackupRestoration', entityId: data.id, module: 'admin', details: { backupJobId: job.id, backupType: job.backup_type } });
  return res.json({ success: true, restoration: data });
});

router.post('/backups/cleanup', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.rpc('cleanup_old_backups', { p_retention_days: req.body.retentionDays || 30 });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, deletedCount: data });
});

router.get('/backup-schedules', authenticate, requirePermission('settings:manage'), async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.from('backup_schedules').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ schedules: data || [] });
});

router.post('/backup-schedules', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { scheduleName, backupType, cronSchedule, retentionDays, storageLocation } = req.body;
  if (!scheduleName || !backupType || !cronSchedule) return res.status(400).json({ error: 'scheduleName, backupType, and cronSchedule are required' });
  const { data, error } = await supabaseAdmin.rpc('create_backup_schedule', {
    p_schedule_name: scheduleName, p_backup_type: backupType, p_cron_schedule: cronSchedule,
    p_retention_days: retentionDays || 30, p_storage_location: storageLocation || 'supabase', p_created_by: null
  });
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user!, action: 'backup_schedule.created', entityType: 'BackupSchedule', entityId: data, module: 'admin', details: { scheduleName, backupType, cronSchedule } });
  return res.json({ success: true, scheduleId: data });
});

router.patch('/backup-schedules/:id', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { cronSchedule, retentionDays, storageLocation, isActive } = req.body;
  const updates: any = { updated_at: new Date().toISOString() };
  if (cronSchedule !== undefined) updates.cron_schedule = cronSchedule;
  if (retentionDays !== undefined) updates.retention_days = retentionDays;
  if (storageLocation !== undefined) updates.storage_location = storageLocation;
  if (isActive !== undefined) updates.is_active = isActive;
  const { data, error } = await supabaseAdmin.from('backup_schedules').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ schedule: data });
});

router.delete('/backup-schedules/:id', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { error } = await supabaseAdmin.from('backup_schedules').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Data Exports ──────────────────────────────────────────────────

const EXPORT_DATASETS: Record<string, { table: string; label: string }> = {
  guests: { table: 'guests', label: 'Guest Profiles' },
  rooms: { table: 'rooms', label: 'Rooms' },
  room_types: { table: 'room_types', label: 'Room Types' },
  reservations: { table: 'reservations', label: 'Reservations' },
  inventory: { table: 'inventory_items', label: 'Inventory Items' },
  folios: { table: 'folios', label: 'Folios' },
  audit_events: { table: 'audit_events', label: 'Audit Events' },
};

router.get('/exports/summary', authenticate, requirePermission('settings:manage'), async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const entries = await Promise.all(Object.entries(EXPORT_DATASETS).map(async ([key, ds]) => {
    try {
      const { count, error } = await supabaseAdmin!.from(ds.table).select('*', { count: 'exact', head: true });
      return [key, { label: ds.label, table: ds.table, count: error ? 0 : (count || 0) }] as const;
    } catch { return [key, { label: ds.label, table: ds.table, count: 0 }] as const; }
  }));
  return res.json({ datasets: Object.fromEntries(entries) });
});

router.get('/exports/:dataset', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const ds = EXPORT_DATASETS[req.params.dataset];
  if (!ds) return res.status(404).json({ error: 'Unknown export dataset' });
  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 5000, 1), 20000);
  const { data, error, count } = await supabaseAdmin.from(ds.table).select('*', { count: 'exact' }).limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  const total = count ?? (data || []).length;
  return res.json({
    dataset: req.params.dataset, label: ds.label, table: ds.table,
    rows: data || [], count: total, returned: (data || []).length,
    truncated: total > (data || []).length, exportedAt: new Date().toISOString(),
  });
});

// ── API Key Management ─────────────────────────────────────────────

router.get('/api-keys', authenticate, requirePermission('settings:manage'), async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.from('api_keys').select('id, key_prefix, name, scopes, rate_limit, created_by, created_at, expires_at, last_used, disabled').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ keys: data || [] });
});

router.post('/api-keys', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { name, scopes, rateLimit, expiresAt } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const rawKey = `seleda_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 12);
  const { data, error } = await supabaseAdmin.from('api_keys').insert({
    key_hash: keyHash, key_prefix: keyPrefix, name, scopes: scopes || [],
    rate_limit: rateLimit || 100, created_by: req.user?.id || null, expires_at: expiresAt || null,
  }).select('id, key_prefix, name, scopes, rate_limit, created_at, expires_at, disabled').single();
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user!, action: 'apikey.created', entityType: 'ApiKey', entityId: data.id, module: 'admin' });
  return res.json({ key: data, rawKey });
});

router.patch('/api-keys/:id', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { name, scopes, rateLimit, disabled, expiresAt } = req.body;
  const updates: any = {};
  if (name !== undefined) updates.name = name;
  if (scopes !== undefined) updates.scopes = scopes;
  if (rateLimit !== undefined) updates.rate_limit = rateLimit;
  if (disabled !== undefined) updates.disabled = disabled;
  if (expiresAt !== undefined) updates.expires_at = expiresAt;
  const { data, error } = await supabaseAdmin.from('api_keys').update(updates).eq('id', req.params.id).select('id, key_prefix, name, scopes, rate_limit, created_at, expires_at, last_used, disabled').single();
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user!, action: 'apikey.updated', entityType: 'ApiKey', entityId: req.params.id, module: 'admin' });
  return res.json({ key: data });
});

// ── Scheduler ────────────────────────────────────────────────────

router.get('/scheduler/jobs', authenticate, requirePermission('settings:manage'), async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [jobsRes, runs24h, failed24h] = await Promise.all([
    supabaseAdmin.from('scheduled_jobs').select('*').order('name'),
    supabaseAdmin.from('job_runs').select('*', { count: 'exact', head: true }).gte('created_at', since24h),
    supabaseAdmin.from('job_runs').select('*', { count: 'exact', head: true }).eq('status', 'failed').gte('created_at', since24h),
  ]);
  if (jobsRes.error) return res.status(500).json({ error: jobsRes.error.message });
  const jobs = jobsRes.data || [];
  return res.json({ jobs, stats: {
    total: jobs.length, active: jobs.filter(j => j.enabled).length,
    disabled: jobs.filter(j => !j.enabled).length,
    runs24h: runs24h.count || 0, failed24h: failed24h.count || 0,
  }});
});

router.post('/scheduler/jobs', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { name, type, scheduleCron, config, enabled = true } = req.body || {};
  if (!name || !type || !scheduleCron) return res.status(400).json({ error: 'name, type, and scheduleCron are required' });
  if (!cron.validate(String(scheduleCron))) return res.status(400).json({ error: 'Invalid cron expression' });
  const { data, error } = await supabaseAdmin
    .from('scheduled_jobs')
    .insert({ name: String(name).trim(), type: String(type).trim(), schedule_cron: String(scheduleCron).trim(), config: config || {}, enabled: Boolean(enabled) })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user!, action: 'job.created', entityType: 'ScheduledJob', entityId: data.id, module: 'admin', details: { name: data.name, type: data.type } });
  return res.status(201).json({ job: data });
});

router.patch('/scheduler/jobs/:id', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { name, scheduleCron, config, enabled } = req.body;
  if (scheduleCron !== undefined && !cron.validate(String(scheduleCron))) return res.status(400).json({ error: 'Invalid cron expression' });
  const updates: any = {};
  if (name !== undefined) updates.name = name;
  if (scheduleCron !== undefined) updates.schedule_cron = scheduleCron;
  if (config !== undefined) updates.config = config;
  if (enabled !== undefined) updates.enabled = enabled;
  const { data, error } = await supabaseAdmin.from('scheduled_jobs').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user!, action: 'job.updated', entityType: 'ScheduledJob', entityId: req.params.id, module: 'admin' });
  return res.json({ job: data });
});

router.delete('/scheduler/jobs/:id', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { error } = await supabaseAdmin.from('scheduled_jobs').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user!, action: 'job.deleted', entityType: 'ScheduledJob', entityId: req.params.id, module: 'admin' });
  return res.json({ success: true });
});

router.post('/scheduler/jobs/:id/trigger', authenticate, requirePermission('settings:manage'), async (req, res) => {
  try {
    const { triggerJobManually } = require('../scheduler');
    const result = await triggerJobManually(req.params.id);
    await writeAuditEvent({ req, user: req.user!, action: 'job.triggered', entityType: 'ScheduledJob', entityId: req.params.id, module: 'admin' });
    return res.json(result);
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});

router.get('/scheduler/jobs/:id/runs', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.from('job_runs').select('*').eq('job_id', req.params.id).order('created_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ runs: data || [] });
});

// ── Compliance Center ──────────────────────────────────────────────

router.get('/compliance/consent-logs', authenticate, requirePermission('settings:manage'), async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.from('consent_logs').select('*').order('timestamp', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ logs: data || [] });
});

router.get('/compliance/retention-policies', authenticate, requirePermission('settings:manage'), async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.from('data_retention_policies').select('*').order('table_name');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ policies: data || [] });
});

router.patch('/compliance/retention-policies/:id', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { retentionDays, action, enabled } = req.body;
  const updates: any = {};
  if (retentionDays !== undefined) updates.retention_days = retentionDays;
  if (action !== undefined) updates.action = action;
  if (enabled !== undefined) updates.enabled = enabled;
  const { data, error } = await supabaseAdmin.from('data_retention_policies').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ policy: data });
});

router.post('/compliance/pii-export', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { targetEntity } = req.body;
  if (!targetEntity) return res.status(400).json({ error: 'targetEntity is required' });
  const [guests, reservations, folios, folioLines] = await Promise.all([
    supabaseAdmin.from('guests').select('*').eq('id', targetEntity).single(),
    supabaseAdmin.from('reservations').select('*').eq('guest_id', targetEntity),
    supabaseAdmin.from('folios').select('*').eq('owner_id', targetEntity),
    supabaseAdmin.from('folio_lines').select('*').eq('reservation_id', targetEntity),
  ]);
  const exportData = { guest: guests.data, reservations: reservations.data, folios: folios.data, folioLines: folioLines.data, exportedAt: new Date().toISOString() };
  await supabaseAdmin.from('pii_export_requests').insert({ requested_by: req.user?.id || null, target_entity: targetEntity, status: 'completed', exported_at: new Date().toISOString() });
  await writeAuditEvent({ req, user: req.user!, action: 'pii.exported', entityType: 'Guest', entityId: targetEntity, module: 'compliance' });
  return res.json({ success: true, data: exportData });
});

router.post('/compliance/pii-erasure', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { targetEntity } = req.body;
  if (!targetEntity) return res.status(400).json({ error: 'targetEntity is required' });
  const { error: guestError } = await supabaseAdmin.from('guests').update({
    first_name: '[ANONYMIZED]', last_name: '[ANONYMIZED]', email: null, phone: null, address: null, passport_number: null, nationality: null,
  }).eq('id', targetEntity);
  if (guestError) return res.status(500).json({ error: guestError.message });
  await supabaseAdmin.from('pii_erasure_requests').insert({ requested_by: req.user?.id || null, target_entity: targetEntity, status: 'completed', erased_at: new Date().toISOString() });
  await writeAuditEvent({ req, user: req.user!, action: 'pii.erased', entityType: 'Guest', entityId: targetEntity, module: 'compliance' });
  return res.json({ success: true });
});

router.get('/compliance/requests', authenticate, requirePermission('settings:manage'), async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const [exports, erasures] = await Promise.all([
    supabaseAdmin.from('pii_export_requests').select('*').order('created_at', { ascending: false }).limit(50),
    supabaseAdmin.from('pii_erasure_requests').select('*').order('created_at', { ascending: false }).limit(50),
  ]);
  return res.json({ exports: exports.data || [], erasures: erasures.data || [] });
});

// ── Health Monitoring ──────────────────────────────────────────────

router.get('/health/error-logs', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const level = req.query.level as string || 'all';
  let query = supabaseAdmin.from('error_logs').select('*').order('timestamp', { ascending: false }).limit(100);
  if (level !== 'all') query = query.eq('level', level);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ logs: data || [] });
});

// DB stats: live census of every relation exposed by PostgREST
const DB_STATS_TTL_MS = 10 * 60_000;
const DB_RELATIONS_TTL_MS = 5 * 60_000;
const DB_STATS_DEADLINE_MS = 90_000;
const DB_STATS_CONCURRENCY = 12;
let dbStatsCache: { at: number; payload: any } | null = null;
let dbRelationsCache: { at: number; names: string[] } | null = null;

async function listPublicRelations(): Promise<string[]> {
  const now = Date.now();
  if (dbRelationsCache && now - dbRelationsCache.at < DB_RELATIONS_TTL_MS) return dbRelationsCache.names;
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const specRes = await fetch(`${supabaseUrl}/rest/v1/`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!specRes.ok) throw new Error(`Schema spec request failed (${specRes.status})`);
  const spec = await specRes.json();
  const names = Object.keys(spec.paths || {})
    .filter(p => !p.startsWith('/rpc/'))
    .map(p => decodeURIComponent(p.slice(1)))
    .filter(Boolean);
  dbRelationsCache = { at: Date.now(), names };
  return names;
}

router.get('/health/db-stats', authenticate, requireSuperAdmin, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  if (dbStatsCache && Date.now() - dbStatsCache.at < DB_STATS_TTL_MS) return res.json(dbStatsCache.payload);
  try {
    const relations = await listPublicRelations();
    const counts: Record<string, number> = {};
    const deadline = Date.now() + DB_STATS_DEADLINE_MS;
    let cursor = 0;
    await Promise.all(Array.from({ length: DB_STATS_CONCURRENCY }, async () => {
      while (cursor < relations.length && Date.now() < deadline) {
        const name = relations[cursor++];
        try {
          const { count, error } = await supabaseAdmin!.from(name).select('*', { count: 'exact', head: true });
          if (!error) counts[name] = count || 0;
        } catch { /* skip */ }
      }
    }));
    const counted = Object.keys(counts).length;
    const payload = {
      tableCounts: counts, totalTables: relations.length, countedTables: counted,
      partial: counted < relations.length, generatedAt: new Date().toISOString(),
    };
    dbStatsCache = { at: Date.now(), payload };
    return res.json(payload);
  } catch (err: any) { return res.status(500).json({ error: err?.message || 'Failed to load database stats' }); }
});

router.get('/health/job-failures', authenticate, requirePermission('settings:manage'), async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.from('job_runs').select('*, scheduled_jobs(name)').eq('status', 'failed').order('created_at', { ascending: false }).limit(20);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ failedJobs: data || [] });
});

// ── Password Reset Requests (staff self-service queue) ─────────────
// Staff submit via POST /api/auth/forgot-password; tenant admins review and
// approve here. Approving issues a temporary password with
// force_password_change = true so the staff member must set a real password
// at first login (ForcedPasswordChangeScreen).

// Tenant whose queue the caller may manage: subdomain tenant wins, else the
// caller's active tenant.
function callerTenantId(req: any): string | null {
  return req.tenant?.id || req.user?.activeTenantId || null;
}

// Enrich reset-request rows with requester + resolver user info.
async function enrichResetRequests(rows: any[]) {
  const requests = rows || [];
  const userIds = [...new Set(requests.flatMap((r: any) => [r.user_id, r.resolved_by].filter(Boolean)))];
  const { data: users } = userIds.length
    ? await supabaseAdmin!.from('system_users').select('id, name, email, username, role').in('id', userIds)
    : { data: [] };
  const userById = new Map((users || []).map((u: any) => [u.id, u]));
  return requests.map((r: any) => ({
    ...r,
    user: userById.get(r.user_id) || null,
    resolvedBy: r.resolved_by ? userById.get(r.resolved_by) || null : null,
  }));
}

// Shared approve flow: issue a temporary password (force_password_change),
// dispatch via the configured providers, mark the request fulfilled.
// Returns { ok:false, status, error } on failure or { ok:true, tempPassword, delivery }.
async function approveResetRequest(
  request: any,
  method: string,
  req: any
): Promise<{ ok: boolean; status?: number; error?: string; tempPassword?: string; delivery?: any }> {
  const { data: user } = await supabaseAdmin!
    .from('system_users')
    .select('id, name, email, username, mobile_number, status')
    .eq('id', request.user_id)
    .maybeSingle();
  if (!user) return { ok: false, status: 404, error: 'User not found' };
  if (user.status !== 'Active') {
    return { ok: false, status: 400, error: `Cannot reset password for a ${user.status} account` };
  }

  // Tenant name for the message — request.tenant_id is authoritative since
  // platform approvals happen on the admin subdomain (no req.tenant).
  let tenantName = req.tenant?.name || '';
  if (!tenantName && request.tenant_id) {
    const { data: t } = await supabaseAdmin!
      .from('tenants')
      .select('name')
      .eq('id', request.tenant_id)
      .maybeSingle();
    tenantName = t?.name || '';
  }

  // Temporary password — the user is forced to replace it on first login.
  const tempPassword = `Tmp-${crypto.randomBytes(4).toString('base64url')}`;
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  const { error: updateError } = await supabaseAdmin!
    .from('system_users')
    .update({
      password_hash: passwordHash,
      password_updated_at: new Date().toISOString(),
      force_password_change: true,
      failed_login_count: 0,
      locked_until: null,
      password_reset_token: null,
      password_reset_expires: null,
    })
    .eq('id', user.id);
  if (updateError) return { ok: false, status: 500, error: updateError.message };

  // Dispatch via configured providers. 'manual' skips delivery — the admin
  // copies the returned tempPassword and sends it themselves.
  const delivery: Record<string, any> = { method };
  const message = `Your temporary ${tenantName ? `${tenantName} ` : ''}ERP password is: ${tempPassword}. You will be required to set a new password when you sign in.`;

  if (method === 'email' || method === 'both') {
    if (user.email) {
      delivery.email = await dispatchEmail(
        `Temporary password — ${tenantName || 'ERP'}`,
        `<p>${message}</p><p style="color:#64748b;font-size:12px">If you did not request this, contact your administrator.</p>`,
        [user.email],
      );
    } else {
      delivery.email = { provider: 'none', delivered: 0, failed: 0, reason: 'user has no email' };
    }
  }
  if (method === 'sms' || method === 'both') {
    if (user.mobile_number) {
      delivery.sms = await dispatchSMS(message, [user.mobile_number]);
    } else {
      delivery.sms = { provider: 'none', delivered: 0, failed: 0, reason: 'user has no mobile number' };
    }
  }

  const { error: resolveError } = await supabaseAdmin!
    .from('password_reset_requests')
    .update({
      status: 'fulfilled',
      resolved_at: new Date().toISOString(),
      resolved_by: req.user!.id,
      delivery_method: method,
      delivery_result: delivery,
    })
    .eq('id', request.id);
  if (resolveError) console.error('Failed to mark reset request fulfilled:', resolveError);

  await writeAuditEvent({
    req,
    user: req.user!,
    action: 'password.reset_request_approved',
    entityType: 'password_reset_request',
    entityId: request.id,
    module: 'admin',
    details: { userId: user.id, method, delivery, audience: request.audience || 'tenant' },
  });

  return { ok: true, tempPassword, delivery };
}

// Shared cancel flow.
async function cancelResetRequest(requestId: string, req: any): Promise<{ ok: boolean; status?: number; error?: string }> {
  const { error } = await supabaseAdmin!
    .from('password_reset_requests')
    .update({
      status: 'cancelled',
      resolved_at: new Date().toISOString(),
      resolved_by: req.user!.id,
    })
    .eq('id', requestId);
  if (error) return { ok: false, status: 500, error: error.message };

  await writeAuditEvent({
    req,
    user: req.user!,
    action: 'password.reset_request_cancelled',
    entityType: 'password_reset_request',
    entityId: requestId,
    module: 'admin',
  });
  return { ok: true };
}

function parseDeliveryMethod(body: any): string {
  return ['email', 'sms', 'both', 'manual'].includes(body?.method) ? body.method : 'both';
}

// ── Tenant queue (tenant admins, users:manage) ─────────────────────

router.get('/password-reset-requests', authenticate, requirePermission('users:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  const tenantId = callerTenantId(req);
  if (!tenantId) return res.json({ requests: [] });

  try {
    const { data: rows, error } = await supabaseAdmin
      .from('password_reset_requests')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('audience', 'tenant')
      .order('requested_at', { ascending: false })
      .limit(200);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ requests: await enrichResetRequests(rows || []) });
  } catch (error) {
    console.error('Error listing password reset requests:', error);
    res.status(500).json({ error: 'Failed to load password reset requests' });
  }
});

router.post('/password-reset-requests/:id/approve', authenticate, requirePermission('users:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  const tenantId = callerTenantId(req);
  if (!tenantId) return res.status(400).json({ error: 'No tenant context' });

  try {
    const { data: request, error: fetchError } = await supabaseAdmin
      .from('password_reset_requests')
      .select('*')
      .eq('id', req.params.id)
      .eq('tenant_id', tenantId)
      .eq('audience', 'tenant')
      .maybeSingle();
    if (fetchError || !request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'pending') {
      return res.status(409).json({ error: `Request already ${request.status}` });
    }

    const result = await approveResetRequest(request, parseDeliveryMethod(req.body), req);
    if (!result.ok) return res.status(result.status || 500).json({ error: result.error });
    res.json({ success: true, tempPassword: result.tempPassword, delivery: result.delivery });
  } catch (error) {
    console.error('Error approving password reset request:', error);
    res.status(500).json({ error: 'Failed to approve password reset request' });
  }
});

router.post('/password-reset-requests/:id/cancel', authenticate, requirePermission('users:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  const tenantId = callerTenantId(req);
  if (!tenantId) return res.status(400).json({ error: 'No tenant context' });

  try {
    const { data: request } = await supabaseAdmin
      .from('password_reset_requests')
      .select('id, status')
      .eq('id', req.params.id)
      .eq('tenant_id', tenantId)
      .eq('audience', 'tenant')
      .maybeSingle();
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'pending') {
      return res.status(409).json({ error: `Request already ${request.status}` });
    }

    const result = await cancelResetRequest(request.id, req);
    if (!result.ok) return res.status(result.status || 500).json({ error: result.error });
    res.json({ success: true });
  } catch (error) {
    console.error('Error cancelling password reset request:', error);
    res.status(500).json({ error: 'Failed to cancel password reset request' });
  }
});

// ── Platform queue (platform super-admins on admin.<domain>) ───────
// Admin-role users' reset requests land here — their own tenant admins may
// be the reason they can't sign in.

// The platform queue is cross-tenant: lift the ALS tenant scope installed by
// resolveTenant/authenticate so the supabaseAdmin interceptor doesn't filter
// rows down to the caller's active tenant.
const bypassTenantScope = (_req: any, _res: any, next: any) => {
  const store = getTenantStore();
  if (store) store.scope = null;
  next();
};

router.get('/platform-password-reset-requests', authenticate, requireSuperAdmin, bypassTenantScope, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  try {
    const { data: rows, error } = await supabaseAdmin
      .from('password_reset_requests')
      .select('*')
      .eq('audience', 'platform')
      .order('requested_at', { ascending: false })
      .limit(200);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ requests: await enrichResetRequests(rows || []) });
  } catch (error) {
    console.error('Error listing platform password reset requests:', error);
    res.status(500).json({ error: 'Failed to load password reset requests' });
  }
});

router.post('/platform-password-reset-requests/:id/approve', authenticate, requireSuperAdmin, bypassTenantScope, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  try {
    const { data: request, error: fetchError } = await supabaseAdmin
      .from('password_reset_requests')
      .select('*')
      .eq('id', req.params.id)
      .eq('audience', 'platform')
      .maybeSingle();
    if (fetchError || !request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'pending') {
      return res.status(409).json({ error: `Request already ${request.status}` });
    }

    const result = await approveResetRequest(request, parseDeliveryMethod(req.body), req);
    if (!result.ok) return res.status(result.status || 500).json({ error: result.error });
    res.json({ success: true, tempPassword: result.tempPassword, delivery: result.delivery });
  } catch (error) {
    console.error('Error approving platform password reset request:', error);
    res.status(500).json({ error: 'Failed to approve password reset request' });
  }
});

router.post('/platform-password-reset-requests/:id/cancel', authenticate, requireSuperAdmin, bypassTenantScope, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  try {
    const { data: request } = await supabaseAdmin
      .from('password_reset_requests')
      .select('id, status')
      .eq('id', req.params.id)
      .eq('audience', 'platform')
      .maybeSingle();
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'pending') {
      return res.status(409).json({ error: `Request already ${request.status}` });
    }

    const result = await cancelResetRequest(request.id, req);
    if (!result.ok) return res.status(result.status || 500).json({ error: result.error });
    res.json({ success: true });
  } catch (error) {
    console.error('Error cancelling platform password reset request:', error);
    res.status(500).json({ error: 'Failed to cancel password reset request' });
  }
});

export default router;

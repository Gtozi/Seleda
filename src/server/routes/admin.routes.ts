/**
 * Admin Routes
 * Super-admin only routes for platform management
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { writeAuditEvent, processApiIntegrationsOnRead, processApiIntegrationsOnWrite } from '../services/sessionService';
import { userApiSchema, roleApiSchema } from '../../schemas/userSchema';
import { processBackupJob, startBackupWorker } from '../services/backupService';
import { validatePassword } from '../../lib/passwordPolicy';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const router = Router();

startBackupWorker();

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

// Completely delete a user from system_users and all tenant assignments (super-admin only)
router.delete('/users/:userId', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { userId } = req.params;

  if (userId === req.user?.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

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

    // Delete all tenant assignments first
    await supabaseAdmin
      .from('tenant_user_assignments')
      .delete()
      .eq('user_id', userId);

    // Delete user sessions
    await supabaseAdmin
      .from('user_sessions')
      .delete()
      .eq('user_id', userId);

    // Delete the user from system_users
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

// Get portal settings for a tenant (super-admin only)
router.get('/tenants/:tenantId/portal-settings', authenticate, requireSuperAdmin, async (req, res) => {
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

    const flags = resolveTenantPortalFlags(globalSettings, tenant.settings);
    res.json({
      settings: flags.portalSettings,
      effective: {
        publicPortalEnabled: flags.publicPortalEnabled,
        publicBookingEnabled: flags.publicBookingEnabled,
        guestPortalEnabled: flags.guestPortalEnabled,
      },
      globalDefaults: {
        publicBookingEnabled: (globalSettings?.public_booking_enabled ?? true) !== false && globalSettings?.module_toggles?.public_booking !== false,
        guestPortalEnabled: (globalSettings?.guest_portal_enabled ?? true) !== false && globalSettings?.module_toggles?.guest !== false,
      },
    });
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
  const { enabled, customDomain, features, publicBookingEnabled, guestPortalEnabled } = req.body || {};

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
    const updatedPortalSettings: Record<string, any> = { ...(currentSettings.portal || {}) };
    const updatedModuleToggles: Record<string, boolean> = { ...(currentSettings.moduleToggles || {}) };

    if (enabled !== undefined) {
      if (enabled === null) delete updatedPortalSettings.enabled;
      else updatedPortalSettings.enabled = Boolean(enabled);
    }
    if (customDomain !== undefined) {
      const trimmed = typeof customDomain === 'string' ? customDomain.trim() : '';
      if (!trimmed) delete updatedPortalSettings.customDomain;
      else updatedPortalSettings.customDomain = trimmed;
    }
    if (features !== undefined && typeof features === 'object') {
      updatedPortalSettings.features = features;
    }
    if (publicBookingEnabled !== undefined) {
      if (publicBookingEnabled === null) {
        delete updatedPortalSettings.publicBookingEnabled;
        delete updatedModuleToggles.public_booking;
      } else {
        const val = Boolean(publicBookingEnabled);
        updatedPortalSettings.publicBookingEnabled = val;
        const globalBookingDefault = (globalSettings?.public_booking_enabled ?? true) !== false && globalSettings?.module_toggles?.public_booking !== false;
        if (val === globalBookingDefault) delete updatedModuleToggles.public_booking;
        else updatedModuleToggles.public_booking = val;
      }
    }
    if (guestPortalEnabled !== undefined) {
      if (guestPortalEnabled === null) {
        delete updatedPortalSettings.guestPortalEnabled;
        delete updatedModuleToggles.guest;
      } else {
        const val = Boolean(guestPortalEnabled);
        updatedPortalSettings.guestPortalEnabled = val;
        const globalGuestDefault = (globalSettings?.guest_portal_enabled ?? true) !== false && globalSettings?.module_toggles?.guest !== false;
        if (val === globalGuestDefault) delete updatedModuleToggles.guest;
        else updatedModuleToggles.guest = val;
      }
    }

    const updatedSettings = {
      ...currentSettings,
      portal: updatedPortalSettings,
      moduleToggles: updatedModuleToggles,
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
      action: 'tenant.portal_settings_update',
      entityType: 'tenant',
      entityId: tenantId,
      module: 'admin',
      details: { portalSettings: updatedPortalSettings },
    });

    invalidateTenantCache();
    invalidateTenantScopeCache(tenantId);

    const flags = resolveTenantPortalFlags(globalSettings, updatedSettings);
    res.json({
      tenant: updatedTenant,
      settings: flags.portalSettings,
      effective: {
        publicPortalEnabled: flags.publicPortalEnabled,
        publicBookingEnabled: flags.publicBookingEnabled,
        guestPortalEnabled: flags.guestPortalEnabled,
      },
    });
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

router.delete('/organizations/:id', authenticate, requireSuperAdmin, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { id } = req.params;

  const { count: propCount } = await supabaseAdmin
    .from('properties')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', id);

  if ((propCount || 0) > 0) {
    return res.status(400).json({ error: 'Cannot delete organization with existing properties. Migrate properties first.' });
  }

  const { error } = await supabaseAdmin.from('organizations').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
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
    const { data, error } = await supabaseAdmin.from('system_users').select('*').order('name');
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
    const password = body.password || 'ChangeMe123!';
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
    await writeAuditEvent({ req, user: req.user!, action: 'user.created', entityType: 'User', entityId: newId, module: 'admin', details: { name: body.full_name, email: body.email, role: body.role } });
    return res.json({ success: true, user: mapSystemUserFromDb(data) });
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

router.post('/users/:id/unlock', authenticate, requirePermission('users:manage'), async (req, res) => {
  const targetId = req.params.id;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('system_users')
      .update({ failed_login_count: 0, locked_until: null, mfa_locked_until: null, failed_mfa_count: 0, status: 'Active' })
      .eq('id', targetId);
    if (error) return res.status(500).json({ error: error.message });
    await writeAuditEvent({ req, user: req.user!, action: 'user.unlocked', entityType: 'User', entityId: targetId, module: 'admin' });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/users/create', authenticate, requirePermission('users:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { email, password, name, role, department, phone, forcePasswordChange, customRoleId } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'email, password, and name are required' });
  }
  const policy = await fetchPasswordPolicy();
  const passwordValidation = validatePassword(password, policy);
  if (!passwordValidation.valid) {
    return res.status(400).json({ error: passwordValidation.errors.join('; ') });
  }
  try {
    const { data, error } = await supabaseAdmin.rpc('create_system_user', {
      p_email: email.toLowerCase(), p_password: password, p_name: name,
      p_role: role || 'member', p_department: department || null,
      p_phone: phone || null, p_force_password_change: forcePasswordChange !== false
    });
    if (error) return res.status(500).json({ error: error.message });
    if (customRoleId && data?.system_user_id) {
      let roleDesc = role || 'member';
      try {
        const { data: roleData } = await supabaseAdmin.from('roles')
          .select('display_name, role_label, name').eq('id', customRoleId).maybeSingle();
        if (roleData) roleDesc = roleData.role_label || roleData.display_name || roleData.name;
      } catch (e) { console.error('Failed to fetch custom role:', e); }
      await supabaseAdmin.from('system_users').update({ custom_role_id: customRoleId, role_description: roleDesc }).eq('id', data.system_user_id);
      try { await supabaseAdmin.from('user_roles').upsert({ user_id: data.system_user_id, role_id: customRoleId }); } catch (e) { console.error('Failed to assign user_roles:', e); }
    }
    await writeAuditEvent({ req, user: req.user!, action: 'user.created', entityType: 'User', entityId: data?.system_user_id, module: 'admin', details: { name, email, role, customRoleId } });
    return res.json({ success: true, user: data });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});

// ── Roles ──────────────────────────────────────────────────────

router.get('/roles', authenticate, requirePermission('roles:manage'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin
      .from('roles')
      .select('id, name, display_name, description, is_superuser, is_system, is_active, category, department, role_label, parent_role_id, module_access, permissions, role_permissions ( permissions ( code ) )')
      .order('name');
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

// ── Custom Roles ────────────────────────────────────────────────

router.get('/custom-roles', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.from('roles').select('*').eq('is_system', false).order('name');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ roles: data || [] });
});

router.post('/custom-roles', authenticate, requirePermission('roles:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { name, displayName, description, category, permissions } = req.body;
  if (!name || !displayName) return res.status(400).json({ error: 'name and displayName are required' });
  try {
    const roleId = `ROLE-${Date.now()}`;
    const { data, error } = await supabaseAdmin.from('roles').insert({
      id: roleId, name, display_name: displayName, description: description || '',
      category: category || 'custom', permissions: permissions || {},
      is_system: false, is_superuser: false, is_active: true, created_by: req.user?.id || null
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    if (permissions) {
      const permCodes: string[] = Array.isArray(permissions) ? permissions : Object.values(permissions).flat() as string[];
      await syncRolePermissions(roleId, permCodes, supabaseAdmin);
    }
    await writeAuditEvent({ req, user: req.user!, action: 'role.created', entityType: 'Role', entityId: roleId, module: 'admin', details: { name, displayName, category } });
    return res.json({ success: true, roleId });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});

router.patch('/custom-roles/:id', authenticate, requirePermission('roles:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const roleId = req.params.id;
  const { displayName, description, category, permissions, isActive } = req.body;
  const updates: any = {};
  if (displayName !== undefined) updates.display_name = displayName;
  if (description !== undefined) updates.description = description;
  if (category !== undefined) updates.category = category;
  if (permissions !== undefined) updates.permissions = permissions;
  if (isActive !== undefined) updates.is_active = isActive;
  updates.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('roles').update(updates).eq('id', roleId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user!, action: 'role.updated', entityType: 'Role', entityId: roleId, module: 'admin', details: { updates: Object.keys(updates) } });
  return res.json({ success: true, role: data });
});

router.delete('/custom-roles/:id', authenticate, requirePermission('roles:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const roleId = req.params.id;
  const { data: roleData } = await supabaseAdmin.from('roles').select('is_system').eq('id', roleId).single();
  if (roleData?.is_system) return res.status(403).json({ error: 'Cannot delete system roles' });
  await supabaseAdmin.from('role_permissions').delete().eq('role_id', roleId);
  const { error } = await supabaseAdmin.from('roles').delete().eq('id', roleId);
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user!, action: 'role.deleted', entityType: 'Role', entityId: roleId, module: 'admin' });
  return res.json({ success: true });
});

// ── User Role Assignments ────────────────────────────────────────

router.get('/users/:userId/roles', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.rpc('get_user_roles', { p_user_id: req.params.userId });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ roles: data || [] });
});

router.post('/users/:userId/roles', authenticate, requirePermission('roles:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { roleId, propertyId, organizationId, expiresAt } = req.body;
  if (!roleId) return res.status(400).json({ error: 'roleId is required' });
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

router.delete('/users/:userId/roles/:assignmentId', authenticate, requirePermission('roles:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { error } = await supabaseAdmin.from('user_role_assignments').update({ is_active: false }).eq('id', req.params.assignmentId);
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user!, action: 'role.unassigned', entityType: 'UserRoleAssignment', entityId: req.params.assignmentId, module: 'admin' });
  return res.json({ success: true });
});

// ── Module Registry ──────────────────────────────────────────────

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

router.post('/modules', authenticate, requirePermission('roles:manage'), async (req, res) => {
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

router.patch('/modules/:id', authenticate, requirePermission('roles:manage'), async (req, res) => {
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

router.delete('/modules/:id', authenticate, requirePermission('roles:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { error } = await supabaseAdmin.from('modules').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user!, action: 'module.deleted', entityType: 'Module', entityId: req.params.id, module: 'admin' });
  return res.json({ success: true });
});

// ── Permission Categories ────────────────────────────────────────

router.get('/permission-categories', authenticate, requirePermission('roles:manage'), async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.from('permission_categories').select('*').order('sort_order');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ categories: data || [] });
});

router.post('/permission-categories', authenticate, requirePermission('roles:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { id, label, icon, actions, sortOrder } = req.body;
  if (!id || !label) return res.status(400).json({ error: 'id and label are required' });
  const { data, error } = await supabaseAdmin.from('permission_categories').upsert({
    id, label, icon: icon || '📋', actions: actions || [], sort_order: sortOrder || 0,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ category: data });
});

router.patch('/permission-categories/:id', authenticate, requirePermission('roles:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { label, icon, actions, sortOrder } = req.body;
  const updates: any = {};
  if (label !== undefined) updates.label = label;
  if (icon !== undefined) updates.icon = icon;
  if (actions !== undefined) updates.actions = actions;
  if (sortOrder !== undefined) updates.sort_order = sortOrder;
  const { data, error } = await supabaseAdmin.from('permission_categories').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ category: data });
});

router.delete('/permission-categories/:id', authenticate, requirePermission('roles:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { error } = await supabaseAdmin.from('permission_categories').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

router.post('/department-permission-categories', authenticate, requirePermission('roles:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { department, categoryId } = req.body;
  if (!department || !categoryId) return res.status(400).json({ error: 'department and categoryId are required' });
  const { data, error } = await supabaseAdmin.from('department_permission_categories').upsert({ department, category_id: categoryId }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ mapping: data });
});

router.delete('/department-permission-categories', authenticate, requirePermission('roles:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { department, categoryId } = req.body;
  if (!department || !categoryId) return res.status(400).json({ error: 'department and categoryId are required' });
  const { error } = await supabaseAdmin.from('department_permission_categories').delete().eq('department', department).eq('category_id', categoryId);
  if (error) return res.status(500).json({ error: error.message });
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

router.get('/organizations', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.from('organizations').select('*').order('org_name');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ organizations: data || [] });
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

router.get('/properties', authenticate, async (_req, res) => {
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

router.get('/properties/:id/footprint', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  return res.json({ footprint: await erpPropertyFootprint(req.params.id) });
});

// ── Settings ───────────────────────────────────────────────────

router.get('/settings', authenticate, requirePermission('settings:update'), async (_req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const data = await getGlobalSettings();
    if (data) {
      const encryptedIntegrations = data.encrypted_api_integrations || data.api_integrations;
      data.api_integrations = processApiIntegrationsOnRead(encryptedIntegrations);
      if (data.encrypted_api_integrations) data.encrypted_api_integrations = undefined;
    }
    return res.json({ settings: data ? snakeToCamelRecord(data) : {} });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/settings', authenticate, requirePermission('settings:update'), async (req, res) => {
  const updates = await filterKnownColumns(camelToSnakeRecord(req.body || {}));
  if (updates.api_integrations) {
    try {
      const encrypted = processApiIntegrationsOnWrite(updates.api_integrations);
      updates.encrypted_api_integrations = encrypted;
      updates.api_integrations = [];
    } catch (e) { console.error('[CRYPTO] Failed to encrypt API integrations on write:', e); }
  }
  if (hasSupabaseAdminConfig && supabaseAdmin) {
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
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// ── Pending Admin Changes — Executive Governance Approval Queue ──

router.get('/pending-changes', authenticate, async (_req, res) => {
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

router.get('/backups', authenticate, async (req, res) => {
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

router.get('/backups/:id/download', authenticate, async (req, res) => {
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

router.get('/backups/statistics', authenticate, async (_req, res) => {
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

router.get('/backups/restorations', authenticate, async (_req, res) => {
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

router.get('/backup-schedules', authenticate, async (_req, res) => {
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

router.get('/exports/summary', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const entries = await Promise.all(Object.entries(EXPORT_DATASETS).map(async ([key, ds]) => {
    try {
      const { count, error } = await supabaseAdmin!.from(ds.table).select('*', { count: 'exact', head: true });
      return [key, { label: ds.label, table: ds.table, count: error ? 0 : (count || 0) }] as const;
    } catch { return [key, { label: ds.label, table: ds.table, count: 0 }] as const; }
  }));
  return res.json({ datasets: Object.fromEntries(entries) });
});

router.get('/exports/:dataset', authenticate, async (req, res) => {
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

router.get('/api-keys', authenticate, async (_req, res) => {
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

// ── Scheduler (Legacy + Enhanced) ─────────────────────────────────

router.get('/scheduler/jobs', authenticate, async (_req, res) => {
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

router.patch('/scheduler/jobs/:id', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { name, scheduleCron, config, enabled } = req.body;
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

router.post('/scheduler/jobs/:id/trigger', authenticate, requirePermission('settings:manage'), async (req, res) => {
  try {
    const { triggerJobManually } = require('../scheduler');
    const result = await triggerJobManually(req.params.id);
    await writeAuditEvent({ req, user: req.user!, action: 'job.triggered', entityType: 'ScheduledJob', entityId: req.params.id, module: 'admin' });
    return res.json(result);
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});

router.get('/scheduler/jobs/:id/runs', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.from('job_runs').select('*').eq('job_id', req.params.id).order('created_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ runs: data || [] });
});

router.get('/scheduler/jobs-enhanced', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.from('scheduled_jobs_enhanced').select('*').order('next_run_at', { ascending: true, nullsFirst: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ jobs: data || [] });
});

router.post('/scheduler/jobs', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { jobName, jobType, jobHandler, scheduleCron, config, priority, timeoutSeconds, retryPolicy } = req.body;
  if (!jobName || !jobType || !jobHandler || !scheduleCron) return res.status(400).json({ error: 'jobName, jobType, jobHandler, and scheduleCron are required' });
  const { data, error } = await supabaseAdmin.from('scheduled_jobs_enhanced').insert({
    job_name: jobName, job_type: jobType, job_handler: jobHandler, schedule_cron: scheduleCron,
    config: config || {}, priority: priority || 5, timeout_seconds: timeoutSeconds || 300,
    retry_policy: retryPolicy || { max_retries: 3, retry_delay_seconds: 60 },
    enabled: true, created_by: req.user?.id || null, next_run_at: null
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user!, action: 'scheduled_job.created', entityType: 'ScheduledJob', entityId: data.id, module: 'admin', details: { jobName, jobType, scheduleCron } });
  return res.json({ job: data });
});

router.patch('/scheduler/jobs-enhanced/:id', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { jobName, jobHandler, scheduleCron, config, enabled, priority, timeoutSeconds, retryPolicy } = req.body;
  const updates: any = { updated_at: new Date().toISOString() };
  if (jobName !== undefined) updates.job_name = jobName;
  if (jobHandler !== undefined) updates.job_handler = jobHandler;
  if (scheduleCron !== undefined) updates.schedule_cron = scheduleCron;
  if (config !== undefined) updates.config = config;
  if (enabled !== undefined) updates.enabled = enabled;
  if (priority !== undefined) updates.priority = priority;
  if (timeoutSeconds !== undefined) updates.timeout_seconds = timeoutSeconds;
  if (retryPolicy !== undefined) updates.retry_policy = retryPolicy;
  const { data, error } = await supabaseAdmin.from('scheduled_jobs_enhanced').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ job: data });
});

router.delete('/scheduler/jobs/:id', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { error } = await supabaseAdmin.from('scheduled_jobs_enhanced').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

router.post('/scheduler/jobs-enhanced/:id/trigger', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.rpc('enqueue_job', {
    p_job_id: req.params.id, p_priority: req.body.priority || 5, p_scheduled_for: new Date().toISOString()
  });
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user!, action: 'scheduled_job.triggered', entityType: 'ScheduledJob', entityId: req.params.id, module: 'admin' });
  return res.json({ success: true, queueId: data });
});

router.get('/scheduler/jobs-enhanced/:id/runs', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.from('job_runs_enhanced').select('*').eq('job_id', req.params.id).order('started_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ runs: data || [] });
});

router.get('/scheduler/queue', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.from('job_execution_queue').select('*, scheduled_jobs_enhanced(job_name, job_type)').order('priority', { ascending: true }).limit(100);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ queue: data || [] });
});

router.post('/scheduler/enqueue-due', authenticate, requirePermission('settings:manage'), async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.rpc('enqueue_due_jobs');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, enqueuedCount: data });
});

router.get('/scheduler/statistics', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.rpc('get_job_statistics');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ statistics: data });
});

// ── Compliance Center ──────────────────────────────────────────────

router.get('/compliance/consent-logs', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.from('consent_logs').select('*').order('timestamp', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ logs: data || [] });
});

router.get('/compliance/retention-policies', authenticate, async (_req, res) => {
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

router.get('/compliance/requests', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const [exports, erasures] = await Promise.all([
    supabaseAdmin.from('pii_export_requests').select('*').order('created_at', { ascending: false }).limit(50),
    supabaseAdmin.from('pii_erasure_requests').select('*').order('created_at', { ascending: false }).limit(50),
  ]);
  return res.json({ exports: exports.data || [], erasures: erasures.data || [] });
});

// ── Health Monitoring ──────────────────────────────────────────────

router.get('/health/error-logs', authenticate, async (req, res) => {
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

router.get('/health/db-stats', authenticate, async (_req, res) => {
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

router.get('/health/job-failures', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.from('job_runs').select('*, scheduled_jobs(name)').eq('status', 'failed').order('created_at', { ascending: false }).limit(20);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ failedJobs: data || [] });
});

router.get('/health/status', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.rpc('get_system_health');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ healthStatus: data || [] });
});

router.post('/health/check', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { checkType, checkName, status, responseTimeMs, details } = req.body;
  if (!checkType || !checkName || !status) return res.status(400).json({ error: 'checkType, checkName, and status are required' });
  const { data, error } = await supabaseAdmin.rpc('record_health_check', {
    p_check_type: checkType, p_check_name: checkName, p_status: status,
    p_response_time_ms: responseTimeMs || null, p_details: details || null
  });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, checkId: data });
});

router.get('/health/alerts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const acknowledged = req.query.acknowledged === 'true';
  const { data, error } = await supabaseAdmin.from('health_alerts').select('*, health_alert_rules(*)').eq('acknowledged', acknowledged).order('created_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ alerts: data || [] });
});

router.patch('/health/alerts/:id/acknowledge', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { error } = await supabaseAdmin.from('health_alerts').update({
    acknowledged: true, acknowledged_by: req.user?.id, acknowledged_at: new Date().toISOString()
  }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

router.get('/health/alert-rules', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.from('health_alert_rules').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ rules: data || [] });
});

router.post('/health/alert-rules', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { checkType, checkName, condition, thresholdValue, alertSeverity, notificationChannels } = req.body;
  if (!checkType || !checkName || !condition) return res.status(400).json({ error: 'checkType, checkName, and condition are required' });
  const { data, error } = await supabaseAdmin.from('health_alert_rules').insert({
    check_type: checkType, check_name: checkName, condition, threshold_value: thresholdValue || null,
    alert_severity: alertSeverity || 'warning', notification_channels: notificationChannels || [], is_active: true
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ rule: data });
});

router.patch('/health/alert-rules/:id', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { condition, thresholdValue, alertSeverity, notificationChannels, isActive } = req.body;
  const updates: any = { updated_at: new Date().toISOString() };
  if (condition !== undefined) updates.condition = condition;
  if (thresholdValue !== undefined) updates.threshold_value = thresholdValue;
  if (alertSeverity !== undefined) updates.alert_severity = alertSeverity;
  if (notificationChannels !== undefined) updates.notification_channels = notificationChannels;
  if (isActive !== undefined) updates.is_active = isActive;
  const { data, error } = await supabaseAdmin.from('health_alert_rules').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ rule: data });
});

// ── Config Versioning ──────────────────────────────────────────────

router.get('/config-versions', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const configKey = req.query.config_key as string;
  const limit = parseInt(req.query.limit as string) || 50;
  if (configKey) {
    const { data, error } = await supabaseAdmin.rpc('get_config_history', { p_config_key: configKey, p_limit: limit });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ versions: data || [] });
  }
  const { data, error } = await supabaseAdmin.from('config_versions').select('config_key, config_type, version, created_at').order('created_at', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: error.message });
  const configMap = new Map();
  (data || []).forEach((v: any) => {
    if (!configMap.has(v.config_key) || v.version > configMap.get(v.config_key).version) configMap.set(v.config_key, v);
  });
  return res.json({ configs: Array.from(configMap.values()) });
});

router.post('/config-versions/create', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { configKey, configType, configData, changeReason } = req.body;
  if (!configKey || !configData) return res.status(400).json({ error: 'configKey and configData are required' });
  const { data, error } = await supabaseAdmin.rpc('create_config_version', {
    p_config_key: configKey, p_config_type: configType || 'manual',
    p_config_data: configData, p_changed_by: req.user?.id || null, p_change_reason: changeReason || null
  });
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user!, action: 'config.version_created', entityType: 'ConfigVersion', entityId: data, module: 'admin', details: { configKey, configType } });
  return res.json({ success: true, versionId: data });
});

router.post('/config-versions/rollback', authenticate, requirePermission('settings:manage'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { configKey, targetVersion, changeReason } = req.body;
  if (!configKey || !targetVersion) return res.status(400).json({ error: 'configKey and targetVersion are required' });
  const { data, error } = await supabaseAdmin.rpc('rollback_config_version', {
    p_config_key: configKey, p_target_version: targetVersion,
    p_changed_by: req.user?.id || null, p_change_reason: changeReason || null
  });
  if (error) return res.status(500).json({ error: error.message });
  await writeAuditEvent({ req, user: req.user!, action: 'config.rollback', entityType: 'ConfigVersion', entityId: configKey, module: 'admin', details: { configKey, targetVersion } });
  return res.json({ success: true, rolledBackData: data });
});

// ── Admin Bookings ──────────────────────────────────────────────────

// Admin atomic booking endpoint — mirrors /api/public/bookings but allows
// the front desk to specify channel/status (e.g. Walk-In → Confirmed).
router.post('/bookings', authenticate, requirePermission('reservation:create'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const payload = req.body || {};
  const required = ['p_guest_name', 'p_guest_email', 'p_check_in', 'p_check_out', 'p_items'];
  const missing = required.filter(k => !payload[k]);
  if (missing.length > 0) return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  if (!Array.isArray(payload.p_items) || payload.p_items.length === 0) return res.status(400).json({ error: 'p_items must be a non-empty array' });

  // Strip fields not accepted by create_booking_atomic; apply as follow-up updates
  const { p_voucher_code, p_voucher_discount, p_corporate_account_id, p_billing_mode, ...rpcPayload } = payload;
  const operatorId = payload.p_operator_id || null;

  const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('create_booking_atomic', rpcPayload);
  if (rpcError) {
    const msg: string = rpcError.message || '';
    console.error('Admin atomic booking RPC error:', { message: msg, details: rpcError.details, hint: rpcError.hint, code: rpcError.code });
    if (msg.includes('AVAILABILITY_ERROR:')) return res.status(409).json({ error: msg.replace('AVAILABILITY_ERROR:', '').trim() });
    return res.status(500).json({ error: 'Booking failed. Please try again.', details: msg });
  }

  const result = rpcResult as any;
  const reservationIds = result.reservationIds || [];
  const groupId = result.groupId || null;
  const firstReservationId = reservationIds[0];

  if (reservationIds.length > 0 && (p_corporate_account_id || p_billing_mode)) {
    const billingUpdate: Record<string, unknown> = {};
    if (p_corporate_account_id) billingUpdate.corporate_account_id = p_corporate_account_id;
    if (p_billing_mode) billingUpdate.billing_mode = p_billing_mode;
    const { error: billingUpdateError } = await supabaseAdmin.from('reservations').update(billingUpdate).in('id', reservationIds);
    if (billingUpdateError) console.error('Admin booking: failed to apply billing fields:', billingUpdateError.message);
  }

  if (firstReservationId && p_voucher_code) {
    try {
      const { data: redeemData, error: redeemError } = await supabaseAdmin.rpc('redeem_voucher', {
        p_voucher_no: p_voucher_code, p_reservation_id: firstReservationId,
        p_redeemed_by: req.user!.name || req.user!.email || 'staff'
      });
      if (!redeemError && redeemData) {
        const voucherDiscount = Number((redeemData as any).net_value || p_voucher_discount || 0);
        const { data: firstRes } = await supabaseAdmin.from('reservations').select('total_amount, charges').eq('id', firstReservationId).single();
        if (firstRes) {
          const newTotal = Math.max(0, Number(firstRes.total_amount) - voucherDiscount);
          const newCharges = Array.isArray(firstRes.charges) ? [...firstRes.charges] : [];
          newCharges.push({ description: 'Voucher discount', amount: -voucherDiscount, date: new Date().toISOString() });
          await supabaseAdmin.from('reservations').update({ total_amount: newTotal, charges: newCharges }).eq('id', firstReservationId);
        }
      } else if (redeemError) { console.error('Admin voucher redeem failed:', redeemError); }
    } catch (e) { console.error('Voucher redemption error:', e); }
  }

  if (firstReservationId && operatorId) {
    try {
      const { data: allotments } = await supabaseAdmin.from('allotments').select('*').eq('operator_id', operatorId).gte('stay_date', payload.p_check_in).lt('stay_date', payload.p_check_out);
      if (allotments && allotments.length > 0) {
        const checkIn = new Date(payload.p_check_in);
        const checkOut = new Date(payload.p_check_out);
        const current = new Date(checkIn);
        while (current < checkOut) {
          const dateStr = current.toISOString().split('T')[0];
          for (const item of payload.p_items) {
            const allotment = (allotments as any[]).find((a: any) => a.room_type_id === item.roomTypeId && a.stay_date === dateStr);
            if (allotment) {
              await supabaseAdmin.from('allotment_pickup_log').insert({
                allotment_id: allotment.id, reservation_id: firstReservationId, pickup_date: dateStr,
                quantity: item.qty || 1, picked_up_by: req.user!.name || req.user!.email || 'staff', notes: 'Admin group booking'
              });
            }
          }
          current.setDate(current.getDate() + 1);
        }
      }
    } catch (e) { console.error('Allotment pickup log error:', e); }
  }

  return res.json({ success: true, reservationIds, groupId, firstReservationId });
});

// ── Public Booking Content ──────────────────────────────────────────

router.patch('/public-booking-content', authenticate, requirePermission('settings:update'), async (req, res) => {
  const { publicPageContent } = req.body || {};
  if (!publicPageContent) return res.status(400).json({ error: 'publicPageContent is required' });
  const convertedContent = camelToSnakeRecord(publicPageContent);
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data: existing } = await supabaseAdmin.from('global_settings').select('id').maybeSingle();
    if (existing) {
      const { data, error } = await supabaseAdmin.from('global_settings').update({
        public_page_content: convertedContent, updated_at: new Date().toISOString(), updated_by: req.user!.id
      }).eq('id', existing.id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      invalidateGlobalSettingsCache();
      await writeAuditEvent({ req, user: req.user!, action: 'public_content.updated', entityType: 'GlobalSettings', entityId: existing.id, module: 'admin', details: { updates: 'publicPageContent' } });
      return res.json({ success: true, settings: data ? snakeToCamelRecord(data) : {} });
    } else {
      return res.status(404).json({ error: 'Global settings record not found' });
    }
  }
  return res.status(503).json({ error: 'Database not configured' });
});

export default router;

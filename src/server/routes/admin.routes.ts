/**
 * Admin Routes
 * Super-admin only routes for platform management
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { writeAuditEvent } from '../services/sessionService';

const router = Router();

// Middleware to ensure only super-admins can access
const requireSuperAdmin = async (req: any, res: any, next: any) => {
  if (!req.user?.isSuperAdmin) {
    return res.status(403).json({ error: 'Super admin access required' });
  }
  next();
};

// Get all tenants (super-admin only)
router.get('/tenants', authenticate, requireSuperAdmin, async (req, res) => {
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

  try {
    const { data: tenant, error } = await supabaseAdmin
      .from('tenants')
      .insert({
        name,
        code: code.toLowerCase(),
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
  const { name, legalName, email, phone, status, settings } = req.body || {};

  try {
    const updates: any = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
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

// Get platform statistics (super-admin only)
router.get('/stats', authenticate, requireSuperAdmin, async (req, res) => {
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

export default router;

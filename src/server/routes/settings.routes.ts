import { Router } from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { getGlobalSettings } from '../services/settingsService';
import { processApiIntegrationsOnRead } from '../services/sessionService';
import { resolveTenantPortalFlags } from '../services/sharedServices';

const router = Router();

const COMPLEXITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };

/**
 * Merge `tenants.settings.erpSettings` (snake_case) onto `global_settings`
 * while enforcing SuperAdmin hard boundaries (MFA, password complexity,
 * rotation, session timeout ceiling, platform maintenance mode).
 */
export function mergeTenantErpSettings(
  rawGlobal: Record<string, any>,
  tenantSettings: Record<string, any> | null | undefined
): Record<string, any> {
  const data: Record<string, any> = { ...rawGlobal };
  const erp = (tenantSettings?.erpSettings && typeof tenantSettings.erpSettings === 'object')
    ? tenantSettings.erpSettings
    : null;

  if (erp) {
    for (const [k, v] of Object.entries(erp)) {
      if (v !== undefined) data[k] = v;
    }
  }

  // Enforce SuperAdmin security & platform boundaries
  const globalForceMfa = Boolean(rawGlobal.force_mfa);
  const globalStrictRotation = Boolean(rawGlobal.strict_password_rotation);
  const globalMinComplexity = COMPLEXITY_RANK[rawGlobal.password_complexity] ? rawGlobal.password_complexity : 'medium';
  const globalMaxTimeout = Number(rawGlobal.session_timeout) || 0;
  const platformMaintenance = Boolean(rawGlobal.maintenance_mode);

  if (globalForceMfa) data.force_mfa = true;
  if (globalStrictRotation) data.strict_password_rotation = true;
  if ((COMPLEXITY_RANK[data.password_complexity] || 0) < COMPLEXITY_RANK[globalMinComplexity]) {
    data.password_complexity = globalMinComplexity;
  }
  if (globalMaxTimeout > 0) {
    const tenantTimeout = Number(data.session_timeout) || globalMaxTimeout;
    data.session_timeout = Math.min(tenantTimeout, globalMaxTimeout);
  }
  if (platformMaintenance) {
    data.maintenance_mode = true;
    if (rawGlobal.maintenance_message) data.maintenance_message = rawGlobal.maintenance_message;
  }

  const flags = resolveTenantPortalFlags(rawGlobal, tenantSettings);
  data.module_toggles = flags.effectiveModuleToggles;
  data.public_booking_enabled = flags.publicBookingEnabled;
  data.guest_portal_enabled = flags.guestPortalEnabled;
  data.super_admin_locked_toggles = flags.superAdminLockedToggles;
  data.super_admin_boundaries = {
    forceMfa: globalForceMfa,
    strictPasswordRotation: globalStrictRotation,
    minPasswordComplexity: globalMinComplexity,
    maxSessionTimeout: globalMaxTimeout > 0 ? globalMaxTimeout : null,
    platformMaintenanceMode: platformMaintenance,
  };

  return data;
}

// Single settings read endpoint with a lightweight checksum for stale-context detection
router.get('/', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const rawData = await getGlobalSettings();
    if (!rawData) return res.json({ settings: null, checksum: null });

    const activeTenantId = req.user?.activeTenantId || req.tenant?.id;
    let tenantSettings: Record<string, any> | null = req.tenant?.settings || null;
    if (activeTenantId && (!req.tenant || req.tenant.id !== activeTenantId)) {
      const { data: tenantRow } = await supabaseAdmin
        .from('tenants')
        .select('settings')
        .eq('id', activeTenantId)
        .maybeSingle();
      tenantSettings = tenantRow?.settings || null;
    }

    // Shallow-clone & merge tenant overrides within SuperAdmin boundaries
    const data = mergeTenantErpSettings(rawData, tenantSettings);
    data.erp_logo = rawData.erp_logo || rawData.hotel_logo || '';
    data.erp_name = rawData.erp_name || 'SELEDA';

    // Mask API keys on read — use encrypted_api_integrations if available, fall back to api_integrations
    const encryptedIntegrations = data.encrypted_api_integrations || data.api_integrations;
    data.api_integrations = processApiIntegrationsOnRead(encryptedIntegrations);
    if (data.encrypted_api_integrations) data.encrypted_api_integrations = undefined;

    // Return version and checksum in response headers (Step 2.5)
    if (data.settings_version) res.setHeader('X-Settings-Version', String(data.settings_version));
    if (data.settings_checksum) res.setHeader('X-Settings-Checksum', data.settings_checksum);

    const checksum = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
    return res.json({
      settings: data,
      checksum,
      version: data.settings_version || data.updated_at || data.created_at || null,
    });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

export default router;

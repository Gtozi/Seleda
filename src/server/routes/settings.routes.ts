import { Router } from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { getGlobalSettings } from '../services/settingsService';
import { processApiIntegrationsOnRead } from '../services/sessionService';
import { resolveTenantPortalFlags } from '../services/sharedServices';

const router = Router();

// Single settings read endpoint with a lightweight checksum for stale-context detection
router.get('/', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const rawData = await getGlobalSettings();
    if (!rawData) return res.json({ settings: null, checksum: null });

    // Shallow-clone the cached global_settings row so per-tenant toggle merging
    // and API key masking never mutate the in-memory cache across requests.
    const data: Record<string, any> = { ...rawData };

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

    const flags = resolveTenantPortalFlags(rawData, tenantSettings);
    data.module_toggles = flags.effectiveModuleToggles;
    data.public_booking_enabled = flags.publicBookingEnabled;
    data.guest_portal_enabled = flags.guestPortalEnabled;

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

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { writeAuditEvent } from '../services/sharedServices';
import { getFeatureFlags, getEnabledLocales, invalidateAdminConfigCache, getTaxRates, evaluateBusinessRules } from '../services/adminConfigService';
import { validateAction, parseCondition, resolveEffects, evaluateCondition } from '../services/ruleEngine';
import { validateSteps, advanceWorkflow } from '../services/workflowEngine';
import { getTenantPropertyIds, tenantOwnsProperty } from '../services/tenantScope';

const router = Router();

interface ResourceDef {
  table: string;
  columns: string[];
  orderBy: string;
  required?: string[];
  readOnly?: boolean;
  descending?: boolean;
  /** Table has no created_by column — don't stamp it on insert. */
  noCreatedBy?: boolean;
  validate?: (row: Record<string, any>) => string | null;
}

const tryMsg = (fn: () => void): string | null => { try { fn(); return null; } catch (e: any) { return e.message; } };

/** Whitelist of admin control-plane resources. Only listed columns are writable. */
const RESOURCES: Record<string, ResourceDef> = {
  departments: { table: 'admin_departments', columns: ['property_id', 'code', 'name', 'parent_id', 'head_name', 'cost_center', 'description', 'status'], orderBy: 'name', required: ['code', 'name'] },
  'feature-flags': { table: 'admin_feature_flags', columns: ['property_id', 'flag_key', 'name', 'description', 'enabled', 'rollout_pct', 'environment'], orderBy: 'flag_key', required: ['flag_key', 'name'] },
  'approval-rules': { table: 'admin_approval_rules', columns: ['property_id', 'name', 'entity_type', 'department', 'min_amount', 'max_amount', 'currency', 'approver_roles', 'steps', 'escalation_hours', 'active'], orderBy: 'entity_type', required: ['name', 'entity_type'] },
  workflows: { table: 'admin_workflows', columns: ['property_id', 'name', 'entity_type', 'trigger_event', 'description', 'steps', 'version', 'status'], orderBy: 'name', required: ['name', 'entity_type', 'trigger_event'], validate: r => (r.steps !== undefined ? validateSteps(r.steps) : null) },
  'business-rules': { table: 'admin_business_rules', columns: ['property_id', 'name', 'category', 'condition_expr', 'action_expr', 'priority', 'description', 'active'], orderBy: 'priority', required: ['name', 'condition_expr', 'action_expr'], validate: r => (r.condition_expr !== undefined && tryMsg(() => parseCondition(r.condition_expr))) || (r.action_expr !== undefined && tryMsg(() => validateAction(r.action_expr))) || null },
  'notification-templates': { table: 'admin_notification_templates', columns: ['property_id', 'code', 'name', 'channel', 'trigger_event', 'subject', 'body', 'recipient_roles', 'active'], orderBy: 'code', required: ['code', 'name', 'body'] },
  'document-templates': { table: 'admin_document_templates', columns: ['property_id', 'code', 'name', 'doc_type', 'body', 'version', 'active'], orderBy: 'code', required: ['code', 'name'] },
  'payment-gateways': { table: 'admin_payment_gateways', columns: ['property_id', 'name', 'provider', 'mode', 'currencies', 'public_key', 'secret_ref', 'webhook_url', 'fee_percent', 'enabled'], orderBy: 'name', required: ['name', 'provider'] },
  'tax-rules': { table: 'admin_tax_rules', columns: ['property_id', 'outlet_id', 'code', 'name', 'tax_type', 'rate', 'applies_to', 'calc_base', 'inclusive', 'effective_from', 'effective_to', 'active'], orderBy: 'code', required: ['code', 'name', 'rate'] },
  licenses: { table: 'admin_licenses', columns: ['license_key', 'holder', 'plan', 'seats', 'modules', 'valid_from', 'valid_to', 'status'], orderBy: 'valid_to', required: ['license_key', 'holder'] },
  devices: { table: 'admin_devices', columns: ['property_id', 'name', 'device_type', 'location', 'ip_address', 'serial_number', 'firmware', 'status', 'last_seen_at'], orderBy: 'name', required: ['name'] },
  'workflow-instances': { table: 'admin_workflow_instances', columns: [], orderBy: 'created_at', descending: true, readOnly: true },
  'identity-providers': { table: 'admin_identity_providers', columns: ['name', 'provider_type', 'issuer_url', 'client_id', 'secret_ref', 'email_domains', 'mfa_required', 'enabled'], orderBy: 'name', required: ['name'] },
  // POS terminal registry (managed from Admin > Device Management)
  'pos-terminals': { table: 'pos_terminals', columns: ['outlet_id', 'device_id', 'terminal_name', 'terminal_type', 'hardware_model', 'ip_address', 'printer_station', 'is_active', 'last_seen_at', 'settings'], orderBy: 'terminal_name', required: ['outlet_id', 'device_id', 'terminal_name'], noCreatedBy: true },
};

const toSnake = (k: string) => k.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`);
const toCamel = (k: string) => k.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
const camelRow = (row: Record<string, any>) => Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamel(k), v]));

const pickWritable = (def: ResourceDef, body: Record<string, any>) => {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(body || {})) {
    const col = toSnake(k);
    if (def.columns.includes(col)) out[col] = v === '' ? null : v;
  }
  return out;
};

const guard = [authenticate, requirePermission('settings:manage')];

const dbReady = (res: any) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    res.status(503).json({ error: 'Database not configured' });
    return false;
  }
  return true;
};

// ── Runtime config for any signed-in user ──────────────────────

router.get('/runtime/flags', authenticate, async (_req, res) => {
  const flags = await getFeatureFlags();
  return res.json({ flags: Object.fromEntries(flags.map(f => [f.flagKey, { enabled: f.enabled, rolloutPct: f.rolloutPct }])) });
});

router.get('/runtime/locales', authenticate, async (_req, res) => res.json({ locales: await getEnabledLocales() }));

router.get('/runtime/tax-rates', authenticate, async (req, res) => {
  const appliesTo = typeof req.query.appliesTo === 'string' ? req.query.appliesTo : 'all';
  const propertyId = typeof req.query.propertyId === 'string' ? req.query.propertyId : null;
  return res.json(await getTaxRates({ appliesTo, propertyId }));
});

router.get('/workflow-instances/mine', authenticate, async (req, res) => {
  if (!dbReady(res)) return;
  const role = String(req.user?.role || '').toLowerCase();
  let q = supabaseAdmin!.from('admin_workflow_instances').select('*').eq('status', 'pending').order('created_at', { ascending: true }).limit(200);
  if (role !== 'executive' && role !== 'system_admin') q = q.eq('assigned_role', role);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ items: (data || []).map(camelRow) });
});

router.post('/workflow-instances/:id/advance', authenticate, async (req, res) => {
  const decision = req.body?.decision === 'reject' ? 'reject' : req.body?.decision === 'approve' ? 'approve' : null;
  if (!decision) return res.status(400).json({ error: 'decision must be "approve" or "reject"' });
  const result = await advanceWorkflow(req.params.id, decision, { id: req.user?.id, role: req.user?.role }, typeof req.body?.comment === 'string' ? req.body.comment : undefined);
  if (result.error) return res.status(result.status || 500).json({ error: result.error });
  await writeAuditEvent({ req, user: req.user!, action: `workflow.${decision === 'approve' ? 'approved' : 'rejected'}`, entityType: 'WorkflowInstance', entityId: req.params.id, module: 'admin' });
  return res.json({ item: camelRow(result.instance as any) });
});

/** Sandbox for the Admin UI: test a saved category, or an unsaved condition/action, against a sample context. */
router.post('/rules/evaluate', ...guard, async (req, res) => {
  const { category, condition, action, context } = req.body || {};
  const ctx = context && typeof context === 'object' ? context : {};
  if (typeof condition === 'string') {
    const err = tryMsg(() => parseCondition(condition)) || (typeof action === 'string' ? tryMsg(() => validateAction(action)) : null);
    if (err) return res.status(400).json({ error: err });
    const matched = evaluateCondition(condition, ctx);
    return res.json({ matched, effects: matched && typeof action === 'string' ? resolveEffects(action, ctx) : [] });
  }
  if (typeof category !== 'string') return res.status(400).json({ error: 'Provide a category, or a condition and action' });
  return res.json(await evaluateBusinessRules(category, ctx));
});

/** Live SSO / OIDC issuer reachability & discovery check for Identity Providers. */
router.post('/identity-providers/:id/test', ...guard, async (req, res) => {
  if (!dbReady(res)) return;
  const { data: idp, error } = await supabaseAdmin!.from('admin_identity_providers').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!idp) return res.status(404).json({ error: 'Identity provider not found' });

  const issuerUrl = String(idp.issuer_url || '').trim().replace(/\/+$/, '');
  if (!issuerUrl || !/^https?:\/\//i.test(issuerUrl)) {
    return res.json({ ok: false, message: 'Issuer URL is missing or not a valid http(s) URL' });
  }

  const secretConfigured = idp.secret_ref ? Boolean(process.env[String(idp.secret_ref)]) : true;
  const target = (idp.provider_type === 'oidc' || idp.provider_type === 'oauth2')
    ? `${issuerUrl}/.well-known/openid-configuration`
    : issuerUrl;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const resp = await fetch(target, { signal: ctrl.signal, headers: { Accept: 'application/json,text/html' } });
    clearTimeout(timer);
    let discovery: Record<string, any> | undefined;
    if (resp.ok && (idp.provider_type === 'oidc' || idp.provider_type === 'oauth2')) {
      const json = await resp.json().catch(() => null);
      if (json && typeof json === 'object') {
        discovery = {
          issuer: json.issuer,
          authorizationEndpoint: json.authorization_endpoint,
          tokenEndpoint: json.token_endpoint,
          jwksUri: json.jwks_uri,
        };
      }
    }
    return res.json({
      ok: resp.ok,
      status: resp.status,
      secretConfigured,
      discovery,
      message: resp.ok
        ? `Connected (${resp.status})${discovery?.issuer ? ` · issuer ${discovery.issuer}` : ''}${!secretConfigured ? ' · warning: secret env not set' : ''}`
        : `Endpoint returned HTTP ${resp.status}`,
    });
  } catch (err: any) {
    return res.json({ ok: false, secretConfigured, message: err?.name === 'AbortError' ? 'Connection timed out (5s)' : (err?.message || 'Connection failed') });
  }
});

/** Verify Payment Gateway secret env var & webhook configuration without exposing secrets. */
router.post('/payment-gateways/:id/verify', ...guard, async (req, res) => {
  if (!dbReady(res)) return;
  const { data: gw, error } = await supabaseAdmin!.from('admin_payment_gateways').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!gw) return res.status(404).json({ error: 'Payment gateway not found' });

  const secretRef = String(gw.secret_ref || '').trim();
  const secretConfigured = secretRef ? Boolean(process.env[secretRef]) : false;
  const webhookUrl = String(gw.webhook_url || '').trim();
  const webhookValid = !webhookUrl || /^https?:\/\/.+/i.test(webhookUrl);
  const ok = secretConfigured && webhookValid;

  return res.json({
    ok,
    mode: gw.mode,
    secretConfigured,
    webhookValid,
    message: ok
      ? `Verified (${gw.mode}): secret "${secretRef}" is configured${webhookUrl ? ' and webhook URL is valid' : ''}`
      : !secretRef
        ? 'No secret reference configured'
        : !secretConfigured
          ? `Environment variable "${secretRef}" is not set on server`
          : 'Webhook URL is invalid',
  });
});

// ── Overview (Executive Dashboard) ─────────────────────────────

router.get('/overview', ...guard, async (_req, res) => {
  if (!dbReady(res)) return;
  const count = async (table: string, filter?: (q: any) => any) => {
    let q = supabaseAdmin!.from(table).select('*', { count: 'exact', head: true });
    if (filter) q = filter(q);
    const { count: c, error } = await q;
    return error ? null : c ?? 0;
  };
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [users, activeUsers, roles, properties, organizations, departments, flagsOn, flagsTotal, devicesOnline, devicesTotal, licensesActive, gateways, auditEvents24h, failures24h, backups, jobs] = await Promise.all([
    count('system_users'),
    count('system_users', q => q.ilike('status', 'active')),
    count('custom_roles'),
    count('properties'),
    count('organizations'),
    count('admin_departments', q => q.eq('status', 'active')),
    count('admin_feature_flags', q => q.eq('enabled', true)),
    count('admin_feature_flags'),
    count('admin_devices', q => q.eq('status', 'online')),
    count('admin_devices'),
    count('admin_licenses', q => q.eq('status', 'active')),
    count('admin_payment_gateways', q => q.eq('enabled', true)),
    count('audit_events', q => q.gte('timestamp', since)),
    count('audit_events', q => q.gte('timestamp', since).in('outcome', ['failure', 'denied'])),
    count('backup_jobs'),
    count('scheduled_jobs'),
  ]);
  return res.json({
    users, activeUsers, roles, properties, organizations, departments,
    featureFlags: { enabled: flagsOn, total: flagsTotal },
    devices: { online: devicesOnline, total: devicesTotal },
    licensesActive, paymentGatewaysEnabled: gateways,
    auditEvents24h, failedEvents24h: failures24h, backups, scheduledJobs: jobs,
    generatedAt: new Date().toISOString(),
  });
});

// ── Report datasets ────────────────────────────────────────────

export interface AdminDataset {
  table: string;
  select: string;
  orderBy: string;
  ascending?: boolean;
  permission?: string;
  label: string;
  description: string;
  group: string;
  /** Timestamp/date column used for period filtering (Today/WTD/MTD/YTD/Custom). */
  dateColumn?: string;
}

export const DATASETS: Record<string, AdminDataset> = {
  users: { table: 'system_users', select: 'id,name,email,role,status,last_login,created_at', orderBy: 'name', ascending: true, permission: 'users:manage', label: 'User register', description: 'All ERP user accounts with roles and login status', group: 'Administration', dateColumn: 'created_at' },
  roles: { table: 'custom_roles', select: '*', orderBy: 'name', ascending: true, permission: 'roles:manage', label: 'Roles & permissions', description: 'Custom roles and their permission grants', group: 'Administration', dateColumn: 'created_at' },
  audit: { table: 'audit_events', select: 'created_at,user_id,user_name,action,module,entity_type,entity_id,outcome,ip_address', orderBy: 'created_at', ascending: false, label: 'Audit trail', description: 'Latest security and system audit events', group: 'Administration', dateColumn: 'created_at' },
  properties: { table: 'properties', select: '*', orderBy: 'property_name', ascending: true, label: 'Property register', description: 'All hotel properties in the organisation', group: 'Master data', dateColumn: 'created_at' },
  rooms: { table: 'rooms', select: '*', orderBy: 'number', ascending: true, label: 'Room inventory', description: 'Rooms with status, type, and floor', group: 'Master data' },
  room_types: { table: 'room_types', select: '*', orderBy: 'name', ascending: true, label: 'Room types', description: 'Room type catalogue and configuration', group: 'Master data', dateColumn: 'created_at' },
  guests: { table: 'guests', select: '*', orderBy: 'name', ascending: true, label: 'Guest profiles', description: 'Guest master records', group: 'Operations', dateColumn: 'created_at' },
  reservations: { table: 'reservations', select: '*', orderBy: 'created_at', ascending: false, label: 'Reservations', description: 'Booking reservations across properties', group: 'Operations', dateColumn: 'created_at' },
  employees: { table: 'employees', select: '*', orderBy: 'name', ascending: true, label: 'Employees', description: 'Staff records and employment details', group: 'Operations', dateColumn: 'created_at' },
  work_orders: { table: 'work_orders', select: '*', orderBy: 'created_date', ascending: false, label: 'Work orders', description: 'Maintenance and service work orders', group: 'Operations', dateColumn: 'created_date' },
  folios: { table: 'folios', select: '*', orderBy: 'created_at', ascending: false, label: 'Folio accounts', description: 'Guest folio accounts and balances', group: 'Finance', dateColumn: 'created_at' },
  licenses: { table: 'admin_licenses', select: '*', orderBy: 'valid_to', ascending: true, label: 'Licences', description: 'Software licences and validity', group: 'Compliance', dateColumn: 'created_at' },
  devices: { table: 'admin_devices', select: '*', orderBy: 'name', ascending: true, label: 'Device inventory', description: 'Registered endpoint devices', group: 'Compliance', dateColumn: 'last_seen_at' },
  backup_jobs: { table: 'backup_jobs', select: 'id,backup_type,status,backup_size_bytes,storage_path,initiated_at,completed_at,error_message', orderBy: 'initiated_at', ascending: false, label: 'Backup history', description: 'Backup job history and status', group: 'Compliance', dateColumn: 'initiated_at' },
};

// ── Generic resource CRUD ──────────────────────────────────────

const resolve = (req: any, res: any): ResourceDef | null => {
  const def = RESOURCES[req.params.resource];
  if (!def) { res.status(404).json({ error: 'Unknown resource' }); return null; }
  return def;
};

const SUPERADMIN_WRITE_ONLY_RESOURCES = new Set(['licenses']);

async function assertResourceAccess(req: any, res: any, def: ResourceDef, id?: string): Promise<boolean> {
  if (SUPERADMIN_WRITE_ONLY_RESOURCES.has(req.params.resource) && !req.user?.isSuperAdmin) {
    res.status(403).json({ error: 'Licenses are managed by Super Admin' });
    return false;
  }
  if (id && def.columns.includes('property_id')) {
    const propIds = await getTenantPropertyIds(req);
    if (propIds !== null) {
      const { data: existing } = await supabaseAdmin!.from(def.table).select('property_id').eq('id', id).maybeSingle();
      if (!existing) {
        res.status(404).json({ error: 'Record not found' });
        return false;
      }
      if (existing.property_id && !propIds.includes(existing.property_id)) {
        res.status(403).json({ error: 'Access denied for this property' });
        return false;
      }
    }
  }
  return true;
}

router.get('/:resource', ...guard, async (req, res) => {
  const def = resolve(req, res); if (!def || !dbReady(res)) return;
  let query = supabaseAdmin!.from(def.table).select('*').order(def.orderBy, { ascending: !def.descending });
  if (def.columns.includes('property_id')) {
    const propIds = await getTenantPropertyIds(req);
    if (propIds !== null) {
      query = propIds.length > 0
        ? query.or(`property_id.is.null,property_id.in.(${propIds.join(',')})`)
        : query.is('property_id', null);
    }
  }
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ items: (data || []).map(camelRow) });
});

router.post('/:resource', ...guard, async (req, res) => {
  const def = resolve(req, res); if (!def || !dbReady(res)) return;
  if (def.readOnly) return res.status(405).json({ error: 'Read-only resource' });
  if (!(await assertResourceAccess(req, res, def))) return;
  const row = pickWritable(def, req.body);
  if (def.columns.includes('property_id') && row.property_id && !(await tenantOwnsProperty(req, row.property_id))) {
    return res.status(403).json({ error: 'Property does not belong to your tenant' });
  }
  const invalid = def.validate?.(row);
  if (invalid) return res.status(400).json({ error: invalid });
  const missing = (def.required || []).filter(c => row[c] === undefined || row[c] === null);
  if (missing.length) return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  const { data, error } = await supabaseAdmin!.from(def.table).insert({ ...row, ...(def.noCreatedBy ? {} : { created_by: req.user?.id ?? null }) }).select().single();
  if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.message });
  invalidateAdminConfigCache();
  await writeAuditEvent({ req, user: req.user!, action: `${req.params.resource}.created`, entityType: def.table, entityId: data.id, module: 'admin' });
  return res.status(201).json({ item: camelRow(data) });
});

router.patch('/:resource/:id', ...guard, async (req, res) => {
  const def = resolve(req, res); if (!def || !dbReady(res)) return;
  if (def.readOnly) return res.status(405).json({ error: 'Read-only resource' });
  if (!(await assertResourceAccess(req, res, def, req.params.id))) return;
  const row = pickWritable(def, req.body);
  if (def.columns.includes('property_id') && row.property_id && !(await tenantOwnsProperty(req, row.property_id))) {
    return res.status(403).json({ error: 'Property does not belong to your tenant' });
  }
  const invalid = def.validate?.(row);
  if (invalid) return res.status(400).json({ error: invalid });
  if (!Object.keys(row).length) return res.status(400).json({ error: 'No valid fields to update' });
  const { data, error } = await supabaseAdmin!.from(def.table).update({ ...row, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
  if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.message });
  invalidateAdminConfigCache();
  await writeAuditEvent({ req, user: req.user!, action: `${req.params.resource}.updated`, entityType: def.table, entityId: req.params.id, module: 'admin', details: { fields: Object.keys(row) } });
  return res.json({ item: camelRow(data) });
});

router.delete('/:resource/:id', ...guard, async (req, res) => {
  const def = resolve(req, res); if (!def || !dbReady(res)) return;
  if (def.readOnly) return res.status(405).json({ error: 'Read-only resource' });
  if (!(await assertResourceAccess(req, res, def, req.params.id))) return;
  const { error } = await supabaseAdmin!.from(def.table).delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  invalidateAdminConfigCache();
  await writeAuditEvent({ req, user: req.user!, action: `${req.params.resource}.deleted`, entityType: def.table, entityId: req.params.id, module: 'admin' });
  return res.json({ success: true });
});

export default router;

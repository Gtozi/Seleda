import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { evaluateRuleSet, type RuleRow, type RuleEvaluation } from './ruleEngine';

/**
 * Runtime readers for the admin control-plane tables (migration 657).
 * Short TTL cache so portals can consult admin settings on hot paths;
 * adminControl.routes.ts invalidates it on every write.
 */

const TTL_MS = 30_000;
type CacheEntry<T> = { at: number; value: T };
const cache = new Map<string, CacheEntry<any>>();

export function invalidateAdminConfigCache(): void {
  cache.clear();
}

async function cached<T>(key: string, load: () => Promise<T>, fallback: T): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return fallback;
  try {
    const value = await load();
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (err: any) {
    console.warn(`adminConfigService[${key}] failed:`, err?.message);
    return hit ? hit.value : fallback;
  }
}

// ── Feature flags ──────────────────────────────────────────────

export interface FeatureFlag { flagKey: string; enabled: boolean; rolloutPct: number; environment: string }

const currentEnvironment = () => (process.env.NODE_ENV === 'production' ? 'production' : 'development');

export async function getFeatureFlags(environment = currentEnvironment()): Promise<FeatureFlag[]> {
  return cached(`flags:${environment}`, async () => {
    const { data, error } = await supabaseAdmin!.from('admin_feature_flags').select('flag_key, enabled, rollout_pct, environment').eq('environment', environment);
    if (error) throw error;
    return (data || []).map((r: any) => ({ flagKey: r.flag_key, enabled: r.enabled, rolloutPct: r.rollout_pct, environment: r.environment }));
  }, []);
}

const bucket = (seed: string) => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 100;
};

/** Unknown flags resolve to `defaultValue`. Partial rollouts are sticky per `seed` (e.g. user id). */
export async function isFeatureEnabled(key: string, opts: { seed?: string; defaultValue?: boolean } = {}): Promise<boolean> {
  const flag = (await getFeatureFlags()).find(f => f.flagKey === key);
  if (!flag) return opts.defaultValue ?? false;
  if (!flag.enabled) return false;
  if (flag.rolloutPct >= 100) return true;
  return opts.seed ? bucket(`${key}:${opts.seed}`) < flag.rolloutPct : false;
}

// ── Locales ────────────────────────────────────────────────────

export async function getEnabledLocales() {
  return cached('locales', async () => {
    const { data, error } = await supabaseAdmin!.from('admin_locales').select('code, name, native_name, rtl, date_format, number_format, is_default').eq('enabled', true).order('code');
    if (error) throw error;
    return (data || []).map((r: any) => ({ code: r.code, name: r.name, nativeName: r.native_name, rtl: r.rtl, dateFormat: r.date_format, numberFormat: r.number_format, isDefault: r.is_default }));
  }, [] as any[]);
}

// ── Approval matrix ────────────────────────────────────────────

export interface ApprovalRule {
  id: string; name: string; entityType: string; department: string | null;
  minAmount: number; maxAmount: number | null; currency: string; approverRoles: string[]; steps: number;
}

async function getApprovalRules(): Promise<ApprovalRule[]> {
  return cached('approval-rules', async () => {
    const { data, error } = await supabaseAdmin!.from('admin_approval_rules').select('*').eq('active', true);
    if (error) throw error;
    return (data || []).map((r: any) => ({
      id: r.id, name: r.name, entityType: r.entity_type, department: r.department,
      minAmount: Number(r.min_amount) || 0, maxAmount: r.max_amount === null ? null : Number(r.max_amount),
      currency: r.currency, approverRoles: (r.approver_roles || []).map((x: string) => x.toLowerCase()), steps: r.steps,
    }));
  }, [] as ApprovalRule[]);
}

/** Most specific matching rule: department match first, then the highest minimum band. */
export async function findApprovalRule(entityType: string, amount: number, opts: { currency?: string; department?: string | null } = {}): Promise<ApprovalRule | null> {
  const dept = opts.department?.toLowerCase();
  const cur = opts.currency?.toLowerCase();
  const matches = (await getApprovalRules()).filter(r =>
    r.entityType.toLowerCase() === entityType.toLowerCase() &&
    amount >= r.minAmount && (r.maxAmount === null || amount <= r.maxAmount) &&
    (!cur || r.currency.toLowerCase() === cur) &&
    (!r.department || r.department.toLowerCase() === dept));
  matches.sort((a, b) => Number(!!b.department) - Number(!!a.department) || b.minAmount - a.minAmount);
  return matches[0] ?? null;
}

/**
 * Returns an error message if the approver isn't allowed under the matrix,
 * or null when allowed (including when no rule applies — behaviour unchanged).
 */
export async function checkApprover(user: { role?: string } | null | undefined, entityType: string, amount: number, opts: { currency?: string; department?: string | null } = {}): Promise<string | null> {
  const rule = await findApprovalRule(entityType, amount, opts);
  if (!rule || rule.approverRoles.length === 0) return null;
  const role = String(user?.role || '').toLowerCase();
  if (role === 'executive' || role === 'system_admin' || rule.approverRoles.includes(role)) return null;
  return `Approval rule "${rule.name}" requires one of these roles: ${rule.approverRoles.join(', ')}`;
}

// ── Notification templates ─────────────────────────────────────

export async function getNotificationTemplate(code: string, channel: string) {
  const all = await cached('notification-templates', async () => {
    const { data, error } = await supabaseAdmin!.from('admin_notification_templates').select('code, channel, subject, body').eq('active', true);
    if (error) throw error;
    return (data || []) as { code: string; channel: string; subject: string | null; body: string }[];
  }, [] as { code: string; channel: string; subject: string | null; body: string }[]);
  return all.find(t => t.code === code && t.channel === channel) ?? null;
}

export function renderTemplate(text: string, vars: Record<string, string | number | null | undefined>): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => String(vars[k] ?? ''));
}

// ── Central tax rules ──────────────────────────────────────────

export interface TaxRate { code: string; name: string; taxType: string; rate: number; inclusive: boolean; calcBase?: string }
export interface TaxRates { vat: number | null; serviceCharge: number | null; others: TaxRate[]; additional: TaxRate[] }

interface TaxRuleRow extends TaxRate { propertyId: string | null; outletId: string | null; appliesTo: string; effectiveFrom: string | null; effectiveTo: string | null }

async function getTaxRuleRows(): Promise<TaxRuleRow[]> {
  return cached('tax-rules', async () => {
    const { data, error } = await supabaseAdmin!.from('admin_tax_rules').select('*').eq('active', true);
    if (error) throw error;
    return (data || []).map((r: any) => ({
      code: r.code, name: r.name, taxType: r.tax_type, rate: Number(r.rate), inclusive: r.inclusive,
      calcBase: r.calc_base || 'subtotal',
      propertyId: r.property_id, outletId: r.outlet_id || null, appliesTo: String(r.applies_to || 'all').toLowerCase(), effectiveFrom: r.effective_from, effectiveTo: r.effective_to,
    }));
  }, [] as TaxRuleRow[]);
}

/**
 * Single source of truth for tax rates. `vat` / `serviceCharge` are null when Admin has defined no
 * matching rule, so callers keep their previous default (nothing changes until rules exist).
 * Specificity: outlet match > property match > "applies to" match > "all"; ties go to the latest effective_from.
 * A rate of 0 expresses an exemption. `additional` holds the winning rule per non-VAT/service-charge
 * tax type (e.g. city tax, tourism levy) for POS-style additional taxes.
 */
export async function getTaxRates(opts: { appliesTo?: string; propertyId?: string | null; outletId?: string | null; on?: Date } = {}): Promise<TaxRates> {
  const appliesTo = (opts.appliesTo || 'all').toLowerCase();
  const day = (opts.on ?? new Date()).toISOString().slice(0, 10);
  const rows = (await getTaxRuleRows()).filter(r =>
    (r.appliesTo === 'all' || r.appliesTo === appliesTo) &&
    (!r.propertyId || r.propertyId === opts.propertyId) &&
    (!r.outletId || r.outletId === opts.outletId) &&
    (!r.effectiveFrom || r.effectiveFrom <= day) && (!r.effectiveTo || r.effectiveTo >= day));
  const score = (r: TaxRuleRow) => (r.outletId && r.outletId === opts.outletId ? 4 : 0) + (r.propertyId ? 2 : 0) + (r.appliesTo === appliesTo && appliesTo !== 'all' ? 1 : 0);
  const best = (type: string) => rows.filter(r => r.taxType === type)
    .sort((a, b) => score(b) - score(a) || String(b.effectiveFrom || '').localeCompare(String(a.effectiveFrom || '')))[0];
  const vat = best('vat');
  const sc = best('service_charge');
  const others = rows.filter(r => r.taxType !== 'vat' && r.taxType !== 'service_charge');
  const byType = new Map<string, TaxRuleRow>();
  for (const r of [...others].sort((a, b) => score(b) - score(a) || String(b.effectiveFrom || '').localeCompare(String(a.effectiveFrom || '')))) {
    if (!byType.has(r.taxType)) byType.set(r.taxType, r);
  }
  const strip = ({ code, name, taxType, rate, inclusive, calcBase }: TaxRate) => ({ code, name, taxType, rate, inclusive, calcBase });
  return {
    vat: vat ? vat.rate : null,
    serviceCharge: sc ? sc.rate : null,
    others: others.map(strip),
    additional: [...byType.values()].map(strip),
  };
}

// ── Central business rules ─────────────────────────────────────


interface BusinessRuleRow extends RuleRow { propertyId: string | null }

async function getBusinessRuleRows(): Promise<BusinessRuleRow[]> {
  return cached('business-rules', async () => {
    const { data, error } = await supabaseAdmin!.from('admin_business_rules').select('*').eq('active', true);
    if (error) throw error;
    return (data || []).map((r: any) => ({
      id: r.id, name: r.name, category: String(r.category || 'general').toLowerCase(), priority: r.priority,
      conditionExpr: r.condition_expr, actionExpr: r.action_expr, active: r.active, propertyId: r.property_id,
    }));
  }, [] as BusinessRuleRow[]);
}

const EMPTY_EVAL: RuleEvaluation = { matched: [], effects: [], blocked: [], approvalRoles: [], errors: [] };

/** Evaluate every active rule in `category` against `context`. Never throws; with no rules the result is empty. */
export async function evaluateBusinessRules(category: string, context: Record<string, any>, propertyId?: string | null): Promise<RuleEvaluation> {
  const rules = (await getBusinessRuleRows()).filter(r => r.category === category.toLowerCase() && (!r.propertyId || r.propertyId === propertyId));
  if (!rules.length) return EMPTY_EVAL;
  const result = evaluateRuleSet(rules, context);
  for (const e of result.errors) console.warn(`[business-rules] rule "${e.name}" failed: ${e.error}`);
  return result;
}

/**
 * Configuration — /erp/inventory/configuration
 * DB-integrated via /api/uinv-portal/config.
 * Inventory portal configuration: valuation method defaults, alert thresholds, etc.
 */
import React, { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Settings, Clock, Loader2, ServerCrash, Save, CheckCircle2,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import { fetchConfig, saveConfig, type UinvConfig } from '../../services/inventoryService';

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

const SECTIONS = [
  { key: 'valuation', label: 'Valuation', fields: [
    { key: 'default_costing_method', label: 'Default Costing Method', type: 'select', options: ['Weighted Average', 'FIFO', 'Standard Cost'] },
    { key: 'auto_recalculate_avg_cost', label: 'Auto-Recalculate Avg Cost on Receipt', type: 'checkbox' },
  ]},
  { key: 'alerts', label: 'Alerts', fields: [
    { key: 'low_stock_threshold_pct', label: 'Low Stock Threshold (%)', type: 'number' },
    { key: 'expiry_warning_days', label: 'Expiry Warning (days)', type: 'number' },
    { key: 'slow_moving_days', label: 'Slow-Moving Threshold (days)', type: 'number' },
    { key: 'dead_stock_days', label: 'Dead Stock Threshold (days)', type: 'number' },
    { key: 'high_variance_pct', label: 'High Variance Threshold (%)', type: 'number' },
  ]},
  { key: 'workflows', label: 'Workflows', fields: [
    { key: 'require_approval_for_adjustments', label: 'Require Approval for Adjustments', type: 'checkbox' },
    { key: 'require_approval_for_waste', label: 'Require Approval for Waste', type: 'checkbox' },
    { key: 'auto_put_away_on_accept', label: 'Auto Put-Away on GRN Accept', type: 'checkbox' },
    { key: 'barcode_required_on_receiving', label: 'Barcode Required on Receiving', type: 'checkbox' },
  ]},
];

const ConfigurationModule: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [config, setConfig] = useState<UinvConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchConfig({ propertyId: currentPropertyId || undefined });
      // Merge all config sections into a single settings object
      const merged: Record<string, any> = {};
      (d || []).forEach((c) => { Object.assign(merged, c.config || {}); });
      setConfig(d?.[0] || null);
      setForm(merged);
    } catch (e: any) {
      setError(e?.message || 'Failed to load configuration');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await saveConfig({ propertyId: currentPropertyId || undefined, section: 'general', config: form });
      setConfig(updated);
      addNotification('Configuration saved.', 'success', 'Inventory');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save configuration', 'error', 'Inventory');
    } finally { setSaving(false); }
  };

  const renderField = (f: any) => {
    const value = form[f.key];
    if (f.type === 'checkbox') {
      return (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!value} onChange={e => setForm({ ...form, [f.key]: e.target.checked })} />
          {f.label}
        </label>
      );
    }
    if (f.type === 'select') {
      return (
        <Field label={f.label}>
          <select className={inputClass} value={value || ''} onChange={e => setForm({ ...form, [f.key]: e.target.value })}>
            {f.options.map((o: string) => <option key={o}>{o}</option>)}
          </select>
        </Field>
      );
    }
    return (
      <Field label={f.label}>
        <input type="number" className={inputClass} value={value ?? 0} onChange={e => setForm({ ...form, [f.key]: +e.target.value })} />
      </Field>
    );
  };

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Configuration"
        subtitle="Inventory portal defaults, alert thresholds, and workflow rules."
        icon={Settings}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Refresh
            </button>
            <button onClick={save} disabled={saving} className={button.primary + ' disabled:opacity-50'}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
            </button>
          </div>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Sections" value={SECTIONS.length} icon={Settings} tone="accent" />
        <StatCard title="Settings" value={SECTIONS.reduce((s, sec) => s + sec.fields.length, 0)} icon={CheckCircle2} tone="info" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {loading && <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500"><Loader2 className="w-5 h-5 animate-spin" /> Loading configuration…</div>}

      {!loading && !error && SECTIONS.map(section => (
        <SectionCard key={section.key} title={section.label} subtitle="Settings for this section" pad="md">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {section.fields.map(f => <div key={f.key}>{renderField(f)}</div>)}
          </div>
        </SectionCard>
      ))}
    </div>
  );
};

export default ConfigurationModule;

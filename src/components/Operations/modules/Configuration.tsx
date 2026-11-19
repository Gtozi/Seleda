/**
 * Configuration — Operations Portal (/erp/operations/configuration).
 *
 * Expanded, fully DB-integrated configuration hub with four areas:
 *
 *  - Approval Matrix: CRUD over `fin_approval_levels` — the real shared
 *    approval matrix used by Finance approval workflows.
 *  - Operations Settings: section-keyed JSONB config in `ops_config`
 *    (migration 643) — shift types, alert thresholds, notification rules,
 *    escalation SLAs, report defaults, duty manager preferences.
 *  - Global Settings: whitelisted fields on the `global_settings`
 *    singleton (check-in/out, tax %, night audit, session timeout, …).
 *  - Department Config: read-only cross-portal overview of hk/eng/sec/
 *    uinv/proc/hr config tables.
 *
 * UI follows the shared portal design language (PageHeader, SectionCard,
 * StatCard, Badge, brandTheme) — same as HK / Engineering / F&B modules.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Settings,
  Shield,
  Briefcase,
  Save,
  RefreshCw,
  Plus,
  Loader2,
  Globe,
  Layers,
  Trash2,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';
import {
  fetchOpsConfiguration,
  createApprovalLevel,
  updateApprovalLevel,
  deleteApprovalLevel,
  saveOpsConfigSection,
  updateGlobalSettings,
  type ApprovalLevel,
  type OpsConfigSection,
  type DeptConfigOverview,
} from '../../../services/operationsService';

type Tab = 'approval-matrix' | 'ops-settings' | 'global' | 'departments';

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: 'approval-matrix', label: 'Approval Matrix', icon: Shield },
  { key: 'ops-settings', label: 'Operations Settings', icon: Briefcase },
  { key: 'global', label: 'Global Settings', icon: Globe },
  { key: 'departments', label: 'Department Config', icon: Layers },
];

/** Field schema for each ops_config section — label + input type. */
const OPS_SECTION_SCHEMA: Record<string, { title: string; fields: { key: string; label: string; type: 'text' | 'number' | 'boolean' | 'select'; options?: string[] }[] }> = {
  'shift-types': {
    title: 'Shift Types',
    fields: [
      { key: 'morningStart', label: 'Morning Shift Start', type: 'text' },
      { key: 'afternoonStart', label: 'Afternoon Shift Start', type: 'text' },
      { key: 'nightStart', label: 'Night Shift Start', type: 'text' },
      { key: 'handoverMinutes', label: 'Handover Duration (min)', type: 'number' },
    ],
  },
  'alert-thresholds': {
    title: 'Alert Thresholds',
    fields: [
      { key: 'criticalResponseMinutes', label: 'Critical Response (min)', type: 'number' },
      { key: 'highResponseMinutes', label: 'High Priority Response (min)', type: 'number' },
      { key: 'mediumResponseMinutes', label: 'Medium Priority Response (min)', type: 'number' },
      { key: 'escalateAfterMinutes', label: 'Auto-Escalate After (min)', type: 'number' },
    ],
  },
  'notification-rules': {
    title: 'Notification Rules',
    fields: [
      { key: 'smsEnabled', label: 'SMS Notifications', type: 'boolean' },
      { key: 'emailEnabled', label: 'Email Notifications', type: 'boolean' },
      { key: 'pushEnabled', label: 'Push Notifications', type: 'boolean' },
      { key: 'notifyOnEscalation', label: 'Notify on Escalation', type: 'boolean' },
      { key: 'notifyOnEmergency', label: 'Notify on Emergency', type: 'boolean' },
    ],
  },
  'escalation': {
    title: 'Escalation Defaults',
    fields: [
      { key: 'defaultSlaHours', label: 'Default SLA (hours)', type: 'number' },
      { key: 'criticalSlaHours', label: 'Critical SLA (hours)', type: 'number' },
      { key: 'autoEscalate', label: 'Auto-Escalate Breaches', type: 'boolean' },
      { key: 'escalateToDutyManager', label: 'Escalate to Duty Manager', type: 'boolean' },
    ],
  },
  'reports': {
    title: 'Report Defaults',
    fields: [
      { key: 'defaultFormat', label: 'Default Format', type: 'select', options: ['PDF', 'Excel', 'CSV'] },
      { key: 'defaultPeriod', label: 'Default Period', type: 'select', options: ['Today', 'WTD', 'MTD', 'YTD'] },
      { key: 'autoRunDaily', label: 'Auto-Run Daily', type: 'boolean' },
      { key: 'archiveRetentionDays', label: 'Archive Retention (days)', type: 'number' },
    ],
  },
  'duty-manager': {
    title: 'Duty Manager',
    fields: [
      { key: 'walkthroughRequired', label: 'Walkthrough Required', type: 'boolean' },
      { key: 'handoverChecklistRequired', label: 'Handover Checklist Required', type: 'boolean' },
      { key: 'maxShiftHours', label: 'Max Shift (hours)', type: 'number' },
      { key: 'briefingLeadMinutes', label: 'Briefing Lead (min)', type: 'number' },
    ],
  },
};

const GLOBAL_FIELDS_META: { key: string; label: string; type: 'text' | 'number' | 'boolean' }[] = [
  { key: 'custom_hotel_name', label: 'Hotel Name', type: 'text' },
  { key: 'contact_phone', label: 'Contact Phone', type: 'text' },
  { key: 'contact_email', label: 'Contact Email', type: 'text' },
  { key: 'check_in_time', label: 'Check-in Time', type: 'text' },
  { key: 'check_out_time', label: 'Check-out Time', type: 'text' },
  { key: 'tax_percent', label: 'Tax %', type: 'number' },
  { key: 'service_charge_percent', label: 'Service Charge %', type: 'number' },
  { key: 'exchange_rate', label: 'Exchange Rate', type: 'number' },
  { key: 'session_timeout', label: 'Session Timeout (min)', type: 'number' },
  { key: 'auto_night_audit_time', label: 'Night Audit Time', type: 'text' },
  { key: 'vip_spend_threshold', label: 'VIP Spend Threshold', type: 'number' },
  { key: 'cancellation_grace_hours', label: 'Cancellation Grace (hrs)', type: 'number' },
  { key: 'cancellation_penalty_percent', label: 'Cancellation Penalty %', type: 'number' },
  { key: 'maintenance_mode', label: 'Maintenance Mode', type: 'boolean' },
  { key: 'public_booking_enabled', label: 'Public Booking Enabled', type: 'boolean' },
  { key: 'guest_portal_enabled', label: 'Guest Portal Enabled', type: 'boolean' },
];

const inputCls =
  'px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-operations)]';

const fmtTs = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const Configuration: React.FC = () => {
  const { currentPropertyId, formatAmount, addNotification } = useERP();
  const [tab, setTab] = useState<Tab>('approval-matrix');
  const [levels, setLevels] = useState<ApprovalLevel[]>([]);
  const [opsConfig, setOpsConfig] = useState<OpsConfigSection[]>([]);
  const [globalSettings, setGlobalSettings] = useState<Record<string, any>>({});
  const [deptConfigs, setDeptConfigs] = useState<DeptConfigOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  // Local edit drafts
  const [opsDrafts, setOpsDrafts] = useState<Record<string, Record<string, any>>>({});
  const [globalDraft, setGlobalDraft] = useState<Record<string, any>>({});
  const [levelDrafts, setLevelDrafts] = useState<Record<string, { spendingLimit: number; status: string; approvers: string }>>({});
  const [showAddLevel, setShowAddLevel] = useState(false);
  const [newLevel, setNewLevel] = useState({ name: '', level: 1, spendingLimit: 0, approvers: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchOpsConfiguration(currentPropertyId || undefined);
      setLevels(data.approvalLevels);
      setOpsConfig(data.opsConfig);
      setGlobalSettings(data.globalSettings);
      setDeptConfigs(data.deptConfigs);
      const od: Record<string, Record<string, any>> = {};
      for (const s of data.opsConfig) od[s.section] = { ...s.data };
      setOpsDrafts(od);
      setGlobalDraft({ ...data.globalSettings });
      const ld: Record<string, any> = {};
      for (const l of data.approvalLevels) ld[l.id] = { spendingLimit: l.spendingLimit, status: l.status, approvers: (l.approvers || []).join(', ') };
      setLevelDrafts(ld);
    } catch (e: any) {
      setError(e?.message || 'Failed to load configuration');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const saveSection = async (section: string) => {
    setSaving(`sec-${section}`);
    try {
      await saveOpsConfigSection(section, opsDrafts[section] || {}, currentPropertyId || undefined);
      addNotification(`${OPS_SECTION_SCHEMA[section]?.title || section} saved`, 'success', 'Executive');
      await load();
    } catch (e: any) {
      addNotification(e?.message || 'Save failed', 'warning', 'Executive');
    } finally {
      setSaving(null);
    }
  };

  const saveGlobal = async () => {
    setSaving('global');
    try {
      const { globalSettings: updated } = await updateGlobalSettings(globalDraft);
      setGlobalSettings(updated);
      addNotification('Global settings saved', 'success', 'Executive');
    } catch (e: any) {
      addNotification(e?.message || 'Save failed', 'warning', 'Executive');
    } finally {
      setSaving(null);
    }
  };

  const saveLevel = async (l: ApprovalLevel) => {
    const d = levelDrafts[l.id];
    if (!d) return;
    setSaving(`lvl-${l.id}`);
    try {
      await updateApprovalLevel(l.id, {
        spendingLimit: Number(d.spendingLimit) || 0,
        status: d.status as 'active' | 'inactive',
        approvers: d.approvers.split(',').map(s => s.trim()).filter(Boolean),
      });
      addNotification(`${l.name} updated`, 'success', 'Executive');
      await load();
    } catch (e: any) {
      addNotification(e?.message || 'Update failed', 'warning', 'Executive');
    } finally {
      setSaving(null);
    }
  };

  const addLevel = async () => {
    if (!newLevel.name.trim()) return;
    setSaving('add-level');
    try {
      await createApprovalLevel({
        name: newLevel.name.trim(),
        level: newLevel.level,
        spendingLimit: newLevel.spendingLimit,
        approvers: newLevel.approvers.split(',').map(s => s.trim()).filter(Boolean),
        propertyId: currentPropertyId || undefined,
      });
      setNewLevel({ name: '', level: 1, spendingLimit: 0, approvers: '' });
      setShowAddLevel(false);
      addNotification('Approval level created', 'success', 'Executive');
      await load();
    } catch (e: any) {
      addNotification(e?.message || 'Create failed', 'warning', 'Executive');
    } finally {
      setSaving(null);
    }
  };

  const removeLevel = async (id: string) => {
    if (!window.confirm('Delete this approval level?')) return;
    setSaving(`del-${id}`);
    try {
      await deleteApprovalLevel(id);
      await load();
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'Executive');
    } finally {
      setSaving(null);
    }
  };

  const activeLevels = levels.filter(l => l.status === 'active').length;
  const configuredSections = opsConfig.length;
  const deptConfigured = deptConfigs.filter(d => d.count > 0).length;

  const renderField = (section: string, field: { key: string; label: string; type: string; options?: string[] }) => {
    const value = opsDrafts[section]?.[field.key];
    const set = (v: any) => setOpsDrafts(prev => ({ ...prev, [section]: { ...prev[section], [field.key]: v } }));
    if (field.type === 'boolean') {
      return (
        <input type="checkbox" checked={!!value} onChange={e => set(e.target.checked)}
          className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
      );
    }
    if (field.type === 'number') {
      return <input type="number" value={value ?? ''} onChange={e => set(Number(e.target.value))} className={`${inputCls} w-28`} />;
    }
    if (field.type === 'select') {
      return (
        <select value={value ?? ''} onChange={e => set(e.target.value)} className={inputCls}>
          {field.options?.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    return <input type="text" value={value ?? ''} onChange={e => set(e.target.value)} className={`${inputCls} w-36`} />;
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Configuration"
        subtitle="Approval matrix, operations settings, global hotel settings & department config"
        icon={Settings}
        actions={
          <button className={button.secondary} onClick={load} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Approval Levels" value={levels.length} caption={`${activeLevels} active`} icon={Shield} tone="info" />
        <StatCard label="Ops Config Sections" value={configuredSections} caption="persisted" icon={Briefcase} tone="success" />
        <StatCard label="Global Fields" value={Object.keys(globalSettings).length} caption="hotel-wide" icon={Globe} tone="neutral" />
        <StatCard label="Departments Configured" value={`${deptConfigured}/${deptConfigs.length}`} caption="cross-portal" icon={Layers} tone="warning" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg w-fit">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t.key
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 size={20} className="animate-spin mr-2" /> Loading configuration…
        </div>
      ) : (
        <>
          {tab === 'approval-matrix' && (
            <SectionCard
              title="Approval Matrix"
              subtitle="Shared with Finance — spending limits and approver routing"
              icon={Shield}
              actions={<button className={button.primary} onClick={() => setShowAddLevel(v => !v)}><Plus size={14} /> Add Level</button>}
            >
              {showAddLevel && (
                <div className="mx-4 mt-4 p-4 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700 grid grid-cols-1 md:grid-cols-5 gap-3">
                  <input className={inputCls} placeholder="Level name" value={newLevel.name} onChange={e => setNewLevel(n => ({ ...n, name: e.target.value }))} />
                  <input className={inputCls} type="number" placeholder="Level #" value={newLevel.level} onChange={e => setNewLevel(n => ({ ...n, level: Number(e.target.value) }))} />
                  <input className={inputCls} type="number" placeholder="Spending limit" value={newLevel.spendingLimit} onChange={e => setNewLevel(n => ({ ...n, spendingLimit: Number(e.target.value) }))} />
                  <input className={inputCls} placeholder="Approvers (emails, comma-sep)" value={newLevel.approvers} onChange={e => setNewLevel(n => ({ ...n, approvers: e.target.value }))} />
                  <button className={button.primary} onClick={addLevel} disabled={saving === 'add-level' || !newLevel.name.trim()}>
                    {saving === 'add-level' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create
                  </button>
                </div>
              )}
              <div className="space-y-3 p-4">
                {levels.map(l => {
                  const d = levelDrafts[l.id] || { spendingLimit: l.spendingLimit, status: l.status, approvers: (l.approvers || []).join(', ') };
                  return (
                    <div key={l.id} className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700">
                      <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-3 min-w-0">
                          <Badge tone="info">L{l.level}</Badge>
                          <div className="min-w-0">
                            <h4 className="font-semibold text-slate-900 dark:text-white">{l.name}</h4>
                            {l.description && <p className="text-xs text-slate-500 dark:text-slate-400">{l.description}</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <label className="text-xs text-slate-500">Limit</label>
                          <input type="number" className={`${inputCls} w-32`} value={d.spendingLimit}
                            onChange={e => setLevelDrafts(prev => ({ ...prev, [l.id]: { ...d, spendingLimit: Number(e.target.value) } }))} />
                          <select className={inputCls} value={d.status}
                            onChange={e => setLevelDrafts(prev => ({ ...prev, [l.id]: { ...d, status: e.target.value } }))}>
                            <option value="active">active</option>
                            <option value="inactive">inactive</option>
                          </select>
                          <button className={button.secondary} onClick={() => saveLevel(l)} disabled={saving === `lvl-${l.id}`}>
                            {saving === `lvl-${l.id}` ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
                          </button>
                          <button className={button.ghost} onClick={() => removeLevel(l.id)} title="Delete">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="mt-3">
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                          Approvers · limit {formatAmount(l.spendingLimit)}{l.requiresUnanimous ? ' · unanimous required' : ''}
                        </p>
                        <input className={`${inputCls} w-full`} value={d.approvers} placeholder="approver emails, comma-separated"
                          onChange={e => setLevelDrafts(prev => ({ ...prev, [l.id]: { ...d, approvers: e.target.value } }))} />
                      </div>
                    </div>
                  );
                })}
                {!levels.length && <p className="text-sm text-slate-400 text-center py-6">No approval levels configured.</p>}
              </div>
            </SectionCard>
          )}

          {tab === 'ops-settings' && (
            <div className="space-y-4">
              {Object.entries(OPS_SECTION_SCHEMA).map(([section, schema]) => {
                const stored = opsConfig.find(s => s.section === section);
                return (
                  <SectionCard
                    key={section}
                    title={schema.title}
                    subtitle={stored ? `Saved ${fmtTs(stored.updatedAt)}${stored.updatedBy ? ` by ${stored.updatedBy}` : ''}` : 'Defaults — not yet saved'}
                    actions={
                      <button className={button.primary} onClick={() => saveSection(section)} disabled={saving === `sec-${section}`}>
                        {saving === `sec-${section}` ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
                      </button>
                    }
                  >
                    <div className="divide-y divide-gray-100 dark:divide-slate-800">
                      {schema.fields.map(f => (
                        <div key={f.key} className="flex items-center justify-between px-4 py-3">
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{f.label}</span>
                          {renderField(section, f)}
                        </div>
                      ))}
                    </div>
                  </SectionCard>
                );
              })}
            </div>
          )}

          {tab === 'global' && (
            <SectionCard
              title="Global Hotel Settings"
              subtitle="Shared with Admin — affects all portals"
              icon={Globe}
              actions={
                <button className={button.primary} onClick={saveGlobal} disabled={saving === 'global'}>
                  {saving === 'global' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save Global
                </button>
              }
            >
              <div className="divide-y divide-gray-100 dark:divide-slate-800">
                {GLOBAL_FIELDS_META.map(f => (
                  <div key={f.key} className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{f.label}</span>
                    {f.type === 'boolean' ? (
                      <input type="checkbox" checked={!!globalDraft[f.key]}
                        onChange={e => setGlobalDraft(prev => ({ ...prev, [f.key]: e.target.checked }))}
                        className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                    ) : f.type === 'number' ? (
                      <input type="number" className={`${inputCls} w-32`} value={globalDraft[f.key] ?? ''}
                        onChange={e => setGlobalDraft(prev => ({ ...prev, [f.key]: Number(e.target.value) }))} />
                    ) : (
                      <input type="text" className={`${inputCls} w-48`} value={globalDraft[f.key] ?? ''}
                        onChange={e => setGlobalDraft(prev => ({ ...prev, [f.key]: e.target.value }))} />
                    )}
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {tab === 'departments' && (
            <SectionCard title="Department Configuration" subtitle="Read-only overview — each portal manages its own config" icon={Layers}>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
                {deptConfigs.map(d => (
                  <div key={d.dept} className="rounded-xl border border-gray-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-800/60">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-slate-900 dark:text-white">{d.dept}</h4>
                      <Badge tone={d.count > 0 ? 'success' : 'neutral'}>{d.count} item(s)</Badge>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">{d.table}</p>
                    {d.sections.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-3">
                        {d.sections.slice(0, 8).map(s => (
                          <span key={s} className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded">{s}</span>
                        ))}
                        {d.sections.length > 8 && <span className="text-xs text-slate-400">+{d.sections.length - 8} more</span>}
                      </div>
                    )}
                    <p className="text-xs text-slate-400 mt-3">Last updated {fmtTs(d.lastUpdated)}</p>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
};

export default Configuration;

/**
 * Engineering Configuration module — maintenance-only settings.
 * Mimics the HK ConfigurationModule pattern (migration 320 / hk_config):
 *   - Section tabs (horizontal segmented control)
 *   - Row-based config entities (add/edit/delete via generic edit modal)
 *   - Flat key-value settings (booleans, numbers, selects) alongside rows
 *   - Per-section Save button
 *   - Config persisted to eng_config (migration 336) via
 *     /api/eng-portal/config/:propertyId/:section
 *
 * Scope: 4 maintenance sections only:
 *   work_orders, preventive_maintenance, alerts, safety
 * General/department/staff/locations/utilities are admin-managed.
 */

import { useState, useCallback, useEffect, useMemo, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import {
  Settings, Save, Wrench, Clock, Bell, ShieldCheck,
  Plus, Edit, Trash2, Loader2, ServerCrash, ArrowRight, RotateCcw,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchEngConfig,
  saveEngConfig,
  ENG_CONFIG_SECTIONS,
  type EngConfigSection,
} from '../../services/engineeringService';

// ── Types ────────────────────────────────────────────────────────────────

type Section = EngConfigSection;

interface EditField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean';
  options?: string[];
}

interface EditState {
  open: boolean;
  title: string;
  fields: EditField[];
  values: Record<string, any>;
  onSave: (values: Record<string, any>) => void;
}

interface FlatSetting {
  id: string;
  name: string;
  value: string | number | boolean;
  type: 'text' | 'number' | 'boolean' | 'select';
  options?: string[];
  description?: string;
}

interface SectionMeta {
  id: Section;
  label: string;
  icon: LucideIcon;
  flatSettings: FlatSetting[];
  rowGroups: RowGroupMeta[];
}

interface RowGroupMeta {
  key: string;          // JSONB key inside the section data
  title: string;
  icon: LucideIcon;
  rowTitle: (row: Record<string, any>) => string;
  rowSub?: (row: Record<string, any>) => string;
  fields: EditField[];
  newRow: () => Record<string, any>;
}

// ── Section definitions ──────────────────────────────────────────────────

const SECTIONS: SectionMeta[] = [
  {
    id: 'work_orders',
    label: 'Work Orders',
    icon: Wrench,
    flatSettings: [
      { id: 'auto-assign', name: 'Auto Assign Work Orders', value: false, type: 'boolean', description: 'Automatically assign based on skills' },
      { id: 'default-priority', name: 'Default Priority', value: 'Normal', type: 'select', options: ['Emergency', 'High', 'Normal', 'Low'], description: 'Default priority for new orders' },
      { id: 'sla-hours', name: 'SLA Response Time (hours)', value: 4, type: 'number', description: 'Standard response time SLA' },
      { id: 'require-photos', name: 'Require Before/After Photos', value: true, type: 'boolean', description: 'Mandatory photo documentation' },
      { id: 'allow-guest-requests', name: 'Allow Guest Requests', value: true, type: 'boolean', description: 'Guests can submit requests' },
    ],
    rowGroups: [
      {
        key: 'priorities',
        title: 'Priority Levels',
        icon: Wrench,
        rowTitle: r => r.label,
        rowSub: r => `SLA ${r.slaHours}h`,
        fields: [
          { key: 'label', label: 'Label', type: 'text' },
          { key: 'slaHours', label: 'SLA (hours)', type: 'number' },
          { key: 'color', label: 'Color class', type: 'select', options: ['bg-rose-500', 'bg-amber-500', 'bg-blue-500', 'bg-slate-500', 'bg-emerald-500', 'bg-purple-500'] },
        ],
        newRow: () => ({ id: `WO-P-${Date.now().toString().slice(-4)}`, label: 'New Priority', slaHours: 24, color: 'bg-slate-500' }),
      },
      {
        key: 'categories',
        title: 'Work Order Categories',
        icon: Wrench,
        rowTitle: r => r.label,
        rowSub: r => `Default: ${r.defaultAssignee}`,
        fields: [
          { key: 'label', label: 'Category', type: 'text' },
          { key: 'defaultAssignee', label: 'Default Assignee', type: 'text' },
        ],
        newRow: () => ({ id: `WO-C-${Date.now().toString().slice(-4)}`, label: 'New Category', defaultAssignee: 'Maintenance Team' }),
      },
    ],
  },
  {
    id: 'preventive_maintenance',
    label: 'Preventive Maint.',
    icon: Clock,
    flatSettings: [
      { id: 'auto-schedule', name: 'Auto Schedule PM', value: true, type: 'boolean', description: 'Automatically generate PM schedules' },
      { id: 'pm-advance-days', name: 'PM Advance Notice (days)', value: 7, type: 'number', description: 'Days before PM due date' },
      { id: 'pm-frequency', name: 'Default PM Frequency', value: 'Monthly', type: 'select', options: ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Semi-Annual', 'Annual'], description: 'Default PM interval' },
      { id: 'require-checklist', name: 'Require PM Checklist', value: true, type: 'boolean', description: 'Mandatory checklist completion' },
      { id: 'pm-reminder', name: 'PM Reminder Email', value: true, type: 'boolean', description: 'Send email reminders' },
    ],
    rowGroups: [
      {
        key: 'frequencies',
        title: 'PM Frequencies',
        icon: Clock,
        rowTitle: r => r.label,
        rowSub: r => `Every ${r.intervalDays} days`,
        fields: [
          { key: 'label', label: 'Label', type: 'text' },
          { key: 'intervalDays', label: 'Interval (days)', type: 'number' },
        ],
        newRow: () => ({ id: `PM-F-${Date.now().toString().slice(-4)}`, label: 'New Frequency', intervalDays: 30 }),
      },
      {
        key: 'checklistTemplates',
        title: 'Checklist Templates',
        icon: Clock,
        rowTitle: r => r.label,
        rowSub: r => `${r.items} items`,
        fields: [
          { key: 'label', label: 'Template Name', type: 'text' },
          { key: 'items', label: 'Item Count', type: 'number' },
        ],
        newRow: () => ({ id: `PM-CT-${Date.now().toString().slice(-4)}`, label: 'New Template', items: 5 }),
      },
    ],
  },
  {
    id: 'alerts',
    label: 'Alerts',
    icon: Bell,
    flatSettings: [
      { id: 'email-alerts', name: 'Email Alerts', value: true, type: 'boolean', description: 'Enable email notifications' },
      { id: 'sms-alerts', name: 'SMS Alerts', value: false, type: 'boolean', description: 'Enable SMS notifications' },
      { id: 'critical-threshold', name: 'Critical Alert Threshold', value: 1, type: 'number', description: 'Hours before critical alert' },
      { id: 'alert-recipients', name: 'Alert Recipients', value: 'engineering@seleda.et', type: 'text', description: 'Comma-separated email list' },
      { id: 'downtime-alert', name: 'Downtime Alert', value: true, type: 'boolean', description: 'Alert on equipment downtime' },
    ],
    rowGroups: [
      {
        key: 'alertTypes',
        title: 'Alert Types',
        icon: Bell,
        rowTitle: r => r.label,
        rowSub: r => `${r.priority} · ${r.channel}`,
        fields: [
          { key: 'label', label: 'Alert Name', type: 'text' },
          { key: 'priority', label: 'Priority', type: 'select', options: ['Critical', 'High', 'Normal', 'Low'] },
          { key: 'channel', label: 'Channel', type: 'select', options: ['Email', 'SMS', 'Email + SMS'] },
        ],
        newRow: () => ({ id: `AL-${Date.now().toString().slice(-4)}`, label: 'New Alert', priority: 'Normal', channel: 'Email' }),
      },
    ],
  },
  {
    id: 'safety',
    label: 'Safety',
    icon: ShieldCheck,
    flatSettings: [
      { id: 'safety-checklist', name: 'Safety Checklist Required', value: true, type: 'boolean', description: 'Mandatory safety check before work' },
      { id: 'ppe-req', name: 'PPE Requirements', value: true, type: 'boolean', description: 'Track PPE compliance' },
      { id: 'incident-reporting', name: 'Incident Reporting', value: true, type: 'boolean', description: 'Mandatory incident documentation' },
      { id: 'compliance-alerts', name: 'Compliance Alerts', value: true, type: 'boolean', description: 'Alert on compliance issues' },
      { id: 'inspection-frequency', name: 'Safety Inspection Frequency', value: 'Monthly', type: 'select', options: ['Weekly', 'Monthly', 'Quarterly'], description: 'Regular safety inspection interval' },
    ],
    rowGroups: [
      {
        key: 'inspectionTypes',
        title: 'Inspection Types',
        icon: ShieldCheck,
        rowTitle: r => r.label,
        rowSub: r => `${r.frequency} · ${r.authority}`,
        fields: [
          { key: 'label', label: 'Inspection', type: 'text' },
          { key: 'frequency', label: 'Frequency', type: 'select', options: ['Weekly', 'Monthly', 'Quarterly', 'Semi-Annual', 'Annual'] },
          { key: 'authority', label: 'Authority', type: 'text' },
        ],
        newRow: () => ({ id: `SI-${Date.now().toString().slice(-4)}`, label: 'New Inspection', frequency: 'Monthly', authority: 'Safety Officer' }),
      },
      {
        key: 'ppeItems',
        title: 'PPE Items',
        icon: ShieldCheck,
        rowTitle: r => r.label,
        rowSub: r => (r.required ? 'Required' : 'Optional'),
        fields: [
          { key: 'label', label: 'Item Name', type: 'text' },
          { key: 'required', label: 'Required', type: 'boolean' },
        ],
        newRow: () => ({ id: `PPE-${Date.now().toString().slice(-4)}`, label: 'New PPE Item', required: true }),
      },
    ],
  },
];

// Build default flat-settings + empty row arrays from the static definitions.
function buildDefaultSectionData(meta: SectionMeta): Record<string, any> {
  const data: Record<string, any> = {};
  for (const s of meta.flatSettings) data[s.id] = s.value;
  for (const rg of meta.rowGroups) data[rg.key] = [];
  return data;
}

// ── Component ────────────────────────────────────────────────────────────

export default function Configuration() {
  const { currentPropertyId, addNotification } = useERP();
  const [section, setSection] = useState<Section>('work_orders');

  // Per-section config state: { [section]: { flatKey: value, rowGroupKey: [...] } }
  const [config, setConfig] = useState<Record<Section, Record<string, any>>>(() => {
    const map = {} as Record<Section, Record<string, any>>;
    for (const s of SECTIONS) map[s.id] = buildDefaultSectionData(s);
    return map;
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Set<Section>>(new Set());

  // Generic edit modal
  const [editState, setEditState] = useState<EditState>({
    open: false, title: '', fields: [], values: {}, onSave: () => {},
  });

  const openEditModal = (
    title: string,
    fields: EditField[],
    currentValues: Record<string, any>,
    onSave: (values: Record<string, any>) => void,
  ) => {
    setEditState({ open: true, title, fields, values: { ...currentValues }, onSave });
  };

  const saveEditModal = () => {
    editState.onSave(editState.values);
    setEditState(s => ({ ...s, open: false }));
  };

  // ── Load all sections on mount ─────────────────────────────────────────
  const load = useCallback(async () => {
    if (!currentPropertyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = {} as Record<Section, Record<string, any>>;
      for (const s of SECTIONS) next[s.id] = buildDefaultSectionData(s);
      await Promise.all(
        ENG_CONFIG_SECTIONS.map(async (sec) => {
          try {
            const data = await fetchEngConfig(currentPropertyId, sec);
            if (data && Object.keys(data).length > 0) {
              next[sec] = { ...next[sec], ...data };
            }
          } catch {
            // Non-fatal — keep seed defaults.
          }
        })
      );
      setConfig(next);
      setDirty(new Set());
    } catch (e: any) {
      setError(e?.message || 'Failed to load configuration');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  // ── Flat setting change ────────────────────────────────────────────────
  const handleFlatChange = (sec: Section, key: string, value: any) => {
    setConfig(prev => ({
      ...prev,
      [sec]: { ...prev[sec], [key]: value },
    }));
    setDirty(prev => new Set(prev).add(sec));
  };

  // ── Row helpers ────────────────────────────────────────────────────────
  const addRow = (sec: Section, groupKey: string, newRow: () => Record<string, any>) => {
    setConfig(prev => ({
      ...prev,
      [sec]: {
        ...prev[sec],
        [groupKey]: [...(prev[sec][groupKey] || []), newRow()],
      },
    }));
    setDirty(prev => new Set(prev).add(sec));
  };

  const updateRow = (sec: Section, groupKey: string, idx: number, values: Record<string, any>) => {
    setConfig(prev => ({
      ...prev,
      [sec]: {
        ...prev[sec],
        [groupKey]: (prev[sec][groupKey] || []).map((r: any, i: number) =>
          i === idx ? { ...r, ...values } : r
        ),
      },
    }));
    setDirty(prev => new Set(prev).add(sec));
  };

  const removeRow = (sec: Section, groupKey: string, idx: number) => {
    setConfig(prev => ({
      ...prev,
      [sec]: {
        ...prev[sec],
        [groupKey]: (prev[sec][groupKey] || []).filter((_: any, i: number) => i !== idx),
      },
    }));
    setDirty(prev => new Set(prev).add(sec));
  };

  // ── Save ───────────────────────────────────────────────────────────────
  const saveSection = async (sec: Section) => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      await saveEngConfig(currentPropertyId, sec, config[sec]);
      setDirty(prev => {
        const next = new Set(prev);
        next.delete(sec);
        return next;
      });
      const meta = SECTIONS.find(s => s.id === sec);
      addNotification(`${meta?.label || sec} configuration saved.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save configuration', 'warning', 'Maintenance');
    } finally {
      setSaving(false);
    }
  };

  const resetSection = (sec: Section) => {
    const meta = SECTIONS.find(s => s.id === sec);
    if (meta) {
      setConfig(prev => ({ ...prev, [sec]: buildDefaultSectionData(meta) }));
      setDirty(prev => new Set(prev).add(sec));
    }
  };

  // ── Reusable sub-components (mimicking HK ConfigRow / AddButton) ───────
  const ConfigRow = ({
    title, sub, onRemove, onEdit,
  }: {
    title: string;
    sub?: string;
    onRemove: () => void;
    onEdit?: () => void;
  }) => (
    <div className="flex items-center justify-between p-3 rounded-xl border border-gray-200 dark:border-slate-700">
      <div className="min-w-0">
        <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{title}</p>
        {sub && <p className="text-xs text-gray-500 truncate">{sub}</p>}
      </div>
      <div className="flex gap-1.5 shrink-0">
        {onEdit && (
          <button onClick={onEdit} className="p-1.5 bg-slate-50 dark:bg-slate-900/40 text-gray-400 hover:text-[var(--color-accent-operations)] rounded-lg transition" title="Edit">
            <Edit className="w-3 h-3" />
          </button>
        )}
        <button onClick={onRemove} className="p-1.5 bg-slate-50 dark:bg-slate-900/40 text-gray-400 hover:text-rose-600 rounded-lg transition" title="Delete">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );

  const AddButton = ({ onClick }: { onClick: () => void }) => (
    <button onClick={onClick} className={button.ghost + ' text-xs'}>
      <Plus className="w-3.5 h-3.5" /> Add
    </button>
  );

  const renderRowGroup = (meta: SectionMeta, rg: RowGroupMeta) => {
    const rows: Record<string, any>[] = config[meta.id]?.[rg.key] || [];
    const Icon = rg.icon;
    return (
      <SectionCard
        key={rg.key}
        title={rg.title}
        icon={Icon}
        tone="accent"
        pad="md"
        actions={<AddButton onClick={() => addRow(meta.id, rg.key, rg.newRow)} />}
      >
        <div className="space-y-2">
          {rows.length === 0 && (
            <div className="py-4 text-center text-xs text-gray-500">
              No {rg.title.toLowerCase()} configured. Click Add to create one.
            </div>
          )}
          {rows.map((row, i) => (
            <ConfigRow
              key={row.id || i}
              title={rg.rowTitle(row)}
              sub={rg.rowSub?.(row)}
              onRemove={() => removeRow(meta.id, rg.key, i)}
              onEdit={() => openEditModal(`Edit ${rg.title.slice(0, -1)}`, rg.fields, row, (v) => updateRow(meta.id, rg.key, i, v))}
            />
          ))}
        </div>
      </SectionCard>
    );
  };

  const renderFlatSettings = (meta: SectionMeta) => (
    <SectionCard title="General Settings" icon={Settings} tone="info" pad="md">
      <div className="space-y-5">
        {meta.flatSettings.map(setting => {
          const currentValue = config[meta.id]?.[setting.id] ?? setting.value;
          return (
            <div key={setting.id} className="space-y-1.5">
              <div>
                <label className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wide block">
                  {setting.name}
                </label>
                {setting.description && (
                  <p className="text-[10px] text-gray-500 mt-0.5">{setting.description}</p>
                )}
              </div>

              {setting.type === 'text' && (
                <input
                  type="text"
                  value={String(currentValue ?? '')}
                  onChange={e => handleFlatChange(meta.id, setting.id, e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
                />
              )}

              {setting.type === 'number' && (
                <input
                  type="number"
                  value={Number(currentValue ?? 0)}
                  onChange={e => handleFlatChange(meta.id, setting.id, parseInt(e.target.value, 10) || 0)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
                />
              )}

              {setting.type === 'boolean' && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleFlatChange(meta.id, setting.id, !currentValue)}
                    className={[
                      'w-12 h-6 rounded-full transition smooth-transition',
                      currentValue ? 'bg-[var(--color-accent-operations)]' : 'bg-gray-300 dark:bg-slate-600',
                    ].join(' ')}
                  >
                    <div
                      className={[
                        'w-5 h-5 rounded-full bg-white transition-all',
                        currentValue ? 'translate-x-6' : 'translate-x-0.5',
                      ].join(' ')}
                    />
                  </button>
                  <span className="text-xs font-bold text-gray-600 dark:text-gray-400">
                    {currentValue ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              )}

              {setting.type === 'select' && setting.options && (
                <select
                  value={String(currentValue ?? '')}
                  onChange={e => handleFlatChange(meta.id, setting.id, e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
                >
                  {setting.options.map(option => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );

  const currentMeta = SECTIONS.find(s => s.id === section);
  const isDirty = dirty.has(section);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Configuration"
        subtitle="Maintenance settings — work orders, PM, alerts & safety."
        icon={Settings}
        actions={
          <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            Refresh
          </button>
        }
      />

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* Section tabs — horizontal segmented control (mimics HK) */}
      <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 overflow-x-auto">
        {SECTIONS.map(s => {
          const Icon = s.icon;
          const sectionDirty = dirty.has(s.id);
          return (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition whitespace-nowrap ${
                section === s.id
                  ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {s.label}
              {sectionDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="py-12 flex items-center justify-center gap-2 text-sm text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading configuration…
        </div>
      )}

      {!loading && currentMeta && (
        <div className="space-y-4">
          {/* Flat settings + row groups in a responsive grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {renderFlatSettings(currentMeta)}
            {currentMeta.rowGroups.map(rg => renderRowGroup(currentMeta, rg))}
          </div>

          {/* Per-section Save / Reset (mimics HK) */}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => resetSection(section)}
              disabled={saving}
              className={button.ghost + ' disabled:opacity-50'}
            >
              <RotateCcw className="w-4 h-4" /> Reset to Defaults
            </button>
            <button
              onClick={() => saveSection(section)}
              disabled={saving || !isDirty}
              className={button.primary + ' disabled:opacity-50'}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save {currentMeta.label} Config
            </button>
          </div>
        </div>
      )}

      {/* Generic edit modal (mimics HK openEditModal / saveEditModal) */}
      <ModalSystem
        isOpen={editState.open}
        onClose={() => setEditState(s => ({ ...s, open: false }))}
        title={editState.title}
        variant="form"
        size="md"
        confirmLabel="Save"
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={saveEditModal}
        showFooter
      >
        <div className="space-y-4">
          {editState.fields.map(field => {
            const val = editState.values[field.key];
            return (
              <label key={field.key} className="block">
                <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{field.label}</span>
                {field.type === 'text' && (
                  <input
                    type="text"
                    value={String(val ?? '')}
                    onChange={e => setEditState(s => ({ ...s, values: { ...s.values, [field.key]: e.target.value } }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
                  />
                )}
                {field.type === 'number' && (
                  <input
                    type="number"
                    value={Number(val ?? 0)}
                    onChange={e => setEditState(s => ({ ...s, values: { ...s.values, [field.key]: parseInt(e.target.value, 10) || 0 } }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
                  />
                )}
                {field.type === 'select' && field.options && (
                  <select
                    value={String(val ?? '')}
                    onChange={e => setEditState(s => ({ ...s, values: { ...s.values, [field.key]: e.target.value } }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
                  >
                    {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                )}
                {field.type === 'boolean' && (
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setEditState(s => ({ ...s, values: { ...s.values, [field.key]: !val } }))}
                      className={[
                        'w-12 h-6 rounded-full transition',
                        val ? 'bg-[var(--color-accent-operations)]' : 'bg-gray-300 dark:bg-slate-600',
                      ].join(' ')}
                    >
                      <div
                        className={[
                          'w-5 h-5 rounded-full bg-white transition-all',
                          val ? 'translate-x-6' : 'translate-x-0.5',
                        ].join(' ')}
                      />
                    </button>
                    <span className="text-xs font-bold text-gray-600 dark:text-gray-400">
                      {val ? 'Yes' : 'No'}
                    </span>
                  </div>
                )}
              </label>
            );
          })}
        </div>
      </ModalSystem>
    </div>
  );
}

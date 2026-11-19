/**
 * Security Configuration module — /erp/security/configuration.
 * Mimics the HK ConfigurationModule / Engineering Configuration pattern
 * (migration 622 / sec_config):
 *   - Section tabs (horizontal segmented control)
 *   - Row-based config entities (add/edit/delete via generic edit modal)
 *   - Flat key-value settings (booleans, numbers, selects) alongside rows
 *   - Per-section Save / Reset buttons
 *   - Config persisted to sec_config via
 *     /api/sec-portal/config/:propertyId/:section
 *
 * Scope: 4 security sections — zones, patrols, incidents, access.
 */

import { useState, useCallback, useEffect } from 'react';
import {
  Settings, Save, MapPin, Route, AlertTriangle, KeyRound,
  Plus, Edit, Trash2, Loader2, ServerCrash, ArrowRight, RotateCcw,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader, SectionCard } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchSecConfig,
  saveSecConfig,
  SEC_CONFIG_SECTIONS,
  type SecConfigSection,
} from '../../services/securityService';

// ── Types ────────────────────────────────────────────────────────────────

type Section = SecConfigSection;

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

const ACCESS_LEVELS = ['Level 1 — Public', 'Level 2 — Staff', 'Level 3 — Restricted', 'Level 4 — Secure'];
const RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

const SECTIONS: SectionMeta[] = [
  {
    id: 'zones',
    label: 'Security Zones',
    icon: MapPin,
    flatSettings: [
      { id: 'patrol-required', name: 'Patrol Required', value: true, type: 'boolean', description: 'Zones require scheduled patrol coverage' },
      { id: 'default-check-frequency', name: 'Default Check Frequency', value: '60 min', type: 'select', options: ['30 min', '60 min', '2 hours', '4 hours'], description: 'Default interval between zone checks' },
      { id: 'zone-alert-enabled', name: 'Zone Alerts', value: true, type: 'boolean', description: 'Alert when a zone check is overdue' },
      { id: 'visitor-escort-required', name: 'Visitor Escort Required', value: true, type: 'boolean', description: 'Visitors require escort in restricted zones' },
    ],
    rowGroups: [
      {
        key: 'zones',
        title: 'Zone Register',
        icon: MapPin,
        rowTitle: r => r.label,
        rowSub: r => `${r.area || '—'} · ${r.riskLevel || 'Medium'} risk`,
        fields: [
          { key: 'label', label: 'Zone Name', type: 'text' },
          { key: 'area', label: 'Area / Floor', type: 'text' },
          { key: 'riskLevel', label: 'Risk Level', type: 'select', options: RISK_LEVELS },
          { key: 'notes', label: 'Notes', type: 'text' },
        ],
        newRow: () => ({ id: `ZN-${Date.now().toString().slice(-4)}`, label: 'New Zone', area: '', riskLevel: 'Medium', notes: '' }),
      },
    ],
  },
  {
    id: 'patrols',
    label: 'Patrol Routes',
    icon: Route,
    flatSettings: [
      { id: 'auto-generate', name: 'Auto-Generate Patrols', value: true, type: 'boolean', description: 'Create patrol tasks automatically per shift' },
      { id: 'default-interval', name: 'Default Interval (min)', value: 60, type: 'number', description: 'Minutes between scheduled patrols' },
      { id: 'require-checkpoints', name: 'Require Checkpoints', value: true, type: 'boolean', description: 'Officers must scan every checkpoint' },
      { id: 'missed-patrol-alert', name: 'Missed Patrol Alert', value: true, type: 'boolean', description: 'Alert supervisor when a patrol is missed' },
    ],
    rowGroups: [
      {
        key: 'routes',
        title: 'Route Templates',
        icon: Route,
        rowTitle: r => r.label,
        rowSub: r => `${r.zone || '—'} · ${r.checkpoints ?? 0} checkpoints · ${r.duration ?? 0} min`,
        fields: [
          { key: 'label', label: 'Route Name', type: 'text' },
          { key: 'zone', label: 'Zone', type: 'text' },
          { key: 'checkpoints', label: 'Checkpoints', type: 'number' },
          { key: 'duration', label: 'Duration (min)', type: 'number' },
        ],
        newRow: () => ({ id: `RT-${Date.now().toString().slice(-4)}`, label: 'New Route', zone: '', checkpoints: 5, duration: 30 }),
      },
    ],
  },
  {
    id: 'incidents',
    label: 'Incident Categories',
    icon: AlertTriangle,
    flatSettings: [
      { id: 'auto-escalate-critical', name: 'Auto-Escalate Critical', value: true, type: 'boolean', description: 'Critical incidents notify management instantly' },
      { id: 'default-priority', name: 'Default Priority', value: 'Medium', type: 'select', options: PRIORITIES, description: 'Priority for uncategorized incidents' },
      { id: 'response-sla-minutes', name: 'Response SLA (min)', value: 15, type: 'number', description: 'Target response time for new incidents' },
      { id: 'require-photos', name: 'Require Photo Evidence', value: true, type: 'boolean', description: 'Photos mandatory on incident reports' },
      { id: 'notify-manager', name: 'Notify Duty Manager', value: true, type: 'boolean', description: 'Duty manager copied on every incident' },
    ],
    rowGroups: [
      {
        key: 'categories',
        title: 'Categories',
        icon: AlertTriangle,
        rowTitle: r => r.label,
        rowSub: r => `${r.defaultPriority || 'Medium'} · SLA ${r.slaMinutes ?? 15}m`,
        fields: [
          { key: 'label', label: 'Category', type: 'text' },
          { key: 'defaultPriority', label: 'Default Priority', type: 'select', options: PRIORITIES },
          { key: 'slaMinutes', label: 'Response SLA (min)', type: 'number' },
        ],
        newRow: () => ({ id: `IC-${Date.now().toString().slice(-4)}`, label: 'New Category', defaultPriority: 'Medium', slaMinutes: 15 }),
      },
    ],
  },
  {
    id: 'access',
    label: 'Access Roles',
    icon: KeyRound,
    flatSettings: [
      { id: 'badge-expiry-days', name: 'Badge Expiry (days)', value: 365, type: 'number', description: 'Days before issued badges expire' },
      { id: 'tailgating-alerts', name: 'Tailgating Alerts', value: true, type: 'boolean', description: 'Alert on dual-entry events' },
      { id: 'auto-lockdown', name: 'Auto Lockdown', value: false, type: 'boolean', description: 'Lock down zones on critical alarms' },
      { id: 'visitor-pre-approval', name: 'Visitor Pre-Approval', value: true, type: 'boolean', description: 'Visitors must be pre-registered' },
    ],
    rowGroups: [
      {
        key: 'roles',
        title: 'Role Definitions',
        icon: KeyRound,
        rowTitle: r => r.label,
        rowSub: r => `${r.level || 'Level 1 — Public'} · ${r.zones || '—'}`,
        fields: [
          { key: 'label', label: 'Role Name', type: 'text' },
          { key: 'level', label: 'Access Level', type: 'select', options: ACCESS_LEVELS },
          { key: 'zones', label: 'Permitted Zones', type: 'text' },
        ],
        newRow: () => ({ id: `AR-${Date.now().toString().slice(-4)}`, label: 'New Role', level: 'Level 1 — Public', zones: '' }),
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

export default function SecurityConfiguration() {
  const { currentPropertyId, addNotification } = useERP();
  const [section, setSection] = useState<Section>('zones');

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
        SEC_CONFIG_SECTIONS.map(async (sec) => {
          try {
            const data = await fetchSecConfig(currentPropertyId, sec);
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
      await saveSecConfig(currentPropertyId, sec, config[sec]);
      setDirty(prev => {
        const next = new Set(prev);
        next.delete(sec);
        return next;
      });
      const meta = SECTIONS.find(s => s.id === sec);
      addNotification(`${meta?.label || sec} configuration saved.`, 'task', 'Security');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save configuration', 'warning', 'Security');
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
        title="Security Configuration"
        subtitle="Zones, patrol routes, incident categories & access roles."
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

      {/* Section tabs — horizontal segmented control (mimics HK/Eng) */}
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
                    {field.options.map(option => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                )}
                {field.type === 'boolean' && (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setEditState(s => ({ ...s, values: { ...s.values, [field.key]: !val } }))}
                      className={[
                        'w-12 h-6 rounded-full transition smooth-transition',
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
                      {val ? 'Enabled' : 'Disabled'}
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

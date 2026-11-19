/**
 * Spa & Wellness Configuration Module
 * DB-backed settings store (spa_settings): general scalars + per-section
 * config cards with editable key/value fields. Shared FO/HK UI.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useERP } from '../../../context/ERPContext';
import {
  Settings,
  Plus,
  Pencil,
  Trash2,
  Save,
  Sparkles,
  Users,
  Home,
  Clock,
  CheckCircle2,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  AlertCircle,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { ModalSystem } from '../../Shared/ModalSystem';
import { button, layout } from '../../FrontOffice/brandTheme';

type Section = 'general' | 'treatments' | 'memberships' | 'facilities';
type SettingStatus = 'Configured' | 'Not Configured';

interface Setting {
  id: string;
  section: Section;
  name: string;
  description: string;
  value: Record<string, any>;
  status: SettingStatus;
}

const SECTION_TABS: { id: Exclude<Section, 'general'>; name: string; icon: typeof Sparkles }[] = [
  { id: 'treatments', name: 'Treatment Setup', icon: Sparkles },
  { id: 'memberships', name: 'Membership Setup', icon: Users },
  { id: 'facilities', name: 'Facility Setup', icon: Home },
];

const DURATION_OPTIONS = ['30 minutes', '45 minutes', '60 minutes', '90 minutes', '120 minutes'];
const CANCELLATION_OPTIONS = ['24 hours notice', '12 hours notice', '6 hours notice', 'No notice required'];

const inputCls = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-spa)]';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">{label}</span>
      {children}
    </label>
  );
}

const SpaWellnessConfigurationModule: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Exclude<Section, 'general'>>('treatments');

  const [configTarget, setConfigTarget] = useState<Setting | null>(null);
  const [configFields, setConfigFields] = useState<Record<string, string>>({});
  const [newFieldKey, setNewFieldKey] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');

  const [generalDraft, setGeneralDraft] = useState<Record<string, any>>({});
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [addSectionTarget, setAddSectionTarget] = useState<Exclude<Section, 'general'> | null>(null);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Setting | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  // ── Data ──────────────────────────────────────────────────────────────────

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const prop = currentPropertyId ? `?propertyId=${currentPropertyId}` : '';
      const res = await fetch(`/api/spa-wellness/settings${prop}`, { credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const rows: Setting[] = await res.json();
      setSettings(rows);
      const draft: Record<string, any> = {};
      for (const s of rows.filter(r => r.section === 'general')) {
        draft[s.id] = s.value?.value;
      }
      setGeneralDraft(draft);
    } catch (e: any) {
      setError(e.message || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const sectionSettings = useMemo(
    () => settings.filter(s => s.section === activeTab),
    [settings, activeTab],
  );

  const stats = useMemo(() => ({
    sections: settings.filter(s => s.section !== 'general').length,
    configured: settings.filter(s => s.section !== 'general' && s.status === 'Configured').length,
    fields: settings.reduce((n, s) => n + Object.keys(s.value?.fields || {}).length, 0),
    general: settings.filter(s => s.section === 'general').length,
  }), [settings]);

  const getGeneral = (id: string) => generalDraft[id];
  const generalDirty = useMemo(() => {
    return settings.filter(s => s.section === 'general')
      .some(s => String(generalDraft[s.id] ?? '') !== String(s.value?.value ?? ''));
  }, [settings, generalDraft]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const saveGeneral = async () => {
    const changed = settings.filter(s => s.section === 'general')
      .filter(s => String(generalDraft[s.id] ?? '') !== String(s.value?.value ?? ''));
    if (!changed.length) return;
    setSavingGeneral(true);
    try {
      for (const s of changed) {
        const res = await fetch(`/api/spa-wellness/settings/${s.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ value: { value: generalDraft[s.id] } }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      }
      addNotification('General settings saved', 'success', 'Spa');
      fetchSettings();
    } catch (e: any) {
      addNotification(`Save failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setSavingGeneral(false);
    }
  };

  const openConfig = (s: Setting) => {
    setConfigTarget(s);
    setConfigFields({ ...(s.value?.fields || {}) });
    setNewFieldKey('');
    setNewFieldValue('');
  };

  const saveConfig = async () => {
    if (!configTarget) return;
    setSavingConfig(true);
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(configFields)) {
      if (k.trim()) clean[k.trim()] = v;
    }
    try {
      const res = await fetch(`/api/spa-wellness/settings/${configTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ value: { fields: clean }, status: 'Configured' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setConfigTarget(null);
      addNotification(`${configTarget.name} updated`, 'success', 'Spa');
      fetchSettings();
    } catch (e: any) {
      addNotification(`Save failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setSavingConfig(false);
    }
  };

  const addSection = async () => {
    if (!addSectionTarget || !newName.trim()) return;
    setSavingConfig(true);
    try {
      const res = await fetch('/api/spa-wellness/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          section: addSectionTarget,
          name: newName.trim(),
          description: newDesc.trim(),
          propertyId: currentPropertyId || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setAddSectionTarget(null);
      setNewName('');
      setNewDesc('');
      addNotification('Config section added', 'success', 'Spa');
      fetchSettings();
    } catch (e: any) {
      addNotification(`Add failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setSavingConfig(false);
    }
  };

  const deleteSetting = async (s: Setting) => {
    setActingOn(s.id);
    try {
      const res = await fetch(`/api/spa-wellness/settings/${s.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setSettings(prev => prev.filter(x => x.id !== s.id));
      setDeleteTarget(null);
      addNotification(`${s.name} removed`, 'success', 'Spa');
    } catch (e: any) {
      addNotification(`Delete failed: ${e.message}`, 'warning', 'Spa');
    } finally {
      setActingOn(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Configuration"
        subtitle="Treatment, membership and facility settings for the spa"
        icon={Settings}
        actions={
          <button onClick={fetchSettings} className={button.secondary}>
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Config Sections" value={stats.sections} icon={SlidersHorizontal} tone="accent" />
        <StatCard title="Configured" value={stats.configured} icon={CheckCircle2} tone="success" />
        <StatCard title="Config Fields" value={stats.fields} icon={Settings} tone="info" />
        <StatCard title="General Settings" value={stats.general} icon={Clock} tone="neutral" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {/* Section tabs + add */}
      <SectionCard pad="md">
        <div className="flex items-center gap-2">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            {SECTION_TABS.map(tab => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition ${
                    active
                      ? 'bg-[var(--color-accent-spa)] text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.name}
                </button>
              );
            })}
          </div>
          <button onClick={() => setAddSectionTarget(activeTab)} className={button.primary}>
            <Plus className="w-4 h-4" /> Add Section
          </button>
        </div>
      </SectionCard>

      {/* Section config cards */}
      <SectionCard
        title={SECTION_TABS.find(t => t.id === activeTab)?.name || ''}
        subtitle={`${sectionSettings.length} sections`}
        icon={Settings}
        tone="accent"
        pad="none"
      >
        {loading ? (
          <div className="flex items-center justify-center py-10 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
          </div>
        ) : sectionSettings.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-400">No config sections yet — add one above.</div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {sectionSettings.map(s => {
              const fields = Object.entries(s.value?.fields || {});
              return (
                <div key={s.id} className="px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-900/30 transition">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-10 h-10 shrink-0 rounded-xl bg-[var(--color-accent-spa)]/10 flex items-center justify-center">
                        <Settings className="w-5 h-5 text-[var(--color-accent-spa)]" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-slate-900 dark:text-white">{s.name}</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{s.description}</p>
                        {fields.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {fields.slice(0, 6).map(([k, v]) => (
                              <span key={k} className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                <b>{k}</b>: {String(v)}
                              </span>
                            ))}
                            {fields.length > 6 && (
                              <span className="text-[11px] px-2 py-0.5 text-slate-400">+{fields.length - 6} more</span>
                            )}
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 mt-2">
                          {s.status === 'Configured'
                            ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            : <AlertCircle className="w-3.5 h-3.5 text-amber-500" />}
                          <Badge tone={s.status === 'Configured' ? 'success' : 'warning'}>{s.status}</Badge>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => openConfig(s)} className={button.secondary}>
                        <Pencil className="w-3.5 h-3.5" /> Configure
                      </button>
                      <button onClick={() => setDeleteTarget(s)} className="p-2 text-slate-400 hover:text-[var(--color-danger)] transition">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* General settings — persisted */}
      <SectionCard
        title="General Settings"
        subtitle={generalDirty ? 'Unsaved changes' : 'Saved'}
        icon={SlidersHorizontal}
        tone="accent"
        actions={
          <button onClick={saveGeneral} disabled={savingGeneral || !generalDirty} className={button.primary}>
            {savingGeneral ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Default Appointment Duration">
            <select
              className={inputCls}
              value={getGeneral('general.default_duration') || '60 minutes'}
              onChange={e => setGeneralDraft(d => ({ ...d, 'general.default_duration': e.target.value }))}
            >
              {DURATION_OPTIONS.map(o => <option key={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Cancellation Policy">
            <select
              className={inputCls}
              value={getGeneral('general.cancellation_policy') || '12 hours notice'}
              onChange={e => setGeneralDraft(d => ({ ...d, 'general.cancellation_policy': e.target.value }))}
            >
              {CANCELLATION_OPTIONS.map(o => <option key={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Default Gratuity Rate">
            <div className="flex items-center gap-2">
              <input
                type="number" min={0} max={100}
                className={inputCls}
                value={getGeneral('general.gratuity_rate') ?? 18}
                onChange={e => setGeneralDraft(d => ({ ...d, 'general.gratuity_rate': Number(e.target.value) }))}
              />
              <span className="text-slate-500 dark:text-slate-400 text-sm">%</span>
            </div>
          </Field>
          <Field label="Tax Rate">
            <div className="flex items-center gap-2">
              <input
                type="number" min={0} max={100} step="0.1"
                className={inputCls}
                value={getGeneral('general.tax_rate') ?? 9}
                onChange={e => setGeneralDraft(d => ({ ...d, 'general.tax_rate': Number(e.target.value) }))}
              />
              <span className="text-slate-500 dark:text-slate-400 text-sm">%</span>
            </div>
          </Field>
        </div>
      </SectionCard>

      {/* ── Configure section modal ── */}
      <ModalSystem
        isOpen={!!configTarget}
        onClose={() => setConfigTarget(null)}
        onConfirm={saveConfig}
        title={configTarget?.name || ''}
        subtitle={configTarget?.description || ''}
        variant="form"
        size="lg"
        loading={savingConfig}
        confirmLabel="Save Configuration"
      >
        {configTarget && (
          <div className="space-y-3">
            {Object.entries(configFields).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <input className={inputCls + ' flex-1'} value={k} disabled />
                <input
                  className={inputCls + ' flex-1'}
                  value={v}
                  onChange={e => setConfigFields(f => ({ ...f, [k]: e.target.value }))}
                />
                <button
                  onClick={() => setConfigFields(f => { const n = { ...f }; delete n[k]; return n; })}
                  className="p-2 text-slate-400 hover:text-[var(--color-danger)] transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
              <input
                className={inputCls + ' flex-1'}
                value={newFieldKey}
                onChange={e => setNewFieldKey(e.target.value)}
                placeholder="New field name"
              />
              <input
                className={inputCls + ' flex-1'}
                value={newFieldValue}
                onChange={e => setNewFieldValue(e.target.value)}
                placeholder="Value"
              />
              <button
                onClick={() => {
                  if (newFieldKey.trim()) {
                    setConfigFields(f => ({ ...f, [newFieldKey.trim()]: newFieldValue }));
                    setNewFieldKey('');
                    setNewFieldValue('');
                  }
                }}
                className={button.secondary}
              >
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* ── Add section modal ── */}
      <ModalSystem
        isOpen={!!addSectionTarget}
        onClose={() => setAddSectionTarget(null)}
        onConfirm={addSection}
        title={`Add Section — ${SECTION_TABS.find(t => t.id === addSectionTarget)?.name || ''}`}
        variant="form"
        size="sm"
        loading={savingConfig}
        confirmLabel="Add Section"
      >
        <div className="space-y-4">
          <Field label="Section Name *">
            <input className={inputCls} value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Booking Rules" />
          </Field>
          <Field label="Description">
            <input className={inputCls} value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="What this section configures" />
          </Field>
        </div>
      </ModalSystem>

      {/* ── Delete confirm ── */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteSetting(deleteTarget)}
        title="Delete Config Section"
        variant="confirm"
        size="sm"
        loading={actingOn === deleteTarget?.id}
        confirmLabel="Delete"
        confirmColor="rose"
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Delete <b>{deleteTarget?.name}</b>? All its configured fields will be removed.
        </p>
      </ModalSystem>
    </div>
  );
};

export default SpaWellnessConfigurationModule;

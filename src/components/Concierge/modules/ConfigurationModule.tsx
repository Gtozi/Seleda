/**
 * Concierge Configuration — portal settings backed by the
 * `concierge_settings` table via /api/concierge/settings.
 *
 * Mirrors the spa_settings registry pattern: keyed rows (section.slug)
 * with a jsonb `value` payload and a Configured / Not Configured status.
 * The editor renders a control per value shape (toggle, select, number,
 * rating, time window) and a global Save that PATCHes only dirty rows.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Settings,
  SlidersHorizontal,
  Bell,
  Clock,
  Users,
  ConciergeBell,
  Save,
  Loader2,
  RefreshCw,
  Plus,
  CheckCircle2,
  AlertTriangle,
  ListChecks,
} from 'lucide-react';
import { useERP } from '../../../context/ERPContext';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout } from '../../FrontOffice/brandTheme';
import { ModalSystem } from '../../Shared/ModalSystem';
import { conciergeFetch } from '../conciergeApi';

type SettingSection = 'requests' | 'notifications' | 'hours' | 'vendors' | 'service';
type SettingStatus = 'Configured' | 'Not Configured';

interface ConciergeSetting {
  id: string;
  section: SettingSection;
  name: string;
  description: string;
  value: Record<string, any>;
  status: SettingStatus;
  updated_at?: string;
}

const API = '/api/concierge/settings';

const SECTION_META: Record<SettingSection, { label: string; icon: typeof Settings; chip: string }> = {
  requests: { label: 'Request Management', icon: SlidersHorizontal, chip: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300' },
  notifications: { label: 'Notifications', icon: Bell, chip: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300' },
  hours: { label: 'Working Hours', icon: Clock, chip: 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300' },
  vendors: { label: 'Vendor Settings', icon: Users, chip: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300' },
  service: { label: 'Service Settings', icon: ConciergeBell, chip: 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300' },
};

const SECTION_ORDER: SettingSection[] = ['requests', 'notifications', 'hours', 'vendors', 'service'];

const PRIORITY_OPTIONS = ['Low', 'Normal', 'High', 'Urgent'];

const inputCls =
  'w-full mt-1 px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm';
const toggleCls =
  'w-5 h-5 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 accent-indigo-600';

const jsonEqual = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

export default function ConfigurationModule() {
  const { addNotification } = useERP();

  const [settings, setSettings] = useState<ConciergeSetting[]>([]);
  const [draft, setDraft] = useState<Record<string, Record<string, any>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addSection, setAddSection] = useState<SettingSection>('requests');
  const [addName, setAddName] = useState('');
  const [addDescription, setAddDescription] = useState('');
  const [addEnabled, setAddEnabled] = useState(false);
  const [adding, setAdding] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await conciergeFetch(API);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load settings (${res.status})`);
      }
      const rows = (await res.json()) as ConciergeSetting[];
      setSettings(rows);
      const d: Record<string, Record<string, any>> = {};
      for (const r of rows) d[r.id] = { ...(r.value || {}) };
      setDraft(d);
    } catch (e: any) {
      setError(e.message || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const bySection = useMemo(() => {
    const map: Record<SettingSection, ConciergeSetting[]> = { requests: [], notifications: [], hours: [], vendors: [], service: [] };
    for (const s of settings) {
      if (map[s.section]) map[s.section].push(s);
    }
    return map;
  }, [settings]);

  const dirtyIds = useMemo(
    () => settings.filter(s => draft[s.id] && !jsonEqual(draft[s.id], s.value)).map(s => s.id),
    [settings, draft],
  );

  const configured = settings.filter(s => s.status === 'Configured').length;
  const notConfigured = settings.length - configured;

  const setField = (id: string, patch: Record<string, any>) =>
    setDraft(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const saveChanges = async () => {
    if (dirtyIds.length === 0) return;
    setSaving(true);
    let ok = 0;
    let fail = 0;
    await Promise.all(
      dirtyIds.map(async id => {
        try {
          const res = await conciergeFetch(`${API}/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            json: true,
            body: JSON.stringify({ value: draft[id], status: 'Configured' }),
          });
          if (!res.ok) throw new Error();
          ok++;
        } catch {
          fail++;
        }
      }),
    );
    setSaving(false);
    await fetchAll();
    if (fail === 0) addNotification(`${ok} setting(s) saved`, 'success', 'Concierge');
    else addNotification(`${ok} saved, ${fail} failed`, 'warning', 'Concierge');
  };

  const addSetting = async () => {
    if (!addName.trim()) return;
    setAdding(true);
    try {
      const res = await conciergeFetch(API, {
        method: 'POST',
        json: true,
        body: JSON.stringify({
          section: addSection,
          name: addName.trim(),
          description: addDescription.trim(),
          value: { enabled: addEnabled },
          status: 'Configured',
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to create setting (${res.status})`);
      addNotification('Setting added', 'success', 'Concierge');
      setAddOpen(false);
      setAddName('');
      setAddDescription('');
      setAddEnabled(false);
      await fetchAll();
    } catch (e: any) {
      addNotification(e.message || 'Failed to add setting', 'warning', 'Concierge');
    } finally {
      setAdding(false);
    }
  };

  // ── Value editor per jsonb shape ──────────────────────────────────
  const renderEditor = (s: ConciergeSetting) => {
    const v = draft[s.id];
    if (!v) return null;

    if ('start' in v && 'end' in v) {
      return (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-500">Start</label>
            <input type="time" value={v.start} onChange={e => setField(s.id, { start: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className="text-xs text-slate-500">End</label>
            <input type="time" value={v.end} onChange={e => setField(s.id, { end: e.target.value })} className={inputCls} />
          </div>
        </div>
      );
    }

    if ('minutes' in v) {
      return (
        <input
          type="number"
          min={1}
          value={v.minutes}
          onChange={e => setField(s.id, { minutes: parseInt(e.target.value) || 0 })}
          className={inputCls}
        />
      );
    }

    if ('rating' in v) {
      return (
        <input
          type="number"
          step="0.1"
          min={1}
          max={5}
          value={v.rating}
          onChange={e => setField(s.id, { rating: parseFloat(e.target.value) || 0 })}
          className={inputCls}
        />
      );
    }

    if ('value' in v && !('enabled' in v)) {
      return (
        <select value={v.value} onChange={e => setField(s.id, { value: e.target.value })} className={inputCls}>
          {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      );
    }

    // enabled (+ optional time) — boolean toggle row
    return (
      <div className="flex items-center gap-4">
        <input
          type="checkbox"
          checked={!!v.enabled}
          onChange={e => setField(s.id, { enabled: e.target.checked })}
          className={toggleCls}
        />
        {'time' in v && (
          <div className="flex items-center gap-2 flex-1">
            <span className="text-xs text-slate-500">at</span>
            <input
              type="time"
              value={v.time}
              disabled={!v.enabled}
              onChange={e => setField(s.id, { time: e.target.value })}
              className={`${inputCls} disabled:opacity-50`}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Configuration"
        subtitle="Concierge portal settings and preferences."
        icon={Settings}
        actions={
          <>
            <button className={button.ghost} onClick={fetchAll} disabled={loading} title="Refresh">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Refresh
            </button>
            <button className={button.secondary} onClick={() => setAddOpen(true)}>
              <Plus size={14} /> Add Setting
            </button>
            <button
              className={[button.primary, 'flex items-center gap-2'].join(' ')}
              onClick={saveChanges}
              disabled={saving || dirtyIds.length === 0}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save Changes{dirtyIds.length > 0 ? ` (${dirtyIds.length})` : ''}
            </button>
          </>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Settings" value={settings.length} icon={Settings} tone="accent" caption={`${SECTION_ORDER.filter(s => bySection[s].length).length} sections`} />
        <StatCard title="Configured" value={configured} icon={CheckCircle2} tone="success" />
        <StatCard title="Not Configured" value={notConfigured} icon={AlertTriangle} tone="warning" />
        <StatCard title="Unsaved Changes" value={dirtyIds.length} icon={ListChecks} tone="info" />
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {loading && settings.length === 0 ? (
        <SectionCard title="Loading…" icon={Settings} tone="accent">
          <div className="px-6 py-10 text-center text-slate-500">
            <Loader2 size={18} className="animate-spin inline-block mr-2" />
            Loading settings…
          </div>
        </SectionCard>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {SECTION_ORDER.map(section => {
            const rows = bySection[section];
            if (rows.length === 0) return null;
            const meta = SECTION_META[section];
            const Icon = meta.icon;
            return (
              <SectionCard
                key={section}
                title={meta.label}
                subtitle={`${rows.length} setting${rows.length === 1 ? '' : 's'}`}
                icon={Icon}
                tone="accent"
              >
                <div className="divide-y divide-slate-100 dark:divide-slate-700">
                  {rows.map(s => {
                    const dirty = dirtyIds.includes(s.id);
                    return (
                      <div key={s.id} className={`px-6 py-4 ${dirty ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''}`}>
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-slate-900 dark:text-white">{s.name}</span>
                              {s.status === 'Not Configured' && <Badge tone="warning">Not Configured</Badge>}
                              {dirty && <Badge tone="info">Modified</Badge>}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{s.description}</p>
                            <p className="text-[10px] text-slate-400 font-mono mt-0.5">{s.id}</p>
                          </div>
                          <span className={`p-2 rounded-lg ${meta.chip}`}>
                            <Icon size={16} />
                          </span>
                        </div>
                        {renderEditor(s)}
                      </div>
                    );
                  })}
                </div>
              </SectionCard>
            );
          })}
        </div>
      )}

      {/* ── Add Setting Modal ──────────────────────────────────────── */}
      <ModalSystem
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add Setting"
        subtitle="Create a new concierge configuration toggle"
        variant="form"
        size="md"
        loading={adding}
        footer={
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setAddOpen(false)}
              disabled={adding}
              className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={addSetting}
              disabled={adding || !addName.trim()}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition disabled:opacity-50 flex items-center gap-2"
            >
              {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Add Setting
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Section</label>
            <select value={addSection} onChange={e => setAddSection(e.target.value as SettingSection)} className={inputCls}>
              {SECTION_ORDER.map(s => <option key={s} value={s}>{SECTION_META[s].label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Setting Name</label>
            <input
              value={addName}
              onChange={e => setAddName(e.target.value)}
              placeholder="e.g. Weekend Surge Staffing"
              className={inputCls}
            />
            {addName.trim() && (
              <p className="text-[10px] text-slate-400 font-mono mt-1">
                {addSection}.{addName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}
              </p>
            )}
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Description</label>
            <input
              value={addDescription}
              onChange={e => setAddDescription(e.target.value)}
              placeholder="What this setting controls"
              className={inputCls}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Enabled</label>
              <p className="text-xs text-slate-500 dark:text-slate-400">Initial toggle state</p>
            </div>
            <input type="checkbox" checked={addEnabled} onChange={e => setAddEnabled(e.target.checked)} className={toggleCls} />
          </div>
        </div>
      </ModalSystem>
    </div>
  );
}

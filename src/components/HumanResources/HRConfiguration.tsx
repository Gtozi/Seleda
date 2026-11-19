/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HR Configuration — organization, attendance, payroll, and performance
 * settings.
 *
 * DB-integrated via /api/hr-portal/configuration/* routes. Uses the
 * hr_configuration table from migration 433.
 *
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Settings,
  Building2,
  Clock,
  DollarSign,
  Target,
  Save,
  Search,
  Plus,
  Trash2,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';

type ConfigGroup = 'organization' | 'attendance' | 'payroll' | 'performance';
type SettingType = 'text' | 'number' | 'boolean' | 'select';

interface HRSetting {
  id: string;
  config_group: ConfigGroup;
  category: string;
  setting_name: string;
  setting_value: string;
  setting_type: SettingType;
  sort_order: number;
}

interface Stats {
  total: number;
  groups: Record<string, number>;
  booleans: number;
  numbers: number;
}

const TABS: { id: ConfigGroup; label: string; icon: any }[] = [
  { id: 'organization', label: 'Organization', icon: Building2 },
  { id: 'attendance', label: 'Attendance', icon: Clock },
  { id: 'payroll', label: 'Payroll', icon: DollarSign },
  { id: 'performance', label: 'Performance', icon: Target },
];

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const inputCls = 'px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans';

const HRConfiguration = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [activeTab, setActiveTab] = useState<ConfigGroup>('organization');
  const [settings, setSettings] = useState<HRSetting[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, groups: {}, booleans: 0, numbers: 0 });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [showModal, setShowModal] = useState(false);

  const [form, setForm] = useState({
    category: '', name: '', value: '', type: 'text' as SettingType, sortOrder: 0,
  });

  const fetchStats = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/configuration/statistics/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setStats(await res.json());
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchSettings = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/configuration/${activeTab}/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) {
        const data = (await res.json()) as { settings: HRSetting[] };
        setSettings(data.settings || []);
      }
    } catch { /* non-fatal */ }
  }, [currentPropertyId, activeTab]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setEdits({});
    await Promise.all([fetchStats(), fetchSettings()]);
    setLoading(false);
  }, [fetchStats, fetchSettings]);

  useEffect(() => { if (currentPropertyId) refresh(); }, [currentPropertyId, activeTab]);

  const grouped = useMemo(() => {
    const cats: Record<string, HRSetting[]> = {};
    for (const s of settings) {
      if (!cats[s.category]) cats[s.category] = [];
      cats[s.category].push(s);
    }
    return Object.entries(cats).map(([category, items]) => ({ category, items: items.sort((a, b) => a.sort_order - b.sort_order) }));
  }, [settings]);

  const filtered = useMemo(() => {
    if (!search.trim()) return grouped;
    const q = search.toLowerCase();
    return grouped
      .map(({ category, items }) => ({
        category,
        items: items.filter((s) => s.setting_name.toLowerCase().includes(q) || s.setting_value.toLowerCase().includes(q)),
      }))
      .filter((g) => g.items.length > 0);
  }, [grouped, search]);

  const handleSave = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const changed = settings.filter((s) => edits[s.id] !== undefined && edits[s.id] !== s.setting_value).map((s) => ({
        id: s.id, name: s.setting_name, category: s.category, value: edits[s.id],
        type: s.setting_type, sort_order: s.sort_order,
      }));
      if (changed.length === 0) { setSaving(false); addNotification('No changes to save', 'info', 'HR'); return; }

      const res = await fetch('/api/hr-portal/configuration/bulk', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ propertyId: currentPropertyId, configGroup: activeTab, settings: changed }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Saved', 'success', 'HR');
      setEdits({}); refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const openCreate = () => {
    setForm({ category: '', name: '', value: '', type: 'text', sortOrder: settings.length });
    setShowModal(true);
  };

  const handleCreate = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const res = await fetch('/api/hr-portal/configuration/', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId, configGroup: activeTab,
          category: form.category, name: form.name, value: form.value,
          type: form.type, sortOrder: form.sortOrder,
        }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Created', 'success', 'HR');
      setShowModal(false); refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this setting?')) return;
    try {
      const res = await fetch(`/api/hr-portal/configuration/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Deleted', 'success', 'HR');
      refresh();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'HR'); }
  };

  const handleToggle = (id: string) => {
    const s = settings.find((x) => x.id === id);
    if (!s) return;
    const next = s.setting_value === 'Yes' ? 'No' : 'Yes';
    setEdits((prev) => ({ ...prev, [id]: next }));
  };

  const hasChanges = Object.keys(edits).some((id) => edits[id] !== settings.find((s) => s.id === id)?.setting_value);

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="HR Configuration" subtitle="Configure HR settings, attendance rules, payroll parameters, and performance templates" icon={Settings} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Settings className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to view configuration.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="HR Configuration"
        subtitle="Configure HR settings, attendance rules, payroll parameters, and performance templates"
        icon={Settings}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refresh} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={openCreate} className={button.secondary}><Plus className="w-4 h-4" /> Add Setting</button>
            <button onClick={handleSave} disabled={saving || !hasChanges} className={button.primary}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Settings" value={String(stats.total)} caption="Across all groups" icon={Settings} tone="accent" />
        {TABS.map((t) => <StatCard key={t.id} title={t.label} value={String(stats.groups[t.id] ?? 0)} caption={String(stats.groups[t.id] ?? 0)} icon={t.icon} tone="neutral" />)}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
        {TABS.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${activeTab === tab.id ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
            <tab.icon size={14} /> {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
        <input type="text" placeholder="Search settings..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans" />
      </div>

      {/* Settings grouped by category */}
      {loading ? (
        <SectionCard>
          <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
        </SectionCard>
      ) : filtered.length === 0 ? (
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-12 text-slate-400"><Settings className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No settings found.</p></div>
        </SectionCard>
      ) : (
        filtered.map(({ category, items }) => (
          <SectionCard key={category} title={category} icon={Settings} tone="accent">
            <div className="p-6 space-y-4">
              {items.map((s) => (
                <div key={s.id} className="flex items-center justify-between py-3 border-b border-slate-50 dark:border-slate-800 last:border-0">
                  <div className="flex-1 min-w-0 pr-4">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{s.setting_name}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase">{s.setting_type}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {s.setting_type === 'boolean' ? (
                      <button
                        onClick={() => handleToggle(s.id)}
                        className={`w-10 h-6 rounded-full transition-colors ${(edits[s.id] ?? s.setting_value) === 'Yes' ? 'bg-indigo-500' : 'bg-slate-300'}`}
                      >
                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${(edits[s.id] ?? s.setting_value) === 'Yes' ? 'translate-x-5' : 'translate-x-1'}`} />
                      </button>
                    ) : (
                      <input
                        type={s.setting_type === 'number' ? 'number' : 'text'}
                        value={edits[s.id] ?? s.setting_value}
                        onChange={(e) => setEdits((prev) => ({ ...prev, [s.id]: e.target.value }))}
                        className={`${inputCls} w-32 sm:w-48`}
                      />
                    )}
                    <button onClick={() => handleDelete(s.id)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={14} className="text-rose-400" /></button>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        ))
      )}

      {/* Add modal */}
      <ModalSystem
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleCreate}
        title="Add Setting"
        variant="form"
        size="md"
        confirmLabel={saving ? 'Creating…' : 'Create'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid gap-4">
          <label className="block"><span className="block text-xs font-bold text-gray-500 uppercase mb-1.5">Category</span><input className={inputCls} value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))} /></label>
          <label className="block"><span className="block text-xs font-bold text-gray-500 uppercase mb-1.5">Name</span><input className={inputCls} value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} /></label>
          <div className="grid grid-cols-2 gap-4">
            <label className="block"><span className="block text-xs font-bold text-gray-500 uppercase mb-1.5">Value</span><input className={inputCls} value={form.value} onChange={(e) => setForm(f => ({ ...f, value: e.target.value }))} /></label>
            <label className="block"><span className="block text-xs font-bold text-gray-500 uppercase mb-1.5">Type</span>
              <select className={inputCls} value={form.type} onChange={(e) => setForm(f => ({ ...f, type: e.target.value as SettingType }))}>
                {['text', 'number', 'boolean', 'select'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default HRConfiguration;

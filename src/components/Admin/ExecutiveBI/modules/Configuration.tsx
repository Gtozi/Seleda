/**
 * Configuration Module
 *
 * Live data from GET /api/executive/configuration:
 * - KPI Setup: metric_definitions + alert_rules
 * - Analytics Setup: health_alert_rules + reporting_snapshots
 *
 * Admin-owned settings (module registry, property/org settings, report
 * schedules, per-portal section configs) are excluded — they are managed in
 * the Admin portal / department portals, not here.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Settings,
  Target,
  Database,
  Download,
  RefreshCw,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  Search,
  Pencil,
} from 'lucide-react';
import { useERP } from '../../../../context/ERPContext';
import { ModalSystem } from '../../../Shared/ModalSystem';
import {
  fetchConfiguration,
  updateExecConfig,
  ConfigurationResponse,
} from '../../../../services/executiveService';

type CfgCategory = 'dashboard' | 'kpi' | 'analytics';

const CFG_CATEGORIES: { id: CfgCategory | 'all'; label: string; icon: any }[] = [
  { id: 'all', label: 'All Settings', icon: Settings },
  { id: 'kpi', label: 'KPI Setup', icon: Target },
  { id: 'analytics', label: 'Analytics Setup', icon: Database },
];

const Configuration = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [data, setData] = useState<ConfigurationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<CfgCategory | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [search, setSearch] = useState('');
  const [editItem, setEditItem] = useState<ConfigurationResponse['items'][number] | null>(null);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchConfiguration(currentPropertyId));
    } catch (e: any) {
      setError(e?.message || 'Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId]);

  const openEdit = (item: ConfigurationResponse['items'][number]) => {
    if (!item.kind || !item.rawId) return;
    if (item.kind === 'metric') {
      const m = data?.kpiMetrics.find(x => x.id === item.rawId);
      setDraft({ target_value: m?.target ?? '', direction: m?.direction || 'HigherIsBetter' });
    } else {
      const r = data?.alertRules.find(x => x.id === item.rawId);
      setDraft({
        threshold: r?.threshold ?? '', severity: r?.severity || 'Warning',
        is_active: r?.isActive ?? true, notify_channel: r?.channel || 'InApp',
        threshold_value: r?.threshold ?? '', alert_severity: r?.severity || 'warning',
      });
    }
    setEditItem(item);
  };

  const saveEdit = async () => {
    if (!editItem?.kind || !editItem.rawId) return;
    setSaving(true);
    try {
      const updates: Record<string, any> = {};
      if (editItem.kind === 'metric') {
        updates.target_value = draft.target_value;
        updates.direction = draft.direction;
      } else if (editItem.kind === 'rule') {
        updates.threshold = draft.threshold;
        updates.severity = draft.severity;
        updates.is_active = draft.is_active;
        updates.notify_channel = draft.notify_channel;
      } else {
        updates.threshold_value = draft.threshold_value;
        updates.alert_severity = draft.alert_severity;
        updates.is_active = draft.is_active;
      }
      await updateExecConfig(editItem.kind, editItem.rawId, updates);
      addNotification(`${editItem.name} updated`, 'success', 'Executive');
      setEditItem(null);
      await load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save configuration', 'warning', 'Executive');
    } finally {
      setSaving(false);
    }
  };

  const filteredItems = useMemo(() => {
    if (!data) return [];
    let items = data.items;
    if (selectedCategory !== 'all') items = items.filter(i => i.category === selectedCategory);
    if (statusFilter !== 'all') items = items.filter(i => i.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(i =>
        i.name.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        i.source.toLowerCase().includes(q));
    }
    return items;
  }, [data, selectedCategory, statusFilter, search]);

  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    (data?.items || []).forEach(i => m.set(i.category, (m.get(i.category) || 0) + 1));
    return m;
  }, [data]);

  const exportCsv = () => {
    const header = 'Name,Category,Source,Status,Last Modified,Description';
    const rows = filteredItems.map(i =>
      [i.name, i.category, i.source, i.status, i.lastModified || '', i.description]
        .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'executive-configuration.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <RefreshCw className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-rose-600 mx-auto mb-2" />
        <p className="text-rose-700 dark:text-rose-400 font-medium">{error}</p>
        <button onClick={load} className="mt-3 px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700">
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { summary } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Configuration</h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            {summary.total} executive settings — KPI definitions, alert rules, and data-health checks
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={load}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Refresh</span>
          </button>
          <button
            onClick={exportCsv}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>Export Config</span>
          </button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Settings', value: summary.total, color: 'text-indigo-600' },
          { label: 'Active', value: summary.active, color: 'text-emerald-600' },
          { label: 'Inactive', value: summary.inactive, color: 'text-gray-500' },
          { label: 'KPI Metrics', value: data.kpiMetrics.length, color: 'text-blue-600' },
        ].map(t => (
          <div key={t.label} className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <p className={`text-2xl font-bold ${t.color}`}>{t.value}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t.label}</p>
          </div>
        ))}
      </div>

      {/* Category chips + search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {CFG_CATEGORIES.map(cat => {
            const Icon = cat.icon;
            const count = cat.id === 'all' ? summary.total : (categoryCounts.get(cat.id) || 0);
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                  selectedCategory === cat.id
                    ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500 dark:border-indigo-400 text-indigo-700 dark:text-indigo-300'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-indigo-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                {cat.label}
                <span className="px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-xs">{count}</span>
              </button>
            );
          })}
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as any)}
          className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search settings…"
            className="w-full pl-9 pr-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm"
          />
        </div>
      </div>

      {/* Config items */}
      {filteredItems.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-12 text-center text-gray-500 dark:text-gray-400">
          No configuration items match the current filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredItems.map(item => (
            <div
              key={item.id}
              className="bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow"
            >
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <h3 className="font-semibold text-gray-900 dark:text-white">{item.name}</h3>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400">
                  {item.source}
                </span>
                {item.meta && (
                  <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                    {item.meta}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">{item.description}</p>
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 text-xs">
                <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                  <Clock className="w-3 h-3" />
                  {item.lastModified ? new Date(item.lastModified).toLocaleDateString() : '—'}
                </span>
                <div className="flex items-center gap-2">
                  {item.kind && item.rawId && (
                    <button
                      onClick={() => openEdit(item)}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
                      title="Edit"
                    >
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                  )}
                  <span className={`flex items-center gap-1 font-medium ${item.status === 'active' ? 'text-emerald-600' : 'text-gray-500'}`}>
                    {item.status === 'active' ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                    {item.status}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {data.properties.length > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Scope: {data.properties.map(p => p.name).join(', ')}
        </p>
      )}

      {/* Edit modal — executive-owned config only (metric / rule / health) */}
      <ModalSystem
        isOpen={!!editItem}
        onClose={() => setEditItem(null)}
        title={editItem?.name || 'Edit Configuration'}
        subtitle={editItem ? `${editItem.source} · ${editItem.category}` : ''}
        variant="form"
        size="md"
        showFooter={true}
        cancelLabel="Cancel"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        onConfirm={saveEdit}
        loading={saving}
      >
        {editItem && (
          <div className="space-y-4 text-sm">
            {editItem.kind === 'metric' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Target Value</label>
                  <input type="number" value={draft.target_value ?? ''}
                    onChange={e => setDraft(d => ({ ...d, target_value: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Direction</label>
                  <select value={draft.direction}
                    onChange={e => setDraft(d => ({ ...d, direction: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                    <option value="HigherIsBetter">Higher is better</option>
                    <option value="LowerIsBetter">Lower is better</option>
                    <option value="Neutral">Neutral</option>
                  </select>
                </div>
              </>
            )}
            {editItem.kind === 'rule' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Threshold</label>
                  <input type="number" value={draft.threshold ?? ''}
                    onChange={e => setDraft(d => ({ ...d, threshold: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Severity</label>
                    <select value={draft.severity}
                      onChange={e => setDraft(d => ({ ...d, severity: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                      <option value="Info">Info</option>
                      <option value="Warning">Warning</option>
                      <option value="Critical">Critical</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Notify Channel</label>
                    <select value={draft.notify_channel}
                      onChange={e => setDraft(d => ({ ...d, notify_channel: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                      <option value="InApp">In-App</option>
                      <option value="Email">Email</option>
                      <option value="SMS">SMS</option>
                      <option value="Both">Both</option>
                    </select>
                  </div>
                </div>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={!!draft.is_active}
                    onChange={e => setDraft(d => ({ ...d, is_active: e.target.checked }))}
                    className="w-4 h-4 rounded border-gray-300" />
                  <span className="text-gray-700 dark:text-gray-300">Rule active</span>
                </label>
              </>
            )}
            {editItem.kind === 'health' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Threshold Value</label>
                  <input type="text" value={draft.threshold_value ?? ''}
                    onChange={e => setDraft(d => ({ ...d, threshold_value: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Severity</label>
                  <select value={draft.alert_severity}
                    onChange={e => setDraft(d => ({ ...d, alert_severity: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                    <option value="info">Info</option>
                    <option value="warning">Warning</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={!!draft.is_active}
                    onChange={e => setDraft(d => ({ ...d, is_active: e.target.checked }))}
                    className="w-4 h-4 rounded border-gray-300" />
                  <span className="text-gray-700 dark:text-gray-300">Check active</span>
                </label>
              </>
            )}
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default Configuration;

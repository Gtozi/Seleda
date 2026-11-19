/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Transportation Configuration — DB-integrated settings lists backed by
 * `transport_config_items` (migration 522) via /api/transport/config.
 * Follows the shared F&B / HK ERP component pattern.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Settings,
  Car,
  MapPin,
  Users,
  Fuel,
  Plus,
  Edit,
  Trash2,
  Save,
  Loader2,
  RefreshCw,
  ListChecks,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';

type ItemGroup = 'transport_type' | 'service_area' | 'vehicle_category' | 'fuel_type' | 'driver_group';
type TabId = 'transportation' | 'service' | 'fleet' | 'drivers' | 'pricing';

interface PricingRule {
  id: string;
  name: string;
  transport_type: string | null;
  rule_type: string;
  base_fare: number;
  per_km_rate: number;
  per_minute_rate: number;
  zone_from: string | null;
  zone_to: string | null;
  package_price: number | null;
  min_fare: number;
  active: boolean;
  priority: number;
}

const RULE_TYPES = ['Fixed', 'Distance-Based', 'Time-Based', 'Zone-Based', 'Package'];

interface RuleForm {
  name: string; transportType: string; ruleType: string; baseFare: string;
  perKmRate: string; perMinuteRate: string; zoneFrom: string; zoneTo: string;
  packagePrice: string; minFare: string; priority: string; active: boolean;
}

const EMPTY_RULE_FORM: RuleForm = {
  name: '', transportType: '', ruleType: 'Fixed', baseFare: '', perKmRate: '',
  perMinuteRate: '', zoneFrom: '', zoneTo: '', packagePrice: '', minFare: '', priority: '0', active: true,
};

interface ConfigItem {
  id: string;
  item_group: ItemGroup;
  name: string;
  active: boolean;
  base_rate: number | null;
  description: string | null;
  capacity: number | null;
  sort_order: number;
}

interface ConfigResponse {
  transportTypes: ConfigItem[];
  serviceAreas: ConfigItem[];
  vehicleCategories: ConfigItem[];
  fuelTypes: ConfigItem[];
  driverGroups: ConfigItem[];
}

interface ItemForm {
  name: string;
  active: boolean;
  baseRate: string;
  description: string;
  capacity: string;
}

const EMPTY_FORM: ItemForm = { name: '', active: true, baseRate: '', description: '', capacity: '' };

const GROUP_META: Record<ItemGroup, { label: string; plural: string; icon: React.ElementType; addLabel: string; extraField?: 'baseRate' | 'description' | 'capacity' }> = {
  transport_type: { label: 'Transportation Type', plural: 'Transportation Types', icon: Car, addLabel: 'Add Type', extraField: 'baseRate' },
  service_area: { label: 'Service Area', plural: 'Service Areas', icon: MapPin, addLabel: 'Add Area', extraField: 'description' },
  vehicle_category: { label: 'Vehicle Category', plural: 'Vehicle Categories', icon: Car, addLabel: 'Add Category', extraField: 'capacity' },
  fuel_type: { label: 'Fuel Type', plural: 'Fuel Types', icon: Fuel, addLabel: 'Add Type' },
  driver_group: { label: 'Driver Group', plural: 'Driver Groups', icon: Users, addLabel: 'Add Group' },
};

const TABS: { id: TabId; label: string }[] = [
  { id: 'transportation', label: 'Transportation Types' },
  { id: 'service', label: 'Service Areas' },
  { id: 'fleet', label: 'Fleet Setup' },
  { id: 'drivers', label: 'Driver Setup' },
  { id: 'pricing', label: 'Pricing Rules' },
];

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const inputCls =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white';
const labelCls = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1';

const TransportationConfiguration: React.FC = () => {
  const { currentPropertyId, addNotification, formatAmount } = useERP();
  const [activeTab, setActiveTab] = useState<TabId>('transportation');
  const [items, setItems] = useState<ConfigResponse>({
    transportTypes: [],
    serviceAreas: [],
    vehicleCategories: [],
    fuelTypes: [],
    driverGroups: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Item modal (add / edit)
  const [itemModal, setItemModal] = useState<{ open: boolean; group: ItemGroup; editing: ConfigItem | null }>({
    open: false,
    group: 'transport_type',
    editing: null,
  });
  const [form, setForm] = useState<ItemForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Pricing rules + quote tester
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [ruleModal, setRuleModal] = useState<{ open: boolean; editing: PricingRule | null }>({ open: false, editing: null });
  const [ruleForm, setRuleForm] = useState<RuleForm>(EMPTY_RULE_FORM);
  const [quote, setQuote] = useState({ type: '', distanceKm: '', durationMin: '', pickup: '', destination: '' });
  const [quoteResult, setQuoteResult] = useState<{ amount: number; ruleName: string | null } | null>(null);
  const [quoting, setQuoting] = useState(false);

  const fetchConfig = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/transport/config/${currentPropertyId}`, { headers: authHeaders() });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `Failed to load configuration (${r.status})`);
      }
      setItems((await r.json()) as ConfigResponse);
      const pr = await fetch(`/api/transport/pricing/${currentPropertyId}`, { headers: authHeaders() });
      if (pr.ok) setRules(((await pr.json()) as { rules: PricingRule[] }).rules || []);
    } catch (e: any) {
      setError(e.message);
      addNotification(e.message || 'Failed to load transportation configuration', 'warning', 'Transportation');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId, addNotification]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const groupItems = useMemo<Record<ItemGroup, ConfigItem[]>>(
    () => ({
      transport_type: items.transportTypes,
      service_area: items.serviceAreas,
      vehicle_category: items.vehicleCategories,
      fuel_type: items.fuelTypes,
      driver_group: items.driverGroups,
    }),
    [items],
  );

  const totalItems = Object.values(groupItems).reduce((s, l) => s + l.length, 0);
  const activeItems = Object.values(groupItems).reduce((s, l) => s + l.filter(i => i.active).length, 0);
  const activeTypes = items.transportTypes.filter(i => i.active).length;
  const activeAreas = items.serviceAreas.filter(i => i.active).length;

  // ── Actions ──────────────────────────────────────────────────────
  const openAdd = (group: ItemGroup) => {
    setForm(EMPTY_FORM);
    setItemModal({ open: true, group, editing: null });
  };

  const openEdit = (item: ConfigItem) => {
    setForm({
      name: item.name,
      active: item.active,
      baseRate: item.base_rate != null ? String(item.base_rate) : '',
      description: item.description || '',
      capacity: item.capacity != null ? String(item.capacity) : '',
    });
    setItemModal({ open: true, group: item.item_group, editing: item });
  };

  const saveItem = async () => {
    if (!form.name.trim()) {
      addNotification('Name is required', 'warning', 'Transportation');
      return;
    }
    setSaving(true);
    const payload: Record<string, any> = {
      name: form.name.trim(),
      active: form.active,
    };
    if (itemModal.group === 'transport_type') payload.baseRate = form.baseRate === '' ? null : parseFloat(form.baseRate);
    if (itemModal.group === 'service_area') payload.description = form.description.trim() || null;
    if (itemModal.group === 'vehicle_category') payload.capacity = form.capacity === '' ? null : parseInt(form.capacity, 10);

    try {
      const editing = itemModal.editing;
      const r = await fetch(
        editing ? `/api/transport/config/item/${editing.id}` : '/api/transport/config/item',
        {
          method: editing ? 'PUT' : 'POST',
          headers: authHeaders(true),
          body: JSON.stringify(editing ? payload : { ...payload, propertyId: currentPropertyId, itemGroup: itemModal.group }),
        },
      );
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `Save failed (${r.status})`);
      }
      addNotification(`${GROUP_META[itemModal.group].label} ${editing ? 'updated' : 'added'}`, 'success', 'Transportation');
      setItemModal({ open: false, group: itemModal.group, editing: null });
      await fetchConfig();
    } catch (e: any) {
      addNotification(e.message || 'Failed to save item', 'warning', 'Transportation');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (item: ConfigItem) => {
    try {
      const r = await fetch(`/api/transport/config/item/${item.id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({ active: !item.active }),
      });
      if (!r.ok) throw new Error('Update failed');
      await fetchConfig();
    } catch (e: any) {
      addNotification(e.message || 'Failed to update item', 'warning', 'Transportation');
    }
  };

  const deleteItem = async (item: ConfigItem) => {
    if (!window.confirm(`Delete "${item.name}"?`)) return;
    try {
      const r = await fetch(`/api/transport/config/item/${item.id}`, { method: 'DELETE', headers: authHeaders() });
      if (!r.ok) throw new Error('Delete failed');
      addNotification(`${item.name} removed`, 'success', 'Transportation');
      await fetchConfig();
    } catch (e: any) {
      addNotification(e.message || 'Failed to delete item', 'warning', 'Transportation');
    }
  };

  // ── Shared list renderer ─────────────────────────────────────────
  const renderList = (group: ItemGroup) => {
    const meta = GROUP_META[group];
    const Icon = meta.icon;
    const list = groupItems[group];
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{meta.plural}</h3>
          <button onClick={() => openAdd(group)} className={[button.primary, 'flex items-center gap-1.5 !px-3 !py-1.5 !text-sm'].join(' ')}>
            <Plus className="w-4 h-4" />
            {meta.addLabel}
          </button>
        </div>
        {list.length === 0 ? (
          <div className="py-10 text-center text-slate-400 text-sm border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
            No {meta.plural.toLowerCase()} configured yet.
          </div>
        ) : (
          <div className="space-y-3">
            {list.map(item => (
              <div
                key={item.id}
                className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600"
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${item.active ? 'bg-emerald-100 dark:bg-emerald-900' : 'bg-slate-200 dark:bg-slate-600'}`}>
                    <Icon className={`w-5 h-5 ${item.active ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`} />
                  </div>
                  <div>
                    <p className="font-medium text-slate-900 dark:text-white">{item.name}</p>
                    {group === 'transport_type' && (
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        Base Rate: {item.base_rate != null && item.base_rate > 0 ? formatAmount(item.base_rate) : 'Free'}
                      </p>
                    )}
                    {group === 'service_area' && item.description && (
                      <p className="text-sm text-slate-600 dark:text-slate-400">{item.description}</p>
                    )}
                    {group === 'vehicle_category' && item.capacity != null && (
                      <p className="text-sm text-slate-600 dark:text-slate-400">Capacity: {item.capacity} passengers</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => toggleActive(item)} title={item.active ? 'Deactivate' : 'Activate'}>
                    <Badge tone={item.active ? 'success' : 'neutral'}>{item.active ? 'Active' : 'Inactive'}</Badge>
                  </button>
                  <button
                    onClick={() => openEdit(item)}
                    className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded transition"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => deleteItem(item)}
                    className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── Pricing rules ──────────────────────────────────────────────
  const openAddRule = () => {
    setRuleForm(EMPTY_RULE_FORM);
    setRuleModal({ open: true, editing: null });
  };

  const openEditRule = (r: PricingRule) => {
    setRuleForm({
      name: r.name, transportType: r.transport_type || '', ruleType: r.rule_type,
      baseFare: String(r.base_fare), perKmRate: String(r.per_km_rate), perMinuteRate: String(r.per_minute_rate),
      zoneFrom: r.zone_from || '', zoneTo: r.zone_to || '',
      packagePrice: r.package_price != null ? String(r.package_price) : '',
      minFare: String(r.min_fare), priority: String(r.priority), active: r.active,
    });
    setRuleModal({ open: true, editing: r });
  };

  const saveRule = async () => {
    if (!ruleForm.name.trim()) {
      addNotification('Rule name is required', 'warning', 'Transportation');
      return;
    }
    setSaving(true);
    const payload = {
      name: ruleForm.name.trim(),
      transportType: ruleForm.transportType || null,
      ruleType: ruleForm.ruleType,
      baseFare: ruleForm.baseFare === '' ? 0 : parseFloat(ruleForm.baseFare),
      perKmRate: ruleForm.perKmRate === '' ? 0 : parseFloat(ruleForm.perKmRate),
      perMinuteRate: ruleForm.perMinuteRate === '' ? 0 : parseFloat(ruleForm.perMinuteRate),
      zoneFrom: ruleForm.zoneFrom || null,
      zoneTo: ruleForm.zoneTo || null,
      packagePrice: ruleForm.packagePrice === '' ? null : parseFloat(ruleForm.packagePrice),
      minFare: ruleForm.minFare === '' ? 0 : parseFloat(ruleForm.minFare),
      priority: parseInt(ruleForm.priority, 10) || 0,
      active: ruleForm.active,
    };
    try {
      const editing = ruleModal.editing;
      const r = await fetch(editing ? `/api/transport/pricing/${editing.id}` : '/api/transport/pricing', {
        method: editing ? 'PUT' : 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(editing ? payload : { ...payload, propertyId: currentPropertyId }),
      });
      if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.error || `Save failed (${r.status})`); }
      addNotification(`Pricing rule ${editing ? 'updated' : 'added'}`, 'success', 'Transportation');
      setRuleModal({ open: false, editing: null });
      await fetchConfig();
    } catch (e: any) {
      addNotification(e.message || 'Failed to save rule', 'warning', 'Transportation');
    } finally {
      setSaving(false);
    }
  };

  const deleteRule = async (r: PricingRule) => {
    if (!window.confirm(`Delete rule "${r.name}"?`)) return;
    try {
      const res = await fetch(`/api/transport/pricing/${r.id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) throw new Error('Delete failed');
      addNotification(`${r.name} removed`, 'success', 'Transportation');
      await fetchConfig();
    } catch (e: any) {
      addNotification(e.message || 'Failed to delete rule', 'warning', 'Transportation');
    }
  };

  const runQuote = async () => {
    if (!currentPropertyId) return;
    setQuoting(true);
    setQuoteResult(null);
    try {
      const qs = new URLSearchParams();
      if (quote.type) qs.set('type', quote.type);
      if (quote.distanceKm) qs.set('distanceKm', quote.distanceKm);
      if (quote.durationMin) qs.set('durationMin', quote.durationMin);
      if (quote.pickup) qs.set('pickup', quote.pickup);
      if (quote.destination) qs.set('destination', quote.destination);
      const r = await fetch(`/api/transport/pricing/quote/${currentPropertyId}?${qs}`, { headers: authHeaders() });
      if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.error || `Quote failed (${r.status})`); }
      setQuoteResult((await r.json()) as { amount: number; ruleName: string | null });
    } catch (e: any) {
      addNotification(e.message || 'Quote failed', 'warning', 'Transportation');
    } finally {
      setQuoting(false);
    }
  };

  const modalMeta = GROUP_META[itemModal.group];

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Transportation Configuration" subtitle="System settings and transportation parameters" icon={Settings} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Settings className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to manage configuration.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Transportation Configuration"
        subtitle="System settings and transportation parameters."
        icon={Settings}
        actions={
          <button onClick={fetchConfig} disabled={loading} className={[button.ghost, 'flex items-center gap-2'].join(' ')} title="Refresh">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh
          </button>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Config Items" value={totalItems} icon={ListChecks} tone="accent" />
        <StatCard title="Active Items" value={activeItems} icon={ListChecks} tone="success" />
        <StatCard title="Active Types" value={activeTypes} icon={Car} tone="info" />
        <StatCard title="Service Areas" value={activeAreas} icon={MapPin} tone="warning" caption={`of ${items.serviceAreas.length} configured`} />
      </div>

      <SectionCard>
        {/* Tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-700 -mx-6 -mt-6 mb-6 px-6">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-6 py-3 text-sm font-medium transition ${
                activeTab === t.id
                  ? 'border-b-2 border-[var(--color-accent-operations)] text-[var(--color-accent-operations)]'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error ? (
          <div className="py-10 text-center text-rose-500 text-sm">{error}</div>
        ) : loading && totalItems === 0 ? (
          <div className="py-10 text-center text-slate-500">
            <Loader2 size={18} className="animate-spin inline-block mr-2" />
            Loading configuration…
          </div>
        ) : (
          <>
            {activeTab === 'transportation' && renderList('transport_type')}
            {activeTab === 'service' && renderList('service_area')}
            {activeTab === 'fleet' && (
              <div className="space-y-8">
                {renderList('vehicle_category')}
                {renderList('fuel_type')}
              </div>
            )}
            {activeTab === 'drivers' && renderList('driver_group')}
            {activeTab === 'pricing' && (
              <div className="space-y-8">
                {/* Rules list */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Pricing Rules</h3>
                    <button onClick={openAddRule} className={[button.primary, 'flex items-center gap-1.5 !px-3 !py-1.5 !text-sm'].join(' ')}>
                      <Plus className="w-4 h-4" /> Add Rule
                    </button>
                  </div>
                  {rules.length === 0 ? (
                    <div className="py-10 text-center text-slate-400 text-sm border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
                      No pricing rules configured yet — trip amounts fall back to the transport type's base rate.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {rules.map(r => (
                        <div key={r.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-slate-900 dark:text-white">{r.name}</p>
                              <Badge tone={r.active ? 'success' : 'neutral'}>{r.active ? 'Active' : 'Inactive'}</Badge>
                              <Badge tone="info">{r.rule_type}</Badge>
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                              {r.rule_type === 'Fixed' && `Fare ${formatAmount(r.base_fare)}`}
                              {r.rule_type === 'Distance-Based' && `${formatAmount(r.base_fare)} + ${formatAmount(r.per_km_rate)}/km`}
                              {r.rule_type === 'Time-Based' && `${formatAmount(r.base_fare)} + ${formatAmount(r.per_minute_rate)}/min`}
                              {r.rule_type === 'Zone-Based' && `${r.zone_from || '*'} → ${r.zone_to || '*'} · ${formatAmount(r.package_price ?? r.base_fare)}`}
                              {r.rule_type === 'Package' && `Package ${formatAmount(r.package_price ?? r.base_fare)}`}
                              {r.transport_type ? ` · ${r.transport_type}` : ' · all types'}
                              {r.min_fare > 0 && ` · min ${formatAmount(r.min_fare)}`}
                              {` · priority ${r.priority}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => openEditRule(r)} className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded transition"><Edit className="w-4 h-4" /></button>
                            <button onClick={() => deleteRule(r)} className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded transition"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Quote tester */}
                <div className="space-y-3 border-t border-slate-100 dark:border-slate-700 pt-6">
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Quote Tester</h3>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div>
                      <label className={labelCls}>Transport Type</label>
                      <select className={inputCls} value={quote.type} onChange={e => setQuote({ ...quote, type: e.target.value })}>
                        <option value="">Any</option>
                        {items.transportTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Distance (km)</label>
                      <input type="number" min="0" className={inputCls} value={quote.distanceKm} onChange={e => setQuote({ ...quote, distanceKm: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelCls}>Duration (min)</label>
                      <input type="number" min="0" className={inputCls} value={quote.durationMin} onChange={e => setQuote({ ...quote, durationMin: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelCls}>Pickup</label>
                      <input className={inputCls} value={quote.pickup} onChange={e => setQuote({ ...quote, pickup: e.target.value })} placeholder="e.g. Airport" />
                    </div>
                    <div>
                      <label className={labelCls}>Destination</label>
                      <input className={inputCls} value={quote.destination} onChange={e => setQuote({ ...quote, destination: e.target.value })} placeholder="e.g. Hotel" />
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <button onClick={runQuote} disabled={quoting} className={[button.secondary, 'flex items-center gap-1.5'].join(' ')}>
                      {quoting ? <Loader2 size={14} className="animate-spin" /> : <ListChecks size={14} />} Get Quote
                    </button>
                    {quoteResult && (
                      <p className="text-sm text-slate-700 dark:text-slate-300">
                        <span className="font-bold text-lg text-slate-900 dark:text-white">{formatAmount(quoteResult.amount)}</span>
                        {quoteResult.ruleName ? <span className="text-slate-500"> via “{quoteResult.ruleName}”</span> : <span className="text-slate-500"> — no matching rule</span>}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </SectionCard>

      {/* ── Add / Edit item modal ─────────────────────────────────── */}
      <ModalSystem
        isOpen={itemModal.open}
        onClose={() => setItemModal({ ...itemModal, open: false })}
        title={`${itemModal.editing ? 'Edit' : 'Add'} ${modalMeta.label}`}
        variant="form"
        size="md"
        loading={saving}
        footer={
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setItemModal({ ...itemModal, open: false })}
              disabled={saving}
              className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={saveItem}
              disabled={saving}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {itemModal.editing ? 'Save Changes' : 'Add'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className={inputCls}
              placeholder={`${modalMeta.label} name`}
            />
          </div>

          {modalMeta.extraField === 'baseRate' && (
            <div>
              <label className={labelCls}>Base Rate (0 = free)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.baseRate}
                onChange={e => setForm({ ...form, baseRate: e.target.value })}
                className={inputCls}
              />
            </div>
          )}

          {modalMeta.extraField === 'description' && (
            <div>
              <label className={labelCls}>Description</label>
              <input
                type="text"
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                className={inputCls}
                placeholder="e.g. Primary service area"
              />
            </div>
          )}

          {modalMeta.extraField === 'capacity' && (
            <div>
              <label className={labelCls}>Capacity (passengers)</label>
              <input
                type="number"
                min="1"
                value={form.capacity}
                onChange={e => setForm({ ...form, capacity: e.target.value })}
                className={inputCls}
              />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.active}
              onChange={e => setForm({ ...form, active: e.target.checked })}
              className="rounded border-slate-300"
            />
            Active
          </label>
        </div>
      </ModalSystem>

      {/* ── Pricing rule modal ────────────────────────────────────── */}
      <ModalSystem
        isOpen={ruleModal.open}
        onClose={() => setRuleModal({ ...ruleModal, open: false })}
        title={`${ruleModal.editing ? 'Edit' : 'Add'} Pricing Rule`}
        variant="form"
        size="lg"
        loading={saving}
        footer={
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setRuleModal({ ...ruleModal, open: false })}
              disabled={saving}
              className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={saveRule}
              disabled={saving}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {ruleModal.editing ? 'Save Changes' : 'Add'}
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Name</label>
            <input className={inputCls} value={ruleForm.name} onChange={e => setRuleForm({ ...ruleForm, name: e.target.value })} placeholder="e.g. Airport Flat Rate" />
          </div>
          <div>
            <label className={labelCls}>Rule Type</label>
            <select className={inputCls} value={ruleForm.ruleType} onChange={e => setRuleForm({ ...ruleForm, ruleType: e.target.value })}>
              {RULE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Transport Type (blank = all)</label>
            <select className={inputCls} value={ruleForm.transportType} onChange={e => setRuleForm({ ...ruleForm, transportType: e.target.value })}>
              <option value="">All types</option>
              {items.transportTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Priority (higher wins)</label>
            <input type="number" className={inputCls} value={ruleForm.priority} onChange={e => setRuleForm({ ...ruleForm, priority: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Base Fare</label>
            <input type="number" min="0" step="0.01" className={inputCls} value={ruleForm.baseFare} onChange={e => setRuleForm({ ...ruleForm, baseFare: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Min Fare</label>
            <input type="number" min="0" step="0.01" className={inputCls} value={ruleForm.minFare} onChange={e => setRuleForm({ ...ruleForm, minFare: e.target.value })} />
          </div>
          {ruleForm.ruleType === 'Distance-Based' && (
            <div>
              <label className={labelCls}>Per-km Rate</label>
              <input type="number" min="0" step="0.01" className={inputCls} value={ruleForm.perKmRate} onChange={e => setRuleForm({ ...ruleForm, perKmRate: e.target.value })} />
            </div>
          )}
          {ruleForm.ruleType === 'Time-Based' && (
            <div>
              <label className={labelCls}>Per-minute Rate</label>
              <input type="number" min="0" step="0.01" className={inputCls} value={ruleForm.perMinuteRate} onChange={e => setRuleForm({ ...ruleForm, perMinuteRate: e.target.value })} />
            </div>
          )}
          {ruleForm.ruleType === 'Zone-Based' && (
            <>
              <div>
                <label className={labelCls}>Zone From (keyword)</label>
                <input className={inputCls} value={ruleForm.zoneFrom} onChange={e => setRuleForm({ ...ruleForm, zoneFrom: e.target.value })} placeholder="e.g. airport" />
              </div>
              <div>
                <label className={labelCls}>Zone To (keyword)</label>
                <input className={inputCls} value={ruleForm.zoneTo} onChange={e => setRuleForm({ ...ruleForm, zoneTo: e.target.value })} placeholder="e.g. hotel" />
              </div>
            </>
          )}
          {['Zone-Based', 'Package'].includes(ruleForm.ruleType) && (
            <div>
              <label className={labelCls}>Package Price</label>
              <input type="number" min="0" step="0.01" className={inputCls} value={ruleForm.packagePrice} onChange={e => setRuleForm({ ...ruleForm, packagePrice: e.target.value })} />
            </div>
          )}
          <label className="col-span-2 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={ruleForm.active} onChange={e => setRuleForm({ ...ruleForm, active: e.target.checked })} className="rounded border-slate-300" />
            Active
          </label>
        </div>
      </ModalSystem>
    </div>
  );
};

export default TransportationConfiguration;

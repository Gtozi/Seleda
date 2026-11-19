/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 *
 * Production Coordination module — F&B Portal.
 * Owns KDS Integration, Production Planning, Prep Planning, Batch Production,
 * and Kitchen Communication.
 * Per spec §11 (KDS Integration), §23 (Kitchen Production Coordination).
 */

import { useMemo, useState, useEffect } from 'react';
import {
  Layers,
  Flame,
  CalendarClock,
  ChefHat,
  Soup,
  MessageSquare,
  Plus,
  Pencil,
  Trash2,
  Search,
  Clock,
  CheckCircle2,
  AlertTriangle,
  X,
  Send,
  Monitor,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';

type SubTab = 'kds' | 'production-planning' | 'prep-planning' | 'batch-production' | 'kitchen-comms';

interface KdsStation {
  id: string;
  name: string;
  outlet_id: string;
  outlet_name: string;
  status: 'Online' | 'Offline' | 'Maintenance';
  open_tickets: number;
  avg_ticket_time: string;
  load: number;
}

interface KdsTicket {
  id: string;
  order_id: string;
  outlet_id: string;
  outlet_name: string;
  station_id: string;
  items: number;
  status: 'Queued' | 'In Progress' | 'Ready' | 'Served';
  age: string;
}

interface ProductionPlan {
  id: string;
  outlet_id: string;
  outlet_name: string;
  plan_date: string;
  meal_period: 'Breakfast' | 'Lunch' | 'Dinner' | 'All Day';
  forecast_covers: number;
  status: 'Planned' | 'In Progress' | 'Completed';
  prep_count?: number;
}

interface PrepItem {
  id: string;
  name: string;
  outlet_id: string;
  outlet_name: string;
  station: string;
  qty: number;
  unit: string;
  assignee: string;
  due_by: string;
  status: 'Pending' | 'In Progress' | 'Ready';
  plan_id?: string | null;
  plan_name?: string | null;
  batch_id?: string | null;
  batch_name?: string | null;
}

interface Batch {
  id: string;
  name: string;
  outlet_id: string;
  outlet_name: string;
  batch_type: 'Soup' | 'Sauce' | 'Stock' | 'Dough' | 'Marinade' | 'Dessert Base';
  yield_qty: number;
  yield_unit: string;
  prepared_by: string;
  status: 'Scheduled' | 'Cooking' | 'Ready' | 'Used';
  prep_count?: number;
}

interface KitchenMessage {
  id: string;
  from_station: string;
  to_station: string;
  message: string;
  priority: 'Info' | 'Urgent';
  message_time: string;
}

const SUB_TABS: { id: SubTab; label: string; icon: typeof Layers }[] = [
  { id: 'kds', label: 'KDS Integration', icon: Monitor },
  { id: 'production-planning', label: 'Production Planning', icon: CalendarClock },
  { id: 'prep-planning', label: 'Prep Planning', icon: ChefHat },
  { id: 'batch-production', label: 'Batch Production', icon: Soup },
  { id: 'kitchen-comms', label: 'Kitchen Communication', icon: MessageSquare },
];

const STATION_TONE: Record<KdsStation['status'], 'success' | 'neutral' | 'warning'> = {
  Online: 'success',
  Offline: 'neutral',
  Maintenance: 'warning',
};

const TICKET_TONE: Record<KdsTicket['status'], 'warning' | 'info' | 'success' | 'neutral'> = {
  Queued: 'warning',
  'In Progress': 'info',
  Ready: 'success',
  Served: 'neutral',
};

const PLAN_TONE: Record<ProductionPlan['status'], 'info' | 'success' | 'neutral'> = {
  Planned: 'info',
  'In Progress': 'success',
  Completed: 'neutral',
};

const PREP_TONE: Record<PrepItem['status'], 'warning' | 'info' | 'success'> = {
  Pending: 'warning',
  'In Progress': 'info',
  Ready: 'success',
};

export default function ProductionCoordination() {
  const { addNotification } = useERP();
  const [subTab, setSubTab] = useState<SubTab>('kds');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showPrepModal, setShowPrepModal] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [newMsg, setNewMsg] = useState('');
  const [newMsgPriority, setNewMsgPriority] = useState<'Info' | 'Urgent'>('Info');
  const [loading, setLoading] = useState(false);

  const [stations, setStations] = useState<KdsStation[]>([]);
  const [tickets, setTickets] = useState<KdsTicket[]>([]);
  const [productionPlans, setProductionPlans] = useState<ProductionPlan[]>([]);
  const [prepItems, setPrepItems] = useState<PrepItem[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [messages, setMessages] = useState<KitchenMessage[]>([]);
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([]);
  const [prepPlanFilter, setPrepPlanFilter] = useState<string | null>(null);

  // Real inventory-backed batch production state
  const [subRecipes, setSubRecipes] = useState<any[]>([]);
  const [recipes, setRecipes] = useState<any[]>([]);
  const [batchForm, setBatchForm] = useState<{ sub_recipe_id: string; recipe_id: string; batch_count: number; outlet_id: string }>({ sub_recipe_id: '', recipe_id: '', batch_count: 1, outlet_id: '' });
  const [batchMode, setBatchMode] = useState<'sub-recipe' | 'recipe'>('sub-recipe');
  const [productionHistory, setProductionHistory] = useState<any[]>([]);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  // Modal / editing state
  const [editingPlan, setEditingPlan] = useState<ProductionPlan | null>(null);
  const [editingPrep, setEditingPrep] = useState<PrepItem | null>(null);
  const [editingStation, setEditingStation] = useState<KdsStation | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [stationsRes, ticketsRes, plansRes, prepRes, batchesRes, messagesRes, outletsRes, subRecipesRes, recipesRes, historyRes] = await Promise.all([
        fetch('/api/fb/kds-stations'),
        fetch('/api/fb/kds-tickets'),
        fetch('/api/fb/production-plans'),
        fetch('/api/fb/prep-items'),
        fetch('/api/fb/batch-production'),
        fetch('/api/fb/kitchen-messages'),
        fetch('/api/fb/outlets'),
        fetch('/api/inventory/sub-recipes'),
        fetch('/api/inventory/recipes'),
        fetch('/api/inventory/production-history'),
      ]);
      if (stationsRes.ok && stationsRes.headers.get('content-type')?.includes('json')) setStations(await stationsRes.json());
      if (ticketsRes.ok && ticketsRes.headers.get('content-type')?.includes('json')) setTickets(await ticketsRes.json());
      if (plansRes.ok && plansRes.headers.get('content-type')?.includes('json')) setProductionPlans(await plansRes.json());
      if (prepRes.ok && prepRes.headers.get('content-type')?.includes('json')) setPrepItems(await prepRes.json());
      if (batchesRes.ok && batchesRes.headers.get('content-type')?.includes('json')) setBatches(await batchesRes.json());
      if (messagesRes.ok && messagesRes.headers.get('content-type')?.includes('json')) setMessages(await messagesRes.json());
      if (outletsRes.ok && outletsRes.headers.get('content-type')?.includes('json')) {
        const o = await outletsRes.json();
        setOutlets((o || []).map((x: any) => ({ id: x.id, name: x.name })));
      }
      if (subRecipesRes.ok && subRecipesRes.headers.get('content-type')?.includes('json')) setSubRecipes(await subRecipesRes.json());
      if (recipesRes.ok && recipesRes.headers.get('content-type')?.includes('json')) setRecipes(await recipesRes.json());
      if (historyRes.ok && historyRes.headers.get('content-type')?.includes('json')) setProductionHistory(await historyRes.json());
    } catch (err) {
      console.error('Failed to fetch production coordination data:', err);
      addNotification('Failed to load production coordination data', 'warning', 'F&B');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const stats = useMemo(() => ({
    onlineStations: stations.filter(s => s.status === 'Online').length,
    openTickets: tickets.filter(t => t.status === 'Queued' || t.status === 'In Progress').length,
    avgLoad: stations.length > 0 ? Math.round(stations.filter(s => s.status === 'Online').reduce((a, s) => a + s.load, 0) / stations.filter(s => s.status === 'Online').length || 0) : 0,
    readyPrep: prepItems.filter(p => p.status === 'Ready').length,
  }), [stations, tickets, prepItems]);

  const filteredStations = stations.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));
  const filteredTickets = tickets.filter(t => t.id.toLowerCase().includes(search.toLowerCase()));
  const filteredPlans = productionPlans.filter(p => p.outlet_id.toLowerCase().includes(search.toLowerCase()));
  const filteredPrep = prepItems.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) &&
    (!prepPlanFilter || p.plan_id === prepPlanFilter)
  );

  // Jump to prep tab filtered by a specific plan
  const viewPrepForPlan = (planId: string) => {
    setPrepPlanFilter(planId);
    setSubTab('prep-planning');
    setSearch('');
  };

  // Jump to prep tab filtered by a specific batch
  const viewPrepForBatch = (batchId: string) => {
    setPrepPlanFilter(null);
    setSubTab('prep-planning');
    setSearch('');
    // Filter prep items by batch via a temporary search on batch_name
    const batch = batches.find(b => b.id === batchId);
    if (batch) setSearch(batch.name);
  };

  // ── Generic delete handler ─────────────────────────────────────────
  const handleDelete = async (id: string, type: string, label?: string) => {
    if (!confirm(`Are you sure you want to delete this ${label || type}?`)) return;
    try {
      const res = await fetch(`/api/fb/${type}/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      addNotification(`${label || type} deleted`, 'success', 'F&B');
      fetchData();
    } catch (err) {
      console.error('Delete error:', err);
      addNotification('Failed to delete', 'warning', 'F&B');
    }
  };

  // ── KDS ticket status advancement ──────────────────────────────────
  const handleAdvanceTicket = async (t: KdsTicket) => {
    const next: KdsTicket['status'] = t.status === 'Queued' ? 'In Progress' : t.status === 'In Progress' ? 'Ready' : 'Served';
    try {
      const res = await fetch(`/api/fb/kds-tickets/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error('Failed to update ticket');
      addNotification(`Ticket ${t.id.substring(0, 8)} → ${next}`, 'info', 'F&B');
      fetchData();
    } catch (err) {
      console.error('Ticket update error:', err);
      addNotification('Failed to update ticket', 'warning', 'F&B');
    }
  };

  // ── KDS station save ───────────────────────────────────────────────
  const handleSaveStation = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingStation) return;
    const form = e.target as HTMLFormElement;
    const status = (form.elements.namedItem('status') as HTMLSelectElement).value as KdsStation['status'];
    const openTickets = parseInt((form.elements.namedItem('openTickets') as HTMLInputElement).value) || 0;
    const avgTicketTime = (form.elements.namedItem('avgTicketTime') as HTMLInputElement).value;
    const load = parseInt((form.elements.namedItem('load') as HTMLInputElement).value) || 0;
    try {
      const res = await fetch(`/api/fb/kds-stations/${editingStation.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, open_tickets: openTickets, avg_ticket_time: avgTicketTime, load }),
      });
      if (!res.ok) throw new Error('Failed to update station');
      addNotification(`Station ${editingStation.name} updated`, 'success', 'F&B');
      setEditingStation(null);
      fetchData();
    } catch (err) {
      console.error('Station update error:', err);
      addNotification('Failed to update station', 'warning', 'F&B');
    }
  };

  // ── Production plan save ───────────────────────────────────────────
  const handleSavePlan = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const outletId = (form.elements.namedItem('outletId') as HTMLSelectElement).value;
    const planDate = (form.elements.namedItem('planDate') as HTMLInputElement).value;
    const mealPeriod = (form.elements.namedItem('mealPeriod') as HTMLSelectElement).value as ProductionPlan['meal_period'];
    const forecastCovers = parseInt((form.elements.namedItem('forecastCovers') as HTMLInputElement).value) || 0;
    const status = (form.elements.namedItem('status') as HTMLSelectElement).value as ProductionPlan['status'];
    const body = { outlet_id: outletId, plan_date: planDate, meal_period: mealPeriod, forecast_covers: forecastCovers, status };
    try {
      if (editingPlan) {
        const res = await fetch(`/api/fb/production-plans/${editingPlan.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('Failed to update plan');
        addNotification('Production plan updated', 'success', 'F&B');
        setEditingPlan(null);
      } else {
        const res = await fetch('/api/fb/production-plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('Failed to create plan');
        addNotification('Production plan created', 'success', 'F&B');
        setShowModal(false);
      }
      fetchData();
    } catch (err) {
      console.error('Plan save error:', err);
      addNotification('Failed to save plan', 'warning', 'F&B');
    }
  };

  // ── Prep item save + status advancement ────────────────────────────
  const handleSavePrep = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const name = (form.elements.namedItem('name') as HTMLInputElement).value;
    const outletId = (form.elements.namedItem('outletId') as HTMLSelectElement).value;
    const station = (form.elements.namedItem('station') as HTMLInputElement).value;
    const qty = parseFloat((form.elements.namedItem('qty') as HTMLInputElement).value) || 0;
    const unit = (form.elements.namedItem('unit') as HTMLInputElement).value;
    const assignee = (form.elements.namedItem('assignee') as HTMLInputElement).value;
    const dueBy = (form.elements.namedItem('dueBy') as HTMLInputElement).value;
    const status = (form.elements.namedItem('status') as HTMLSelectElement).value as PrepItem['status'];
    const planId = (form.elements.namedItem('planId') as HTMLSelectElement).value || null;
    const batchId = (form.elements.namedItem('batchId') as HTMLSelectElement).value || null;
    const body = { name, outlet_id: outletId, station, qty, unit, assignee, due_by: dueBy, status, plan_id: planId, batch_id: batchId };
    try {
      if (editingPrep) {
        const res = await fetch(`/api/fb/prep-items/${editingPrep.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('Failed to update prep item');
        addNotification(`Prep item "${name}" updated`, 'success', 'F&B');
        setEditingPrep(null);
      } else {
        const res = await fetch('/api/fb/prep-items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('Failed to create prep item');
        addNotification(`Prep item "${name}" created`, 'success', 'F&B');
        setShowPrepModal(false);
      }
      fetchData();
    } catch (err) {
      console.error('Prep save error:', err);
      addNotification('Failed to save prep item', 'warning', 'F&B');
    }
  };

  const handleAdvancePrep = async (p: PrepItem) => {
    const next: PrepItem['status'] = p.status === 'Pending' ? 'In Progress' : 'Ready';
    try {
      const res = await fetch(`/api/fb/prep-items/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error('Failed to update prep item');
      addNotification(`"${p.name}" → ${next}`, 'info', 'F&B');
      fetchData();
    } catch (err) {
      console.error('Prep advance error:', err);
      addNotification('Failed to update prep item', 'warning', 'F&B');
    }
  };

  // ── Real inventory-backed batch production ────────────────────────
  const submitBatchProduction = async () => {
    if (batchMode === 'sub-recipe') {
      if (!batchForm.sub_recipe_id) { addNotification('Please select a sub-recipe', 'warning', 'F&B'); return; }
    } else {
      if (!batchForm.recipe_id) { addNotification('Please select a recipe', 'warning', 'F&B'); return; }
    }
    if (!batchForm.batch_count || batchForm.batch_count <= 0) { addNotification('Please enter a valid batch count', 'warning', 'F&B'); return; }
    if (!batchForm.outlet_id) { addNotification('Please select an outlet', 'warning', 'F&B'); return; }
    try {
      const url = batchMode === 'sub-recipe' ? '/api/inventory/batch-production' : '/api/inventory/recipe-batch-production';
      const body = batchMode === 'sub-recipe'
        ? { sub_recipe_id: batchForm.sub_recipe_id, batch_count: batchForm.batch_count, outlet_id: batchForm.outlet_id }
        : { recipe_id: batchForm.recipe_id, batch_count: batchForm.batch_count, outlet_id: batchForm.outlet_id };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to produce batch');
      }
      const result = await res.json();
      const unmatched = result.unmatched_ingredients?.length > 0
        ? ` (${result.unmatched_ingredients.length} unmatched)`
        : '';
      if (batchMode === 'sub-recipe') {
        addNotification(
          `Batch produced: ${result.batch_count}× ${result.sub_recipe_name} = ${result.total_yield} ${result.yield_unit}. Stock: ${result.batch_product_stock_after} ${result.yield_unit}${unmatched}`,
          'success', 'F&B'
        );
      } else {
        addNotification(
          `Recipe batch produced: ${result.batch_count}× ${result.recipe_name}. Stock: ${result.finished_product_stock_after}. Cost: $${result.total_raw_cost.toFixed(2)}${unmatched}`,
          'success', 'F&B'
        );
      }
      setShowBatchModal(false);
      setBatchForm({ sub_recipe_id: '', recipe_id: '', batch_count: 1, outlet_id: '' });
      fetchData();
    } catch (err: any) {
      addNotification(err.message || 'Failed to produce batch', 'error', 'F&B');
    }
  };

  // ── Kitchen message send ───────────────────────────────────────────
  const handleSendMessage = async () => {
    if (!newMsg.trim()) return;
    const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    try {
      const res = await fetch('/api/fb/kitchen-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_station: 'F&B Manager',
          to_station: 'All Stations',
          message: newMsg.trim(),
          priority: newMsgPriority,
          message_time: time,
        }),
      });
      if (!res.ok) throw new Error('Failed to send message');
      addNotification('Message sent to all stations', 'success', 'F&B');
      setNewMsg('');
      fetchData();
    } catch (err) {
      console.error('Send message error:', err);
      addNotification('Failed to send message', 'warning', 'F&B');
    }
  };

  return (
    <div className={['accent-fb', layout.sectionStack].join(' ')}>
      <PageHeader
        title="Production Coordination"
        subtitle="KDS integration, production planning, prep planning, batch production, and kitchen communication"
        icon={Layers}
        actions={
          <>
            <button onClick={() => fetchData()} className={button.secondary}>
              <Clock className="w-4 h-4" /> Refresh
            </button>
            {subTab === 'production-planning' && (
              <button onClick={() => setShowModal(true)} className={button.primary}>
                <Plus className="w-4 h-4" /> New Plan
              </button>
            )}
            {subTab === 'prep-planning' && (
              <button onClick={() => setShowPrepModal(true)} className={button.primary}>
                <Plus className="w-4 h-4" /> New Prep Item
              </button>
            )}
            {subTab === 'batch-production' && (
              <button onClick={() => setShowBatchModal(true)} className={button.primary}>
                <Plus className="w-4 h-4" /> Produce Batch
              </button>
            )}
          </>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Online Stations" value={stats.onlineStations} icon={Monitor} tone="success" caption={`${stations.length} total`} />
        <StatCard title="Open Tickets" value={stats.openTickets} icon={Flame} tone="warning" />
        <StatCard title="Avg Station Load" value={`${stats.avgLoad}%`} icon={Layers} tone="accent" />
        <StatCard title="Prep Ready" value={stats.readyPrep} icon={ChefHat} tone="info" />
      </div>

      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => { setSubTab(t.id); setSearch(''); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap ${
              subTab === t.id
                ? 'bg-white dark:bg-slate-700 text-[var(--color-accent-operations)] shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <t.icon className="w-4 h-4" />
            <span className="text-sm font-medium">{t.label}</span>
          </button>
        ))}
      </div>

      {subTab !== 'kitchen-comms' && (
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
          />
        </div>
      )}

      {/* KDS Stations */}
      {subTab === 'kds' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {loading ? (
            <div className="col-span-full text-center text-slate-500 py-8">Loading stations...</div>
          ) : filteredStations.length === 0 ? (
            <div className="col-span-full text-center text-slate-500 py-8">No stations found</div>
          ) : filteredStations.map(s => (
            <div key={s.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-5 card-shadow">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Monitor className="w-5 h-5 text-[var(--color-accent-operations)]" />
                  <h3 className="font-semibold text-gray-900 dark:text-white">{s.name}</h3>
                </div>
                <Badge tone={STATION_TONE[s.status]}>{s.status}</Badge>
              </div>
              <p className="text-xs text-slate-500 mb-3">{s.outlet_name || s.outlet_id}</p>
              <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                <div><p className="text-xs text-slate-500">Open Tickets</p><p className="font-semibold text-gray-900 dark:text-white">{s.open_tickets}</p></div>
                <div><p className="text-xs text-slate-500">Avg Time</p><p className="font-semibold text-gray-900 dark:text-white">{s.avg_ticket_time}</p></div>
              </div>
              <div className="mb-3">
                <div className="flex justify-between text-xs text-slate-500 mb-1"><span>Load</span><span>{s.load}%</span></div>
                <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${s.load > 70 ? 'bg-[var(--color-danger)]' : s.load > 40 ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-success)]'}`} style={{ width: `${s.load}%` }} />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-slate-700">
                <button onClick={() => setEditingStation(s)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit station"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => handleDelete(s.id, 'kds-stations', 'station')} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete station"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* KDS Tickets */}
      {subTab === 'kds' && (
        <SectionCard title="Active KDS Tickets" icon={Flame} tone="warning">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Ticket</th>
                  <th className="px-6 py-3 font-medium">Order</th>
                  <th className="px-6 py-3 font-medium">Outlet</th>
                  <th className="px-6 py-3 font-medium">Station</th>
                  <th className="px-6 py-3 font-medium">Items</th>
                  <th className="px-6 py-3 font-medium">Age</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {loading ? (
                  <tr><td colSpan={8} className="px-6 py-4 text-center text-slate-500">Loading...</td></tr>
                ) : filteredTickets.length === 0 ? (
                  <tr><td colSpan={8} className="px-6 py-4 text-center text-slate-500">No tickets found</td></tr>
                ) : filteredTickets.map(t => {
                  const station = stations.find(s => s.id === t.station_id);
                  return (
                  <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{t.id.substring(0, 8)}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{t.order_id}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{t.outlet_name || t.outlet_id}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{station?.name || t.station_id.substring(0, 8)}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{t.items}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{t.age}</td>
                    <td className="px-6 py-3"><Badge tone={TICKET_TONE[t.status]}>{t.status}</Badge></td>
                    <td className="px-6 py-3 text-right">
                      <div className="inline-flex gap-2">
                        {t.status !== 'Served' && (
                          <button onClick={() => handleAdvanceTicket(t)} className="px-2 py-1 text-xs rounded-lg bg-[var(--color-accent-operations)] text-white" title={t.status === 'Queued' ? 'Start cooking' : t.status === 'In Progress' ? 'Mark ready' : 'Mark served'}>
                            {t.status === 'Queued' ? 'Start' : t.status === 'In Progress' ? 'Ready' : 'Serve'}
                          </button>
                        )}
                        <button onClick={() => handleDelete(t.id, 'kds-tickets', 'ticket')} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete ticket"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Production Planning */}
      {subTab === 'production-planning' && (
        <SectionCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Plan</th>
                  <th className="px-6 py-3 font-medium">Outlet</th>
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium">Meal Period</th>
                  <th className="px-6 py-3 font-medium">Forecast Covers</th>
                  <th className="px-6 py-3 font-medium">Prep Items</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {loading ? (
                  <tr><td colSpan={8} className="px-6 py-4 text-center text-slate-500">Loading...</td></tr>
                ) : filteredPlans.length === 0 ? (
                  <tr><td colSpan={8} className="px-6 py-4 text-center text-slate-500">No plans found</td></tr>
                ) : filteredPlans.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{p.id.substring(0, 8)}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{p.outlet_name || p.outlet_id}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{p.plan_date}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{p.meal_period}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{p.forecast_covers}</td>
                    <td className="px-6 py-3">
                      <button onClick={() => viewPrepForPlan(p.id)} className="text-[var(--color-accent-operations)] hover:underline font-medium" title="View prep items for this plan">
                        {p.prep_count || 0} {p.prep_count === 1 ? 'item' : 'items'}
                      </button>
                    </td>
                    <td className="px-6 py-3"><Badge tone={PLAN_TONE[p.status]}>{p.status}</Badge></td>
                    <td className="px-6 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <button onClick={() => viewPrepForPlan(p.id)} className="px-2 py-1 text-xs rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600" title="View prep items">View Prep</button>
                        <button onClick={() => setEditingPlan(p)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit plan"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => handleDelete(p.id, 'production-plans', 'plan')} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete plan"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Prep Planning */}
      {subTab === 'prep-planning' && (
        <SectionCard>
          {prepPlanFilter && (
            <div className="flex items-center justify-between px-6 py-3 bg-[var(--color-accent-operations)]/10 border-b border-gray-200 dark:border-slate-700">
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Filtered by plan: <strong className="text-gray-900 dark:text-white">{productionPlans.find(pl => pl.id === prepPlanFilter)?.meal_period} {productionPlans.find(pl => pl.id === prepPlanFilter)?.plan_date}</strong>
              </span>
              <button onClick={() => setPrepPlanFilter(null)} className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline">Clear filter</button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Prep Item</th>
                  <th className="px-6 py-3 font-medium">Outlet</th>
                  <th className="px-6 py-3 font-medium">Station</th>
                  <th className="px-6 py-3 font-medium">Qty</th>
                  <th className="px-6 py-3 font-medium">Assignee</th>
                  <th className="px-6 py-3 font-medium">Due By</th>
                  <th className="px-6 py-3 font-medium">Plan</th>
                  <th className="px-6 py-3 font-medium">Batch</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {loading ? (
                  <tr><td colSpan={10} className="px-6 py-4 text-center text-slate-500">Loading...</td></tr>
                ) : filteredPrep.length === 0 ? (
                  <tr><td colSpan={10} className="px-6 py-4 text-center text-slate-500">No prep items found</td></tr>
                ) : filteredPrep.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{p.name}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{p.outlet_name || p.outlet_id}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{p.station}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{p.qty} {p.unit}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{p.assignee}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{p.due_by}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400 text-xs">{p.plan_name || <span className="text-slate-400">—</span>}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400 text-xs">{p.batch_name || <span className="text-slate-400">—</span>}</td>
                    <td className="px-6 py-3"><Badge tone={PREP_TONE[p.status]}>{p.status}</Badge></td>
                    <td className="px-6 py-3 text-right">
                      <div className="inline-flex gap-2">
                        {p.status !== 'Ready' && (
                          <button onClick={() => handleAdvancePrep(p)} className="px-2 py-1 text-xs rounded-lg bg-[var(--color-accent-operations)] text-white" title={p.status === 'Pending' ? 'Start' : 'Mark ready'}>
                            {p.status === 'Pending' ? 'Start' : 'Ready'}
                          </button>
                        )}
                        <button onClick={() => setEditingPrep(p)} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]" title="Edit prep item"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => handleDelete(p.id, 'prep-items', 'prep item')} className="p-1 text-slate-400 hover:text-[var(--color-danger)]" title="Delete prep item"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Batch Production — real inventory-backed sub-recipe production */}
      {subTab === 'batch-production' && (
        <SectionCard title="Batch Production" subtitle="Produce sub-recipe and recipe batches — deduct ingredients from inventory, add semi-finished/finished goods to stock">
          <div className="p-6 space-y-6">
            {/* Sub-Recipes table with production history */}
            <div>
              <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Sub-Recipes (Semi-Finished Goods)</h3>
              <div className="overflow-x-auto border border-gray-200 dark:border-slate-600 rounded-xl">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Name</th>
                      <th className="px-4 py-3 font-medium">Category</th>
                      <th className="px-4 py-3 font-medium">Yield / Batch</th>
                      <th className="px-4 py-3 font-medium">Portions</th>
                      <th className="px-4 py-3 font-medium">Shelf Life</th>
                      <th className="px-4 py-3 font-medium">Unit Cost</th>
                      <th className="px-4 py-3 font-medium">Stock</th>
                      <th className="px-4 py-3 font-medium">Used In</th>
                      <th className="px-4 py-3 font-medium">Ingredients</th>
                      <th className="px-4 py-3 font-medium">History</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {loading ? (
                      <tr><td colSpan={10} className="px-4 py-6 text-center text-slate-500">Loading sub-recipes...</td></tr>
                    ) : subRecipes.length === 0 ? (
                      <tr><td colSpan={10} className="px-4 py-6 text-center text-slate-500">No sub-recipes found. Sub-recipes are created in Recipe Management.</td></tr>
                    ) : subRecipes.map((sr) => {
                      const itemHistory = productionHistory.filter(h => h.item_id === sr.inventory_item_id);
                      const isExpanded = expandedItem === `sr-${sr.id}`;
                      return (
                        <>
                          <tr key={sr.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                            <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                              <div className="flex items-center gap-2">
                                <Soup className="w-4 h-4 text-[var(--color-accent-operations)]" />
                                {sr.name}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{sr.category}</td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{sr.yield_qty} {sr.yield_unit}</td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{sr.portions}</td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{sr.shelf_life_hours ? `${sr.shelf_life_hours}h` : '—'}</td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400">${sr.unit_cost.toFixed(2)}</td>
                            <td className="px-4 py-3">
                              <Badge tone={sr.current_stock > 0 ? 'success' : 'neutral'}>
                                {sr.current_stock} {sr.yield_unit}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-xs text-[var(--color-accent-operations)]">
                              {sr.used_by && sr.used_by.length > 0
                                ? sr.used_by.map((u: any) => u.menu_item_name).join(', ')
                                : '—'}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-500">
                              {sr.lines.length} items
                            </td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => setExpandedItem(isExpanded ? null : `sr-${sr.id}`)}
                                className="text-xs text-[var(--color-accent-operations)] hover:underline"
                              >
                                {itemHistory.length} {itemHistory.length === 1 ? 'record' : 'records'} {isExpanded ? '▲' : '▼'}
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-slate-50 dark:bg-slate-900/30">
                              <td colSpan={10} className="px-4 py-3">
                                <div className="ml-4 space-y-3">
                                  {/* Ingredients breakdown */}
                                  <div>
                                    <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Ingredients per batch:</div>
                                    <div className="flex flex-wrap gap-2">
                                      {sr.lines.map((line: any, idx: number) => (
                                        <span key={idx} className="text-xs px-2 py-0.5 bg-white dark:bg-slate-700 rounded-full border border-gray-200 dark:border-slate-600 text-slate-600 dark:text-slate-400">
                                          {line.ingredient_name}: {line.quantity_per_batch} {line.unit}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                  {/* Production history */}
                                  <div>
                                    <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Production history:</div>
                                    {itemHistory.length === 0 ? (
                                      <div className="text-xs text-slate-400">No production records yet.</div>
                                    ) : (
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-xs border border-gray-200 dark:border-slate-600 rounded-lg">
                                          <thead className="bg-white dark:bg-slate-800 text-left text-slate-500">
                                            <tr>
                                              <th className="px-3 py-2 font-medium">Date</th>
                                              <th className="px-3 py-2 font-medium">Qty Produced</th>
                                              <th className="px-3 py-2 font-medium">Unit Cost</th>
                                              <th className="px-3 py-2 font-medium">Total Cost</th>
                                              <th className="px-3 py-2 font-medium">Outlet</th>
                                              <th className="px-3 py-2 font-medium">By</th>
                                              <th className="px-3 py-2 font-medium">Reason</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                                            {itemHistory.slice(0, 10).map((h: any) => (
                                              <tr key={h.id}>
                                                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{new Date(h.transaction_date).toLocaleString()}</td>
                                                <td className="px-3 py-2 text-slate-700 dark:text-slate-300 font-medium">{h.quantity} {sr.yield_unit}</td>
                                                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">${Number(h.unit_cost || 0).toFixed(2)}</td>
                                                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">${Number(h.total_cost || 0).toFixed(2)}</td>
                                                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{h.to_outlet?.name || '—'}</td>
                                                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{h.performed_by || '—'}</td>
                                                <td className="px-3 py-2 text-slate-500 text-xs">{h.reason || '—'}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Recipes table with production history */}
            <div>
              <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Recipes (Finished Goods)</h3>
              <div className="overflow-x-auto border border-gray-200 dark:border-slate-600 rounded-xl">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Name</th>
                      <th className="px-4 py-3 font-medium">Portions</th>
                      <th className="px-4 py-3 font-medium">Yield</th>
                      <th className="px-4 py-3 font-medium">Unit Cost</th>
                      <th className="px-4 py-3 font-medium">Stock</th>
                      <th className="px-4 py-3 font-medium">Ingredients</th>
                      <th className="px-4 py-3 font-medium">Sub-Recipes</th>
                      <th className="px-4 py-3 font-medium">History</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {loading ? (
                      <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-500">Loading recipes...</td></tr>
                    ) : recipes.length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-500">No recipes found. Recipes are created in Recipe Management.</td></tr>
                    ) : recipes.map((r) => {
                      const itemHistory = productionHistory.filter(h => h.item_id === r.inventory_item_id);
                      const isExpanded = expandedItem === `r-${r.id}`;
                      const subRecipeLines = r.lines.filter((l: any) => l.type === 'sub-recipe');
                      const ingredientLines = r.lines.filter((l: any) => l.type === 'ingredient');
                      return (
                        <>
                          <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                            <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                              <div className="flex items-center gap-2">
                                <ChefHat className="w-4 h-4 text-[var(--color-accent-operations)]" />
                                {r.name}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{r.portions}</td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{r.yield}</td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400">${r.unit_cost.toFixed(2)}</td>
                            <td className="px-4 py-3">
                              <Badge tone={r.current_stock > 0 ? 'success' : 'neutral'}>
                                {r.current_stock} pcs
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-500">
                              {ingredientLines.length} raw
                            </td>
                            <td className="px-4 py-3 text-xs text-purple-600 dark:text-purple-400">
                              {subRecipeLines.length > 0 ? `${subRecipeLines.length} semi-finished` : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => setExpandedItem(isExpanded ? null : `r-${r.id}`)}
                                className="text-xs text-[var(--color-accent-operations)] hover:underline"
                              >
                                {itemHistory.length} {itemHistory.length === 1 ? 'record' : 'records'} {isExpanded ? '▲' : '▼'}
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-slate-50 dark:bg-slate-900/30">
                              <td colSpan={8} className="px-4 py-3">
                                <div className="ml-4 space-y-3">
                                  {/* Ingredients breakdown */}
                                  <div>
                                    <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Ingredients per portion:</div>
                                    <div className="flex flex-wrap gap-2">
                                      {r.lines.map((line: any, idx: number) => (
                                        <span key={idx} className={`text-xs px-2 py-0.5 rounded-full border ${line.type === 'sub-recipe' ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-700' : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-400 border-gray-200 dark:border-slate-600'}`}>
                                          {line.type === 'sub-recipe' ? `📦 ${line.sub_recipe_name}` : line.ingredient_name}: {line.quantity_per_portion} {line.unit}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                  {/* Production history */}
                                  <div>
                                    <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Production history:</div>
                                    {itemHistory.length === 0 ? (
                                      <div className="text-xs text-slate-400">No production records yet.</div>
                                    ) : (
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-xs border border-gray-200 dark:border-slate-600 rounded-lg">
                                          <thead className="bg-white dark:bg-slate-800 text-left text-slate-500">
                                            <tr>
                                              <th className="px-3 py-2 font-medium">Date</th>
                                              <th className="px-3 py-2 font-medium">Qty Produced</th>
                                              <th className="px-3 py-2 font-medium">Unit Cost</th>
                                              <th className="px-3 py-2 font-medium">Total Cost</th>
                                              <th className="px-3 py-2 font-medium">Outlet</th>
                                              <th className="px-3 py-2 font-medium">By</th>
                                              <th className="px-3 py-2 font-medium">Reason</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                                            {itemHistory.slice(0, 10).map((h: any) => (
                                              <tr key={h.id}>
                                                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{new Date(h.transaction_date).toLocaleString()}</td>
                                                <td className="px-3 py-2 text-slate-700 dark:text-slate-300 font-medium">{h.quantity} pcs</td>
                                                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">${Number(h.unit_cost || 0).toFixed(2)}</td>
                                                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">${Number(h.total_cost || 0).toFixed(2)}</td>
                                                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{h.to_outlet?.name || '—'}</td>
                                                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{h.performed_by || '—'}</td>
                                                <td className="px-3 py-2 text-slate-500 text-xs">{h.reason || '—'}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Global production history — real inventory transactions */}
            <div>
              <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Recent Production Activity (All Items)</h3>
              <div className="overflow-x-auto border border-gray-200 dark:border-slate-600 rounded-xl">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Product</th>
                      <th className="px-4 py-3 font-medium">Qty Produced</th>
                      <th className="px-4 py-3 font-medium">Unit Cost</th>
                      <th className="px-4 py-3 font-medium">Total Cost</th>
                      <th className="px-4 py-3 font-medium">Outlet</th>
                      <th className="px-4 py-3 font-medium">Produced By</th>
                      <th className="px-4 py-3 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {productionHistory.length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-500">No production records yet. Use "Produce Batch" to start.</td></tr>
                    ) : productionHistory.slice(0, 20).map((h: any) => {
                      const item = Array.isArray(h.item) ? h.item[0] : h.item;
                      const outlet = Array.isArray(h.to_outlet) ? h.to_outlet[0] : h.to_outlet;
                      return (
                        <tr key={h.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs">{new Date(h.transaction_date).toLocaleString()}</td>
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                            <div className="flex items-center gap-2">
                              <ChefHat className="w-4 h-4 text-[var(--color-accent-operations)]" />
                              {item?.name || 'Unknown'}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-700 dark:text-slate-300 font-medium">
                            {h.quantity} {item?.unit_of_measure || ''}
                          </td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">${Number(h.unit_cost || 0).toFixed(2)}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">${Number(h.total_cost || 0).toFixed(2)}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{outlet?.name || '—'}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{h.performed_by || '—'}</td>
                          <td className="px-4 py-3 text-slate-500 text-xs">{h.reason || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Kitchen Communication */}
      {subTab === 'kitchen-comms' && (
        <SectionCard title="Kitchen Communication" icon={MessageSquare} tone="accent">
          <div className="p-6 space-y-4">
            <div className="flex gap-2">
              <input
                value={newMsg}
                onChange={e => setNewMsg(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSendMessage(); }}
                placeholder="Broadcast to all stations..."
                className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
              />
              <select
                value={newMsgPriority}
                onChange={e => setNewMsgPriority(e.target.value as 'Info' | 'Urgent')}
                className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
              >
                <option value="Info">Info</option>
                <option value="Urgent">Urgent</option>
              </select>
              <button onClick={handleSendMessage} className={button.primary}>
                <Send className="w-4 h-4" /> Send
              </button>
            </div>
            <div className="space-y-2">
              {loading ? (
                <div className="text-center text-slate-500 py-8">Loading messages...</div>
              ) : messages.length === 0 ? (
                <div className="text-center text-slate-500 py-8">No messages found</div>
              ) : messages.map(m => (
                <div key={m.id} className={`flex items-start gap-3 p-3 rounded-xl border-l-4 ${m.priority === 'Urgent' ? 'border-l-[var(--color-danger)] bg-red-50 dark:bg-red-900/20' : 'border-l-[var(--color-info)] bg-slate-50 dark:bg-slate-700/40'}`}>
                  {m.priority === 'Urgent' ? <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5" /> : <CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-medium text-gray-900 dark:text-white">{m.from_station}</span>
                      <span>→</span>
                      <span className="font-medium text-gray-900 dark:text-white">{m.to_station}</span>
                      <span className="ml-auto">{m.message_time}</span>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{m.message}</p>
                  </div>
                  <button onClick={() => handleDelete(m.id, 'kitchen-messages', 'message')} className="p-1 text-slate-400 hover:text-[var(--color-danger)] flex-shrink-0" title="Delete message"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>
      )}

      {/* New / Edit Production Plan Modal */}
      {(showModal || editingPlan) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{editingPlan ? 'Edit Production Plan' : 'New Production Plan'}</h2>
              <button onClick={() => { setShowModal(false); setEditingPlan(null); }} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSavePlan}>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-500">Outlet</label>
                  <select name="outletId" defaultValue={editingPlan?.outlet_id || ''} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" required>
                    <option value="" disabled>Select outlet…</option>
                    {outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Date</label>
                    <input name="planDate" type="date" defaultValue={editingPlan?.plan_date || new Date().toISOString().split('T')[0]} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" required />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Meal Period</label>
                    <select name="mealPeriod" defaultValue={editingPlan?.meal_period || 'Dinner'} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                      <option>Breakfast</option><option>Lunch</option><option>Dinner</option><option>All Day</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Forecast Covers</label>
                    <input name="forecastCovers" type="number" min={0} defaultValue={editingPlan?.forecast_covers ?? ''} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" placeholder="e.g. 120" required />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Status</label>
                    <select name="status" defaultValue={editingPlan?.status || 'Planned'} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                      <option>Planned</option><option>In Progress</option><option>Completed</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="submit" className={button.primary}>{editingPlan ? 'Save' : 'Create'}</button>
                  <button type="button" onClick={() => { setShowModal(false); setEditingPlan(null); }} className={button.secondary}>Cancel</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit KDS Station Modal */}
      {editingStation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Edit Station {editingStation.name}</h2>
              <button onClick={() => setEditingStation(null)} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSaveStation}>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Status</label>
                    <select name="status" defaultValue={editingStation.status} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                      <option>Online</option><option>Offline</option><option>Maintenance</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Open Tickets</label>
                    <input name="openTickets" type="number" min={0} defaultValue={editingStation.open_tickets} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" required />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Avg Ticket Time</label>
                    <input name="avgTicketTime" defaultValue={editingStation.avg_ticket_time} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" required />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Load (%)</label>
                    <input name="load" type="number" min={0} max={100} defaultValue={editingStation.load} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" required />
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="submit" className={button.primary}>Save</button>
                  <button type="button" onClick={() => setEditingStation(null)} className={button.secondary}>Cancel</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New / Edit Prep Item Modal */}
      {(showPrepModal || editingPrep) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{editingPrep ? 'Edit Prep Item' : 'New Prep Item'}</h2>
              <button onClick={() => { setShowPrepModal(false); setEditingPrep(null); }} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSavePrep}>
              <div className="space-y-3">
                <input name="name" defaultValue={editingPrep?.name} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" placeholder="Prep item name" required />
                <div>
                  <label className="text-xs text-slate-500">Outlet</label>
                  <select name="outletId" defaultValue={editingPrep?.outlet_id || ''} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" required>
                    <option value="" disabled>Select outlet…</option>
                    {outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Station</label>
                    <input name="station" defaultValue={editingPrep?.station} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" required />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Assignee</label>
                    <input name="assignee" defaultValue={editingPrep?.assignee} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" required />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Qty</label>
                    <input name="qty" type="number" step="0.01" min={0} defaultValue={editingPrep?.qty ?? ''} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" required />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Unit</label>
                    <input name="unit" defaultValue={editingPrep?.unit} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" placeholder="kg, L, pcs" required />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Due By</label>
                    <input name="dueBy" defaultValue={editingPrep?.due_by} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white" placeholder="HH:MM" required />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-500">Status</label>
                  <select name="status" defaultValue={editingPrep?.status || 'Pending'} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                    <option>Pending</option><option>In Progress</option><option>Ready</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500">Production Plan</label>
                  <select name="planId" defaultValue={editingPrep?.plan_id || (prepPlanFilter || '')} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                    <option value="">— None —</option>
                    {productionPlans.map(pl => (
                      <option key={pl.id} value={pl.id}>{pl.meal_period} {pl.plan_date} · {pl.outlet_name || pl.outlet_id}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500">Batch (consumed from)</label>
                  <select name="batchId" defaultValue={editingPrep?.batch_id || ''} className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                    <option value="">— None —</option>
                    {batches.map(b => (
                      <option key={b.id} value={b.id}>{b.name} ({b.batch_type}, {b.status})</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="submit" className={button.primary}>{editingPrep ? 'Save' : 'Create'}</button>
                  <button type="button" onClick={() => { setShowPrepModal(false); setEditingPrep(null); }} className={button.secondary}>Cancel</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Batch Production Modal — real inventory-backed production */}
      {showBatchModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Produce Batch</h2>
              <button onClick={() => setShowBatchModal(false)} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              {/* Mode toggle: Sub-Recipe vs Recipe */}
              <div className="flex gap-2 p-1 bg-slate-100 dark:bg-slate-700/40 rounded-xl">
                <button
                  onClick={() => setBatchMode('sub-recipe')}
                  className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${batchMode === 'sub-recipe' ? 'bg-[var(--color-accent-operations)] text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
                >
                  Sub-Recipe (Semi-Finished)
                </button>
                <button
                  onClick={() => setBatchMode('recipe')}
                  className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${batchMode === 'recipe' ? 'bg-[var(--color-accent-operations)] text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
                >
                  Recipe (Finished Good)
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  {batchMode === 'sub-recipe' ? (
                    <>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Sub-Recipe (Batch Product)</label>
                      <select
                        value={batchForm.sub_recipe_id}
                        onChange={(e) => setBatchForm(prev => ({ ...prev, sub_recipe_id: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                      >
                        <option value="">Select sub-recipe...</option>
                        {subRecipes.map(sr => (
                          <option key={sr.id} value={sr.id}>
                            {sr.name} — yield: {sr.yield_qty} {sr.yield_unit}/batch, stock: {sr.current_stock} {sr.yield_unit}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Recipe (Menu Item to Produce)</label>
                      <select
                        value={batchForm.recipe_id}
                        onChange={(e) => setBatchForm(prev => ({ ...prev, recipe_id: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                      >
                        <option value="">Select recipe...</option>
                        {recipes.map(r => (
                          <option key={r.id} value={r.id}>
                            {r.name} — portions: {r.portions}, yield: {r.yield}, stock: {r.current_stock}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Batch Count</label>
                  <input
                    type="number"
                    min="1"
                    value={batchForm.batch_count}
                    onChange={(e) => setBatchForm(prev => ({ ...prev, batch_count: Number(e.target.value) }))}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Outlet (Production Location)</label>
                  <select
                    value={batchForm.outlet_id}
                    onChange={(e) => setBatchForm(prev => ({ ...prev, outlet_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                  >
                    <option value="">Select outlet...</option>
                    {outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Production preview — sub-recipe mode */}
              {batchMode === 'sub-recipe' && batchForm.sub_recipe_id && (() => {
                const sr = subRecipes.find(s => s.id === batchForm.sub_recipe_id);
                if (!sr) return null;
                const totalYield = sr.yield_qty * batchForm.batch_count;
                const portionsPerBatch = sr.portions || 1;
                const totalPortions = portionsPerBatch * batchForm.batch_count;
                return (
                  <div className="border border-gray-200 dark:border-slate-600 rounded-xl overflow-hidden">
                    <div className="bg-[var(--color-accent-operations)]/10 px-4 py-2 text-xs uppercase text-[var(--color-accent-operations)] font-medium">
                      Production Preview
                    </div>
                    <div className="p-4 space-y-3">
                      <div className="text-sm">
                        <span className="font-medium text-gray-900 dark:text-white">Will produce:</span>{' '}
                        <span className="text-[var(--color-accent-operations)] font-medium">
                          {totalYield} {sr.yield_unit} of {sr.name}
                        </span>
                        <span className="text-slate-500 ml-2">({totalPortions} portions)</span>
                      </div>

                      {/* Recipe usage info */}
                      {sr.used_by && sr.used_by.length > 0 && (
                        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                          <div className="text-xs font-medium text-blue-700 dark:text-blue-400 mb-1">Used in menu items:</div>
                          <div className="flex flex-wrap gap-2">
                            {sr.used_by.map((u: any, idx: number) => (
                              <span key={idx} className="inline-flex items-center gap-1 px-2 py-0.5 bg-white dark:bg-slate-700 rounded-full text-xs text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700">
                                {u.menu_item_name}
                                <span className="text-slate-400">· {u.portions}p</span>
                              </span>
                            ))}
                          </div>
                          <div className="text-xs text-slate-500 mt-2">
                            This batch can serve approximately <span className="font-medium text-slate-700 dark:text-slate-300">{totalPortions}</span> portions across recipes.
                          </div>
                        </div>
                      )}

                      <div>
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Raw ingredients to consume:</span>
                        <table className="w-full text-sm mt-2">
                          <thead className="text-left text-xs text-slate-500">
                            <tr>
                              <th className="py-1 font-medium">Ingredient</th>
                              <th className="py-1 font-medium">Per Batch</th>
                              <th className="py-1 font-medium">Total ({batchForm.batch_count} batches)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200 dark:divide-slate-600">
                            {sr.lines.map((line: any, idx: number) => (
                              <tr key={idx}>
                                <td className="py-1.5 text-slate-700 dark:text-slate-300">{line.ingredient_name}</td>
                                <td className="py-1.5 text-slate-600 dark:text-slate-400">{line.quantity_per_batch} {line.unit}</td>
                                <td className="py-1.5 text-slate-600 dark:text-slate-400">
                                  {(line.quantity_per_batch * batchForm.batch_count).toFixed(4)} {line.unit}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-900/40 p-2 rounded">
                        Financial posting: Dr Semi-Finished Inventory · Cr Raw Material Inventory
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Production preview — recipe mode */}
              {batchMode === 'recipe' && batchForm.recipe_id && (() => {
                const r = recipes.find(x => x.id === batchForm.recipe_id);
                if (!r) return null;
                const totalPortions = batchForm.batch_count;
                return (
                  <div className="border border-gray-200 dark:border-slate-600 rounded-xl overflow-hidden">
                    <div className="bg-[var(--color-accent-operations)]/10 px-4 py-2 text-xs uppercase text-[var(--color-accent-operations)] font-medium">
                      Production Preview
                    </div>
                    <div className="p-4 space-y-3">
                      <div className="text-sm">
                        <span className="font-medium text-gray-900 dark:text-white">Will produce:</span>{' '}
                        <span className="text-[var(--color-accent-operations)] font-medium">
                          {totalPortions} portions of {r.name}
                        </span>
                        <span className="text-slate-500 ml-2">(yield: {r.yield})</span>
                      </div>

                      <div>
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Ingredients to consume (per portion × {totalPortions}):</span>
                        <table className="w-full text-sm mt-2">
                          <thead className="text-left text-xs text-slate-500">
                            <tr>
                              <th className="py-1 font-medium">Ingredient / Batch Product</th>
                              <th className="py-1 font-medium">Type</th>
                              <th className="py-1 font-medium">Per Portion</th>
                              <th className="py-1 font-medium">Total ({totalPortions} portions)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200 dark:divide-slate-600">
                            {r.lines.map((line: any, idx: number) => (
                              <tr key={idx}>
                                <td className="py-1.5 text-slate-700 dark:text-slate-300">
                                  {line.type === 'sub-recipe' ? line.sub_recipe_name : line.ingredient_name}
                                </td>
                                <td className="py-1.5">
                                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${line.type === 'sub-recipe' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-600 dark:text-slate-300'}`}>
                                    {line.type === 'sub-recipe' ? 'Semi-Finished' : 'Raw'}
                                  </span>
                                </td>
                                <td className="py-1.5 text-slate-600 dark:text-slate-400">{line.quantity_per_portion} {line.unit}</td>
                                <td className="py-1.5 text-slate-600 dark:text-slate-400">
                                  {(line.quantity_per_portion * totalPortions).toFixed(4)} {line.unit}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-900/40 p-2 rounded">
                        Financial posting: Dr Finished Goods Inventory · Cr Raw Material + Semi-Finished Inventory
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="flex gap-3 pt-2">
                <button onClick={submitBatchProduction} className={button.primary}>Produce Batch</button>
                <button onClick={() => setShowBatchModal(false)} className={button.secondary}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Fuel Management — fuel purchases, consumption tracking, and cost analysis.
 * DB-integrated via /api/transport/fuel/* (transport_fuel_purchases + transport_fuel_cards).
 * UI follows the F&B / Housekeeping portal pattern.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Fuel,
  Search,
  Plus,
  Pencil,
  Trash2,
  TrendingUp,
  AlertTriangle,
  Loader2,
  RefreshCw,
  CreditCard,
  Ban,
  CheckCircle2,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';

interface FuelCard {
  id: string;
  card_number: string;
  masked_number: string | null;
  type: string;
  status: string;
  credit_limit: number;
  balance: number;
  assigned_vehicle: string | null;
  expiry_date: string | null;
}

interface FuelPurchase {
  id: string;
  purchase_number: string;
  purchase_date: string;
  vehicle_id: string | null;
  driver_id: string | null;
  station: string | null;
  fuel_type: string;
  gallons: number;
  price_per_gallon: number;
  total_cost: number;
  odometer: number | null;
  fuel_card_id: string | null;
  efficiency: number | null;
  flagged?: boolean;
  flag_reason?: string | null;
  transport_vehicles: { vehicle_number: string; make: string | null; model: string | null } | null;
  transport_drivers: { employees: { name: string } | null } | null;
  transport_fuel_cards: { card_number: string; type: string } | null;
}

interface Vehicle { id: string; vehicle_number: string; driver_id: string | null; }
interface Driver { id: string; employees: { name: string } | null; }

const FUEL_TYPES = ['Gasoline', 'Diesel', 'Electric', 'Hybrid'];
const CARD_STATUSES = ['Active', 'Blocked', 'Expired', 'Lost'];

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const inputCls = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans';
const filterSelectCls = 'px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs outline-none focus:ring-1 focus:ring-indigo-500 font-sans w-auto';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function cardStatusTone(status: string): StatusTone {
  switch (status) {
    case 'Active': return 'success';
    case 'Blocked': return 'danger';
    case 'Expired': return 'warning';
    case 'Lost': return 'danger';
    default: return 'neutral';
  }
}

function formatDate(d?: string | null): string {
  if (!d) return '—';
  return new Date(`${d}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

const emptyPurchaseForm = {
  purchaseDate: '', vehicleId: '', driverId: '', station: '', fuelType: 'Gasoline',
  gallons: '', pricePerGallon: '', totalCost: '', odometer: '', fuelCardId: '', efficiency: '',
};
const emptyCardForm = {
  maskedNumber: '', type: 'Shell', status: 'Active', creditLimit: '', balance: '', assignedVehicle: '', expiryDate: '',
};

const FuelManagement = () => {
  const { currentPropertyId, addNotification, formatAmount } = useERP();
  const [cards, setCards] = useState<FuelCard[]>([]);
  const [purchases, setPurchases] = useState<FuelPurchase[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [fuelTypeFilter, setFuelTypeFilter] = useState('all');
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [showCardModal, setShowCardModal] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<FuelPurchase | null>(null);
  const [editingCard, setEditingCard] = useState<FuelCard | null>(null);
  const [purchaseForm, setPurchaseForm] = useState({ ...emptyPurchaseForm });
  const [cardForm, setCardForm] = useState({ ...emptyCardForm });

  const fetchAll = useCallback(async () => {
    if (!currentPropertyId) return;
    setLoading(true);
    try {
      const [fRes, vRes, dRes] = await Promise.all([
        fetch(`/api/transport/fuel/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/transport/vehicles/${currentPropertyId}`, { headers: authHeaders() }),
        fetch(`/api/transport/drivers/${currentPropertyId}`, { headers: authHeaders() }),
      ]);
      if (fRes.ok) {
        const data = (await fRes.json()) as { cards: FuelCard[]; purchases: FuelPurchase[] };
        setCards(data.cards || []);
        setPurchases(data.purchases || []);
      }
      if (vRes.ok) setVehicles(((await vRes.json()) as { vehicles: Vehicle[] }).vehicles || []);
      if (dRes.ok) setDrivers(((await dRes.json()) as { drivers: Driver[] }).drivers || []);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [currentPropertyId]);

  useEffect(() => { if (currentPropertyId) fetchAll(); }, [currentPropertyId, fetchAll]);

  const filteredPurchases = useMemo(() => {
    let list = purchases;
    if (fuelTypeFilter !== 'all') list = list.filter((p) => p.fuel_type === fuelTypeFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) =>
        (p.transport_vehicles?.vehicle_number || '').toLowerCase().includes(q) ||
        (p.transport_drivers?.employees?.name || '').toLowerCase().includes(q) ||
        p.purchase_number.toLowerCase().includes(q) ||
        (p.station || '').toLowerCase().includes(q));
    }
    return list;
  }, [purchases, fuelTypeFilter, search]);

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const todayCost = purchases.filter((p) => p.purchase_date === today).reduce((s, p) => s + Number(p.total_cost), 0);
    const gas = purchases.filter((p) => p.fuel_type !== 'Electric' && p.efficiency != null);
    return {
      todayCost,
      avgEfficiency: gas.length ? gas.reduce((s, p) => s + Number(p.efficiency), 0) / gas.length : 0,
      activeCards: cards.filter((c) => c.status === 'Active').length,
      blockedCards: cards.filter((c) => c.status !== 'Active').length,
    };
  }, [purchases, cards]);

  const openCreatePurchase = () => {
    setEditingPurchase(null);
    setPurchaseForm({ ...emptyPurchaseForm, purchaseDate: new Date().toISOString().slice(0, 10) });
    setShowPurchaseModal(true);
  };

  const openEditPurchase = (p: FuelPurchase) => {
    setEditingPurchase(p);
    setPurchaseForm({
      purchaseDate: p.purchase_date || '',
      vehicleId: p.vehicle_id || '',
      driverId: p.driver_id || '',
      station: p.station || '',
      fuelType: p.fuel_type,
      gallons: String(p.gallons),
      pricePerGallon: String(p.price_per_gallon),
      totalCost: String(p.total_cost),
      odometer: p.odometer != null ? String(p.odometer) : '',
      fuelCardId: p.fuel_card_id || '',
      efficiency: p.efficiency != null ? String(p.efficiency) : '',
    });
    setShowPurchaseModal(true);
  };

  const openCreateCard = () => {
    setEditingCard(null);
    setCardForm({ ...emptyCardForm });
    setShowCardModal(true);
  };

  const openEditCard = (c: FuelCard) => {
    setEditingCard(c);
    setCardForm({
      maskedNumber: c.masked_number || '',
      type: c.type,
      status: c.status,
      creditLimit: String(c.credit_limit),
      balance: String(c.balance),
      assignedVehicle: c.assigned_vehicle || '',
      expiryDate: c.expiry_date || '',
    });
    setShowCardModal(true);
  };

  const handleSavePurchase = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const endpoint = editingPurchase ? `/api/transport/fuel/purchases/${editingPurchase.id}` : '/api/transport/fuel/purchases';
      const body = {
        propertyId: currentPropertyId,
        purchaseDate: purchaseForm.purchaseDate || null,
        vehicleId: purchaseForm.vehicleId || null,
        driverId: purchaseForm.driverId || null,
        station: purchaseForm.station || null,
        fuelType: purchaseForm.fuelType,
        gallons: Number(purchaseForm.gallons) || 0,
        pricePerGallon: Number(purchaseForm.pricePerGallon) || 0,
        totalCost: Number(purchaseForm.totalCost) || 0,
        odometer: purchaseForm.odometer === '' ? null : Number(purchaseForm.odometer),
        fuelCardId: purchaseForm.fuelCardId || null,
        efficiency: purchaseForm.efficiency === '' ? null : Number(purchaseForm.efficiency),
      };
      const res = await fetch(endpoint, { method: editingPurchase ? 'PUT' : 'POST', headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(editingPurchase ? 'Purchase updated' : 'Purchase recorded', 'success', 'Transportation');
      setShowPurchaseModal(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleSaveCard = async () => {
    if (!currentPropertyId) return;
    setSaving(true);
    try {
      const endpoint = editingCard ? `/api/transport/fuel/cards/${editingCard.id}` : '/api/transport/fuel/cards';
      const body = {
        propertyId: currentPropertyId,
        maskedNumber: cardForm.maskedNumber || null,
        type: cardForm.type,
        status: cardForm.status,
        creditLimit: Number(cardForm.creditLimit) || 0,
        balance: Number(cardForm.balance) || 0,
        assignedVehicle: cardForm.assignedVehicle || null,
        expiryDate: cardForm.expiryDate || null,
      };
      const res = await fetch(endpoint, { method: editingCard ? 'PUT' : 'POST', headers: authHeaders(true), body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(editingCard ? 'Card updated' : 'Card created', 'success', 'Transportation');
      setShowCardModal(false); fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleCardStatus = async (c: FuelCard, status: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/fuel/cards/${c.id}`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ status }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification(`Card ${status.toLowerCase()}`, 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleDeletePurchase = async (id: string) => {
    if (!confirm('Delete this purchase record?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/fuel/purchases/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Purchase deleted', 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  const handleDeleteCard = async (id: string) => {
    if (!confirm('Delete this fuel card?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/transport/fuel/cards/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Failed (${res.status})`); }
      addNotification('Fuel card deleted', 'success', 'Transportation');
      fetchAll();
    } catch (e: any) { addNotification(e?.message || 'Failed', 'danger', 'Transportation'); } finally { setSaving(false); }
  };

  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Fuel Management" subtitle="Fuel purchases, consumption tracking, and cost analysis" icon={Fuel} />
        <SectionCard><div className="flex flex-col items-center justify-center py-16 text-slate-400"><Fuel className="w-10 h-10 mb-3 opacity-40" /><p className="text-sm">Select a property to view fuel data.</p></div></SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Fuel Management"
        subtitle="Fuel purchases, consumption tracking, and cost analysis"
        icon={Fuel}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={fetchAll} className={button.ghost}><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={openCreateCard} className={button.secondary}><CreditCard className="w-4 h-4" /> New Card</button>
            <button onClick={openCreatePurchase} className={button.primary}><Plus className="w-4 h-4" /> Record Purchase</button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Today's Cost" value={formatAmount(stats.todayCost)} icon={Fuel} tone="accent" />
        <StatCard title="Avg Efficiency" value={`${stats.avgEfficiency.toFixed(1)} MPG`} icon={TrendingUp} tone="success" />
        <StatCard title="Active Cards" value={String(stats.activeCards)} icon={CreditCard} tone="info" />
        <StatCard title="Blocked / Inactive" value={String(stats.blockedCards)} icon={AlertTriangle} tone="warning" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Fuel Purchases */}
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Recent Purchases</h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                <input
                  placeholder="Search..."
                  className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-44 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select className={filterSelectCls} value={fuelTypeFilter} onChange={(e) => setFuelTypeFilter(e.target.value)}>
                <option value="all">All Fuels</option>
                {FUEL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="p-4 space-y-3 max-h-[480px] overflow-y-auto">
            {loading && filteredPurchases.length === 0 ? (
              <div className="flex items-center justify-center py-10 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
            ) : filteredPurchases.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400"><Fuel className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No purchases recorded.</p></div>
            ) : filteredPurchases.map((p) => (
              <div key={p.id} className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700 group">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900 dark:text-white">{p.purchase_number}</span>
                      <Badge tone={p.fuel_type === 'Electric' ? 'info' : 'neutral'}>{p.fuel_type}</Badge>
                      {p.flagged && (
                        <Badge tone="danger"><span title={p.flag_reason || 'Fuel anomaly'}><AlertTriangle className="w-3 h-3 inline mr-0.5" />{p.flag_reason || 'Flagged'}</span></Badge>
                      )}
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                      {p.transport_vehicles?.vehicle_number || '—'} - {p.transport_drivers?.employees?.name || '—'}
                    </p>
                  </div>
                  <div className="text-right flex items-start gap-1">
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{formatAmount(Number(p.total_cost))}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{formatDate(p.purchase_date)}</p>
                    </div>
                    <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition">
                      <button onClick={() => openEditPurchase(p)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition"><Pencil size={12} className="text-slate-400" /></button>
                      <button onClick={() => handleDeletePurchase(p.id)} className="p-1 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded transition"><Trash2 size={12} className="text-rose-400" /></button>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-slate-600 dark:text-slate-400">
                  <div className="truncate">{p.station || '—'}</div>
                  <div>{p.fuel_type === 'Electric' ? `${formatAmount(Number(p.price_per_gallon))}/kWh` : `${Number(p.gallons)} gal @ ${formatAmount(Number(p.price_per_gallon))}/gal`}</div>
                  <div>{p.efficiency != null ? `${p.efficiency} ${p.fuel_type === 'Electric' ? 'mi/kWh' : 'MPG'}` : '—'}</div>
                </div>
                {p.transport_fuel_cards && (
                  <p className="text-[10px] text-slate-400 mt-1">Card {p.transport_fuel_cards.card_number} · {p.transport_fuel_cards.type}</p>
                )}
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Fuel Cards */}
        <SectionCard pad="none">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800"><h3 className="text-base font-semibold text-slate-900 dark:text-white">Fuel Cards</h3></div>
          <div className="p-4 space-y-3 max-h-[480px] overflow-y-auto">
            {cards.length === 0 && !loading ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400"><CreditCard className="w-8 h-8 mb-2 opacity-40" /><p className="text-sm">No fuel cards.</p></div>
            ) : cards.map((c) => {
              const pct = Number(c.credit_limit) > 0 ? Math.min(100, (Number(c.balance) / Number(c.credit_limit)) * 100) : 0;
              return (
                <div key={c.id} className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700 group">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900 dark:text-white">{c.card_number}</span>
                        <Badge tone={cardStatusTone(c.status)}>{c.status}</Badge>
                      </div>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                        {c.type} • {c.masked_number || '—'}
                        {c.assigned_vehicle ? ` • ${c.assigned_vehicle}` : ''}
                      </p>
                    </div>
                    <div className="text-right flex items-start gap-1">
                      <div>
                        <p className="text-sm font-medium text-slate-900 dark:text-white">{formatAmount(Number(c.balance))}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">of {formatAmount(Number(c.credit_limit))}</p>
                      </div>
                      <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition">
                        <button onClick={() => openEditCard(c)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition"><Pencil size={12} className="text-slate-400" /></button>
                        <button onClick={() => handleDeleteCard(c.id)} className="p-1 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded transition"><Trash2 size={12} className="text-rose-400" /></button>
                      </div>
                    </div>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${c.status === 'Active' ? 'bg-emerald-500' : 'bg-rose-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    {c.expiry_date && <span className="text-[10px] text-slate-400">Expires {formatDate(c.expiry_date)}</span>}
                    <span className="flex-1" />
                    {c.status === 'Active' ? (
                      <button onClick={() => handleCardStatus(c, 'Blocked')} disabled={saving} className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded-md bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 hover:bg-rose-200 transition"><Ban size={10} /> Block</button>
                    ) : (
                      <button onClick={() => handleCardStatus(c, 'Active')} disabled={saving} className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded-md bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 transition"><CheckCircle2 size={10} /> Activate</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      </div>

      {/* Purchase Modal */}
      <ModalSystem
        isOpen={showPurchaseModal}
        onClose={() => setShowPurchaseModal(false)}
        onConfirm={handleSavePurchase}
        title={editingPurchase ? 'Edit Purchase' : 'Record Fuel Purchase'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date"><input type="date" className={inputCls} value={purchaseForm.purchaseDate} onChange={(e) => setPurchaseForm(f => ({ ...f, purchaseDate: e.target.value }))} /></Field>
          <Field label="Vehicle">
            <select className={inputCls} value={purchaseForm.vehicleId} onChange={(e) => {
              const v = vehicles.find((x) => x.id === e.target.value);
              setPurchaseForm(f => ({ ...f, vehicleId: e.target.value, driverId: v?.driver_id || f.driverId }));
            }}>
              <option value="">Select vehicle</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.vehicle_number}</option>)}
            </select>
          </Field>
          <Field label="Driver">
            <select className={inputCls} value={purchaseForm.driverId} onChange={(e) => setPurchaseForm(f => ({ ...f, driverId: e.target.value }))}>
              <option value="">Select driver</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.employees?.name || d.id}</option>)}
            </select>
          </Field>
          <Field label="Station"><input className={inputCls} value={purchaseForm.station} onChange={(e) => setPurchaseForm(f => ({ ...f, station: e.target.value }))} placeholder="e.g. Shell - Downtown" /></Field>
          <Field label="Fuel Type">
            <select className={inputCls} value={purchaseForm.fuelType} onChange={(e) => setPurchaseForm(f => ({ ...f, fuelType: e.target.value }))}>
              {FUEL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Fuel Card">
            <select className={inputCls} value={purchaseForm.fuelCardId} onChange={(e) => setPurchaseForm(f => ({ ...f, fuelCardId: e.target.value }))}>
              <option value="">None</option>
              {cards.map((c) => <option key={c.id} value={c.id}>{c.card_number} · {c.type}</option>)}
            </select>
          </Field>
          <Field label={purchaseForm.fuelType === 'Electric' ? 'kWh' : 'Gallons'}><input type="number" step="0.01" min={0} className={inputCls} value={purchaseForm.gallons} onChange={(e) => setPurchaseForm(f => ({ ...f, gallons: e.target.value }))} /></Field>
          <Field label="Price per Unit"><input type="number" step="0.001" min={0} className={inputCls} value={purchaseForm.pricePerGallon} onChange={(e) => setPurchaseForm(f => ({ ...f, pricePerGallon: e.target.value }))} /></Field>
          <Field label="Total Cost"><input type="number" step="0.01" min={0} className={inputCls} value={purchaseForm.totalCost} onChange={(e) => setPurchaseForm(f => ({ ...f, totalCost: e.target.value }))} /></Field>
          <Field label="Odometer"><input type="number" min={0} className={inputCls} value={purchaseForm.odometer} onChange={(e) => setPurchaseForm(f => ({ ...f, odometer: e.target.value }))} /></Field>
          <Field label={purchaseForm.fuelType === 'Electric' ? 'Efficiency (mi/kWh)' : 'Efficiency (MPG)'}><input type="number" step="0.1" min={0} className={inputCls} value={purchaseForm.efficiency} onChange={(e) => setPurchaseForm(f => ({ ...f, efficiency: e.target.value }))} /></Field>
        </div>
      </ModalSystem>

      {/* Card Modal */}
      <ModalSystem
        isOpen={showCardModal}
        onClose={() => setShowCardModal(false)}
        onConfirm={handleSaveCard}
        title={editingCard ? `Edit Card ${editingCard.card_number}` : 'New Fuel Card'}
        variant="form"
        size="md"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Provider"><input className={inputCls} value={cardForm.type} onChange={(e) => setCardForm(f => ({ ...f, type: e.target.value }))} placeholder="e.g. Shell" /></Field>
          <Field label="Masked Number"><input className={inputCls} value={cardForm.maskedNumber} onChange={(e) => setCardForm(f => ({ ...f, maskedNumber: e.target.value }))} placeholder="****1234" /></Field>
          <Field label="Credit Limit"><input type="number" step="0.01" min={0} className={inputCls} value={cardForm.creditLimit} onChange={(e) => setCardForm(f => ({ ...f, creditLimit: e.target.value }))} /></Field>
          <Field label="Balance"><input type="number" step="0.01" min={0} className={inputCls} value={cardForm.balance} onChange={(e) => setCardForm(f => ({ ...f, balance: e.target.value }))} /></Field>
          <Field label="Status">
            <select className={inputCls} value={cardForm.status} onChange={(e) => setCardForm(f => ({ ...f, status: e.target.value }))}>
              {CARD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Assigned Vehicle">
            <select className={inputCls} value={cardForm.assignedVehicle} onChange={(e) => setCardForm(f => ({ ...f, assignedVehicle: e.target.value }))}>
              <option value="">Unassigned</option>
              {vehicles.map((v) => <option key={v.id} value={v.vehicle_number}>{v.vehicle_number}</option>)}
            </select>
          </Field>
          <Field label="Expiry Date"><input type="date" className={inputCls} value={cardForm.expiryDate} onChange={(e) => setCardForm(f => ({ ...f, expiryDate: e.target.value }))} /></Field>
        </div>
      </ModalSystem>
    </div>
  );
};

export default FuelManagement;

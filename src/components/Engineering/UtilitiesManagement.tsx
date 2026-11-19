/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Utilities & Plant Operations — Engineering Portal
 * (/erp/maintenance/utilities).
 *
 * DB-integrated: fetches and persists via /api/eng-portal/utility-readings,
 * /generators, /generator-events, and /utility-alerts. UI aligned with the
 * other Engineering modules — PageHeader, SectionCard, StatCard, Badge,
 * ModalSystem, brandTheme tokens. Multi-property scoping via useERP().
 *
 * Four sub-tabs: Overall Consumption, Electricity, Water, Backup Power.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Zap, Droplets, Fuel, Battery, Activity, TrendingUp, TrendingDown,
  AlertTriangle, Clock, Calendar, Gauge, Plus, Loader2, ServerCrash,
  ArrowRight, MoreVertical, Trash2, Eye, CheckCircle2, Power, Settings2,
  Thermometer, Lightbulb,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, BarChart, Bar,
} from 'recharts';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchUtilityReadings, createUtilityReading, deleteUtilityReading,
  fetchGenerators, createGenerator, updateGenerator, deleteGenerator,
  fetchGeneratorEvents, createGeneratorEvent, deleteGeneratorEvent,
  fetchUtilityAlerts, createUtilityAlert, updateUtilityAlert, deleteUtilityAlert,
  type UtilityReading, type UtilityType,
  type Generator, type GeneratorStatus, type GeneratorEventType,
  type GeneratorEvent, type UtilityAlert, type UtilityAlertType,
  type UtilityAlertSeverity, type UtilityAlertStatus,
} from '../../services/engineeringService';

// ── Static registries ────────────────────────────────────────────────────
type SubTab = 'overall' | 'electricity' | 'water' | 'generator';

const SUB_TABS: { id: SubTab; label: string; icon: LucideIcon }[] = [
  { id: 'overall',     label: 'Overall',        icon: Activity },
  { id: 'electricity', label: 'Electricity',    icon: Zap },
  { id: 'water',       label: 'Water Systems',  icon: Droplets },
  { id: 'generator',   label: 'Backup Power',   icon: Fuel },
];

const UTILITY_TYPE_OPTIONS: UtilityType[] = ['electricity', 'water', 'fuel'];
const GENERATOR_STATUS_OPTIONS: GeneratorStatus[] = ['Running', 'Standby', 'Maintenance', 'Offline'];
const GEN_EVENT_TYPE_OPTIONS: GeneratorEventType[] = [
  'Cold Start', 'Load Test', 'Refuel', 'Service',
  'Manual Start', 'Emergency Stop', 'Alert', 'Other',
];
const ALERT_TYPE_OPTIONS: UtilityAlertType[] = ['Flow', 'Voltage', 'Draw', 'Leak', 'Temperature', 'Other'];
const ALERT_SEVERITY_OPTIONS: UtilityAlertSeverity[] = ['Info', 'Warning', 'Critical'];

const UTILITY_ICON: Record<string, LucideIcon> = {
  electricity: Zap, water: Droplets, fuel: Fuel,
};
const UTILITY_UNIT: Record<string, string> = {
  electricity: 'kWh', water: 'm³', fuel: 'L',
};
const UTILITY_COLOR: Record<string, string> = {
  electricity: '#6366f1', water: '#3b82f6', fuel: '#f59e0b',
};

const GEN_STATUS_TONE: Record<GeneratorStatus, StatusTone> = {
  Running: 'success', Standby: 'info', Maintenance: 'warning', Offline: 'danger',
};
const ALERT_SEVERITY_TONE: Record<UtilityAlertSeverity, StatusTone> = {
  Info: 'info', Warning: 'warning', Critical: 'danger',
};
const ALERT_STATUS_TONE: Record<UtilityAlertStatus, StatusTone> = {
  Active: 'danger', Resolved: 'success',
};

// ── Field helper ─────────────────────────────────────────────────────────
const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtDateTime(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function daysAgo(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return '1 day ago';
  return `${diff} days ago`;
}

// ── Component ────────────────────────────────────────────────────────────
const UtilitiesManagement: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [subTab, setSubTab] = useState<SubTab>('overall');

  const [readings, setReadings] = useState<UtilityReading[]>([]);
  const [generators, setGenerators] = useState<Generator[]>([]);
  const [genEvents, setGenEvents] = useState<GeneratorEvent[]>([]);
  const [alerts, setAlerts] = useState<UtilityAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  // Modal state
  const [showReadingModal, setShowReadingModal] = useState(false);
  const [showGenModal, setShowGenModal] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [detailGenId, setDetailGenId] = useState<string | null>(null);
  const detailGen = generators.find(g => g.id === detailGenId) || null;

  // Forms
  const [readingForm, setReadingForm] = useState({
    utilityType: 'electricity' as UtilityType, readingDate: new Date().toISOString().slice(0, 10),
    value: '', unit: 'kWh', readingBy: '', notes: '',
  });
  const [genForm, setGenForm] = useState({
    name: '', code: '', status: 'Standby' as GeneratorStatus,
    runningHours: '0', fuelLevelPct: '100', batteryHealthPct: '100',
    lastServiceDate: '', nextServiceDate: '', outputKva: '',
    engineType: '', controlUnit: '', location: '', notes: '',
  });
  const [eventForm, setEventForm] = useState({
    generatorId: '', eventType: 'Cold Start' as GeneratorEventType, description: '',
  });
  const [alertForm, setAlertForm] = useState({
    alertType: 'Flow' as UtilityAlertType, severity: 'Warning' as UtilityAlertSeverity,
    sector: '', description: '',
  });

  // ── Load ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, g, ge, a] = await Promise.all([
        fetchUtilityReadings({ propertyId: currentPropertyId || undefined, days: 30 }),
        fetchGenerators({ propertyId: currentPropertyId || undefined }),
        fetchGeneratorEvents({ propertyId: currentPropertyId || undefined }),
        fetchUtilityAlerts({ propertyId: currentPropertyId || undefined }),
      ]);
      setReadings(r);
      setGenerators(g);
      setGenEvents(ge);
      setAlerts(a);
    } catch (e: any) {
      setError(e?.message || 'Failed to load utilities data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  // ── Derived data ──────────────────────────────────────────────────────
  const readingsByType = useMemo(() => {
    const map: Record<string, UtilityReading[]> = {};
    readings.forEach(r => {
      if (!map[r.utility_type]) map[r.utility_type] = [];
      map[r.utility_type].push(r);
    });
    return map;
  }, [readings]);

  const chartData = useMemo(() => {
    const elec = readingsByType['electricity'] || [];
    const water = readingsByType['water'] || [];
    const fuel = readingsByType['fuel'] || [];
    const maxLen = Math.max(elec.length, water.length, fuel.length);
    const out: { day: string; electricity?: number; water?: number; fuel?: number }[] = [];
    for (let i = 0; i < maxLen; i++) {
      out.push({
        day: elec[i]?.reading_date || water[i]?.reading_date || fuel[i]?.reading_date || '',
        electricity: elec[i]?.value,
        water: water[i]?.value,
        fuel: fuel[i]?.value,
      });
    }
    return out;
  }, [readingsByType]);

  const totals = useMemo(() => {
    const sum = (type: string) =>
      (readingsByType[type] || []).reduce((acc, r) => acc + Number(r.value || 0), 0);
    return {
      electricity: sum('electricity'),
      water: sum('water'),
      fuel: sum('fuel'),
    };
  }, [readingsByType]);

  const activeAlerts = alerts.filter(a => a.status === 'Active');
  const resolvedAlerts = alerts.filter(a => a.status === 'Resolved');

  const genEventsByGen = useMemo(() => {
    const map: Record<string, GeneratorEvent[]> = {};
    genEvents.forEach(e => {
      if (!map[e.generator_id || '']) map[e.generator_id || ''] = [];
      map[e.generator_id || ''].push(e);
    });
    return map;
  }, [genEvents]);

  // ── Actions ───────────────────────────────────────────────────────────
  const submitReading = async () => {
    if (!readingForm.value.trim()) return;
    setSubmitting(true);
    try {
      await createUtilityReading({
        propertyId: currentPropertyId || undefined,
        readingDate: readingForm.readingDate,
        utilityType: readingForm.utilityType,
        value: parseFloat(readingForm.value),
        unit: readingForm.unit || UTILITY_UNIT[readingForm.utilityType],
        readingBy: readingForm.readingBy || undefined,
        notes: readingForm.notes || undefined,
      });
      addNotification(`${readingForm.utilityType} reading logged.`, 'task', 'Maintenance');
      setShowReadingModal(false);
      setReadingForm({ ...readingForm, value: '', notes: '' });
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to log reading', 'warning', 'Maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  const removeReading = async (id: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await deleteUtilityReading(id);
      setReadings(prev => prev.filter(r => r.id !== id));
      addNotification('Reading deleted.', 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete reading', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const submitGen = async () => {
    if (!genForm.name.trim()) return;
    setSubmitting(true);
    try {
      await createGenerator({
        propertyId: currentPropertyId || undefined,
        name: genForm.name.trim(),
        code: genForm.code || undefined,
        status: genForm.status,
        runningHours: parseFloat(genForm.runningHours) || 0,
        fuelLevelPct: parseInt(genForm.fuelLevelPct) || 100,
        batteryHealthPct: parseInt(genForm.batteryHealthPct) || 100,
        lastServiceDate: genForm.lastServiceDate || undefined,
        nextServiceDate: genForm.nextServiceDate || undefined,
        outputKva: genForm.outputKva ? parseFloat(genForm.outputKva) : undefined,
        engineType: genForm.engineType || undefined,
        controlUnit: genForm.controlUnit || undefined,
        location: genForm.location || undefined,
        notes: genForm.notes || undefined,
      });
      addNotification(`Generator "${genForm.name.trim()}" registered.`, 'task', 'Maintenance');
      setShowGenModal(false);
      setGenForm({ name: '', code: '', status: 'Standby', runningHours: '0', fuelLevelPct: '100', batteryHealthPct: '100', lastServiceDate: '', nextServiceDate: '', outputKva: '', engineType: '', controlUnit: '', location: '', notes: '' });
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to register generator', 'warning', 'Maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  const updateGen = async (id: string, patch: any) => {
    setActingOn(id);
    try {
      const { generator } = await updateGenerator(id, patch);
      setGenerators(prev => prev.map(g => (g.id === id ? generator : g)));
      addNotification(`Generator updated.`, 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update generator', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const removeGen = async (id: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await deleteGenerator(id);
      setGenerators(prev => prev.filter(g => g.id !== id));
      addNotification('Generator deleted.', 'task', 'Maintenance');
      setDetailGenId(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete generator', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const submitEvent = async () => {
    setSubmitting(true);
    try {
      await createGeneratorEvent({
        propertyId: currentPropertyId || undefined,
        generatorId: eventForm.generatorId || undefined,
        eventType: eventForm.eventType,
        description: eventForm.description || undefined,
      });
      addNotification(`Generator event logged: ${eventForm.eventType}.`, 'task', 'Maintenance');
      setShowEventModal(false);
      setEventForm({ generatorId: '', eventType: 'Cold Start', description: '' });
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to log event', 'warning', 'Maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  const removeEvent = async (id: string) => {
    setActingOn(id);
    try {
      await deleteGeneratorEvent(id);
      setGenEvents(prev => prev.filter(e => e.id !== id));
      addNotification('Event deleted.', 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete event', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const submitAlert = async () => {
    if (!alertForm.description.trim()) return;
    setSubmitting(true);
    try {
      await createUtilityAlert({
        propertyId: currentPropertyId || undefined,
        alertType: alertForm.alertType,
        severity: alertForm.severity,
        sector: alertForm.sector || undefined,
        description: alertForm.description.trim(),
      });
      addNotification(`Utility alert created.`, 'task', 'Maintenance');
      setShowAlertModal(false);
      setAlertForm({ alertType: 'Flow', severity: 'Warning', sector: '', description: '' });
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create alert', 'warning', 'Maintenance');
    } finally {
      setSubmitting(false);
    }
  };

  const resolveAlert = async (id: string) => {
    setActingOn(id);
    try {
      const { alert } = await updateUtilityAlert(id, { status: 'Resolved' });
      setAlerts(prev => prev.map(a => (a.id === id ? alert : a)));
      addNotification('Alert resolved.', 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to resolve alert', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  const removeAlert = async (id: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await deleteUtilityAlert(id);
      setAlerts(prev => prev.filter(a => a.id !== id));
      addNotification('Alert deleted.', 'task', 'Maintenance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete alert', 'warning', 'Maintenance');
    } finally {
      setActingOn(null);
    }
  };

  // ── Render helpers ────────────────────────────────────────────────────
  const renderUtilityChart = (type: UtilityType, color: string) => {
    const data = (readingsByType[type] || []).map(r => ({
      day: r.reading_date, value: Number(r.value),
    }));
    if (data.length === 0) {
      return <div className="p-8 text-center text-sm text-gray-500">No {type} readings yet.</div>;
    }
    return (
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id={`color-${type}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.2} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="day" axisLine={false} tickLine={false} stroke="#94a3b8" fontSize={10} />
            <YAxis axisLine={false} tickLine={false} stroke="#94a3b8" fontSize={10} />
            <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
            <Area type="monotone" dataKey="value" stroke={color} fillOpacity={1} fill={`url(#color-${type})`} strokeWidth={3} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const renderReadingsList = (type: UtilityType) => {
    const data = (readingsByType[type] || []).slice().reverse();
    if (data.length === 0) {
      return <div className="p-8 text-center text-sm text-gray-500">No readings logged.</div>;
    }
    return (
      <SectionCard pad="none" bodyClassName="divide-y divide-gray-100 dark:divide-slate-700">
        {data.map(r => (
          <div key={r.id} className="p-4 flex items-center gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800">
                <Calendar className="w-4 h-4 text-gray-500" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtDate(r.reading_date)}</p>
                <p className="text-xs text-gray-500">
                  {Number(r.value).toLocaleString()} {r.unit}
                  {r.reading_by && ` · by ${r.reading_by}`}
                </p>
              </div>
            </div>
            {r.notes && <span className="text-xs text-gray-400 truncate hidden md:block">{r.notes}</span>}
            <button
              onClick={() => removeReading(r.id)}
              disabled={actingOn === r.id}
              className={button.ghost + ' disabled:opacity-50'}
            >
              {actingOn === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </button>
          </div>
        ))}
      </SectionCard>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Utilities & Plant Operations"
        subtitle="Real-time resource tracking and plant management"
        icon={Activity}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={() => setShowReadingModal(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> Log Reading
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Electricity (MTD)" value={`${totals.electricity.toLocaleString()} kWh`} icon={Zap} tone="accent" />
        <StatCard title="Water (MTD)" value={`${totals.water.toLocaleString()} m³`} icon={Droplets} tone="info" />
        <StatCard title="Fuel (MTD)" value={`${totals.fuel.toLocaleString()} L`} icon={Fuel} tone="warning" />
        <StatCard title="Active Alerts" value={activeAlerts.length} icon={AlertTriangle} tone="danger" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* Sub-tab navigation */}
      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl overflow-x-auto">
        {SUB_TABS.map(t => {
          const count = t.id === 'generator' ? generators.length : t.id === 'overall' ? activeAlerts.length : 0;
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap ${
                subTab === t.id
                  ? 'bg-white dark:bg-slate-700 text-[var(--color-accent-operations)] shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <t.icon className="w-4 h-4" />
              <span className="text-sm font-medium">{t.label}</span>
              {count > 0 && (
                <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-bold bg-[var(--color-info)]/15 text-[var(--color-info)]">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading utilities data…
        </div>
      )}

      {/* ══ Overall sub-tab ══════════════════════════════════════════════ */}
      {!loading && subTab === 'overall' && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 space-y-6">
              <SectionCard title="Consumption Trends" subtitle="Daily readings — all utilities" icon={Activity} pad="md">
                {chartData.length === 0 ? (
                  <div className="p-8 text-center text-sm text-gray-500">No readings available.</div>
                ) : (
                  <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData}>
                        <defs>
                          <linearGradient id="colorElec" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="colorWater" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="day" axisLine={false} tickLine={false} stroke="#94a3b8" fontSize={10} />
                        <YAxis axisLine={false} tickLine={false} stroke="#94a3b8" fontSize={10} />
                        <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                        <Area type="monotone" dataKey="electricity" stroke="#6366f1" fillOpacity={1} fill="url(#colorElec)" strokeWidth={3} />
                        <Area type="monotone" dataKey="water" stroke="#3b82f6" fillOpacity={1} fill="url(#colorWater)" strokeWidth={3} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </SectionCard>
            </div>

            <div className="lg:col-span-4 space-y-6">
              {/* Abnormal Usage Detection */}
              <SectionCard title="Abnormal Usage Detection" subtitle="AI-powered leak & draw drift" icon={AlertTriangle} pad="md">
                <div className="space-y-3">
                  {alerts.length === 0 && (
                    <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl flex gap-3">
                      <CheckCircle2 size={16} className="text-emerald-500" />
                      <span className="text-xs text-emerald-700 dark:text-emerald-300">All systems normal. No active alerts.</span>
                    </div>
                  )}
                  {alerts.map(a => (
                    <div
                      key={a.id}
                      className={`p-4 rounded-2xl border flex gap-3 ${
                        a.status === 'Active'
                          ? a.severity === 'Critical'
                            ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800'
                            : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                          : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                      }`}
                    >
                      {a.status === 'Active' ? <AlertTriangle size={16} className={a.severity === 'Critical' ? 'text-rose-500' : 'text-amber-500'} /> : <CheckCircle2 size={16} className="text-emerald-500" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-black uppercase tracking-tight text-gray-900 dark:text-white">
                            {a.alert_type}: {a.sector || '—'}
                          </span>
                          <Badge tone={ALERT_SEVERITY_TONE[a.severity]}>{a.severity}</Badge>
                          <Badge tone={ALERT_STATUS_TONE[a.status]}>{a.status}</Badge>
                        </div>
                        <p className="text-[10px] text-gray-600 dark:text-gray-300">{a.description}</p>
                        {a.status === 'Active' && (
                          <button
                            onClick={() => resolveAlert(a.id)}
                            disabled={actingOn === a.id}
                            className={button.ghost + ' mt-2 text-xs disabled:opacity-50'}
                          >
                            {actingOn === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Resolve'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={() => setShowAlertModal(true)} className={button.secondary + ' w-full mt-3'}>
                  <Plus className="w-4 h-4" /> Raise Alert
                </button>
              </SectionCard>
            </div>
          </div>
        </>
      )}

      {/* ══ Electricity sub-tab ══════════════════════════════════════════ */}
      {!loading && subTab === 'electricity' && (
        <>
          <SectionCard title="Electricity Consumption" subtitle="Daily grid electricity readings" icon={Zap} pad="md">
            {renderUtilityChart('electricity', '#6366f1')}
          </SectionCard>
          {renderReadingsList('electricity')}
        </>
      )}

      {/* ══ Water sub-tab ════════════════════════════════════════════════ */}
      {!loading && subTab === 'water' && (
        <>
          <SectionCard title="Water Consumption" subtitle="Daily water meter readings" icon={Droplets} pad="md">
            {renderUtilityChart('water', '#3b82f6')}
          </SectionCard>
          {renderReadingsList('water')}
        </>
      )}

      {/* ══ Backup Power sub-tab ═════════════════════════════════════════ */}
      {!loading && subTab === 'generator' && (
        <>
          <SectionCard
            title="Backup Power Generators"
            subtitle={`${generators.length} generator(s) · ${generators.filter(g => g.status === 'Running').length} running`}
            icon={Fuel}
            pad="md"
            actions={
              <button onClick={() => setShowGenModal(true)} className={button.primary}>
                <Plus className="w-4 h-4" /> Register Generator
              </button>
            }
          >
            {generators.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">No generators registered.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {generators.map(gen => {
                  const tone = GEN_STATUS_TONE[gen.status];
                  const events = genEventsByGen[gen.id] || [];
                  return (
                    <div key={gen.id} className={`p-5 rounded-2xl border ${statusTone[tone].soft} ${statusTone[tone].border}`}>
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <h4 className="text-sm font-black text-gray-900 dark:text-white">{gen.name}</h4>
                          <p className="text-xs text-gray-500 font-mono">{gen.code || '—'} · {gen.location || '—'}</p>
                        </div>
                        <div className="relative">
                          <button
                            onClick={() => setMenuOpen(menuOpen === gen.id ? null : gen.id)}
                            className={button.ghost}
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>
                          {menuOpen === gen.id && (
                            <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                              <button onClick={() => { setDetailGenId(gen.id); setMenuOpen(null); }} className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-slate-700">
                                <Eye className="w-3.5 h-3.5 inline mr-1" /> View Details
                              </button>
                              {GENERATOR_STATUS_OPTIONS.map(s => (
                                <button
                                  key={s}
                                  onClick={() => { updateGen(gen.id, { status: s }); setMenuOpen(null); }}
                                  className="w-full text-left px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                                >
                                  Set {s}
                                </button>
                              ))}
                              <button onClick={() => removeGen(gen.id)} className="w-full text-left px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 border-t border-gray-100 dark:border-slate-700">
                                <Trash2 className="w-3.5 h-3.5 inline mr-1" /> Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 mb-4">
                        <Badge tone={tone}>{gen.status}</Badge>
                        {gen.status === 'Running' && <Power className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />}
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <span className="text-gray-500 font-bold">Running Hours</span>
                          <p className="text-gray-900 dark:text-white font-black">{gen.running_hours}h</p>
                        </div>
                        <div>
                          <span className="text-gray-500 font-bold">Fuel Level</span>
                          <p className="text-gray-900 dark:text-white font-black">{gen.fuel_level_pct}%</p>
                        </div>
                        <div>
                          <span className="text-gray-500 font-bold">Battery</span>
                          <p className="text-gray-900 dark:text-white font-black">{gen.battery_health_pct}%</p>
                        </div>
                        <div>
                          <span className="text-gray-500 font-bold">Last Service</span>
                          <p className="text-gray-900 dark:text-white font-black">{daysAgo(gen.last_service_date)}</p>
                        </div>
                      </div>

                      {events.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-gray-200/50 dark:border-slate-700/50">
                          <p className="text-[10px] font-black text-gray-500 uppercase tracking-wide mb-2">Recent Events</p>
                          <div className="space-y-1">
                            {events.slice(0, 3).map(e => (
                              <div key={e.id} className="flex justify-between text-[10px]">
                                <span className="text-gray-500">{fmtDateTime(e.event_time)}</span>
                                <span className="font-bold text-gray-700 dark:text-gray-300">{e.event_type}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* Generator Events Log */}
          <SectionCard
            title="Generator Events Log"
            subtitle="All generator events across the property"
            icon={Clock}
            pad="md"
            actions={
              <button onClick={() => setShowEventModal(true)} className={button.secondary}>
                <Plus className="w-4 h-4" /> Log Event
              </button>
            }
          >
            {genEvents.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500">No events logged.</div>
            ) : (
              <div className="space-y-2">
                {genEvents.slice(0, 20).map(e => {
                  const gen = generators.find(g => g.id === e.generator_id);
                  return (
                    <div key={e.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900/40 rounded-xl">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-white dark:bg-slate-800">
                          <Activity className="w-3.5 h-3.5 text-gray-500" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-gray-900 dark:text-white">{e.event_type}</p>
                          <p className="text-xs text-gray-500">
                            {gen?.name || '—'} · {fmtDateTime(e.event_time)}
                            {e.description && ` · ${e.description}`}
                          </p>
                        </div>
                      </div>
                      <button onClick={() => removeEvent(e.id)} disabled={actingOn === e.id} className={button.ghost + ' disabled:opacity-50'}>
                        {actingOn === e.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </>
      )}

      {/* ── Log Reading modal ─────────────────────────────────────────── */}
      <ModalSystem
        isOpen={showReadingModal}
        onClose={() => (submitting ? undefined : setShowReadingModal(false))}
        title="Log Utility Reading"
        subtitle="Record a meter reading"
        variant="form"
        size="md"
        loading={submitting}
        confirmLabel={submitting ? 'Saving…' : 'Save Reading'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitReading}
        showFooter
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Utility Type">
              <select value={readingForm.utilityType} onChange={e => { const t = e.target.value as UtilityType; setReadingForm(f => ({ ...f, utilityType: t, unit: UTILITY_UNIT[t] })); }} className={inputClass}>
                {UTILITY_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Reading Date">
              <input type="date" value={readingForm.readingDate} onChange={e => setReadingForm(f => ({ ...f, readingDate: e.target.value }))} className={inputClass} />
            </Field>
            <Field label="Value">
              <input type="number" step="0.01" value={readingForm.value} onChange={e => setReadingForm(f => ({ ...f, value: e.target.value }))} placeholder="e.g. 420" className={inputClass} />
            </Field>
            <Field label="Unit">
              <input value={readingForm.unit} onChange={e => setReadingForm(f => ({ ...f, unit: e.target.value }))} className={inputClass} />
            </Field>
            <Field label="Read By (optional)">
              <input value={readingForm.readingBy} onChange={e => setReadingForm(f => ({ ...f, readingBy: e.target.value }))} placeholder="e.g. Engineering" className={inputClass} />
            </Field>
          </div>
          <Field label="Notes (optional)">
            <textarea value={readingForm.notes} onChange={e => setReadingForm(f => ({ ...f, notes: e.target.value }))} rows={2} className={inputClass} />
          </Field>
        </div>
      </ModalSystem>

      {/* ── Register Generator modal ─────────────────────────────────── */}
      <ModalSystem
        isOpen={showGenModal}
        onClose={() => (submitting ? undefined : setShowGenModal(false))}
        title="Register Generator"
        subtitle="Add a backup power generator"
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={submitting ? 'Saving…' : 'Register'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitGen}
        showFooter
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name">
              <input value={genForm.name} onChange={e => setGenForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Main Generator" className={inputClass} />
            </Field>
            <Field label="Code">
              <input value={genForm.code} onChange={e => setGenForm(f => ({ ...f, code: e.target.value }))} placeholder="e.g. G-01" className={inputClass} />
            </Field>
            <Field label="Status">
              <select value={genForm.status} onChange={e => setGenForm(f => ({ ...f, status: e.target.value as GeneratorStatus }))} className={inputClass}>
                {GENERATOR_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Location">
              <input value={genForm.location} onChange={e => setGenForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Plant Room 1" className={inputClass} />
            </Field>
            <Field label="Running Hours">
              <input type="number" step="0.1" value={genForm.runningHours} onChange={e => setGenForm(f => ({ ...f, runningHours: e.target.value }))} className={inputClass} />
            </Field>
            <Field label="Fuel Level (%)">
              <input type="number" min="0" max="100" value={genForm.fuelLevelPct} onChange={e => setGenForm(f => ({ ...f, fuelLevelPct: e.target.value }))} className={inputClass} />
            </Field>
            <Field label="Battery Health (%)">
              <input type="number" min="0" max="100" value={genForm.batteryHealthPct} onChange={e => setGenForm(f => ({ ...f, batteryHealthPct: e.target.value }))} className={inputClass} />
            </Field>
            <Field label="Output (kVA)">
              <input type="number" step="0.1" value={genForm.outputKva} onChange={e => setGenForm(f => ({ ...f, outputKva: e.target.value }))} placeholder="e.g. 500" className={inputClass} />
            </Field>
            <Field label="Engine Type">
              <input value={genForm.engineType} onChange={e => setGenForm(f => ({ ...f, engineType: e.target.value }))} placeholder="e.g. V12 Turbo" className={inputClass} />
            </Field>
            <Field label="Control Unit">
              <input value={genForm.controlUnit} onChange={e => setGenForm(f => ({ ...f, controlUnit: e.target.value }))} placeholder="e.g. Deep Sea 8610" className={inputClass} />
            </Field>
            <Field label="Last Service Date">
              <input type="date" value={genForm.lastServiceDate} onChange={e => setGenForm(f => ({ ...f, lastServiceDate: e.target.value }))} className={inputClass} />
            </Field>
            <Field label="Next Service Date">
              <input type="date" value={genForm.nextServiceDate} onChange={e => setGenForm(f => ({ ...f, nextServiceDate: e.target.value }))} className={inputClass} />
            </Field>
          </div>
          <Field label="Notes (optional)">
            <textarea value={genForm.notes} onChange={e => setGenForm(f => ({ ...f, notes: e.target.value }))} rows={2} className={inputClass} />
          </Field>
        </div>
      </ModalSystem>

      {/* ── Generator Detail modal ───────────────────────────────────── */}
      <ModalSystem
        isOpen={!!detailGenId}
        onClose={() => setDetailGenId(null)}
        title={detailGen ? detailGen.name : 'Generator'}
        subtitle={detailGen?.code || ''}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {detailGen && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={GEN_STATUS_TONE[detailGen.status]}>{detailGen.status}</Badge>
              {detailGen.location && <Badge tone="neutral">{detailGen.location}</Badge>}
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase">Running Hours</p>
                <p className="text-sm font-black text-gray-900 dark:text-white">{detailGen.running_hours}h</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase">Fuel Level</p>
                <p className="text-sm font-black text-gray-900 dark:text-white">{detailGen.fuel_level_pct}%</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase">Battery</p>
                <p className="text-sm font-black text-gray-900 dark:text-white">{detailGen.battery_health_pct}%</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase">Output</p>
                <p className="text-sm font-black text-gray-900 dark:text-white">{detailGen.output_kva || '—'} kVA</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase">Last Service</p>
                <p className="text-sm font-black text-gray-900 dark:text-white">{fmtDate(detailGen.last_service_date)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase">Next Service</p>
                <p className="text-sm font-black text-gray-900 dark:text-white">{fmtDate(detailGen.next_service_date)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase">Engine Type</p>
                <p className="text-sm font-black text-gray-900 dark:text-white">{detailGen.engine_type || '—'}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase">Control Unit</p>
                <p className="text-sm font-black text-gray-900 dark:text-white">{detailGen.control_unit || '—'}</p>
              </div>
            </div>

            {/* Inline editable fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-gray-100 dark:border-slate-700">
              <Field label="Status">
                <select
                  value={detailGen.status}
                  onChange={e => updateGen(detailGen.id, { status: e.target.value as GeneratorStatus })}
                  className={inputClass}
                  disabled={actingOn === detailGen.id}
                >
                  {GENERATOR_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Fuel Level (%)">
                <input
                  type="number" min="0" max="100"
                  defaultValue={detailGen.fuel_level_pct}
                  onBlur={e => updateGen(detailGen.id, { fuelLevelPct: parseInt(e.target.value) || 0 })}
                  className={inputClass}
                  disabled={actingOn === detailGen.id}
                />
              </Field>
              <Field label="Running Hours">
                <input
                  type="number" step="0.1"
                  defaultValue={detailGen.running_hours}
                  onBlur={e => updateGen(detailGen.id, { runningHours: parseFloat(e.target.value) || 0 })}
                  className={inputClass}
                  disabled={actingOn === detailGen.id}
                />
              </Field>
              <Field label="Battery Health (%)">
                <input
                  type="number" min="0" max="100"
                  defaultValue={detailGen.battery_health_pct}
                  onBlur={e => updateGen(detailGen.id, { batteryHealthPct: parseInt(e.target.value) || 0 })}
                  className={inputClass}
                  disabled={actingOn === detailGen.id}
                />
              </Field>
            </div>

            {/* Recent events for this generator */}
            <div className="pt-2 border-t border-gray-100 dark:border-slate-700">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Recent Events</p>
              <div className="space-y-1">
                {(genEventsByGen[detailGen.id] || []).slice(0, 5).map(e => (
                  <div key={e.id} className="flex justify-between text-xs">
                    <span className="text-gray-500">{fmtDateTime(e.event_time)}</span>
                    <span className="font-bold text-gray-700 dark:text-gray-300">{e.event_type}{e.description ? ` — ${e.description}` : ''}</span>
                  </div>
                ))}
                {(genEventsByGen[detailGen.id] || []).length === 0 && (
                  <p className="text-xs text-gray-400">No events for this generator.</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-slate-700">
              <button onClick={() => removeGen(detailGen.id)} disabled={actingOn === detailGen.id} className={button.ghost + ' text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 ml-auto disabled:opacity-50'}>
                <Trash2 className="w-4 h-4 inline mr-1" /> Delete
              </button>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* ── Log Event modal ──────────────────────────────────────────── */}
      <ModalSystem
        isOpen={showEventModal}
        onClose={() => (submitting ? undefined : setShowEventModal(false))}
        title="Log Generator Event"
        subtitle="Record a generator event"
        variant="form"
        size="md"
        loading={submitting}
        confirmLabel={submitting ? 'Saving…' : 'Log Event'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitEvent}
        showFooter
      >
        <div className="space-y-4">
          <Field label="Generator (optional)">
            <select value={eventForm.generatorId} onChange={e => setEventForm(f => ({ ...f, generatorId: e.target.value }))} className={inputClass}>
              <option value="">— All generators —</option>
              {generators.map(g => <option key={g.id} value={g.id}>{g.name} ({g.code || '—'})</option>)}
            </select>
          </Field>
          <Field label="Event Type">
            <select value={eventForm.eventType} onChange={e => setEventForm(f => ({ ...f, eventType: e.target.value as GeneratorEventType }))} className={inputClass}>
              {GEN_EVENT_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Description (optional)">
            <textarea value={eventForm.description} onChange={e => setEventForm(f => ({ ...f, description: e.target.value }))} rows={2} className={inputClass} />
          </Field>
        </div>
      </ModalSystem>

      {/* ── Raise Alert modal ────────────────────────────────────────── */}
      <ModalSystem
        isOpen={showAlertModal}
        onClose={() => (submitting ? undefined : setShowAlertModal(false))}
        title="Raise Utility Alert"
        subtitle="Report an abnormal usage detection"
        variant="form"
        size="md"
        loading={submitting}
        confirmLabel={submitting ? 'Saving…' : 'Raise Alert'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitAlert}
        showFooter
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Alert Type">
              <select value={alertForm.alertType} onChange={e => setAlertForm(f => ({ ...f, alertType: e.target.value as UtilityAlertType }))} className={inputClass}>
                {ALERT_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Severity">
              <select value={alertForm.severity} onChange={e => setAlertForm(f => ({ ...f, severity: e.target.value as UtilityAlertSeverity }))} className={inputClass}>
                {ALERT_SEVERITY_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Sector / Location (optional)">
            <input value={alertForm.sector} onChange={e => setAlertForm(f => ({ ...f, sector: e.target.value }))} placeholder="e.g. Sector C" className={inputClass} />
          </Field>
          <Field label="Description">
            <textarea value={alertForm.description} onChange={e => setAlertForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="Describe the abnormality…" className={inputClass} />
          </Field>
        </div>
      </ModalSystem>
    </div>
  );
};

export default UtilitiesManagement;

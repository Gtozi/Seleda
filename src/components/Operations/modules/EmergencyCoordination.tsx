/**
 * Emergency Coordination — Operations Portal (/erp/operations/emergency).
 *
 * Live emergency command board sharing the Security portal's own tables
 * (sec_emergency_notifications + sec_emergency_responses) — alerts raised
 * here appear in /erp/security SOC Emergency and vice-versa. A watch list
 * of Critical/High sec_incidents can be escalated into full emergencies.
 *
 * UI follows the shared portal design language (PageHeader, SectionCard,
 * StatCard, Badge, brandTheme) — same as HK / Engineering / F&B modules.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Flame,
  Phone,
  MapPin,
  Users,
  Radio,
  AlertTriangle,
  Shield,
  RefreshCw,
  Loader2,
  ChevronRight,
  Siren,
  ArrowUpCircle,
  DoorOpen,
} from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';
import {
  fetchOpsEmergencies,
  raiseEmergency,
  updateEmergency,
  addEmergencyResponse,
  escalateIncidentToEmergency,
  EMERGENCY_STATUS_OPTIONS,
  EMERGENCY_PRIORITY_OPTIONS,
  EVACUATION_OPTIONS,
  type OpsEmergency,
} from '../../../services/operationsService';

const EMERGENCY_TYPES = ['Fire', 'Medical', 'Security', 'Evacuation', 'Flood', 'Power Failure', 'Gas Leak', 'Natural Disaster', 'Other'];

const typeTone = (t: string): 'danger' | 'warning' | 'info' | 'neutral' => {
  const v = t.toLowerCase();
  if (v.includes('fire') || v.includes('medical')) return 'danger';
  if (v.includes('security') || v.includes('evacuation') || v.includes('gas')) return 'warning';
  if (v.includes('power') || v.includes('flood')) return 'info';
  return 'neutral';
};

const statusTone = (s: string): 'danger' | 'warning' | 'success' | 'info' | 'neutral' =>
  ({ Active: 'danger', 'In Progress': 'warning', Resolved: 'success', Scheduled: 'neutral' }[s] as any || 'neutral');

const priorityTone = (p: string): 'danger' | 'warning' | 'info' | 'neutral' =>
  ({ Critical: 'danger', High: 'warning', Medium: 'info', Low: 'neutral' }[p] as any || 'neutral');

const inputCls =
  'px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-operations)]';

const QUICK_REPORTS: Array<{ type: string; label: string; icon: React.ElementType; tone: string }> = [
  { type: 'Fire', label: 'Report Fire', icon: Flame, tone: 'bg-rose-600 hover:bg-rose-700' },
  { type: 'Medical', label: 'Report Medical', icon: Phone, tone: 'bg-red-600 hover:bg-red-700' },
  { type: 'Security', label: 'Report Security', icon: Shield, tone: 'bg-blue-600 hover:bg-blue-700' },
  { type: 'Evacuation', label: 'Initiate Evacuation', icon: DoorOpen, tone: 'bg-orange-600 hover:bg-orange-700' },
];

const EmergencyCoordination: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [data, setData] = useState<{ emergencies: OpsEmergency[]; criticalIncidents: any[]; stats: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [quickType, setQuickType] = useState<string | null>(null);
  const [form, setForm] = useState({ emergencyType: 'Fire', location: '', priority: 'High', description: '', commander: '', responseTeam: '', evacuation: 'Not Required' });
  const [respText, setRespText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const d = await fetchOpsEmergencies(currentPropertyId);
      setData(d);
    } catch (e: any) {
      setError(e?.message || 'Failed to load emergencies');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const emergencies = data?.emergencies || [];
  const active = useMemo(() => emergencies.filter((e) => e.status !== 'Resolved'), [emergencies]);
  const resolved = useMemo(() => emergencies.filter((e) => e.status === 'Resolved'), [emergencies]);
  const selected = emergencies.find((e) => e.id === selectedId) || active[0] || null;
  const stats = data?.stats || { active: 0, critical: 0, evacuationInProgress: 0, resolvedToday: 0, openCriticalIncidents: 0 };

  const act = async (key: string, fn: () => Promise<any>, note?: string) => {
    setBusy(key);
    try {
      await fn();
      await load();
      if (note) addNotification(note, 'task', 'Executive');
    } catch (e: any) {
      addNotification(e?.message || 'Action failed', 'error', 'Executive');
    } finally {
      setBusy(null);
    }
  };

  const openQuickReport = (type: string) => {
    setQuickType(type);
    setForm((f) => ({ ...f, emergencyType: type, evacuation: type === 'Evacuation' ? 'In Progress' : 'Not Required', priority: type === 'Fire' || type === 'Medical' ? 'Critical' : 'High' }));
    setShowForm(true);
  };

  const submitReport = () => {
    if (!form.location.trim()) return;
    act('raise', async () => {
      await raiseEmergency({
        propertyId: currentPropertyId,
        emergencyType: form.emergencyType,
        location: form.location.trim(),
        priority: form.priority,
        description: form.description || undefined,
        commander: form.commander || undefined,
        responseTeam: form.responseTeam || undefined,
        evacuation: form.evacuation,
      });
      setForm({ emergencyType: 'Fire', location: '', priority: 'High', description: '', commander: '', responseTeam: '', evacuation: 'Not Required' });
      setShowForm(false);
    }, `${form.emergencyType} emergency raised — Security SOC notified.`);
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        icon={Siren}
        title="Emergency Coordination"
        subtitle="Live emergency command board — shared with the Security SOC, incidents and response timeline"
        actions={
          <div className="flex items-center gap-2">
            <button className={button.primary} onClick={() => { setQuickType(null); setShowForm(!showForm); }}>
              <AlertTriangle size={16} /> Report Emergency
            </button>
            <button className={button.ghost} onClick={load} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        }
      />

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-danger)]/10 text-[var(--color-danger)] text-sm">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Active Emergencies" icon={Siren} tone="danger" value={stats.active}
          caption={stats.critical ? `${stats.critical} critical` : undefined} />
        <StatCard title="Critical Incidents" icon={AlertTriangle} tone="warning" value={stats.openCriticalIncidents}
          caption="open Critical/High — watch list" />
        <StatCard title="Evacuations" icon={DoorOpen} tone="info" value={stats.evacuationInProgress} caption="in progress" />
        <StatCard title="Resolved Today" icon={Radio} tone="success" value={stats.resolvedToday} />
      </div>

      {/* Quick report strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {QUICK_REPORTS.map((q) => (
          <div key={q.type} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center gap-2 mb-2">
              <q.icon size={18} className="text-slate-700 dark:text-slate-300" />
              <span className="text-xs font-mono uppercase text-slate-500 dark:text-slate-400 font-bold">{q.type}</span>
            </div>
            <button onClick={() => openQuickReport(q.type)}
              className={`w-full py-2 text-white rounded-lg transition-colors text-sm font-medium ${q.tone}`}>
              {q.label}
            </button>
          </div>
        ))}
      </div>

      {/* Report form */}
      {showForm && (
        <SectionCard title={quickType ? `Report ${quickType} Emergency` : 'Report Emergency'} subtitle="Creates a sec_emergency_notifications alert — visible in the Security SOC" icon={AlertTriangle} tone="danger" pad="md">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <select className={inputCls} value={form.emergencyType} onChange={(e) => setForm({ ...form, emergencyType: e.target.value })}>
                {EMERGENCY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input className={inputCls} placeholder="Location *" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
              <select className={inputCls} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                {EMERGENCY_PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select className={inputCls} value={form.evacuation} onChange={(e) => setForm({ ...form, evacuation: e.target.value })}>
                {EVACUATION_OPTIONS.map((v) => <option key={v} value={v}>Evacuation: {v}</option>)}
              </select>
              <input className={inputCls} placeholder="Incident commander" value={form.commander} onChange={(e) => setForm({ ...form, commander: e.target.value })} />
              <input className={inputCls} placeholder="Response team" value={form.responseTeam} onChange={(e) => setForm({ ...form, responseTeam: e.target.value })} />
            </div>
            <input className={inputCls} placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <div className="flex gap-2">
              <button className={button.primary} onClick={submitReport} disabled={busy === 'raise' || !form.location.trim()}>
                {busy === 'raise' ? 'Raising…' : 'Raise Alert'}
              </button>
              <button className={button.secondary} onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Critical incidents watch list */}
      {(data?.criticalIncidents.length || 0) > 0 && (
        <SectionCard title="Critical Incidents Watch List" subtitle="Open Critical/High security incidents — escalate into a full emergency if needed" icon={Shield} tone="warning" pad="md">
          <div className="flex flex-col gap-2">
            {data!.criticalIncidents.map((i) => (
              <div key={i.id} className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-slate-700">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-slate-900 dark:text-white">{i.type}</span>
                    <Badge tone={priorityTone(i.priority)}>{i.priority}</Badge>
                    <Badge tone="neutral">{i.status}</Badge>
                    {i.location && <span className="text-xs text-slate-500 inline-flex items-center gap-1"><MapPin size={11} />{i.location}</span>}
                  </div>
                  {i.description && <p className="text-xs text-slate-500 mt-0.5 truncate">{i.description}</p>}
                </div>
                <button className={button.secondary} disabled={busy === `esc-${i.id}`}
                  onClick={() => act(`esc-${i.id}`, () => escalateIncidentToEmergency(i.id, currentPropertyId), `Incident ${i.id} escalated to emergency.`)}>
                  {busy === `esc-${i.id}` ? <Loader2 size={14} className="animate-spin" /> : <ArrowUpCircle size={14} />}
                  Escalate
                </button>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Emergency board */}
      <SectionCard title="Emergency Board" subtitle={`${active.length} active · ${resolved.length} resolved`} icon={Siren} tone="danger" pad="md">
        {loading && emergencies.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
            <Loader2 size={20} className="animate-spin" /> Loading emergencies…
          </div>
        ) : emergencies.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-10">No emergencies on record — all clear.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,380px)_1fr] gap-4 items-start">
            <div className="flex flex-col gap-2 max-h-[620px] overflow-y-auto pr-1">
              {[...active, ...resolved].map((e) => (
                <button key={e.id} onClick={() => setSelectedId(e.id)}
                  className={`text-left p-3 rounded-lg border transition-all hover:shadow-md ${
                    selected?.id === e.id
                      ? 'border-[var(--color-accent-operations)] bg-[var(--color-accent-operations)]/5 ring-1 ring-[var(--color-accent-operations)]'
                      : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800'
                  }`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-sm text-slate-900 dark:text-white">{e.type}</span>
                    <ChevronRight size={14} className="text-slate-400 shrink-0 mt-0.5" />
                  </div>
                  <div className="flex gap-1.5 flex-wrap mt-1.5">
                    <Badge tone={typeTone(e.type)}>{e.type}</Badge>
                    <Badge tone={priorityTone(e.priority)}>{e.priority}</Badge>
                    <Badge tone={statusTone(e.status)}>{e.status}</Badge>
                    {e.evacuation === 'In Progress' && <Badge tone="warning">Evacuating</Badge>}
                  </div>
                  <div className="flex gap-3 text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                    <span className="inline-flex items-center gap-1"><MapPin size={12} /> {e.location}</span>
                    {e.commander && <span className="inline-flex items-center gap-1"><Radio size={12} /> {e.commander}</span>}
                    <span>{e.occurredAt ? new Date(e.occurredAt).toLocaleString() : ''}</span>
                  </div>
                </button>
              ))}
            </div>

            {selected && (
              <div className="p-4 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">{selected.type} — {selected.location}</h3>
                    <div className="flex gap-1.5 flex-wrap">
                      <Badge tone={priorityTone(selected.priority)}>{selected.priority}</Badge>
                      <Badge tone={statusTone(selected.status)}>{selected.status}</Badge>
                      {selected.evacuation && selected.evacuation !== 'Not Required' && (
                        <Badge tone="warning">Evacuation: {selected.evacuation}</Badge>
                      )}
                    </div>
                  </div>
                </div>

                {selected.description && (
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">{selected.description}</p>
                )}

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4 text-sm">
                  <div><p className="text-xs text-slate-500">Reported</p><p className="text-slate-900 dark:text-white font-medium">{selected.occurredAt ? new Date(selected.occurredAt).toLocaleString() : '—'}</p></div>
                  <div><p className="text-xs text-slate-500">Commander</p><p className="text-slate-900 dark:text-white font-medium">{selected.commander || 'Unassigned'}</p></div>
                  <div><p className="text-xs text-slate-500">Response Team</p><p className="text-slate-900 dark:text-white font-medium">{selected.responseTeam || '—'}</p></div>
                  <div><p className="text-xs text-slate-500">Resolved</p><p className="text-slate-900 dark:text-white font-medium">{selected.resolvedAt ? new Date(selected.resolvedAt).toLocaleString() : '—'}</p></div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-wrap mb-4">
                  <select className={inputCls} value={selected.status}
                    disabled={busy === `st-${selected.id}`}
                    onChange={(e) => act(`st-${selected.id}`, () => updateEmergency(selected.id, { status: e.target.value }))}>
                    {EMERGENCY_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select className={inputCls} value={selected.evacuation || 'Not Required'}
                    disabled={busy === `ev-${selected.id}`}
                    onChange={(e) => act(`ev-${selected.id}`, () => updateEmergency(selected.id, { evacuation: e.target.value }))}>
                    {EVACUATION_OPTIONS.map((v) => <option key={v} value={v}>Evac: {v}</option>)}
                  </select>
                  <button className={button.secondary} disabled={busy === `cmd-${selected.id}`}
                    onClick={() => {
                      const name = prompt('Incident commander name', selected.commander || '');
                      if (name !== null) act(`cmd-${selected.id}`, () => updateEmergency(selected.id, { commander: name }));
                    }}>
                    <Users size={14} /> Set Commander
                  </button>
                </div>

                {/* Response timeline */}
                <div className="mb-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Response Timeline</p>
                  <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto mb-2">
                    {selected.responses.length === 0 ? (
                      <p className="text-xs text-slate-400">No response entries yet.</p>
                    ) : selected.responses.map((r) => (
                      <div key={r.id} className="flex items-start gap-2 text-sm">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-operations)] mt-1.5 shrink-0" />
                        <div>
                          <span className="font-medium text-slate-900 dark:text-white">{r.action}</span>
                          {r.detail && <span className="text-slate-500"> — {r.detail}</span>}
                          <p className="text-xs text-slate-400">{r.actor || 'system'} · {new Date(r.at).toLocaleString()}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input className={`${inputCls} flex-1`} placeholder="Log response note (e.g. 'Paramedics arrived')" value={respText}
                      onChange={(e) => setRespText(e.target.value)} />
                    <button className={button.secondary} disabled={busy === `resp-${selected.id}` || !respText.trim()}
                      onClick={() => act(`resp-${selected.id}`, async () => {
                        await addEmergencyResponse(selected.id, 'Note', respText.trim());
                        setRespText('');
                      })}>
                      Log
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
};

export default EmergencyCoordination;

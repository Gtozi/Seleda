/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Maintenance Coordination module — docs/Housekeeping Portal new.md §20.
 * Issue Reporting (8 categories) and workflow: Report Issue → Assign
 * Engineering → Track Status → Verify Completion → Release Room.
 *
 * DB-integrated: fetches and persists via /api/hk-portal/maintenance.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Wrench,
  Droplets,
  Zap,
  AirVent,
  Sofa,
  Lock,
  Lightbulb,
  Tv,
  Wifi,
  Plus,
  Search,
  ArrowRight,
  CheckCircle2,
  Eye,
  Send,
  Loader2,
  ServerCrash,
  X,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';

type IssueType = 'Plumbing' | 'Electrical' | 'HVAC' | 'Furniture Damage' | 'Lock Problems' | 'Lighting' | 'TV' | 'Internet';
type WorkflowStage = 'Reported' | 'Assigned to Engineering' | 'In Progress' | 'Completed' | 'Verified' | 'Room Released';

interface MaintenanceIssue {
  id: string;
  type: IssueType;
  room: string;
  reportedBy: string;
  reportedAt: string;
  stage: WorkflowStage;
  assignedTo?: string;
  notes?: string;
}

const TYPE_ICON: Record<IssueType, LucideIcon> = {
  Plumbing: Droplets,
  Electrical: Zap,
  HVAC: AirVent,
  'Furniture Damage': Sofa,
  'Lock Problems': Lock,
  Lighting: Lightbulb,
  TV: Tv,
  Internet: Wifi,
};

const ISSUE_TYPES: IssueType[] = [
  'Plumbing', 'Electrical', 'HVAC', 'Furniture Damage',
  'Lock Problems', 'Lighting', 'TV', 'Internet',
];

const STAGE_FLOW: WorkflowStage[] = ['Reported', 'Assigned to Engineering', 'In Progress', 'Completed', 'Verified', 'Room Released'];

const STAGE_TONE: Record<WorkflowStage, StatusTone> = {
  'Reported': 'warning',
  'Assigned to Engineering': 'info',
  'In Progress': 'info',
  'Completed': 'accent',
  'Verified': 'success',
  'Room Released': 'success',
};

// ── Auth headers ───────────────────────────────────────────────────────
function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

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

export default function MaintenanceCoordinationModule() {
  const { currentPropertyId, addNotification } = useERP();

  const [issues, setIssues] = useState<MaintenanceIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const [filter, setFilter] = useState<'All' | WorkflowStage>('All');
  const [typeFilter, setTypeFilter] = useState<'All' | IssueType>('All');
  const [search, setSearch] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<{ type: IssueType; room: string; reportedBy: string; notes: string }>({
    type: 'Plumbing', room: '', reportedBy: '', notes: '',
  });

  const fetchIssues = useCallback(async () => {
    if (!currentPropertyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hk-portal/maintenance/${currentPropertyId}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Failed to load maintenance issues (${res.status})`);
      const data = (await res.json()) as { issues: MaintenanceIssue[] };
      setIssues(data.issues || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load maintenance issues');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  const filtered = useMemo(
    () =>
      issues.filter(i => {
        const matchesStage = filter === 'All' || i.stage === filter;
        const matchesType = typeFilter === 'All' || i.type === typeFilter;
        const matchesSearch =
          i.room.toLowerCase().includes(search.toLowerCase()) ||
          i.type.toLowerCase().includes(search.toLowerCase()) ||
          (i.assignedTo?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
          i.id.toLowerCase().includes(search.toLowerCase());
        return matchesStage && matchesType && matchesSearch;
      }),
    [issues, filter, typeFilter, search]
  );

  const advance = async (id: string) => {
    setActingOn(id);
    try {
      const res = await fetch(`/api/hk-portal/maintenance/${id}/advance`, {
        method: 'PUT',
        headers: authHeaders(true),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to advance issue (${res.status})`);
      }
      const updated = (await res.json()) as MaintenanceIssue;
      setIssues(prev => prev.map(i => (i.id === id ? updated : i)));
      addNotification(`Maintenance issue ${id} advanced to ${updated.stage}.`, 'task', 'Housekeeping');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to advance issue', 'error', 'Housekeeping');
    } finally {
      setActingOn(null);
    }
  };

  const submitReport = async () => {
    if (!currentPropertyId) return;
    if (!form.room.trim() || !form.reportedBy.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/hk-portal/maintenance', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          type: form.type,
          room: form.room.trim(),
          reportedBy: form.reportedBy.trim(),
          notes: form.notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to report issue (${res.status})`);
      }
      const created = (await res.json()) as MaintenanceIssue;
      setIssues(prev => [created, ...prev]);
      addNotification(`Maintenance issue ${created.id} reported for Room ${created.room}.`, 'task', 'Housekeeping');
      setShowForm(false);
      setForm({ type: 'Plumbing', room: '', reportedBy: '', notes: '' });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to report issue', 'error', 'Housekeeping');
    } finally {
      setSubmitting(false);
    }
  };

  const counts = {
    reported: issues.filter(i => i.stage === 'Reported').length,
    assigned: issues.filter(i => i.stage === 'Assigned to Engineering').length,
    inProgress: issues.filter(i => i.stage === 'In Progress').length,
    completed: issues.filter(i => i.stage === 'Completed' || i.stage === 'Verified').length,
    released: issues.filter(i => i.stage === 'Room Released').length,
  };

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Maintenance Coordination"
        subtitle="Report issues to Engineering & track to room release."
        icon={Wrench}
        actions={
          <button className={button.primary} onClick={() => setShowForm(true)}>
            <Plus size={14} /> Report Issue
          </button>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Reported" value={counts.reported} icon={Send} tone="warning" />
        <StatCard title="Assigned" value={counts.assigned} icon={ArrowRight} tone="info" />
        <StatCard title="In Progress" value={counts.inProgress} icon={Wrench} tone="info" />
        <StatCard title="Completed" value={counts.completed} icon={CheckCircle2} tone="accent" />
        <StatCard title="Rooms Released" value={counts.released} icon={Eye} tone="success" />
      </div>

      {/* Issue type quick filter */}
      <SectionCard pad="md" tone="accent">
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
          {ISSUE_TYPES.map(t => {
            const Icon = TYPE_ICON[t];
            const active = typeFilter === t;
            return (
              <button
                key={t}
                onClick={() => setTypeFilter(typeFilter === t ? 'All' : t)}
                className={[
                  'p-2.5 rounded-2xl border text-center smooth-transition',
                  active
                    ? 'border-[var(--color-accent-operations)] ring-1 ring-[var(--color-accent-operations)]/30 bg-[var(--color-accent-operations)]/10'
                    : 'border-gray-200 dark:border-slate-700 hover:border-[var(--color-accent-operations)]',
                ].join(' ')}
              >
                <Icon size={16} className="mx-auto text-[var(--color-accent-operations)] mb-1" />
                <p className="text-[8px] font-black uppercase leading-tight text-gray-600 dark:text-gray-300">{t}</p>
              </button>
            );
          })}
        </div>
      </SectionCard>

      {/* Filters + search */}
      <SectionCard pad="md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <select
              value={filter}
              onChange={e => setFilter(e.target.value as 'All' | WorkflowStage)}
              className="bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl px-3 py-2 text-[10px] font-bold text-gray-600 dark:text-gray-200 outline-none cursor-pointer"
            >
              <option value="All">All Stages</option>
              {STAGE_FLOW.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="relative w-full max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              placeholder="Search room, type, assignee..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-850 border border-transparent dark:border-slate-800 rounded-xl text-xs outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)] font-sans"
            />
          </div>
        </div>
      </SectionCard>

      {/* Issue list */}
      <SectionCard pad="none" bodyClassName="divide-y divide-gray-100 dark:divide-slate-700">
        {loading && (
          <div className="p-8 flex items-center justify-center gap-2 text-[10px] font-bold text-gray-400 uppercase">
            <Loader2 size={14} className="animate-spin" /> Loading maintenance issues…
          </div>
        )}
        {!loading && error && (
          <div className="p-8 flex flex-col items-center justify-center gap-2 text-[10px] font-bold text-red-500 uppercase">
            <ServerCrash size={16} /> {error}
            <button onClick={fetchIssues} className={button.ghost + ' mt-1'}>Retry</button>
          </div>
        )}
        {!loading && !error && filtered.map(i => {
          const Icon = TYPE_ICON[i.type];
          const stageIdx = STAGE_FLOW.indexOf(i.stage);
          const tone = STAGE_TONE[i.stage];
          return (
            <div key={i.id} className="p-4 flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex items-center gap-3 md:w-56 shrink-0">
                <div className={`p-2 rounded-xl ${statusTone[tone].soft}`}>
                  <Icon size={16} className={statusTone[tone].text} />
                </div>
                <div>
                  <h4 className="text-[11px] font-black text-gray-900 dark:text-white uppercase">{i.type}</h4>
                  <p className="text-[9px] text-gray-400 font-mono">{i.id} · Room {i.room}</p>
                </div>
              </div>
              <div className="flex-1 text-[10px] font-mono">
                <p className="font-bold text-gray-700 dark:text-gray-200">{i.notes}</p>
                <p className="text-gray-400">Reported by {i.reportedBy} at {i.reportedAt}{i.assignedTo ? ` · Assigned: ${i.assignedTo}` : ''}</p>
              </div>
              {/* Workflow progress */}
              <div className="md:w-72 shrink-0">
                <div className="flex items-center justify-between text-[8px] font-mono mb-1">
                  <Badge tone={tone} variant="soft">{i.stage}</Badge>
                  <span className="text-gray-400">{stageIdx + 1}/{STAGE_FLOW.length}</span>
                </div>
                <div className="flex gap-1">
                  {STAGE_FLOW.map((s, idx) => (
                    <div
                      key={s}
                      className={[
                        'h-1.5 flex-1 rounded-full',
                        idx <= stageIdx ? 'bg-[var(--color-accent-operations)]' : 'bg-slate-100 dark:bg-slate-800',
                      ].join(' ')}
                    />
                  ))}
                </div>
              </div>
              <div className="md:w-32 shrink-0 flex justify-end">
                {i.stage !== 'Room Released' && (
                  <button
                    onClick={() => advance(i.id)}
                    disabled={actingOn === i.id}
                    className={button.ghost + ' bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)] hover:bg-[var(--color-accent-operations)] hover:text-white whitespace-nowrap disabled:opacity-50'}
                  >
                    {actingOn === i.id ? <Loader2 size={12} className="animate-spin" /> : (
                      i.stage === 'Reported' ? 'Assign' : i.stage === 'Completed' ? 'Verify' : i.stage === 'Verified' ? 'Release' : 'Advance'
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {!loading && !error && filtered.length === 0 && (
          <div className="p-8 text-center text-[10px] font-bold text-gray-400 uppercase">
            {issues.length === 0 ? 'No maintenance issues reported yet.' : 'No maintenance issues match the filters.'}
          </div>
        )}
      </SectionCard>

      {/* Report Issue modal */}
      <ModalSystem
        isOpen={showForm}
        onClose={() => (submitting ? undefined : setShowForm(false))}
        title="Report Maintenance Issue"
        subtitle="Dispatch a new issue to the Engineering team."
        variant="form"
        size="md"
        loading={submitting}
        confirmLabel={submitting ? 'Submitting…' : 'Report Issue'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitReport}
        showFooter
      >
        <div className="space-y-4">
          <Field label="Issue Type">
            <select
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value as IssueType }))}
              className={inputClass}
            >
              {ISSUE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Room / Location">
              <input
                value={form.room}
                onChange={e => setForm(f => ({ ...f, room: e.target.value }))}
                placeholder="e.g. 306"
                className={inputClass}
              />
            </Field>
            <Field label="Reported By">
              <input
                value={form.reportedBy}
                onChange={e => setForm(f => ({ ...f, reportedBy: e.target.value }))}
                placeholder="e.g. Maria S."
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Describe the issue…"
              rows={3}
              className={inputClass}
            />
          </Field>
        </div>
      </ModalSystem>
    </div>
  );
}

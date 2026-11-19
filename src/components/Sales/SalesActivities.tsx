import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, RefreshCw, Phone, Users, MapPin, CalendarClock,
  CheckSquare, Bell, ClipboardList, Calendar, CheckCircle2, XCircle, RotateCcw,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import StatCard from '../FrontOffice/StatCard';
import { button, layout } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import { ModalSystem } from '../Shared/ModalSystem';
import { DataTable, Column } from '../Shared/DataTable';
import { fetchSalesActivities, createSalesActivity, updateSalesActivity, type SalesActivity } from '../../services/salesService';

const ACTIVITY_TYPES = ['Call', 'Meeting', 'Site Inspection', 'Client Visit', 'Follow-up', 'Task'];
const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  Call: <Phone size={14} />,
  Meeting: <Users size={14} />,
  'Site Inspection': <MapPin size={14} />,
  'Client Visit': <MapPin size={14} />,
  'Follow-up': <Bell size={14} />,
  Task: <CheckSquare size={14} />,
};

const PRIORITY_TONE: Record<string, string> = {
  High: 'danger',
  Medium: 'warning',
  Low: 'neutral',
};

const STATUS_TONE: Record<string, string> = {
  Pending: 'warning',
  Completed: 'success',
  Overdue: 'danger',
  Cancelled: 'neutral',
};

const EMPTY_FORM = {
  activityType: 'Call',
  title: '',
  relatedTo: '',
  assignedTo: '',
  dueDate: '',
  priority: 'Medium',
  notes: '',
};

const SalesActivities: React.FC = () => {
  const { addNotification } = useERP();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activities, setActivities] = useState<SalesActivity[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSalesActivities();
      setActivities(data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load sales activities');
      addNotification('Failed to load sales activities', 'error', 'Sales');
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleAdd = async () => {
    if (!form.title.trim()) {
      setError('Title is required');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createSalesActivity(form);
      addNotification('Activity created', 'success', 'Sales');
      setShowAddModal(false);
      setForm(EMPTY_FORM);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to create activity');
      addNotification('Failed to create activity', 'error', 'Sales');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (activity: SalesActivity, status: string) => {
    try {
      await updateSalesActivity(activity.id, { status });
      addNotification(`Activity marked ${status}`, 'info', 'Sales');
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to update activity');
      addNotification('Failed to update activity', 'error', 'Sales');
    }
  };

  const columns: Column<SalesActivity>[] = [
    {
      key: 'activity_type',
      label: 'Type',
      align: 'center',
      sortable: true,
      sortAccessor: (a) => a.activity_type,
      render: (a) => (
        <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
          {ACTIVITY_ICONS[a.activity_type] || <ClipboardList size={14} />}
          {a.activity_type}
        </div>
      ),
    },
    {
      key: 'title',
      label: 'Title',
      sortable: true,
      sortAccessor: (a) => a.title,
      render: (a) => <span className="text-sm font-semibold text-gray-900 dark:text-white">{a.title}</span>,
    },
    {
      key: 'related_to',
      label: 'Related To',
      sortable: true,
      sortAccessor: (a) => a.related_to || '',
      render: (a) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{a.related_to || '—'}</span>,
    },
    {
      key: 'assigned_to',
      label: 'Assigned',
      align: 'center',
      sortable: true,
      sortAccessor: (a) => a.assigned_to || '',
      render: (a) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{a.assigned_to || '—'}</span>,
    },
    {
      key: 'due_date',
      label: 'Due Date',
      align: 'center',
      sortable: true,
      sortAccessor: (a) => a.due_date || '',
      render: (a) => (
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-center gap-1">
          <Calendar size={12} /> {a.due_date || '—'}
        </span>
      ),
    },
    {
      key: 'priority',
      label: 'Priority',
      align: 'center',
      sortable: true,
      sortAccessor: (a) => a.priority,
      render: (a) => <Badge tone={(PRIORITY_TONE[a.priority] || 'neutral') as any}>{a.priority}</Badge>,
    },
    {
      key: 'status',
      label: 'Status',
      align: 'center',
      sortable: true,
      sortAccessor: (a) => a.status,
      render: (a) => <Badge tone={(STATUS_TONE[a.status] || 'neutral') as any}>{a.status}</Badge>,
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      sortable: false,
      render: (a) => (
        <div className="flex justify-end gap-1">
          {a.status === 'Pending' || a.status === 'Overdue' ? (
            <>
              <button onClick={() => handleStatusChange(a, 'Completed')} className="p-1.5 text-slate-400 hover:text-emerald-500 transition" title="Complete"><CheckCircle2 size={14} /></button>
              <button onClick={() => handleStatusChange(a, 'Cancelled')} className="p-1.5 text-slate-400 hover:text-slate-500 transition" title="Cancel"><XCircle size={14} /></button>
            </>
          ) : (
            <button onClick={() => handleStatusChange(a, 'Pending')} className="p-1.5 text-slate-400 hover:text-[var(--color-info)] transition" title="Reopen"><RotateCcw size={14} /></button>
          )}
        </div>
      ),
    },
  ];

  const countsByType = (type: string) => activities.filter((a) => a.activity_type === type).length;

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Sales Activities"
        subtitle="Calls, meetings, site inspections, follow-ups, tasks, and calendar · DB-synced"
        icon={CalendarClock}
        actions={
          <>
            <button onClick={loadData} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={() => { setForm(EMPTY_FORM); setShowAddModal(true); setError(null); }} className={button.primary}>
              <Plus size={16} /> New Activity
            </button>
          </>
        }
      />

      {error && !showAddModal && (
        <div className="p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-2xl flex items-center justify-between">
          <p className="text-sm font-semibold text-rose-700 dark:text-rose-400">{error}</p>
          <button onClick={loadData} disabled={loading} className={[button.secondary, 'flex items-center gap-2'].join(' ')}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {ACTIVITY_TYPES.map((type) => (
          <StatCard
            key={type}
            title={type}
            value={countsByType(type).toString()}
            icon={() => <>{ACTIVITY_ICONS[type]}</>}
            tone="info"
          />
        ))}
      </div>

      <SectionCard title="Activity Calendar" subtitle="All scheduled sales activities and tasks">
        <div className="p-6">
          <DataTable
            columns={columns}
            data={activities}
            rowKey={(row) => row.id}
            sortable
            filterable
            filterPlaceholder="Search activities..."
            filterKeys={['title', 'related_to', 'assigned_to', 'activity_type', 'status']}
            emptyMessage="No sales activities scheduled."
            containerClassName="!rounded-2xl !shadow-none border-slate-200 dark:border-slate-700"
          />
        </div>
      </SectionCard>

      <ModalSystem
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setError(null); }}
        onConfirm={handleAdd}
        title="New Sales Activity"
        subtitle="Schedule a call, meeting, or task"
        confirmLabel="Create Activity"
        cancelLabel="Cancel"
        confirmColor="emerald"
        showFooter
        loading={saving}
        size="lg"
      >
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl text-sm text-rose-700 dark:text-rose-400">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Activity Type</label>
              <select value={form.activityType} onChange={(e) => setForm({ ...form, activityType: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
                {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Priority</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
                <option>Low</option><option>Medium</option><option>High</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Title</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" placeholder="e.g., Follow-up call with Ethiopian Airlines" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Related To</label>
              <input value={form.relatedTo} onChange={(e) => setForm({ ...form, relatedTo: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" placeholder="Lead or account name" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Assigned To</label>
              <input value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Due Date</label>
            <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default SalesActivities;

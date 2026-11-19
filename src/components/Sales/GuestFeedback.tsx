import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, RefreshCw, Star, MessageSquare, AlertCircle,
  CheckCircle2, Clock, Utensils, Calendar, XCircle,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import StatCard from '../FrontOffice/StatCard';
import { button, layout } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import { ModalSystem } from '../Shared/ModalSystem';
import { DataTable, Column } from '../Shared/DataTable';
import { fetchGuestFeedback, createGuestFeedback, updateGuestFeedback, type GuestFeedback as Feedback } from '../../services/salesService';

const FEEDBACK_TYPES = ['Post-Stay Survey', 'In-Stay Survey', 'Event Feedback', 'Restaurant Feedback', 'Complaint'];

const TYPE_TONE: Record<string, string> = {
  'Post-Stay Survey': 'info',
  'In-Stay Survey': 'accent',
  'Event Feedback': 'warning',
  'Restaurant Feedback': 'success',
  'Complaint': 'danger',
};

const STATUS_TONE: Record<string, string> = {
  Resolved: 'success',
  Pending: 'warning',
  Escalated: 'danger',
  Closed: 'neutral',
};

const EMPTY_FORM = {
  feedbackType: 'Post-Stay Survey',
  guestName: '',
  rating: 5,
  comments: '',
  feedbackDate: '',
};

const GuestFeedbackComponent: React.FC = () => {
  const { addNotification } = useERP();

  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFeedback(await fetchGuestFeedback());
    } catch (err: any) {
      setError(err.message || 'Failed to load guest feedback');
      addNotification('Failed to load guest feedback', 'error', 'Sales');
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async () => {
    if (!form.guestName.trim()) {
      setError('Guest name is required');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createGuestFeedback({ ...form, feedbackDate: form.feedbackDate || new Date().toISOString().split('T')[0] });
      addNotification('Guest feedback logged', 'success', 'Sales');
      setShowAddModal(false);
      setForm(EMPTY_FORM);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to log feedback');
      addNotification('Failed to log feedback', 'error', 'Sales');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (item: Feedback, status: string) => {
    try {
      await updateGuestFeedback(item.id, { status });
      addNotification(`Feedback ${status.toLowerCase()}`, 'info', 'Sales');
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to update feedback');
      addNotification('Failed to update feedback', 'error', 'Sales');
    }
  };

  const avgRating = useMemo(() =>
    feedback.length > 0 ? (feedback.reduce((s, f) => s + Number(f.rating || 0), 0) / feedback.length).toFixed(1) : '—',
  [feedback]);
  const resolvedCount = useMemo(() => feedback.filter((f) => f.status === 'Resolved').length, [feedback]);
  const pendingCount = useMemo(() => feedback.filter((f) => f.status === 'Pending').length, [feedback]);
  const complaintsCount = useMemo(() => feedback.filter((f) => f.feedback_type === 'Complaint').length, [feedback]);

  const columns: Column<Feedback>[] = [
    {
      key: 'feedback_type',
      label: 'Type',
      align: 'center',
      sortable: true,
      sortAccessor: (f) => f.feedback_type || '',
      render: (f) => <Badge tone={(TYPE_TONE[f.feedback_type || ''] || 'neutral') as any}>{f.feedback_type || '—'}</Badge>,
    },
    {
      key: 'guest_name',
      label: 'Guest',
      sortable: true,
      sortAccessor: (f) => f.guest_name,
      render: (f) => <span className="text-sm font-semibold text-gray-900 dark:text-white">{f.guest_name}</span>,
    },
    {
      key: 'rating',
      label: 'Rating',
      align: 'center',
      sortable: true,
      sortAccessor: (f) => f.rating,
      render: (f) => (
        <div className="flex items-center justify-center gap-0.5">
          {[1, 2, 3, 4, 5].map((i) => <Star key={i} size={12} className={i <= f.rating ? 'text-amber-400 fill-amber-400' : 'text-slate-200 dark:text-slate-700'} />)}
        </div>
      ),
    },
    {
      key: 'comments',
      label: 'Comments',
      sortable: true,
      sortAccessor: (f) => f.comments || '',
      render: (f) => <span className="text-xs font-medium text-slate-600 dark:text-slate-400 truncate block max-w-xs">{f.comments}</span>,
    },
    {
      key: 'feedback_date',
      label: 'Date',
      align: 'center',
      sortable: true,
      sortAccessor: (f) => f.feedback_date || '',
      render: (f) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-center gap-1"><Calendar size={12} /> {f.feedback_date || '—'}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      align: 'center',
      sortable: true,
      sortAccessor: (f) => f.status,
      render: (f) => <Badge tone={(STATUS_TONE[f.status] || 'neutral') as any}>{f.status}</Badge>,
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      sortable: false,
      render: (f) => (
        <div className="flex justify-end gap-1">
          {f.status !== 'Resolved' && (
            <button onClick={() => handleStatusChange(f, 'Resolved')} className="p-1.5 text-slate-400 hover:text-emerald-500 transition" title="Resolve"><CheckCircle2 size={14} /></button>
          )}
          {f.status !== 'Escalated' && (
            <button onClick={() => handleStatusChange(f, 'Escalated')} className="p-1.5 text-slate-400 hover:text-rose-500 transition" title="Escalate"><AlertCircle size={14} /></button>
          )}
          {f.status !== 'Closed' && (
            <button onClick={() => handleStatusChange(f, 'Closed')} className="p-1.5 text-slate-400 hover:text-slate-500 transition" title="Close"><XCircle size={14} /></button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Guest Feedback"
        subtitle="Post-stay surveys, in-stay surveys, event feedback, complaint management, and resolution tracking · DB-synced"
        icon={MessageSquare}
        actions={
          <>
            <button onClick={loadData} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={() => { setForm(EMPTY_FORM); setShowAddModal(true); setError(null); }} className={button.primary}>
              <Plus size={16} /> Log Feedback
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

      <div className={layout.kpiGrid}>
        <StatCard title="Avg Rating" value={avgRating} icon={Star} tone="warning" />
        <StatCard title="Resolved" value={resolvedCount.toLocaleString()} icon={CheckCircle2} tone="success" />
        <StatCard title="Pending" value={pendingCount.toLocaleString()} icon={Clock} tone="warning" />
        <StatCard title="Complaints" value={complaintsCount.toLocaleString()} icon={AlertCircle} tone="danger" />
      </div>

      <SectionCard title="Guest Feedback" subtitle="All feedback, surveys, and complaints">
        <div className="p-6">
          <DataTable
            columns={columns}
            data={feedback}
            rowKey={(row) => row.id}
            sortable
            filterable
            filterPlaceholder="Search feedback..."
            filterKeys={['guest_name', 'feedback_type', 'status', 'comments']}
            emptyMessage="No guest feedback collected yet."
            containerClassName="!rounded-2xl !shadow-none border-slate-200 dark:border-slate-700"
          />
        </div>
      </SectionCard>

      <ModalSystem
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setError(null); }}
        onConfirm={handleCreate}
        title="Log Guest Feedback"
        subtitle="Record survey results or complaints"
        confirmLabel="Log Feedback"
        cancelLabel="Cancel"
        confirmColor="emerald"
        showFooter
        loading={saving}
        size="md"
      >
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl text-sm text-rose-700 dark:text-rose-400">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Feedback Type</label>
              <select value={form.feedbackType} onChange={(e) => setForm({ ...form, feedbackType: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
                {FEEDBACK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Rating (1-5)</label>
              <select value={form.rating} onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} Star{n > 1 ? 's' : ''}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Guest Name</label>
            <input value={form.guestName} onChange={(e) => setForm({ ...form, guestName: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Date</label>
            <input type="date" value={form.feedbackDate} onChange={(e) => setForm({ ...form, feedbackDate: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Comments</label>
            <textarea value={form.comments} onChange={(e) => setForm({ ...form, comments: e.target.value })} rows={4} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default GuestFeedbackComponent;

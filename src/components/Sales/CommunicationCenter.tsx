import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, RefreshCw, Mail, MessageSquare, Bell,
  Send, Phone, Users, CheckCircle2, XCircle, SendHorizonal, Clock,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import StatCard from '../FrontOffice/StatCard';
import { button, layout } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import { ModalSystem } from '../Shared/ModalSystem';
import { DataTable, Column } from '../Shared/DataTable';
import { fetchCommunications, createCommunication, updateCommunication, type Communication } from '../../services/salesService';

const CHANNELS = ['Email', 'SMS', 'WhatsApp', 'Push Notification', 'In-App Message'];

const CHANNEL_TONE: Record<string, string> = {
  Email: 'info',
  SMS: 'accent',
  WhatsApp: 'success',
  'Push Notification': 'warning',
  'In-App Message': 'neutral',
};

const STATUS_TONE: Record<string, string> = {
  Sent: 'info',
  Delivered: 'success',
  Read: 'success',
  Failed: 'danger',
  Pending: 'warning',
};

const CHANNEL_ICON: Record<string, React.ReactNode> = {
  Email: <Mail size={14} />,
  SMS: <MessageSquare size={14} />,
  WhatsApp: <Phone size={14} />,
  'Push Notification': <Bell size={14} />,
  'In-App Message': <Users size={14} />,
};

const EMPTY_FORM = {
  channel: 'Email',
  subject: '',
  recipient: '',
  body: '',
  communicationDate: '',
};

const CommunicationCenter: React.FC = () => {
  const { addNotification } = useERP();

  const [messages, setMessages] = useState<Communication[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMessages(await fetchCommunications());
    } catch (err: any) {
      setError(err.message || 'Failed to load communications');
      addNotification('Failed to load communications', 'error', 'Sales');
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async () => {
    if (!form.recipient.trim()) {
      setError('Recipient is required');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createCommunication({ ...form, status: 'Pending', communicationDate: form.communicationDate || new Date().toISOString().split('T')[0] });
      addNotification('Communication queued', 'success', 'Sales');
      setShowAddModal(false);
      setForm(EMPTY_FORM);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to create communication');
      addNotification('Failed to create communication', 'error', 'Sales');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (msg: Communication, status: string) => {
    try {
      await updateCommunication(msg.id, { status });
      addNotification(`Marked ${status.toLowerCase()}`, 'info', 'Sales');
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to update communication');
      addNotification('Failed to update communication', 'error', 'Sales');
    }
  };

  const countsByChannel = useMemo(() => {
    const map: Record<string, number> = {};
    messages.forEach((m) => { if (m.channel) map[m.channel] = (map[m.channel] || 0) + 1; });
    return map;
  }, [messages]);

  const totalSent = useMemo(() => messages.filter((m) => m.status === 'Sent' || m.status === 'Delivered' || m.status === 'Read').length, [messages]);
  const totalDelivered = useMemo(() => messages.filter((m) => m.status === 'Delivered' || m.status === 'Read').length, [messages]);
  const totalPending = useMemo(() => messages.filter((m) => m.status === 'Pending').length, [messages]);
  const totalFailed = useMemo(() => messages.filter((m) => m.status === 'Failed').length, [messages]);

  const columns: Column<Communication>[] = [
    {
      key: 'channel',
      label: 'Channel',
      align: 'center',
      sortable: true,
      sortAccessor: (m) => m.channel || '',
      render: (m) => (
        <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
          {CHANNEL_ICON[m.channel || ''] || <Mail size={14} />}
          {m.channel || '—'}
        </div>
      ),
    },
    {
      key: 'subject',
      label: 'Subject',
      sortable: true,
      sortAccessor: (m) => m.subject || '',
      render: (m) => <span className="text-sm font-semibold text-gray-900 dark:text-white">{m.subject || '—'}</span>,
    },
    {
      key: 'recipient',
      label: 'Recipient',
      sortable: true,
      sortAccessor: (m) => m.recipient || '',
      render: (m) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{m.recipient || '—'}</span>,
    },
    {
      key: 'body',
      label: 'Preview',
      sortable: true,
      sortAccessor: (m) => m.body || '',
      render: (m) => <span className="text-xs font-medium text-slate-600 dark:text-slate-400 truncate block max-w-xs">{m.body}</span>,
    },
    {
      key: 'communication_date',
      label: 'Date',
      align: 'center',
      sortable: true,
      sortAccessor: (m) => m.communication_date || '',
      render: (m) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{m.communication_date || '—'}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      align: 'center',
      sortable: true,
      sortAccessor: (m) => m.status,
      render: (m) => <Badge tone={(STATUS_TONE[m.status] || 'neutral') as any}>{m.status}</Badge>,
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      sortable: false,
      render: (m) => (
        <div className="flex justify-end gap-1">
          {m.status === 'Pending' && (
            <button onClick={() => handleStatusChange(m, 'Sent')} className="p-1.5 text-slate-400 hover:text-[var(--color-info)] transition" title="Send"><SendHorizonal size={14} /></button>
          )}
          {(m.status === 'Pending' || m.status === 'Sent') && (
            <button onClick={() => handleStatusChange(m, 'Delivered')} className="p-1.5 text-slate-400 hover:text-emerald-500 transition" title="Mark delivered"><CheckCircle2 size={14} /></button>
          )}
          {m.status !== 'Failed' && (
            <button onClick={() => handleStatusChange(m, 'Failed')} className="p-1.5 text-slate-400 hover:text-rose-500 transition" title="Mark failed"><XCircle size={14} /></button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Communication Center"
        subtitle="Unified messaging across email, SMS, WhatsApp, push notifications, and in-app messages · DB-synced"
        icon={Send}
        actions={
          <>
            <button onClick={loadData} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={() => { setForm(EMPTY_FORM); setShowAddModal(true); setError(null); }} className={button.primary}>
              <Plus size={16} /> New Message
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
        {CHANNELS.map((ch) => (
          <StatCard
            key={ch}
            title={ch}
            value={(countsByChannel[ch] || 0).toString()}
            icon={() => <>{CHANNEL_ICON[ch]}</>}
            tone={(CHANNEL_TONE[ch] || 'neutral') as any}
          />
        ))}
      </div>

      <div className={layout.kpiGrid}>
        <StatCard title="Total Sent" value={totalSent.toLocaleString()} icon={Send} tone="info" />
        <StatCard title="Delivered / Read" value={totalDelivered.toLocaleString()} icon={CheckCircle2} tone="success" />
        <StatCard title="Pending" value={totalPending.toLocaleString()} icon={Clock} tone="warning" />
        <StatCard title="Failed" value={totalFailed.toLocaleString()} icon={XCircle} tone="danger" />
      </div>

      <SectionCard title="Communication Log" subtitle="All messages across channels">
        <div className="p-6">
          <DataTable
            columns={columns}
            data={messages}
            rowKey={(row) => row.id}
            sortable
            filterable
            filterPlaceholder="Search messages..."
            filterKeys={['channel', 'subject', 'recipient', 'status', 'body']}
            emptyMessage="No messages sent yet."
            containerClassName="!rounded-2xl !shadow-none border-slate-200 dark:border-slate-700"
          />
        </div>
      </SectionCard>

      <ModalSystem
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setError(null); }}
        onConfirm={handleCreate}
        title="New Communication"
        subtitle="Send a message via any channel"
        confirmLabel="Queue Message"
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
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Channel</label>
              <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
                {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Date</label>
              <input type="date" value={form.communicationDate} onChange={(e) => setForm({ ...form, communicationDate: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Recipient</label>
            <input value={form.recipient} onChange={(e) => setForm({ ...form, recipient: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" placeholder="Email or phone number" />
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Subject</label>
            <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Message</label>
            <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={5} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default CommunicationCenter;

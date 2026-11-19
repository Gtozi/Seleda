import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, RefreshCw, MessageSquare, Send, Smartphone,
  Bell, MessageCircle, Zap, SendHorizonal,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import StatCard from '../FrontOffice/StatCard';
import { button, layout } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import { ModalSystem } from '../Shared/ModalSystem';
import { DataTable, Column } from '../Shared/DataTable';
import { fetchSMSMessaging, createSMSMessage, updateSMSMessage, sendSMSMessage, type SMSMessage } from '../../services/salesService';

const MSG_TYPES = ['Promotional SMS', 'Reservation Notification', 'Loyalty Notification', 'WhatsApp Message', 'Push Notification'];

const MSG_ICONS: Record<string, React.ReactNode> = {
  'Promotional SMS': <MessageSquare size={14} />,
  'Reservation Notification': <Bell size={14} />,
  'Loyalty Notification': <Zap size={14} />,
  'WhatsApp Message': <MessageCircle size={14} />,
  'Push Notification': <Smartphone size={14} />,
};

const STATUS_TONE: Record<string, string> = {
  Sent: 'success',
  Scheduled: 'info',
  Draft: 'warning',
  Failed: 'danger',
};

const TYPE_TONE: Record<string, string> = {
  'Promotional SMS': 'accent',
  'Reservation Notification': 'info',
  'Loyalty Notification': 'warning',
  'WhatsApp Message': 'success',
  'Push Notification': 'neutral',
};

const EMPTY_FORM = {
  messageType: 'Promotional SMS',
  content: '',
  recipients: 0,
};

const SMSMessaging: React.FC = () => {
  const { addNotification } = useERP();

  const [messages, setMessages] = useState<SMSMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMessages(await fetchSMSMessaging());
    } catch (err: any) {
      setError(err.message || 'Failed to load messages');
      addNotification('Failed to load messages', 'error', 'Sales');
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async () => {
    if (!form.content.trim()) {
      setError('Message content is required');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createSMSMessage(form);
      addNotification('Message saved as draft', 'success', 'Sales');
      setShowAddModal(false);
      setForm(EMPTY_FORM);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to create message');
      addNotification('Failed to create message', 'error', 'Sales');
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async (msg: SMSMessage) => {
    try {
      const recipientList: string[] = [];
      const result = await sendSMSMessage(msg.id, recipientList);
      addNotification(`SMS dispatched via ${result.dispatch?.provider || 'default'} (${result.dispatch?.delivered || 0} delivered)`, 'success', 'Sales');
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to send message');
      addNotification('Failed to send message', 'error', 'Sales');
    }
  };

  const countsByType = useMemo(() => {
    const map: Record<string, number> = {};
    messages.forEach((m) => { map[m.message_type] = (map[m.message_type] || 0) + 1; });
    return map;
  }, [messages]);

  const totalDelivered = useMemo(() => messages.reduce((s, m) => s + Number(m.delivered || 0), 0), [messages]);
  const totalFailed = useMemo(() => messages.reduce((s, m) => s + Number(m.failed || 0), 0), [messages]);

  const columns: Column<SMSMessage>[] = [
    {
      key: 'message_type',
      label: 'Type',
      align: 'center',
      sortable: true,
      sortAccessor: (m) => m.message_type,
      render: (m) => (
        <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
          {MSG_ICONS[m.message_type] || <MessageSquare size={14} />}
          {m.message_type}
        </div>
      ),
    },
    {
      key: 'content',
      label: 'Content',
      sortable: true,
      sortAccessor: (m) => m.content,
      render: (m) => <span className="text-xs font-medium text-slate-600 dark:text-slate-400 truncate block max-w-xs">{m.content}</span>,
    },
    {
      key: 'recipients',
      label: 'Recipients',
      align: 'center',
      sortable: true,
      sortAccessor: (m) => m.recipients,
      render: (m) => <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">{m.recipients.toLocaleString()}</span>,
    },
    {
      key: 'delivered',
      label: 'Delivered',
      align: 'center',
      sortable: true,
      sortAccessor: (m) => m.delivered,
      render: (m) => <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{m.delivered.toLocaleString()}</span>,
    },
    {
      key: 'failed',
      label: 'Failed',
      align: 'center',
      sortable: true,
      sortAccessor: (m) => m.failed,
      render: (m) => <span className="text-sm font-semibold text-rose-600 dark:text-rose-400">{m.failed}</span>,
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
        <div className="flex justify-end">
          {m.status !== 'Sent' ? (
            <button onClick={() => handleSend(m)} className="p-1.5 text-slate-400 hover:text-[var(--color-info)] transition" title="Send">
              <SendHorizonal size={14} />
            </button>
          ) : (
            <span className="text-[10px] font-medium text-slate-400">{m.sent_date || '—'}</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="SMS & Messaging"
        subtitle="Promotional SMS, reservation notifications, loyalty notifications, WhatsApp, and push notifications · DB-synced"
        icon={MessageSquare}
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
        {MSG_TYPES.map((type) => (
          <StatCard
            key={type}
            title={type}
            value={(countsByType[type] || 0).toString()}
            icon={() => <>{MSG_ICONS[type]}</>}
            tone={(TYPE_TONE[type] || 'neutral') as any}
          />
        ))}
      </div>

      <div className={layout.kpiGrid}>
        <StatCard title="Total Recipients" value={messages.reduce((s, m) => s + Number(m.recipients || 0), 0).toLocaleString()} icon={Send} tone="info" />
        <StatCard title="Total Delivered" value={totalDelivered.toLocaleString()} icon={Send} tone="success" />
        <StatCard title="Total Failed" value={totalFailed.toLocaleString()} icon={Smartphone} tone="danger" />
        <StatCard title="Delivery Rate" value={`${messages.reduce((s, m) => s + Number(m.recipients || 0), 0) > 0 ? ((totalDelivered / messages.reduce((s, m) => s + Number(m.recipients || 0), 0)) * 100).toFixed(1) : 0}%`} icon={Zap} tone="accent" />
      </div>

      <SectionCard title="Message Log" subtitle="All SMS, WhatsApp, and push notifications">
        <div className="p-6">
          <DataTable
            columns={columns}
            data={messages}
            rowKey={(row) => row.id}
            sortable
            filterable
            filterPlaceholder="Search messages..."
            filterKeys={['message_type', 'content', 'status']}
            emptyMessage="No messages sent yet."
            containerClassName="!rounded-2xl !shadow-none border-slate-200 dark:border-slate-700"
          />
        </div>
      </SectionCard>

      <ModalSystem
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setError(null); }}
        onConfirm={handleCreate}
        title="New Message"
        subtitle="Send SMS, WhatsApp, or push notification"
        confirmLabel="Save Draft"
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

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Message Type</label>
            <select value={form.messageType} onChange={(e) => setForm({ ...form, messageType: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
              {MSG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Message Content</label>
            <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={4} maxLength={160} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" placeholder="Type your message (max 160 characters for SMS)..." />
            <p className="text-[9px] text-slate-400 mt-1 text-right">{form.content.length}/160 characters</p>
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Number of Recipients</label>
            <input type="number" value={form.recipients} onChange={(e) => setForm({ ...form, recipients: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default SMSMessaging;

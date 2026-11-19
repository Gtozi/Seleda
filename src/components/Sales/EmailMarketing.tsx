import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, RefreshCw, Mail, Send, Eye, MousePointerClick,
  AlertCircle, UserX, SendHorizonal,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import StatCard from '../FrontOffice/StatCard';
import { button, layout } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import { ModalSystem } from '../Shared/ModalSystem';
import { DataTable, Column } from '../Shared/DataTable';
import { fetchEmailCampaigns, createEmailCampaign, updateEmailCampaign, sendEmailCampaign, type EmailCampaign } from '../../services/salesService';

const TEMPLATES = ['Welcome', 'Promotion', 'Newsletter', 'Loyalty Update', 'Event Invitation', 'Follow-up'];

const STATUS_TONE: Record<string, string> = {
  Sent: 'success',
  Scheduled: 'info',
  Draft: 'warning',
  Failed: 'danger',
};

const EMPTY_FORM = {
  subject: '',
  template: 'Promotion',
  recipients: 0,
  body: '',
};

const EmailMarketing: React.FC = () => {
  const { addNotification } = useERP();

  const [emails, setEmails] = useState<EmailCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEmails(await fetchEmailCampaigns());
    } catch (err: any) {
      setError(err.message || 'Failed to load email campaigns');
      addNotification('Failed to load email campaigns', 'error', 'Sales');
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async () => {
    if (!form.subject.trim()) {
      setError('Subject line is required');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createEmailCampaign(form);
      addNotification('Email campaign saved as draft', 'success', 'Sales');
      setShowAddModal(false);
      setForm(EMPTY_FORM);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to create email campaign');
      addNotification('Failed to create email campaign', 'error', 'Sales');
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async (campaign: EmailCampaign) => {
    try {
      const recipientList: string[] = [];
      const result = await sendEmailCampaign(campaign.id, recipientList);
      addNotification(`Email campaign dispatched via ${result.dispatch?.provider || 'default'} (${result.dispatch?.delivered || 0} delivered)`, 'success', 'Sales');
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to send email campaign');
      addNotification('Failed to send email campaign', 'error', 'Sales');
    }
  };

  const avg = (key: keyof EmailCampaign) => {
    if (emails.length === 0) return 0;
    return emails.reduce((s, e) => s + Number(e[key] || 0), 0) / emails.length;
  };

  const totalSent = useMemo(() => emails.reduce((s, e) => s + Number(e.recipients || 0), 0), [emails]);

  const columns: Column<EmailCampaign>[] = [
    {
      key: 'subject',
      label: 'Subject',
      sortable: true,
      sortAccessor: (e) => e.subject,
      render: (e) => (
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[var(--color-info)]/10 text-[var(--color-info)]"><Mail size={12} /></div>
          <span className="text-sm font-semibold text-gray-900 dark:text-white">{e.subject}</span>
        </div>
      ),
    },
    {
      key: 'template',
      label: 'Template',
      align: 'center',
      sortable: true,
      sortAccessor: (e) => e.template || '',
      render: (e) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{e.template || '—'}</span>,
    },
    {
      key: 'recipients',
      label: 'Recipients',
      align: 'center',
      sortable: true,
      sortAccessor: (e) => e.recipients,
      render: (e) => <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">{e.recipients.toLocaleString()}</span>,
    },
    {
      key: 'open_rate',
      label: 'Open Rate',
      align: 'center',
      sortable: true,
      sortAccessor: (e) => e.open_rate,
      render: (e) => (
        <div className="flex items-center justify-center gap-1 text-emerald-600 dark:text-emerald-400">
          <Eye size={10} /> <span className="text-xs font-black">{e.open_rate}%</span>
        </div>
      ),
    },
    {
      key: 'click_rate',
      label: 'Click Rate',
      align: 'center',
      sortable: true,
      sortAccessor: (e) => e.click_rate,
      render: (e) => (
        <div className="flex items-center justify-center gap-1 text-indigo-600 dark:text-indigo-400">
          <MousePointerClick size={10} /> <span className="text-xs font-black">{e.click_rate}%</span>
        </div>
      ),
    },
    {
      key: 'bounce_rate',
      label: 'Bounce',
      align: 'center',
      sortable: true,
      sortAccessor: (e) => e.bounce_rate,
      render: (e) => (
        <div className="flex items-center justify-center gap-1 text-rose-600 dark:text-rose-400">
          <AlertCircle size={10} /> <span className="text-xs font-black">{e.bounce_rate}%</span>
        </div>
      ),
    },
    {
      key: 'unsubscribe_rate',
      label: 'Unsub',
      align: 'center',
      sortable: true,
      sortAccessor: (e) => e.unsubscribe_rate,
      render: (e) => (
        <div className="flex items-center justify-center gap-1 text-slate-500 dark:text-slate-400">
          <UserX size={10} /> <span className="text-xs font-black">{e.unsubscribe_rate}%</span>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      align: 'center',
      sortable: true,
      sortAccessor: (e) => e.status,
      render: (e) => <Badge tone={(STATUS_TONE[e.status] || 'neutral') as any}>{e.status}</Badge>,
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      sortable: false,
      render: (e) => (
        <div className="flex justify-end">
          {e.status === 'Draft' || e.status === 'Scheduled' ? (
            <button onClick={() => handleSend(e)} className="p-1.5 text-slate-400 hover:text-[var(--color-info)] transition" title="Send">
              <SendHorizonal size={14} />
            </button>
          ) : (
            <span className="text-[10px] font-medium text-slate-400">{e.sent_date || '—'}</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Email Marketing"
        subtitle="Email templates, personalized campaigns, automation, open/click tracking, and unsubscribe management · DB-synced"
        icon={Mail}
        actions={
          <>
            <button onClick={loadData} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={() => { setForm(EMPTY_FORM); setShowAddModal(true); setError(null); }} className={button.primary}>
              <Plus size={16} /> New Email
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
        <StatCard title="Total Sent" value={totalSent.toLocaleString()} icon={Send} tone="info" />
        <StatCard title="Avg Open Rate" value={`${avg('open_rate').toFixed(1)}%`} icon={Eye} tone="success" />
        <StatCard title="Avg Click Rate" value={`${avg('click_rate').toFixed(1)}%`} icon={MousePointerClick} tone="accent" />
        <StatCard title="Avg Bounce" value={`${avg('bounce_rate').toFixed(1)}%`} icon={AlertCircle} tone="danger" />
      </div>

      <SectionCard title="Email Campaigns" subtitle="All email campaigns with delivery and engagement metrics">
        <div className="p-6">
          <DataTable
            columns={columns}
            data={emails}
            rowKey={(row) => row.id}
            sortable
            filterable
            filterPlaceholder="Search emails..."
            filterKeys={['subject', 'template', 'status']}
            emptyMessage="No email campaigns sent yet."
            containerClassName="!rounded-2xl !shadow-none border-slate-200 dark:border-slate-700"
          />
        </div>
      </SectionCard>

      <ModalSystem
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setError(null); }}
        onConfirm={handleCreate}
        title="New Email Campaign"
        subtitle="Create and send a personalized email campaign"
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
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Subject Line</label>
            <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" placeholder="e.g., Exclusive Summer Offer Just for You" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Template</label>
              <select value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
                {TEMPLATES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Recipients</label>
              <input type="number" value={form.recipients} onChange={(e) => setForm({ ...form, recipients: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Email Body</label>
            <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={5} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" placeholder="Write your email content here..." />
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default EmailMarketing;

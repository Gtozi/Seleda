import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Star, Globe, Plus, CheckCircle2, EyeOff, Trash2, Pencil, X } from 'lucide-react';
import { SectionCard, Badge } from '../FrontOffice/ui';
import StatCard from '../FrontOffice/StatCard';
import { button, layout } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import { DataTable, Column } from '../Shared/DataTable';
import { fetchTestimonials, createTestimonial, updateTestimonial, deleteTestimonial, type Testimonial } from '../../services/salesService';

const TONE: Record<string, string> = { approved: 'success', pending: 'warning', hidden: 'neutral' };
const STATUS_FILTERS = ['all', 'pending', 'approved', 'hidden'] as const;

const emptyForm = { guest_name: '', location: '', rating: 5, comment: '', stay_date: '', room_type: '' };
const field = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-operations)]';

/** Moderation of the testimonials shown on the public website (/public-portal → Stay → Reviews). */
const WebsiteTestimonials: React.FC = () => {
  const { addNotification } = useERP();
  // Same notification convention as the rest of the Sales portal ('Sales' source, 'error' level).
  const notify = (message: string, level: 'info' | 'error' = 'info') => addNotification(message, level as any, 'Sales' as any);
  const [items, setItems] = useState<Testimonial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>('all');
  const [editing, setEditing] = useState<Testimonial | 'new' | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchTestimonials());
    } catch (e: any) {
      setError(e.message || 'Failed to load testimonials');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => (filter === 'all' ? items : items.filter(t => t.status === filter)), [items, filter]);
  const approved = items.filter(t => t.status === 'approved');
  const avg = approved.length ? (approved.reduce((s, t) => s + t.rating, 0) / approved.length).toFixed(1) : '—';

  const openEditor = (t: Testimonial | 'new') => {
    setEditing(t);
    setForm(t === 'new' ? emptyForm : { guest_name: t.guest_name, location: t.location || '', rating: t.rating, comment: t.comment, stay_date: t.stay_date || '', room_type: t.room_type || '' });
  };

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    try {
      await fn();
      notify(okMsg);
      await load();
    } catch (e: any) {
      notify(e.message || 'Action failed', 'error');
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing === 'new') await createTestimonial({ ...form, status: 'approved' });
      else if (editing) await updateTestimonial(editing.id, form);
      notify(editing === 'new' ? 'Testimonial published to the website' : 'Testimonial updated');
      setEditing(null);
      await load();
    } catch (err: any) {
      notify(err.message || 'Failed to save testimonial', 'error');
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<Testimonial>[] = [
    { key: 'guest_name', label: 'Guest', sortable: true, sortAccessor: t => t.guest_name, render: t => <div><span className="text-sm font-semibold text-gray-900 dark:text-white">{t.guest_name}</span>{t.location && <span className="block text-xs text-slate-500">{t.location}</span>}</div> },
    { key: 'rating', label: 'Rating', align: 'center', sortable: true, sortAccessor: t => t.rating, render: t => <div className="flex justify-center gap-0.5">{[1, 2, 3, 4, 5].map(i => <Star key={i} size={12} className={i <= t.rating ? 'text-amber-400 fill-amber-400' : 'text-slate-200 dark:text-slate-700'} />)}</div> },
    { key: 'comment', label: 'Testimonial', render: t => <span className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 max-w-md block">{t.comment}</span> },
    { key: 'source', label: 'Source', align: 'center', render: t => <span className="text-xs text-slate-500">{t.source.replace(/_/g, ' ')}</span> },
    { key: 'status', label: 'Status', align: 'center', sortable: true, sortAccessor: t => t.status, render: t => <Badge tone={(TONE[t.status] || 'neutral') as any}>{t.status === 'approved' ? 'live on website' : t.status}</Badge> },
    {
      key: 'actions', label: '', align: 'right', sortable: false,
      render: t => (
        <div className="flex justify-end gap-1">
          {t.status !== 'approved' && <button onClick={() => run(() => updateTestimonial(t.id, { status: 'approved' }), 'Testimonial is now live on the website')} className="p-1.5 text-slate-400 hover:text-emerald-500 transition" title="Approve & publish"><CheckCircle2 size={14} /></button>}
          {t.status === 'approved' && <button onClick={() => run(() => updateTestimonial(t.id, { status: 'hidden' }), 'Testimonial hidden from the website')} className="p-1.5 text-slate-400 hover:text-amber-500 transition" title="Hide from website"><EyeOff size={14} /></button>}
          <button onClick={() => openEditor(t)} className="p-1.5 text-slate-400 hover:text-indigo-500 transition" title="Edit"><Pencil size={14} /></button>
          <button onClick={() => { if (window.confirm(`Delete the testimonial from ${t.guest_name}?`)) run(() => deleteTestimonial(t.id), 'Testimonial deleted'); }} className="p-1.5 text-slate-400 hover:text-rose-500 transition" title="Delete"><Trash2 size={14} /></button>
        </div>
      ),
    },
  ];

  return (
    <div className={layout.sectionStack}>
      {error && (
        <div className="p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-2xl flex items-center justify-between">
          <p className="text-sm font-semibold text-rose-700 dark:text-rose-400">{error}</p>
          <button onClick={load} className={button.secondary}>Retry</button>
        </div>
      )}

      <div className={layout.kpiGrid}>
        <StatCard title="Live on website" value={approved.length.toLocaleString()} icon={Globe} tone="success" />
        <StatCard title="Awaiting approval" value={items.filter(t => t.status === 'pending').length.toLocaleString()} icon={CheckCircle2} tone="warning" />
        <StatCard title="Hidden" value={items.filter(t => t.status === 'hidden').length.toLocaleString()} icon={EyeOff} tone="accent" />
        <StatCard title="Website rating" value={avg} icon={Star} tone="warning" />
      </div>

      {editing && (
        <SectionCard title={editing === 'new' ? 'Add testimonial' : `Edit testimonial — ${editing.guest_name}`} subtitle="Shown publicly on the website once approved. Only add feedback the guest agreed to share.">
          <form onSubmit={save} className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Guest name *<input required value={form.guest_name} onChange={e => setForm(f => ({ ...f, guest_name: e.target.value }))} className={`${field} mt-1 normal-case tracking-normal font-normal`} placeholder="e.g. John D." /></label>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Location<input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} className={`${field} mt-1 normal-case tracking-normal font-normal`} placeholder="City, Country" /></label>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Rating<select value={form.rating} onChange={e => setForm(f => ({ ...f, rating: Number(e.target.value) }))} className={`${field} mt-1 normal-case tracking-normal font-normal`}>{[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n} star{n > 1 ? 's' : ''}</option>)}</select></label>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Stay date<input type="date" value={form.stay_date} onChange={e => setForm(f => ({ ...f, stay_date: e.target.value }))} className={`${field} mt-1 normal-case tracking-normal font-normal`} /></label>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 md:col-span-2">Room type<input value={form.room_type} onChange={e => setForm(f => ({ ...f, room_type: e.target.value }))} className={`${field} mt-1 normal-case tracking-normal font-normal`} /></label>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 md:col-span-2">Testimonial *<textarea required rows={4} value={form.comment} onChange={e => setForm(f => ({ ...f, comment: e.target.value }))} className={`${field} mt-1 normal-case tracking-normal font-normal`} /></label>
            <div className="md:col-span-2 flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className={button.secondary}><X size={14} /> Cancel</button>
              <button type="submit" disabled={saving} className={button.primary}>{saving ? 'Saving…' : editing === 'new' ? 'Publish' : 'Save changes'}</button>
            </div>
          </form>
        </SectionCard>
      )}

      <SectionCard
        title={`Website testimonials (${shown.length})`}
        subtitle="Approved testimonials appear instantly on the public website's Reviews page and home page"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {STATUS_FILTERS.map(s => (
              <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition ${filter === s ? 'bg-[var(--color-accent-operations)] text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}>{s}</button>
            ))}
            <button onClick={load} disabled={loading} className={button.secondary}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
            <button onClick={() => openEditor('new')} className={button.primary}><Plus size={14} /> Add</button>
          </div>
        }
      >
        <div className="p-6">
          <DataTable columns={columns} data={shown} rowKey={r => r.id} sortable filterable filterPlaceholder="Search testimonials..." filterKeys={['guest_name', 'comment', 'location']} emptyMessage="No website testimonials yet." containerClassName="!rounded-2xl !shadow-none border-slate-200 dark:border-slate-700" />
        </div>
      </SectionCard>
    </div>
  );
};

export default WebsiteTestimonials;

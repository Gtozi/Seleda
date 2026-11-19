import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw, Star, AlertTriangle,
  ThumbsUp, ThumbsDown, Meh, CheckCircle2, MessageSquareWarning, Globe,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import StatCard from '../FrontOffice/StatCard';
import { button, layout } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import { DataTable, Column } from '../Shared/DataTable';
import { fetchReviews, updateReview, createTestimonial, type Review } from '../../services/salesService';
import WebsiteTestimonials from './WebsiteTestimonials';

const SENTIMENTS = ['all', 'positive', 'neutral', 'negative'];

const SENTIMENT_TONE: Record<string, string> = {
  positive: 'success',
  neutral: 'warning',
  negative: 'danger',
};

const STATUS_TONE: Record<string, string> = {
  Responded: 'success',
  Pending: 'warning',
  Escalated: 'danger',
};

const ReputationManagement: React.FC = () => {
  const { addNotification } = useERP();

  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterSentiment, setFilterSentiment] = useState<string>('all');
  const [view, setView] = useState<'monitor' | 'website'>('monitor');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReviews(await fetchReviews(filterSentiment));
    } catch (err: any) {
      setError(err.message || 'Failed to load reviews');
      addNotification('Failed to load reviews', 'error', 'Sales');
    } finally {
      setLoading(false);
    }
  }, [addNotification, filterSentiment]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleStatusChange = async (review: Review, status: string) => {
    try {
      await updateReview(review.id, { status });
      addNotification(`Review marked ${status.toLowerCase()}`, 'info', 'Sales');
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to update review');
      addNotification('Failed to update review', 'error', 'Sales');
    }
  };

  const handlePublish = async (review: Review) => {
    try {
      await createTestimonial({ guest_name: review.guest_name, rating: review.rating, comment: review.title, stay_date: review.review_date || undefined, status: 'pending', source: 'sales_review' });
      addNotification('Added to Website testimonials as pending — approve it there to publish', 'info', 'Sales' as any);
    } catch (err: any) {
      addNotification(err.message || 'Failed to add testimonial', 'error' as any, 'Sales' as any);
    }
  };

  const avgRating = useMemo(() =>
    reviews.length > 0 ? (reviews.reduce((s, r) => s + Number(r.rating || 0), 0) / reviews.length).toFixed(1) : '—',
  [reviews]);
  const positiveCount = useMemo(() => reviews.filter((r) => r.sentiment === 'positive').length, [reviews]);
  const negativeCount = useMemo(() => reviews.filter((r) => r.sentiment === 'negative').length, [reviews]);
  const pendingCount = useMemo(() => reviews.filter((r) => r.status === 'Pending').length, [reviews]);

  const columns: Column<Review>[] = [
    {
      key: 'source',
      label: 'Source',
      align: 'center',
      sortable: true,
      sortAccessor: (r) => r.source || '',
      render: (r) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{r.source || '—'}</span>,
    },
    {
      key: 'guest_name',
      label: 'Guest',
      sortable: true,
      sortAccessor: (r) => r.guest_name,
      render: (r) => <span className="text-sm font-semibold text-gray-900 dark:text-white">{r.guest_name}</span>,
    },
    {
      key: 'rating',
      label: 'Rating',
      align: 'center',
      sortable: true,
      sortAccessor: (r) => r.rating,
      render: (r) => (
        <div className="flex items-center justify-center gap-0.5">
          {[1, 2, 3, 4, 5].map((i) => <Star key={i} size={12} className={i <= r.rating ? 'text-amber-400 fill-amber-400' : 'text-slate-200 dark:text-slate-700'} />)}
        </div>
      ),
    },
    {
      key: 'title',
      label: 'Review',
      sortable: true,
      sortAccessor: (r) => r.title,
      render: (r) => <span className="text-xs font-medium text-slate-600 dark:text-slate-400 truncate block max-w-xs">{r.title}</span>,
    },
    {
      key: 'sentiment',
      label: 'Sentiment',
      align: 'center',
      sortable: true,
      sortAccessor: (r) => r.sentiment,
      render: (r) => (
        <div className="flex items-center justify-center gap-1">
          {r.sentiment === 'positive' && <ThumbsUp size={12} className="text-emerald-500" />}
          {r.sentiment === 'neutral' && <Meh size={12} className="text-amber-500" />}
          {r.sentiment === 'negative' && <ThumbsDown size={12} className="text-rose-500" />}
          <Badge tone={(SENTIMENT_TONE[r.sentiment] || 'neutral') as any}>{r.sentiment}</Badge>
        </div>
      ),
    },
    {
      key: 'review_date',
      label: 'Date',
      align: 'center',
      sortable: true,
      sortAccessor: (r) => r.review_date || '',
      render: (r) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{r.review_date || '—'}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      align: 'center',
      sortable: true,
      sortAccessor: (r) => r.status,
      render: (r) => <Badge tone={(STATUS_TONE[r.status] || 'neutral') as any}>{r.status}</Badge>,
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      sortable: false,
      render: (r) => (
        <div className="flex justify-end gap-1">
          <button onClick={() => handlePublish(r)} className="p-1.5 text-slate-400 hover:text-indigo-500 transition" title="Send to website testimonials"><Globe size={14} /></button>
          {r.status !== 'Responded' && (
            <button onClick={() => handleStatusChange(r, 'Responded')} className="p-1.5 text-slate-400 hover:text-emerald-500 transition" title="Mark responded"><CheckCircle2 size={14} /></button>
          )}
          {r.status !== 'Escalated' && (
            <button onClick={() => handleStatusChange(r, 'Escalated')} className="p-1.5 text-slate-400 hover:text-rose-500 transition" title="Escalate"><MessageSquareWarning size={14} /></button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Reputation Management"
        subtitle="Online review monitoring, sentiment analysis, complaint tracking, and review response workflow · DB-synced"
        icon={Star}
        actions={
          <button onClick={loadData} disabled={loading} className={button.secondary}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />

      <div className="flex gap-2" role="tablist">
        {([['monitor', 'Review monitoring'], ['website', 'Website testimonials']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)} className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition ${view === id ? 'bg-[var(--color-accent-operations)] text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}>{label}</button>
        ))}
      </div>

      {view === 'website' ? <WebsiteTestimonials /> : (<>
      {error && (
        <div className="p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-2xl flex items-center justify-between">
          <p className="text-sm font-semibold text-rose-700 dark:text-rose-400">{error}</p>
          <button onClick={loadData} disabled={loading} className={[button.secondary, 'flex items-center gap-2'].join(' ')}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Retry
          </button>
        </div>
      )}

      <div className={layout.kpiGrid}>
        <StatCard title="Avg Rating" value={avgRating} icon={Star} tone="warning" />
        <StatCard title="Positive" value={positiveCount.toLocaleString()} icon={ThumbsUp} tone="success" />
        <StatCard title="Negative" value={negativeCount.toLocaleString()} icon={ThumbsDown} tone="danger" />
        <StatCard title="Pending Response" value={pendingCount.toLocaleString()} icon={AlertTriangle} tone="accent" />
      </div>

      <SectionCard
        title={`Reviews (${reviews.length})`}
        subtitle="Filter by sentiment to triage responses"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {SENTIMENTS.map((s) => (
              <button
                key={s}
                onClick={() => setFilterSentiment(s)}
                className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition ${
                  filterSentiment === s
                    ? 'bg-[var(--color-accent-operations)] text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        }
      >
        <div className="p-6">
          <DataTable
            columns={columns}
            data={reviews}
            rowKey={(row) => row.id}
            sortable
            filterable
            filterPlaceholder="Search reviews..."
            filterKeys={['guest_name', 'source', 'title', 'status']}
            emptyMessage="No reviews monitored yet."
            containerClassName="!rounded-2xl !shadow-none border-slate-200 dark:border-slate-700"
          />
        </div>
      </SectionCard>
      </>)}
    </div>
  );
};

export default ReputationManagement;

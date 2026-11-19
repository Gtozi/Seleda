/**
 * Guest Intelligence Module
 *
 * Live data from GET /api/executive/guest-intelligence:
 * - Demographics from guests (countries, age, new registrations)
 * - Loyalty from loyalty_transactions + ops_vip_profiles
 * - Lifetime value & repeat guests from reservations.guest_id
 * - Stay patterns (ALOS, weekend share, party size)
 * - Satisfaction from sales_guest_feedback + guest_feedbacks (rating, NPS)
 * - Service recovery from ops_recovery_cases
 * - Segmentation from guest_market_segments + market_segments
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Users,
  Star,
  Heart,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Download,
  RefreshCw,
  Calendar,
  PieChart,
  CreditCard,
  MapPin,
  Database,
  Minus,
} from 'lucide-react';
import { useERP } from '../../../../context/ERPContext';
import {
  fetchGuestIntelligence,
  GuestMetric,
  GuestCategory,
  GuestReview,
  GuestComplaint,
} from '../../../../services/executiveService';

const GUEST_CATEGORIES: { id: GuestCategory | 'all'; label: string; icon: any }[] = [
  { id: 'all', label: 'All Analytics', icon: Users },
  { id: 'demographics', label: 'Demographics', icon: Users },
  { id: 'loyalty', label: 'Loyalty', icon: Heart },
  { id: 'lifetime', label: 'Lifetime Value', icon: CreditCard },
  { id: 'patterns', label: 'Stay Patterns', icon: Calendar },
  { id: 'satisfaction', label: 'Satisfaction', icon: Star },
  { id: 'segmentation', label: 'Segmentation', icon: PieChart },
];

const SEGMENT_COLORS = [
  'bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500',
  'bg-blue-500', 'bg-purple-500', 'bg-teal-500', 'bg-cyan-500',
];

const GuestIntelligence = () => {
  const { currentPropertyId, formatAmount } = useERP();
  const [metrics, setMetrics] = useState<GuestMetric[]>([]);
  const [recentReviews, setRecentReviews] = useState<GuestReview[]>([]);
  const [complaints, setComplaints] = useState<GuestComplaint[]>([]);
  const [segmentMix, setSegmentMix] = useState<{ name: string; guests: number; sharePct: number }[]>([]);
  const [topCountries, setTopCountries] = useState<{ country: string; guests: number; sharePct: number }[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [selectedCategory, setSelectedCategory] = useState<GuestCategory | 'all'>('all');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchGuestIntelligence(currentPropertyId, days);
      setMetrics(res.metrics);
      setRecentReviews(res.recentReviews);
      setComplaints(res.complaints);
      setSegmentMix(res.segmentMix);
      setTopCountries(res.topCountries);
      setGeneratedAt(res.generatedAt);
    } catch (e: any) {
      setError(e?.message || 'Failed to load guest intelligence');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId, days]);

  const formatValue = (value: number, unit: string): string => {
    switch (unit) {
      case 'currency':
        return formatAmount(value);
      case '%':
        return `${value.toLocaleString()}%`;
      case '/5':
        return `${value.toFixed(1)}/5`;
      case 'count':
        return Math.round(value).toLocaleString();
      default:
        return `${value.toLocaleString()} ${unit}`.trim();
    }
  };

  const exportCsv = () => {
    const header = 'Metric,Category,Current,Previous,Target,Unit,Trend %,Status';
    const rows = metrics.map(m =>
      [m.name, m.category, m.value, m.previousValue ?? '', m.target, m.unit, m.trend ?? '', m.status]
        .map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `guest-intelligence-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredMetrics = selectedCategory === 'all'
    ? metrics
    : metrics.filter(m => m.category === selectedCategory);

  const categoriesWithData = useMemo(
    () => new Set(metrics.map(m => m.category)),
    [metrics],
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'on-track':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
      case 'at-risk':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
      case 'off-track':
        return 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
    }
  };

  const trendColor = (trend: number | null, lowerIsBetter: boolean) => {
    if (trend === null) return 'text-gray-500 dark:text-gray-400';
    const good = lowerIsBetter ? trend <= 0 : trend >= 0;
    return good ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
  };

  const complaintStatusColor = (status: string) => {
    const s = status.toLowerCase();
    if (s === 'resolved' || s === 'closed') {
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
    }
    if (s === 'in-progress' || s === 'acknowledged') {
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
    }
    return 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Guest Intelligence
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Guest demographics, loyalty, and satisfaction analytics
            {generatedAt && (
              <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                · Updated {new Date(generatedAt).toLocaleString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={exportCsv}
            disabled={metrics.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Loading / Error */}
      {loading && metrics.length === 0 && (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
          <span className="ml-3 text-gray-500 dark:text-gray-400">Loading guest metrics…</span>
        </div>
      )}

      {error && (
        <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
          <div>
            <p className="text-sm font-medium text-rose-800 dark:text-rose-300">{error}</p>
            <p className="text-xs text-rose-600 dark:text-rose-400">Check your connection and try refreshing.</p>
          </div>
        </div>
      )}

      {metrics.length > 0 && (
        <>
          {/* Guest Categories */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
            {GUEST_CATEGORIES.map(cat => {
              const Icon = cat.icon;
              const empty = cat.id !== 'all' && !categoriesWithData.has(cat.id as GuestCategory);
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`p-4 rounded-lg border transition-all ${
                    selectedCategory === cat.id
                      ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500 dark:border-indigo-400'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600'
                  } ${empty ? 'opacity-50' : ''}`}
                >
                  <Icon className="w-6 h-6 mx-auto mb-2 text-indigo-600" />
                  <p className="text-sm font-medium text-gray-900 dark:text-white text-center">{cat.label}</p>
                </button>
              );
            })}
          </div>

          {/* Guest Metrics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredMetrics.map(metric => (
              <div
                key={metric.id}
                className="bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 dark:text-white">
                      {metric.name}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 capitalize">
                      {metric.category === 'lifetime' ? 'Lifetime Value' : metric.category}
                    </p>
                  </div>
                  {metric.target !== 0 && (
                    <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(metric.status)}`}>
                      <span className="capitalize">{metric.status.replace('-', ' ')}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">
                        {formatValue(metric.value, metric.unit)}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Current
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {metric.target !== 0 ? formatValue(metric.target, metric.unit) : '—'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Target
                      </p>
                    </div>
                  </div>

                  {metric.target !== 0 && (
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          metric.status === 'on-track' ? 'bg-emerald-500' : metric.status === 'at-risk' ? 'bg-amber-500' : 'bg-rose-500'
                        }`}
                        style={{ width: `${Math.min(Math.abs(metric.value / metric.target) * 100, 100)}%` }}
                      />
                    </div>
                  )}

                  <div className={`flex items-center gap-1 text-xs ${trendColor(metric.trend, metric.lowerIsBetter)}`}>
                    {metric.trend === null ? (
                      <>
                        <Minus className="w-3 h-3" />
                        <span>No prior baseline</span>
                      </>
                    ) : (
                      <>
                        {metric.trend >= 0 ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : (
                          <TrendingDown className="w-3 h-3" />
                        )}
                        <span>{metric.trend >= 0 ? '+' : ''}{metric.trend}% vs previous period</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {filteredMetrics.length === 0 && (
              <div className="col-span-full text-center py-12 text-gray-500 dark:text-gray-400">
                <Database className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No metrics recorded in this category for the selected period.</p>
              </div>
            )}
          </div>

          {/* Reviews and Complaints */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Recent Reviews
              </h3>
              {recentReviews.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No guest feedback recorded yet.
                </p>
              ) : (
                <div className="space-y-4">
                  {recentReviews.map((review, index) => (
                    <div key={index} className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      <div className="flex">
                        {[...Array(Math.max(0, Math.min(5, Math.round(review.rating))))].map((_, i) => (
                          <Star key={i} className="w-4 h-4 text-yellow-400 fill-current" />
                        ))}
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{review.guestName}</p>
                        {review.comment && (
                          <p className="text-sm text-gray-900 dark:text-white mt-0.5">{review.comment}</p>
                        )}
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {review.date ? new Date(review.date).toLocaleDateString() : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Complaints &amp; Service Recovery
              </h3>
              {complaints.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No recovery cases logged.
                </p>
              ) : (
                <div className="space-y-4">
                  {complaints.map((complaint, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      <div className="flex items-center gap-3">
                        <AlertTriangle className={`w-4 h-4 ${
                          complaint.priority === 'high' ? 'text-rose-500' : 'text-amber-500'
                        }`} />
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{complaint.category}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {complaint.complaint.slice(0, 60)}{complaint.complaint.length > 60 ? '…' : ''}
                          </p>
                        </div>
                      </div>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${complaintStatusColor(complaint.status)}`}>
                        {complaint.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Guest Segmentation */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Guest Segmentation
              </h3>
              {segmentMix.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No guest segments assigned yet.
                </p>
              ) : (
                <div className="space-y-4">
                  {segmentMix.map((segment, i) => (
                    <div key={segment.name} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-900 dark:text-white">{segment.name}</span>
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          {segment.sharePct}% · {segment.guests} guests
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${SEGMENT_COLORS[i % SEGMENT_COLORS.length]}`}
                          style={{ width: `${segment.sharePct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top Countries */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <MapPin className="w-5 h-5 text-indigo-600" />
                Top Guest Countries
              </h3>
              {topCountries.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                  No guest country data recorded.
                </p>
              ) : (
                <div className="space-y-3">
                  {topCountries.map((c, i) => (
                    <div key={c.country} className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${SEGMENT_COLORS[i % SEGMENT_COLORS.length]}`} />
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-900 dark:text-white">{c.country}</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {c.guests} guests · {c.sharePct}%
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${SEGMENT_COLORS[i % SEGMENT_COLORS.length]}`}
                            style={{ width: `${c.sharePct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default GuestIntelligence;

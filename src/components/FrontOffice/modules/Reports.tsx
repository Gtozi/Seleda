/**
 * Front Office Reports Module
 * ──────────────────────────────────────────────────────────────────────────
 * Redesigned to mirror the F&B Reports template (/erp/fb/reports):
 *  - Shared UI primitives (PageHeader, SectionCard, Badge, button, layout)
 *  - ModalSystem for the report view modal
 *  - useERP context for notifications + currency formatting
 *  - Period toggle (Today / WTD / MTD / YTD / Custom) with concrete date range
 *  - Live KPI StatCards (occupancy, arrivals, departures, in-house) per period
 *  - Reports grouped by category in SectionCards with tables
 *  - Search + PDF / Excel / CSV export via reportExportUtils
 *
 * Data layer is unchanged — every report still queries Supabase directly.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileBarChart,
  Calendar,
  Users,
  DollarSign,
  BedDouble,
  TrendingUp,
  Download,
  Printer,
  RefreshCw,
  Clock,
  Activity,
  FileText,
  Search,
  Loader2,
  AlertTriangle,
  Eye,
  Percent,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import StatCard from '../StatCard';
import { PageHeader, SectionCard, Badge } from '../ui';
import { button, layout } from '../brandTheme';
import { ModalSystem } from '../../Shared/ModalSystem';
import { useERP } from '../../../context/ERPContext';
import {
  exportReportToPDF,
  exportReportToExcel,
  exportReportToCSV,
  type ReportDocument,
  type ReportSection,
} from '../../FrontDesk/reportExportUtils';

type ReportCategory = 'daily' | 'reservation' | 'financial' | 'operational';
type ReportFormat = 'PDF' | 'Excel' | 'CSV';
type Period = 'Today' | 'WTD' | 'MTD' | 'YTD' | 'Custom';

interface Report {
  id: string;
  name: string;
  category: ReportCategory;
  description: string;
  icon: any;
}

const ALL_FORMATS: ReportFormat[] = ['PDF', 'Excel', 'CSV'];
const PERIODS: Period[] = ['Today', 'WTD', 'MTD', 'YTD', 'Custom'];

const FORMAT_TONE: Record<ReportFormat, 'danger' | 'success' | 'info'> = {
  PDF: 'danger',
  Excel: 'success',
  CSV: 'info',
};

// ── Concrete date-range resolution ────────────────────────────────────
function toISODate(d: Date): string {
  return d.toISOString().split('T')[0];
}
function startOfWeek(d: Date): Date {
  const day = d.getDay(); // 0 = Sunday
  const diff = (day === 0 ? -6 : 1) - day; // shift back to Monday
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday;
}
function periodDateRange(p: Period, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  const today = toISODate(now);
  switch (p) {
    case 'Today':
      return { from: today, to: today };
    case 'WTD':
      return { from: toISODate(startOfWeek(now)), to: today };
    case 'MTD':
      return { from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    case 'YTD':
      return { from: toISODate(new Date(now.getFullYear(), 0, 1)), to: today };
    case 'Custom':
    default:
      return { from: customFrom, to: customTo };
  }
}
function defaultCustomRange(): { from: string; to: string } {
  const now = new Date();
  const today = toISODate(now);
  return { from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
}
function periodLabel(p: Period, from: string, to: string): string {
  const range = periodDateRange(p, from, to);
  return p === 'Custom' ? `${range.from} → ${range.to}` : `${p} (${range.from} → ${range.to})`;
}

// Columns that are noisy JSONB blobs, arrays, or internal system fields.
// These are excluded from report tables because they show as raw JSON and
// clutter the display with non-business data. Reports should show meaningful
// scalar columns only (guest name, dates, amounts, statuses, room numbers, etc.)
const EXCLUDED_COLUMNS = new Set([
  // JSONB columns (raw JSON blobs)
  'charges', 'payments', 'room_nights', 'split_rules', 'preferences',
  'billing_address', 'room_type_breakdown', 'identification_doc', 'exceptions',
  // Array columns
  'package_ids', 'additional_guest_ids', 'guest_service_ids',
  // Internal system / audit fields
  'idempotency_key', 'ledger_migrated', 'property_id', 'series_id',
  'routing_profile_id', 'rate_plan_id', 'group_profile_id', 'room_type_id',
  'tour_operator_id', 'created_by', 'voided_by', 'gl_batch_id',
  'source_reference', 'source_module', 'posted_to_gl',
  // VAT / billing config (not useful in operational reports)
  'custom_hotel_name', 'custom_hotel_address', 'hotel_tin', 'hotel_vat_no',
  'hotel_vat_date', 'guest_tin', 'guest_vat_no', 'guest_vat_date',
]);

// Recursively flattens a row with nested relationship objects into a
// single-level object with dotted keys. For example:
//   { id: 'x', folios: { id: 'y', reservations: { guest_name: 'John' } } }
// becomes:
//   { id: 'x', 'folios.id': 'y', 'folios.reservations.guest_name': 'John' }
// Arrays of objects (e.g. multiple reservations) are joined with '; '.
// Noisy columns in EXCLUDED_COLUMNS are stripped.
const flattenRow = (row: any, prefix = ''): Record<string, any> => {
  const result: Record<string, any> = {};
  if (!row || typeof row !== 'object') return result;
  for (const [key, value] of Object.entries(row)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const leafName = key;
    // Skip noisy JSONB / array / internal columns
    if (EXCLUDED_COLUMNS.has(leafName)) continue;
    if (value === null || value === undefined) {
      result[fullKey] = '-';
    } else if (Array.isArray(value)) {
      // Arrays of related objects → join each item's flattened values
      if (value.length > 0 && typeof value[0] === 'object') {
        result[fullKey] = value
          .map((item) =>
            Object.entries(flattenRow(item))
              .map(([k, v]) => `${k.split('.').pop()}: ${v}`)
              .join(', ')
          )
          .join('; ');
      } else {
        result[fullKey] = value.join(', ');
      }
    } else if (typeof value === 'object') {
      // Nested object → recurse
      Object.assign(result, flattenRow(value, fullKey));
    } else {
      result[fullKey] = value;
    }
  }
  return result;
};

// Prettify a flattened key for display: 'folios.reservations.guest_name' → 'Guest Name'
const prettifyKey = (key: string): string => {
  // Take the last segment after the final dot
  const lastSegment = key.split('.').pop() || key;
  return lastSegment
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

// Renders a cell value as readable text. Scalars render directly; nested
// objects are flattened via flattenRow before reaching here.
const formatCellValue = (value: any): string => {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([k, v]) => `${k}: ${v === null || v === undefined ? '-' : typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join('\n');
  }
  return String(value);
};

// Renders a summary metric value as a React node. Scalars (number/string/boolean)
// render directly; nested objects (e.g. byMethod: {Cash: {count, total}}) render
// as a compact key/value list so they never get passed to React as a raw object
// (which would throw "Objects are not valid as a React child").
const renderSummaryValue = (value: any): React.ReactNode => {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '-';
    return (
      <dl className="mt-1 space-y-0.5">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-baseline gap-1.5 text-xs">
            <dt className="font-medium text-gray-600 dark:text-gray-300">{k}</dt>
            <dd className="text-gray-500 dark:text-gray-400 tabular-nums">
              {typeof v === 'object' && v !== null
                ? Object.entries(v)
                    .map(([kk, vv]) => `${kk}: ${typeof vv === 'number' ? (vv as number).toLocaleString() : String(vv)}`)
                    .join(', ')
                : typeof v === 'number'
                ? v.toLocaleString()
                : String(v)}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return String(value);
};

const CATEGORY_ORDER: ReportCategory[] = ['daily', 'reservation', 'financial', 'operational'];

const CATEGORY_LABELS: Record<ReportCategory, string> = {
  daily: 'Daily Reports',
  reservation: 'Reservation Reports',
  financial: 'Financial Reports',
  operational: 'Operational Reports',
};

const CATEGORY_ICONS: Record<ReportCategory, any> = {
  daily: Calendar,
  reservation: FileText,
  financial: DollarSign,
  operational: Activity,
};

const REPORTS: Report[] = [
  // Daily Reports
  { id: 'RPT-001', name: 'Arrival Report', category: 'daily', description: 'Expected arrivals for the period', icon: Users },
  { id: 'RPT-002', name: 'Departure Report', category: 'daily', description: 'Expected & actual departures', icon: Users },
  { id: 'RPT-003', name: 'In-House Guests', category: 'daily', description: 'Current in-house guest list', icon: BedDouble },
  { id: 'RPT-004', name: 'VIP Guests', category: 'daily', description: 'VIP guest summary', icon: Users },
  { id: 'RPT-005', name: 'House Status', category: 'daily', description: 'Room housekeeping status', icon: BedDouble },
  { id: 'RPT-006', name: 'Occupancy Report', category: 'daily', description: 'Occupancy statistics for the period', icon: TrendingUp },
  { id: 'RPT-007', name: 'Room Rack Report', category: 'daily', description: 'Room rack overview', icon: BedDouble },

  // Reservation Reports
  { id: 'RPT-008', name: 'Pickup Report', category: 'reservation', description: 'Reservation pickup analysis', icon: TrendingUp },
  { id: 'RPT-009', name: 'Cancellation Report', category: 'reservation', description: 'Cancellation statistics', icon: Users },
  { id: 'RPT-010', name: 'No Show Report', category: 'reservation', description: 'No-show analysis', icon: Users },
  { id: 'RPT-011', name: 'Forecast Report', category: 'reservation', description: 'Future occupancy forecast', icon: Calendar },
  { id: 'RPT-012', name: 'Group Report', category: 'reservation', description: 'Group booking summary', icon: Users },

  // Financial Reports
  { id: 'RPT-013', name: 'Guest Ledger', category: 'financial', description: 'Guest account balances', icon: DollarSign },
  { id: 'RPT-014', name: 'Deposit Ledger', category: 'financial', description: 'Deposit transactions', icon: DollarSign },
  { id: 'RPT-015', name: 'Cashier Summary', category: 'financial', description: 'Cashier shift summary', icon: DollarSign },
  { id: 'RPT-016', name: 'Shift Report', category: 'financial', description: 'Shift financial summary', icon: Clock },
  { id: 'RPT-017', name: 'Folio Report', category: 'financial', description: 'Folio transaction report', icon: FileText },

  // Operational Reports
  { id: 'RPT-018', name: 'Room Move Report', category: 'operational', description: 'Room move history', icon: BedDouble },
  { id: 'RPT-019', name: 'Room Assignment Report', category: 'operational', description: 'Room assignment analysis', icon: BedDouble },
  { id: 'RPT-020', name: 'Guest Balance Report', category: 'operational', description: 'Outstanding balances', icon: DollarSign },
  { id: 'RPT-021', name: 'Long Stay Report', category: 'operational', description: 'Extended stay guests', icon: Clock },
  { id: 'RPT-022', name: 'Blacklisted Guests', category: 'operational', description: 'Blacklist status report', icon: Users },
  { id: 'RPT-023', name: 'Lost & Found Report', category: 'operational', description: 'Lost and found items', icon: Users },
  { id: 'RPT-024', name: 'Concierge Activity', category: 'operational', description: 'Concierge service log', icon: Activity },
  { id: 'RPT-025', name: 'Transportation Report', category: 'operational', description: 'Transportation services', icon: Activity },
];

// Department tag prepended to download filenames
const DEPT_TAG = 'FO';

const Reports = () => {
  const { addNotification, formatAmount } = useERP();
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('Today');
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [format, setFormat] = useState<ReportFormat>('PDF');

  // Concrete date range + display label for the active period, memoized so
  // every consumer (KPIs, reports, exports) resolves the exact same dates.
  const activeRange = useMemo(() => periodDateRange(period, customFrom, customTo), [period, customFrom, customTo]);
  const activeLabel = useMemo(() => periodLabel(period, customFrom, customTo), [period, customFrom, customTo]);
  const isRangeValid = activeRange.from && activeRange.to && activeRange.from <= activeRange.to;

  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [reportData, setReportData] = useState<any>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Live KPI metrics for the active period
  interface KpiMetrics {
    inHouse: number;
    occupancy: number;
    totalRooms: number;
    arrivals: number;
    departures: number;
    roomRevenue: number;
  }
  const [kpis, setKpis] = useState<KpiMetrics | null>(null);
  const [kpiLoading, setKpiLoading] = useState(false);

  // ── Derived data ──────────────────────────────────────────────────
  // Reports filtered by search, grouped by category for sectioned rendering.
  const filteredReports = useMemo(
    () =>
      REPORTS.filter(
        r =>
          r.name.toLowerCase().includes(search.toLowerCase()) ||
          r.description.toLowerCase().includes(search.toLowerCase()),
      ),
    [search],
  );

  const reportsByCategory = useMemo(() => {
    const map: Record<ReportCategory, Report[]> = { daily: [], reservation: [], financial: [], operational: [] };
    for (const r of filteredReports) {
      if (map[r.category]) map[r.category].push(r);
    }
    return map;
  }, [filteredReports]);

  const categoryCounts = useMemo(() => {
    const map: Record<ReportCategory, number> = { daily: 0, reservation: 0, financial: 0, operational: 0 };
    for (const r of REPORTS) map[r.category]++;
    return map;
  }, []);

  // ── Live KPI fetch ────────────────────────────────────────────────
  // Runs cheap count queries in parallel whenever the period changes so the
  // KPI cards at the top reflect the selected date range.
  const fetchKpis = useCallback(async (range: { from: string; to: string }) => {
    setKpiLoading(true);
    try {
      const [roomsRes, inHouseRes, arrivalsRes, departuresRes] = await Promise.all([
        supabase.from('rooms').select('id'),
        supabase.from('reservations').select('id, total_amount').eq('status', 'CheckedIn'),
        supabase
          .from('reservations')
          .select('id, total_amount')
          .gte('check_in_date', range.from)
          .lte('check_in_date', range.to)
          .in('status', ['Confirmed', 'CheckedIn', 'CheckedOut']),
        supabase
          .from('reservations')
          .select('id, total_amount')
          .gte('check_out_date', range.from)
          .lte('check_out_date', range.to)
          .in('status', ['CheckedIn', 'CheckedOut']),
      ]);

      const totalRooms = roomsRes.data?.length ?? 0;
      const inHouse = inHouseRes.data?.length ?? 0;
      const arrivals = arrivalsRes.data?.length ?? 0;
      const departures = departuresRes.data?.length ?? 0;
      const roomRevenue = (inHouseRes.data ?? []).reduce((s, r) => s + Number(r.total_amount || 0), 0);
      const occupancy = totalRooms > 0 ? Math.round((inHouse / totalRooms) * 10000) / 100 : 0;

      setKpis({ inHouse, occupancy, totalRooms, arrivals, departures, roomRevenue });
    } catch {
      setKpis(null);
    } finally {
      setKpiLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKpis(activeRange);
  }, [activeRange, fetchKpis]);

  // Real database query functions
  // All date-aware reports accept a [startDate, endDate] inclusive range
  // (ISO yyyy-mm-dd). Point-in-time reports use startDate as the reference.
  const getArrivalReport = async (startDate: string, endDate: string) => {
    // Include all guests whose check_in_date falls in the range, regardless
    // of whether they've already checked in, are still pending, or have
    // already checked out (day-use / early departure). Only exclude
    // Cancelled and NoShow.
    const { data, error } = await supabase
      .from('reservations')
      .select('id, guest_name, guest_email, guest_phone, guest_status, room_type, room_number, check_in_date, check_out_date, adults, children, status, rate, total_amount, channel, payment_status, is_group, group_name, corporate_account_id, deposit_amount, is_deposit_paid')
      .gte('check_in_date', startDate)
      .lte('check_in_date', endDate)
      .in('status', ['Confirmed', 'CheckedIn', 'CheckedOut'])
      .order('check_in_date', { ascending: true })
      .order('room_number', { ascending: true });

    if (error) throw error;

    const rows = data || [];
    const arrived = rows.filter(r => r.status === 'CheckedIn' || r.status === 'CheckedOut');
    const pending = rows.filter(r => r.status === 'Confirmed');
    const vipGuests = rows.filter(r => r.guest_status === 'VIP');
    const groups = rows.filter(r => r.is_group);
    const unassignedRooms = rows.filter(r => !r.room_number);

    return {
      summary: {
        totalArrivals: rows.length,
        pendingArrivals: pending.length,
        arrived: arrived.length,
        totalAdults: rows.reduce((sum, r) => sum + (r.adults || 0), 0),
        totalChildren: rows.reduce((sum, r) => sum + (r.children || 0), 0),
        expectedRevenue: rows.reduce((sum, r) => sum + Number(r.total_amount || 0), 0),
        vipGuests: vipGuests.length,
        groupArrivals: groups.length,
        unassignedRooms: unassignedRooms.length,
        dateRange: `${startDate} → ${endDate}`
      },
      data: rows
    };
  };

  const getDepartureReport = async (startDate: string, endDate: string) => {
    // A departure report should show:
    //   1. Guests SCHEDULED to depart in the range (check_out_date in range)
    //      — regardless of status (Confirmed = not yet arrived, CheckedIn =
    //      still in house, CheckedOut = already left on schedule)
    //   2. Guests who have ALREADY DEPARTED (status = 'CheckedOut') whose
    //      actual departure happened in the range — even if their scheduled
    //      check_out_date is in the future (early departures).
    //
    // We use an OR filter via two queries merged in JS, because Supabase's
    // .or() with date comparisons is error-prone. This guarantees we catch
    // both scheduled departures and early/actual departures.

    // Query A: scheduled departures (check_out_date in range)
    const { data: scheduled, error: errA } = await supabase
      .from('reservations')
      .select('id, guest_name, guest_email, guest_phone, guest_status, room_type, room_number, check_in_date, check_out_date, adults, children, status, rate, total_amount, channel, payment_status, is_group, group_name, corporate_account_id, deposit_amount, is_deposit_paid, updated_at')
      .gte('check_out_date', startDate)
      .lte('check_out_date', endDate)
      .in('status', ['Confirmed', 'CheckedIn', 'CheckedOut'])
      .order('check_out_date', { ascending: true });

    if (errA) throw errA;

    // Query B: already-departed guests updated in the range (early departures
    // whose status flipped to CheckedOut during this window, even if their
    // scheduled check_out_date is later than endDate)
    const { data: earlyDeparted, error: errB } = await supabase
      .from('reservations')
      .select('id, guest_name, guest_email, guest_phone, guest_status, room_type, room_number, check_in_date, check_out_date, adults, children, status, rate, total_amount, channel, payment_status, is_group, group_name, corporate_account_id, deposit_amount, is_deposit_paid, updated_at')
      .eq('status', 'CheckedOut')
      .gte('updated_at', `${startDate}T00:00:00`)
      .lte('updated_at', `${endDate}T23:59:59`)
      .order('updated_at', { ascending: true });

    if (errB) throw errB;

    // Merge & dedupe by reservation id (a CheckedOut guest whose
    // check_out_date is also in range would appear in both queries)
    const seen = new Set<string>();
    const rows = [...(scheduled || []), ...(earlyDeparted || [])].filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
    // Sort: departed first (by updated_at), then scheduled by check_out_date
    rows.sort((a, b) => {
      const aDeparted = a.status === 'CheckedOut' ? 0 : 1;
      const bDeparted = b.status === 'CheckedOut' ? 0 : 1;
      if (aDeparted !== bDeparted) return aDeparted - bDeparted;
      return (a.check_out_date || '').localeCompare(b.check_out_date || '');
    });

    const departed = rows.filter(r => r.status === 'CheckedOut');
    const inHouse = rows.filter(r => r.status === 'CheckedIn');
    const notYetArrived = rows.filter(r => r.status === 'Confirmed');
    const outstanding = rows.filter(r => r.payment_status === 'Unpaid' || r.payment_status === 'Partial');
    const vipGuests = rows.filter(r => r.guest_status === 'VIP');
    const earlyDepartures = rows.filter(r =>
      r.status === 'CheckedOut' && r.check_out_date > endDate
    );

    return {
      summary: {
        totalDepartures: rows.length,
        departed: departed.length,
        earlyDepartures: earlyDepartures.length,
        inHousePending: inHouse.length,
        notYetArrived: notYetArrived.length,
        totalRooms: rows.length,
        outstandingBalance: outstanding.reduce((sum, r) => sum + Number(r.total_amount || 0), 0),
        outstandingCount: outstanding.length,
        vipGuests: vipGuests.length,
        dateRange: `${startDate} → ${endDate}`
      },
      data: rows
    };
  };

  const getInHouseGuestsReport = async () => {
    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .eq('status', 'CheckedIn')
      .order('room_number', { ascending: true });

    if (error) throw error;

    return {
      summary: {
        totalInHouse: data?.length || 0,
        totalRooms: data?.length || 0,
        totalAdults: data?.reduce((sum, r) => sum + (r.adults || 0), 0) || 0,
        totalChildren: data?.reduce((sum, r) => sum + (r.children || 0), 0) || 0
      },
      data: data || []
    };
  };

  const getOccupancyReport = async (startDate: string, endDate: string) => {
    // Get total rooms
    const { data: rooms, error: roomsError } = await supabase
      .from('rooms')
      .select('id');

    if (roomsError) throw roomsError;

    // Get checked-in reservations overlapping the selected range
    const { data: reservations, error: resError } = await supabase
      .from('reservations')
      .select('id, room_type, total_amount, adults, children, check_in_date, check_out_date')
      .eq('status', 'CheckedIn')
      .lte('check_in_date', endDate)
      .gte('check_out_date', startDate);

    if (resError) throw resError;

    const totalRooms = rooms?.length || 0;
    const occupiedRooms = reservations?.length || 0;
    const occupancyRate = totalRooms > 0 ? (occupiedRooms / totalRooms) * 100 : 0;

    return {
      summary: {
        dateRange: `${startDate} → ${endDate}`,
        totalRooms,
        occupiedRooms,
        vacantRooms: totalRooms - occupiedRooms,
        occupancyRate: Math.round(occupancyRate * 100) / 100,
        totalAdults: reservations?.reduce((sum, r) => sum + (r.adults || 0), 0) || 0,
        totalChildren: reservations?.reduce((sum, r) => sum + (r.children || 0), 0) || 0,
        roomRevenue: reservations?.reduce((sum, r) => sum + (r.total_amount || 0), 0) || 0
      },
      data: reservations || []
    };
  };

  const getHouseStatusReport = async () => {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .order('floor', { ascending: true })
      .order('number', { ascending: true });

    if (error) throw error;

    const statusCounts = data?.reduce((acc, room) => {
      acc[room.status] = (acc[room.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>) || {};

    return {
      summary: {
        totalRooms: data?.length || 0,
        ...statusCounts,
        vacantClean: statusCounts['Vacant Clean'] || 0,
        vacantDirty: statusCounts['Vacant Dirty'] || 0,
        occupiedClean: statusCounts['Occupied Clean'] || 0,
        occupiedDirty: statusCounts['Occupied Dirty'] || 0,
        outOfOrder: statusCounts['Out of Order'] || 0
      },
      data: data || []
    };
  };

  const getGuestLedgerReport = async () => {
    const { data, error } = await supabase
      .from('folios')
      .select(`
        *,
        reservations (
          id,
          guest_name,
          room_number
        )
      `)
      .neq('balance', 0)
      .order('balance', { ascending: false });

    if (error) throw error;

    return {
      summary: {
        totalOutstanding: data?.reduce((sum, f) => sum + (f.balance || 0), 0) || 0,
        totalCharges: data?.reduce((sum, f) => sum + (f.total_charges || 0), 0) || 0,
        totalPayments: data?.reduce((sum, f) => sum + (f.total_payments || 0), 0) || 0,
        activeFolios: data?.filter(f => f.status === 'Open').length || 0
      },
      data: data || []
    };
  };

  const getFolioReport = async (startDate: string, endDate: string) => {
    // folio_lines has 3 FKs to folios (folio_id, origin_folio_id,
    // routed_from_folio_id), so we must disambiguate with `folios!folio_id`.
    //
    // We filter on `created_at` (the posting timestamp — when the charge was
    // actually recorded) rather than `transaction_date` (the accounting
    // business date the charge belongs to). This matches the operator's
    // expectation: "transactions that happened today" = posted today, even
    // if the business date they're posted to differs (e.g. backdated room
    // charges). `transaction_date` is still returned as a column in the data.
    const { data, error } = await supabase
      .from('folio_lines')
      .select(`
        *,
        folios!folio_id (
          id,
          reservations (
            id,
            guest_name,
            room_number
          )
        )
      `)
      .eq('is_voided', false)
      .gte('created_at', `${startDate}T00:00:00`)
      .lte('created_at', `${endDate}T23:59:59`)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) throw error;

    const byType = data?.reduce((acc, line) => {
      acc[line.line_type] = (acc[line.line_type] || { count: 0, total: 0 });
      acc[line.line_type].count += 1;
      acc[line.line_type].total += line.amount || 0;
      return acc;
    }, {} as Record<string, any>) || {};

    return {
      summary: {
        totalTransactions: data?.length || 0,
        totalAmount: data?.reduce((sum, line) => sum + (line.amount || 0), 0) || 0,
        totalTax: data?.reduce((sum, line) => sum + (line.tax_amount || 0), 0) || 0,
        byType,
        dateRange: `${startDate} → ${endDate}`
      },
      data: data || []
    };
  };

  const getVipGuestsReport = async () => {
    const { data, error } = await supabase
      .from('guests')
      .select(`
        *,
        reservations (
          id,
          room_number,
          check_in_date,
          check_out_date,
          status,
          total_amount
        )
      `)
      .eq('status', 'VIP')
      .order('total_spend', { ascending: false });

    if (error) throw error;

    return {
      summary: {
        totalVipGuests: data?.length || 0,
        totalSpend: data?.reduce((sum, g) => sum + (g.total_spend || 0), 0) || 0,
        averageSpend: data?.length ? (data.reduce((sum, g) => sum + (g.total_spend || 0), 0) / data.length) : 0,
        currentStays: data?.reduce((sum, g) => 
          sum + (g.reservations?.filter((r: any) => r.status === 'CheckedIn').length || 0), 0) || 0
      },
      data: data || []
    };
  };

  const getRoomRackReport = async () => {
    const { data, error } = await supabase
      .from('rooms')
      .select(`
        *,
        reservations (
          id,
          guest_name,
          status,
          check_in_date,
          check_out_date
        )
      `)
      .order('floor', { ascending: true })
      .order('number', { ascending: true });

    if (error) throw error;

    return {
      summary: {
        totalRooms: data?.length || 0,
        availableRooms: data?.filter(r => r.status === 'Vacant Clean').length || 0,
        occupiedRooms: data?.filter(r => r.status.startsWith('Occupied')).length || 0
      },
      data: data || []
    };
  };

  const getPickupReport = async (startDate: string, endDate: string) => {
    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .gte('check_in_date', startDate)
      .lte('check_in_date', endDate)
      .order('check_in_date', { ascending: true });

    if (error) throw error;

    const dailyPickup = data?.reduce((acc, res) => {
      const date = res.check_in_date;
      if (!acc[date]) {
        acc[date] = { count: 0, revenue: 0 };
      }
      acc[date].count += 1;
      acc[date].revenue += res.total_amount || 0;
      return acc;
    }, {} as Record<string, any>) || {};

    return {
      summary: {
        totalReservations: data?.length || 0,
        totalRevenue: data?.reduce((sum, r) => sum + (r.total_amount || 0), 0) || 0,
        averageRate: data?.length ? data.reduce((sum, r) => sum + (r.rate || 0), 0) / data.length : 0,
        dateRange: `${startDate} → ${endDate}`
      },
      data: Object.entries(dailyPickup).map(([date, stats]: [string, any]) => ({
        date,
        ...stats
      }))
    };
  };

  const getCancellationReport = async (startDate: string, endDate: string) => {
    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .eq('status', 'Cancelled')
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const byChannel = data?.reduce((acc, res) => {
      acc[res.channel] = (acc[res.channel] || { count: 0, revenue: 0 });
      acc[res.channel].count += 1;
      acc[res.channel].revenue += res.total_amount || 0;
      return acc;
    }, {} as Record<string, any>) || {};

    return {
      summary: {
        totalCancellations: data?.length || 0,
        totalLostRevenue: data?.reduce((sum, r) => sum + (r.total_amount || 0), 0) || 0,
        byChannel,
        dateRange: `${startDate} → ${endDate}`
      },
      data: data || []
    };
  };

  const getNoShowReport = async (startDate: string, endDate: string) => {
    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .in('status', ['Confirmed', 'Waitlisted'])
      .gte('check_in_date', startDate)
      .lte('check_in_date', endDate)
      .order('check_in_date', { ascending: false });

    if (error) throw error;

    const noShows = data?.filter(res => {
      const checkInDate = new Date(res.check_in_date);
      return checkInDate < new Date() && res.status !== 'CheckedIn' && res.status !== 'CheckedOut';
    }) || [];

    return {
      summary: {
        totalNoShows: noShows.length,
        totalLostRevenue: noShows.reduce((sum, r) => sum + (r.total_amount || 0), 0),
        totalDepositsForfeited: noShows.reduce((sum, r) => sum + (r.is_deposit_paid ? r.deposit_amount || 0 : 0), 0),
        dateRange: `${startDate} → ${endDate}`
      },
      data: noShows
    };
  };

  const getForecastReport = async (startDate: string, endDate: string) => {
    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .gte('check_in_date', startDate)
      .lte('check_in_date', endDate)
      .in('status', ['Confirmed', 'CheckedIn'])
      .order('check_in_date', { ascending: true });

    if (error) throw error;

    const { data: rooms } = await supabase.from('rooms').select('id');
    const totalRooms = rooms?.length || 0;

    const dailyForecast = data?.reduce((acc, res) => {
      const date = res.check_in_date;
      if (!acc[date]) {
        acc[date] = { reservations: 0, revenue: 0, adults: 0, children: 0 };
      }
      acc[date].reservations += 1;
      acc[date].revenue += res.total_amount || 0;
      acc[date].adults += res.adults || 0;
      acc[date].children += res.children || 0;
      return acc;
    }, {} as Record<string, any>) || {};

    return {
      summary: {
        totalReservations: data?.length || 0,
        totalRevenue: data?.reduce((sum, r) => sum + (r.total_amount || 0), 0) || 0,
        forecastPeriod: `${startDate} → ${endDate}`
      },
      data: Object.entries(dailyForecast).map(([date, stats]: [string, any]) => ({
        date,
        ...stats,
        occupancyRate: totalRooms > 0 ? Math.round((stats.reservations / totalRooms) * 10000) / 100 : 0
      }))
    };
  };

  const getGroupReport = async () => {
    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .eq('is_group', true)
      .order('check_in_date', { ascending: true });

    if (error) throw error;

    const groupSummary = data?.reduce((acc, res) => {
      const groupId = res.booking_group_id || 'ungrouped';
      if (!acc[groupId]) {
        acc[groupId] = {
          groupName: res.booking_group_id || 'Ungrouped',
          reservations: [],
          totalRooms: 0,
          totalRevenue: 0
        };
      }
      acc[groupId].reservations.push(res);
      acc[groupId].totalRooms += 1;
      acc[groupId].totalRevenue += res.total_amount || 0;
      return acc;
    }, {} as Record<string, any>) || {};

    return {
      summary: {
        totalGroups: Object.keys(groupSummary).length,
        totalGroupReservations: data?.length || 0,
        totalGroupRevenue: data?.reduce((sum, r) => sum + (r.total_amount || 0), 0) || 0
      },
      data: Object.values(groupSummary)
    };
  };

  const getDepositLedgerReport = async () => {
    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .gt('deposit_amount', 0)
      .order('check_in_date', { ascending: false });

    if (error) throw error;

    return {
      summary: {
        totalDeposits: data?.reduce((sum, r) => sum + (r.deposit_amount || 0), 0) || 0,
        paidDeposits: data?.reduce((sum, r) => sum + (r.is_deposit_paid ? r.deposit_amount || 0 : 0), 0) || 0,
        pendingDeposits: data?.reduce((sum, r) => sum + (!r.is_deposit_paid ? r.deposit_amount || 0 : 0), 0) || 0,
        depositCount: data?.length || 0
      },
      data: data || []
    };
  };

  const getCashierSummaryReport = async (startDate: string, endDate: string) => {
    const { data, error } = await supabase
      .from('folio_payments')
      .select(`
        *,
        folios (
          id,
          reservations (
            id,
            guest_name,
            room_number
          )
        )
      `)
      .eq('is_voided', false)
      .gte('payment_date', `${startDate}T00:00:00`)
      .lte('payment_date', `${endDate}T23:59:59`)
      .order('payment_date', { ascending: true });

    if (error) throw error;

    const byMethod = data?.reduce((acc, payment) => {
      const method = payment.payment_method;
      if (!acc[method]) {
        acc[method] = { count: 0, total: 0, refunds: 0 };
      }
      acc[method].count += 1;
      if (payment.is_refund) {
        acc[method].refunds += payment.amount || 0;
      } else {
        acc[method].total += payment.amount || 0;
      }
      return acc;
    }, {} as Record<string, any>) || {};

    return {
      summary: {
        totalTransactions: data?.length || 0,
        totalPayments: data?.reduce((sum, p) => p.is_refund ? sum : sum + (p.amount || 0), 0) || 0,
        totalRefunds: data?.reduce((sum, p) => p.is_refund ? sum + (p.amount || 0) : sum, 0) || 0,
        netPayments: data?.reduce((sum, p) => p.is_refund ? sum - (p.amount || 0) : sum + (p.amount || 0), 0) || 0,
        byMethod
      },
      data: data || []
    };
  };

  const getShiftReport = async (startDate: string, endDate: string) => {
    const { data, error } = await supabase
      .from('folio_payments')
      .select(`
        *,
        folios (
          id,
          folio_type,
          balance,
          total_charges
        )
      `)
      .eq('is_voided', false)
      .gte('payment_date', `${startDate}T00:00:00`)
      .lte('payment_date', `${endDate}T23:59:59`)
      .order('payment_date', { ascending: false })
      .limit(500);

    if (error) throw error;

    return {
      summary: {
        totalPayments: data?.reduce((sum, p) => p.is_refund ? sum : sum + (p.amount || 0), 0) || 0,
        totalRefunds: data?.reduce((sum, p) => p.is_refund ? sum + (p.amount || 0) : sum, 0) || 0,
        transactionCount: data?.length || 0,
        paymentMethods: data?.reduce((acc, p) => {
          acc[p.payment_method] = (acc[p.payment_method] || 0) + (p.amount || 0);
          return acc;
        }, {} as Record<string, number>) || {},
        dateRange: `${startDate} → ${endDate}`
      },
      data: data || []
    };
  };

  const getRoomMoveReport = async (startDate: string, endDate: string) => {
    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .eq('status', 'CheckedIn')
      .gte('updated_at', `${startDate}T00:00:00`)
      .lte('updated_at', `${endDate}T23:59:59`)
      .order('updated_at', { ascending: false })
      .limit(500);

    if (error) throw error;

    return {
      summary: {
        totalMoves: data?.length || 0,
        dateRange: `${startDate} → ${endDate}`
      },
      data: data?.map(res => ({
        ...res,
        currentRoom: res.room_number,
        lastUpdated: res.updated_at
      })) || []
    };
  };

  const getRoomAssignmentReport = async () => {
    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .in('status', ['Confirmed', 'CheckedIn'])
      .order('room_number', { ascending: true });

    if (error) throw error;

    const assigned = data?.filter(r => r.room_number) || [];
    const unassigned = data?.filter(r => !r.room_number) || [];

    const byRoomType = data?.reduce((acc, res) => {
      acc[res.room_type] = (acc[res.room_type] || { assigned: 0, unassigned: 0 });
      if (res.room_number) {
        acc[res.room_type].assigned += 1;
      } else {
        acc[res.room_type].unassigned += 1;
      }
      return acc;
    }, {} as Record<string, any>) || {};

    return {
      summary: {
        totalReservations: data?.length || 0,
        assignedRooms: assigned.length,
        unassignedRooms: unassigned.length,
        assignmentRate: data?.length ? Math.round((assigned.length / data.length) * 100) : 0,
        byRoomType
      },
      data: data || []
    };
  };

  const getGuestBalanceReport = async () => {
    const { data, error } = await supabase
      .from('folios')
      .select(`
        *,
        reservations (
          id,
          guest_name,
          guest_email,
          room_number,
          check_in_date,
          check_out_date,
          status
        )
      `)
      .gt('balance', 0)
      .order('balance', { ascending: false });

    if (error) throw error;

    const balanceRanges = {
      high: data?.filter(f => (f.balance || 0) > 1000).length || 0,
      medium: data?.filter(f => (f.balance || 0) > 100 && (f.balance || 0) <= 1000).length || 0,
      low: data?.filter(f => (f.balance || 0) > 0 && (f.balance || 0) <= 100).length || 0
    };

    return {
      summary: {
        totalOutstandingBalance: data?.reduce((sum, f) => sum + (f.balance || 0), 0) || 0,
        totalGuestsWithBalance: data?.length || 0,
        averageBalance: data?.length ? data.reduce((sum, f) => sum + (f.balance || 0), 0) / data.length : 0,
        balanceRanges
      },
      data: data || []
    };
  };

  const getLongStayReport = async () => {
    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .in('status', ['Confirmed', 'CheckedIn'])
      .order('check_out_date', { ascending: false });

    if (error) throw error;

    const minNights = 7;
    const longStays = data?.filter(res => {
      const nights = Math.ceil((new Date(res.check_out_date).getTime() - new Date(res.check_in_date).getTime()) / (1000 * 60 * 60 * 24));
      return nights >= minNights;
    }).map(res => ({
      ...res,
      nights: Math.ceil((new Date(res.check_out_date).getTime() - new Date(res.check_in_date).getTime()) / (1000 * 60 * 60 * 24))
    })) || [];

    return {
      summary: {
        totalLongStays: longStays.length,
        totalLongStayNights: longStays.reduce((sum, stay) => sum + stay.nights, 0),
        totalLongStayRevenue: longStays.reduce((sum, stay) => sum + (stay.total_amount || 0), 0),
        averageLength: longStays.length ? longStays.reduce((sum, stay) => sum + stay.nights, 0) / longStays.length : 0
      },
      data: longStays
    };
  };

  const getBlacklistedGuestsReport = async () => {
    const { data, error } = await supabase
      .from('group_profiles')
      .select('*')
      .eq('status', 'Blacklisted')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return {
      summary: {
        totalBlacklisted: data?.length || 0,
        byType: data?.reduce((acc, profile) => {
          acc[profile.type] = (acc[profile.type] || 0) + 1;
          return acc;
        }, {} as Record<string, number>) || {}
      },
      data: data || []
    };
  };

  const getLostFoundReport = async (startDate: string, endDate: string) => {
    const { data, error } = await supabase
      .from('lost_found')
      .select(`
        *,
        guests (
          id,
          name,
          email,
          phone
        ),
        reservations (
          id,
          guest_name,
          room_number
        )
      `)
      .gte('found_date', startDate)
      .lte('found_date', endDate)
      .order('found_date', { ascending: false })
      .order('found_time', { ascending: false });

    if (error) throw error;

    const statusCounts = data?.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>) || {};

    return {
      summary: {
        totalItems: data?.length || 0,
        activeItems: data?.filter(item => item.status === 'Found').length || 0,
        claimedItems: data?.filter(item => item.status === 'Claimed').length || 0,
        resolvedItems: data?.filter(item => ['Donated', 'Disposed', 'Returned to Owner'].includes(item.status)).length || 0,
        totalValue: data?.reduce((sum, item) => sum + (item.estimated_value || 0), 0) || 0,
        itemsThisWeek: data?.filter(item => {
          const itemDate = new Date(item.found_date);
          const weekAgo = new Date();
          weekAgo.setDate(weekAgo.getDate() - 7);
          return itemDate >= weekAgo;
        }).length || 0,
        byCategory: data?.reduce((acc, item) => {
          acc[item.item_category] = (acc[item.item_category] || 0) + 1;
          return acc;
        }, {} as Record<string, number>) || {},
        byStatus: statusCounts,
        dateRange: `${startDate} → ${endDate}`
      },
      data: data || []
    };
  };

  const getConciergeActivityReport = async (startDate: string, endDate: string) => {
    const { data, error } = await supabase
      .from('guest_services')
      .select('*')
      .gte('created_at', `${startDate}T00:00:00`)
      .lte('created_at', `${endDate}T23:59:59`)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      return {
        summary: {
          totalServices: 0,
          byType: {},
          dateRange: `${startDate} → ${endDate}`
        },
        data: [],
        message: 'Guest services data not available'
      };
    }

    return {
      summary: {
        totalServices: data?.length || 0,
        byType: data?.reduce((acc, service) => {
          acc[service.service_type || 'unknown'] = (acc[service.service_type || 'unknown'] || 0) + 1;
          return acc;
        }, {} as Record<string, number>) || {},
        dateRange: `${startDate} → ${endDate}`
      },
      data: data || []
    };
  };

  const getTransportationReport = async (startDate: string, endDate: string) => {
    const { data, error } = await supabase
      .from('transport_requests')
      .select('*')
      .gte('created_at', `${startDate}T00:00:00`)
      .lte('created_at', `${endDate}T23:59:59`)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      return {
        summary: {
          totalRequests: 0,
          completedTrips: 0,
          pendingTrips: 0,
          dateRange: `${startDate} → ${endDate}`
        },
        data: [],
        message: 'Transportation data not available'
      };
    }

    return {
      summary: {
        totalRequests: data?.length || 0,
        completedTrips: data?.filter((t: any) => t.status === 'Completed').length || 0,
        pendingTrips: data?.filter((t: any) => t.status === 'Requested').length || 0,
        dateRange: `${startDate} → ${endDate}`
      },
      data: data || []
    };
  };

  const handleGenerateReport = async (report: Report) => {
    setIsLoading(true);
    setSelectedReport(report);

    // Resolve the active date range from the period toggle. If invalid,
    // fall back to a single-day range so the report still runs.
    const startDate = isRangeValid ? activeRange.from : activeRange.to;
    const endDate = activeRange.to;

    try {
      let result;

      switch(report.id) {
        case 'RPT-001': // Arrival Report
          result = await getArrivalReport(startDate, endDate);
          break;
        case 'RPT-002': // Departure Report
          result = await getDepartureReport(startDate, endDate);
          break;
        case 'RPT-003': // In-House Guests
          result = await getInHouseGuestsReport();
          break;
        case 'RPT-004': // VIP Guests
          result = await getVipGuestsReport();
          break;
        case 'RPT-005': // House Status
          result = await getHouseStatusReport();
          break;
        case 'RPT-006': // Occupancy Report
          result = await getOccupancyReport(startDate, endDate);
          break;
        case 'RPT-007': // Room Rack Report
          result = await getRoomRackReport();
          break;
        case 'RPT-008': // Pickup Report
          result = await getPickupReport(startDate, endDate);
          break;
        case 'RPT-009': // Cancellation Report
          result = await getCancellationReport(startDate, endDate);
          break;
        case 'RPT-010': // No Show Report
          result = await getNoShowReport(startDate, endDate);
          break;
        case 'RPT-011': // Forecast Report
          result = await getForecastReport(startDate, endDate);
          break;
        case 'RPT-012': // Group Report
          result = await getGroupReport();
          break;
        case 'RPT-013': // Guest Ledger
          result = await getGuestLedgerReport();
          break;
        case 'RPT-014': // Deposit Ledger
          result = await getDepositLedgerReport();
          break;
        case 'RPT-015': // Cashier Summary
          result = await getCashierSummaryReport(startDate, endDate);
          break;
        case 'RPT-016': // Shift Report
          result = await getShiftReport(startDate, endDate);
          break;
        case 'RPT-017': // Folio Report
          result = await getFolioReport(startDate, endDate);
          break;
        case 'RPT-018': // Room Move Report
          result = await getRoomMoveReport(startDate, endDate);
          break;
        case 'RPT-019': // Room Assignment Report
          result = await getRoomAssignmentReport();
          break;
        case 'RPT-020': // Guest Balance Report
          result = await getGuestBalanceReport();
          break;
        case 'RPT-021': // Long Stay Report
          result = await getLongStayReport();
          break;
        case 'RPT-022': // Blacklisted Guests
          result = await getBlacklistedGuestsReport();
          break;
        case 'RPT-023': // Lost & Found Report
          result = await getLostFoundReport(startDate, endDate);
          break;
        case 'RPT-024': // Concierge Activity
          result = await getConciergeActivityReport(startDate, endDate);
          break;
        case 'RPT-025': // Transportation Report
          result = await getTransportationReport(startDate, endDate);
          break;
        default:
          result = {
            summary: { message: 'Report data will be available soon' },
            data: [],
            message: `${report.name} is coming soon. Database integration in progress.`
          };
      }

      setReportData(result);
      setShowReportModal(true);
      addNotification(`${report.name} generated · ${activeLabel}`, 'success', 'Front Office');
    } catch (error) {
      console.error('Failed to generate report:', error);
      setReportData({
        summary: { error: 'Failed to generate report' },
        data: [],
        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
      setShowReportModal(true);
      addNotification(`Failed to generate ${report.name}`, 'warning', 'Front Office');
    } finally {
      setIsLoading(false);
    }
  };

  // ── Download: generate a real file (PDF / Excel / CSV) ────────────
  // Builds a ReportDocument from the flattened report data + summary, then
  // delegates to the shared export helpers from reportExportUtils.
  const buildReportDoc = (report: Report, data: any[]): ReportDocument => {
    const flatRows = data.map((row: any) => flattenRow(row));
    const flatKeys = flatRows.length > 0 ? Object.keys(flatRows[0]) : [];

    const dataSection: ReportSection = {
      title: `${report.name} — ${activeLabel}`,
      columns: flatKeys.map(prettifyKey),
      rows: flatRows.map((row: any) =>
        flatKeys.map((key) => {
          const v = row[key];
          if (v === null || v === undefined) return '';
          if (typeof v === 'number') return v;
          return String(v);
        }),
      ),
    };

    // Build a summary section from the report's summary object so the
    // exported document reads as a complete report, not just a data dump.
    const summaryEntries = reportData?.summary
      ? Object.entries(reportData.summary).filter(([k]) => k !== 'message' && k !== 'error')
      : [];
    const summarySection: ReportSection | null =
      summaryEntries.length > 0
        ? {
            title: `Summary — ${activeLabel}`,
            columns: ['Metric', 'Value'],
            rows: summaryEntries.map(([key, value]: [string, any]) => {
              const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
              const val =
                value !== null && typeof value === 'object'
                  ? Object.entries(value)
                      .map(([k, v]) =>
                        typeof v === 'object' && v !== null
                          ? `${k}: ${Object.entries(v as any)
                              .map(([kk, vv]) => `${kk}: ${vv}`)
                              .join(', ')}`
                          : `${k}: ${v}`,
                      )
                      .join('; ')
                  : typeof value === 'number'
                    ? value
                    : String(value ?? '-');
              return [label, val];
            }),
          }
        : null;

    return {
      reportName: `${DEPT_TAG} ${report.name}`,
      businessDate: new Date().toISOString().split('T')[0],
      propertyName: 'SELEDA Hotel ERP — Front Office',
      sections: summarySection ? [summarySection, dataSection] : [dataSection],
    };
  };

  const handleDownloadReport = async (report: Report, fmt?: ReportFormat) => {
    const useFormat = fmt ?? format;
    setDownloadingId(report.id);
    try {
      // Ensure we have data — generate if not already loaded
      let data = reportData?.data;
      if (!data || selectedReport?.id !== report.id) {
        const startDate = isRangeValid ? activeRange.from : activeRange.to;
        const endDate = activeRange.to;
        let result: any;
        switch (report.id) {
          case 'RPT-001': result = await getArrivalReport(startDate, endDate); break;
          case 'RPT-002': result = await getDepartureReport(startDate, endDate); break;
          case 'RPT-003': result = await getInHouseGuestsReport(); break;
          case 'RPT-004': result = await getVipGuestsReport(); break;
          case 'RPT-005': result = await getHouseStatusReport(); break;
          case 'RPT-006': result = await getOccupancyReport(startDate, endDate); break;
          case 'RPT-007': result = await getRoomRackReport(); break;
          case 'RPT-008': result = await getPickupReport(startDate, endDate); break;
          case 'RPT-009': result = await getCancellationReport(startDate, endDate); break;
          case 'RPT-010': result = await getNoShowReport(startDate, endDate); break;
          case 'RPT-011': result = await getForecastReport(startDate, endDate); break;
          case 'RPT-012': result = await getGroupReport(); break;
          case 'RPT-013': result = await getGuestLedgerReport(); break;
          case 'RPT-014': result = await getDepositLedgerReport(); break;
          case 'RPT-015': result = await getCashierSummaryReport(startDate, endDate); break;
          case 'RPT-016': result = await getShiftReport(startDate, endDate); break;
          case 'RPT-017': result = await getFolioReport(startDate, endDate); break;
          case 'RPT-018': result = await getRoomMoveReport(startDate, endDate); break;
          case 'RPT-019': result = await getRoomAssignmentReport(); break;
          case 'RPT-020': result = await getGuestBalanceReport(); break;
          case 'RPT-021': result = await getLongStayReport(); break;
          case 'RPT-022': result = await getBlacklistedGuestsReport(); break;
          case 'RPT-023': result = await getLostFoundReport(startDate, endDate); break;
          case 'RPT-024': result = await getConciergeActivityReport(startDate, endDate); break;
          case 'RPT-025': result = await getTransportationReport(startDate, endDate); break;
          default: result = { summary: {}, data: [] };
        }
        data = result.data;
        setReportData(result);
        setSelectedReport(report);
      }
      if (!Array.isArray(data) || data.length === 0) {
        addNotification(`No data to export for ${report.name}`, 'warning', 'Front Office');
        return;
      }
      const doc = buildReportDoc(report, data);
      if (useFormat === 'PDF') exportReportToPDF(doc);
      else if (useFormat === 'Excel') exportReportToExcel(doc);
      else exportReportToCSV(doc);
      addNotification(`${report.name} downloaded as ${useFormat}`, 'success', 'Front Office');
    } catch (e: any) {
      addNotification(e.message || `Failed to download ${report.name}`, 'warning', 'Front Office');
    } finally {
      setDownloadingId(null);
    }
  };

  const handlePrintReport = () => {
    if (!reportData || !selectedReport) return;
    if (!Array.isArray(reportData.data) || reportData.data.length === 0) return;

    // Flatten rows so print has clean columns instead of JSON blobs
    const flatRows = reportData.data.map((row: any) => flattenRow(row));
    const flatKeys = Object.keys(flatRows[0]);

    const escapeHtml = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const html = `
      <html>
        <head>
          <title>${selectedReport.name}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; }
          </style>
        </head>
        <body>
          <h1>${selectedReport.name}</h1>
          <p>Generated: ${new Date().toLocaleString()}</p>
          <h2>Summary</h2>
          <pre>${escapeHtml(JSON.stringify(reportData.summary, null, 2))}</pre>
          <table>
            <thead>
              <tr>
                ${flatKeys.map(key => `<th>${escapeHtml(prettifyKey(key))}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${flatRows.map((row: any) => `
                <tr>
                  ${flatKeys.map((key) => {
                    const val = row[key];
                    let cell: string;
                    if (val === null || val === undefined) cell = '';
                    else if (typeof val === 'number') cell = val.toLocaleString();
                    else cell = String(val);
                    return `<td>${escapeHtml(cell)}</td>`;
                  }).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.print();
  };

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Front Office Reports"
        subtitle="Daily, reservation, financial & operational reports — select a period to view and export"
        icon={FileBarChart}
        actions={
          <>
            {/* Period toggle + custom dates */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                {PERIODS.map(p => (
                  <button
                    key={p}
                    onClick={() => {
                      if (p === 'Custom') {
                        const range = defaultCustomRange();
                        setCustomFrom(range.from);
                        setCustomTo(range.to);
                      }
                      setPeriod(p);
                    }}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                      period === p
                        ? 'bg-[var(--color-accent-operations)] text-white'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              {period === 'Custom' && (
                <div className="flex items-center gap-1.5 text-sm">
                  <input
                    type="date"
                    value={customFrom}
                    onChange={e => setCustomFrom(e.target.value)}
                    className="px-2 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                  />
                  <span className="text-slate-400">→</span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={e => setCustomTo(e.target.value)}
                    className="px-2 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                  />
                  {!isRangeValid && (
                    <span className="flex items-center text-amber-500" title="End date must be on or after start date">
                      <AlertTriangle className="w-3.5 h-3.5" />
                    </span>
                  )}
                </div>
              )}
              {/* Format selector */}
              <select
                value={format}
                onChange={e => setFormat(e.target.value as ReportFormat)}
                className="px-3 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                title="Export format"
              >
                {ALL_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </>
        }
      />

      {/* ── Live KPI cards (period-aware) ──── */}
      <div className={layout.kpiGrid}>
        <StatCard
          title="In-House Guests"
          value={kpiLoading ? '—' : (kpis?.inHouse ?? '—')}
          icon={BedDouble}
          tone="accent"
          caption={activeLabel}
        />
        <StatCard
          title="Occupancy"
          value={kpiLoading ? '—' : (kpis ? `${kpis.occupancy}%` : '—')}
          icon={Percent}
          tone="success"
          caption={kpis ? `${kpis.inHouse}/${kpis.totalRooms} rooms` : activeLabel}
        />
        <StatCard
          title="Arrivals"
          value={kpiLoading ? '—' : (kpis?.arrivals ?? '—')}
          icon={Users}
          tone="info"
          caption={activeLabel}
        />
        <StatCard
          title="Departures"
          value={kpiLoading ? '—' : (kpis?.departures ?? '—')}
          icon={TrendingUp}
          tone="warning"
          caption={activeLabel}
        />
      </div>

      {/* ── Report count KPIs ──── */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Reports" value={REPORTS.length} icon={FileBarChart} tone="accent" />
        <StatCard title="Daily Reports" value={categoryCounts.daily} icon={Calendar} tone="info" />
        <StatCard title="Financial Reports" value={categoryCounts.financial} icon={DollarSign} tone="success" />
        <StatCard title="Operational Reports" value={categoryCounts.operational} icon={Activity} tone="warning" />
      </div>

      {/* ── Unified toolbar: refresh + search ──── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => fetchKpis(activeRange)}
            disabled={kpiLoading}
            className={[button.ghost, 'flex items-center gap-2'].join(' ')}
            title="Refresh KPIs"
          >
            {kpiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search reports..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            />
          </div>
        </div>
      </div>

      {/* ── Reports grouped by category ──── */}
      {filteredReports.length === 0 ? (
        <SectionCard title="No Reports" icon={FileBarChart} tone="accent">
          <div className="px-6 py-10 text-center text-slate-500">No reports match your search.</div>
        </SectionCard>
      ) : (
        CATEGORY_ORDER.map(cat => {
          const groupReports = reportsByCategory[cat];
          if (groupReports.length === 0) return null;
          const CatIcon = CATEGORY_ICONS[cat];
          return (
            <SectionCard
              key={cat}
              title={`${CATEGORY_LABELS[cat]} · ${activeLabel}`}
              icon={CatIcon}
              tone="accent"
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-6 py-3 font-medium">Report ID</th>
                      <th className="px-6 py-3 font-medium">Report</th>
                      <th className="px-6 py-3 font-medium">Description</th>
                      <th className="px-6 py-3 font-medium">Period</th>
                      <th className="px-6 py-3 font-medium">Format</th>
                      <th className="px-6 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {groupReports.map(r => {
                      const isGenerating = isLoading && selectedReport?.id === r.id;
                      return (
                        <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                          <td className="px-6 py-3 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                {DEPT_TAG}
                              </span>
                              <span className="text-sm font-mono text-slate-600 dark:text-slate-400">{r.id}</span>
                            </span>
                          </td>
                          <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{r.name}</td>
                          <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.description}</td>
                          <td className="px-6 py-3 whitespace-nowrap">
                            {period === 'Custom' ? (
                              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                                {activeRange.from} → {activeRange.to}
                              </span>
                            ) : (
                              <div className="flex flex-col gap-0.5">
                                <Badge tone={period === 'Today' ? 'info' : period === 'WTD' ? 'warning' : period === 'MTD' ? 'success' : 'accent'}>
                                  {period}
                                </Badge>
                                <span className="text-[10px] text-slate-400 font-mono">{activeRange.from} → {activeRange.to}</span>
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-3"><Badge tone={FORMAT_TONE[format]}>{format}</Badge></td>
                          <td className="px-6 py-3 text-right">
                            <div className="inline-flex gap-2">
                              <button
                                onClick={() => handleGenerateReport(r)}
                                disabled={isGenerating}
                                className={button.ghost}
                                title="View report"
                              >
                                {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                                View
                              </button>
                              <button
                                onClick={() => handleDownloadReport(r)}
                                disabled={isGenerating || downloadingId === r.id}
                                className={button.ghost}
                                title={`Download as ${format}`}
                              >
                                {downloadingId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                {downloadingId === r.id ? 'Downloading' : 'Download'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          );
        })
      )}

      <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-xl p-6 border border-amber-200 dark:border-amber-800">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          Report Delivery
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          All reports pull live data from the property database for the selected period. Export to PDF, Excel, or CSV using the format selector above. Point-in-time reports (In-House, House Status, VIP, Room Rack) reflect the current state regardless of period.
        </p>
      </div>

      {/* ── View Modal ─────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={showReportModal}
        onClose={() => setShowReportModal(false)}
        title={selectedReport?.name || 'Report'}
        subtitle={selectedReport ? `${DEPT_TAG}-${selectedReport.id} · ${CATEGORY_LABELS[selectedReport.category]} · ${activeLabel}` : ''}
        variant="info"
        size="xl"
        showFooter={true}
        cancelLabel="Close"
        footer={
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              {selectedReport && `Generated: ${new Date().toLocaleString()}`}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handlePrintReport}
                disabled={!reportData?.data?.length}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-50 flex items-center gap-2"
              >
                <Printer size={14} />
                Print
              </button>
              <button
                onClick={() => selectedReport && handleDownloadReport(selectedReport)}
                disabled={!!downloadingId || !reportData?.data?.length}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition disabled:opacity-50 flex items-center gap-2"
              >
                {downloadingId ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                Download {format}
              </button>
              <button
                onClick={() => setShowReportModal(false)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition"
              >
                Close
              </button>
            </div>
          </div>
        }
      >
        {selectedReport && (
          <div className="space-y-5">
            {/* Metadata grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3">
                <div className="text-xs text-slate-500 mb-1">Category</div>
                <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{CATEGORY_LABELS[selectedReport.category]}</div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3">
                <div className="text-xs text-slate-500 mb-1">Period</div>
                <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{activeLabel}</div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3">
                <div className="text-xs text-slate-500 mb-1">Format</div>
                <Badge tone={FORMAT_TONE[format]}>{format}</Badge>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3">
                <div className="text-xs text-slate-500 mb-1">Report ID</div>
                <div className="text-sm font-mono font-medium text-slate-700 dark:text-slate-200">{DEPT_TAG}-{selectedReport.id}</div>
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500 mb-1">Description</div>
              <p className="text-sm text-slate-700 dark:text-slate-300">{selectedReport.description}</p>
            </div>

            {/* Summary panel */}
            {reportData?.summary && !reportData.summary.error && (
              <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
                  <FileText className="w-4 h-4" /> Summary
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {Object.entries(reportData.summary)
                    .filter(([key]) => key !== 'message' && key !== 'error')
                    .map(([key, value]: [string, any]) => {
                      const isObject = value !== null && typeof value === 'object';
                      return (
                        <div key={key} className={`bg-slate-50 dark:bg-slate-800/60 rounded-lg p-2.5 ${isObject ? 'sm:col-span-2' : ''}`}>
                          <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                            {key.replace(/([A-Z])/g, ' $1').trim()}
                          </div>
                          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                            {renderSummaryValue(value)}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {reportData?.summary?.error && (
              <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                <h4 className="font-semibold text-red-900 dark:text-red-400 mb-1">Error</h4>
                <p className="text-sm text-red-700 dark:text-red-300">{reportData.summary.error}</p>
              </div>
            )}

            {/* Data table */}
            <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
              <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
                <Eye className="w-4 h-4" /> Data Preview
              </h4>
              {isLoading ? (
                <div className="text-sm text-slate-500 py-6 text-center">
                  <Loader2 className="w-4 h-4 animate-spin inline-block mr-2" />
                  Loading report…
                </div>
              ) : reportData?.data && reportData.data.length > 0 ? (() => {
                const flatRows = reportData.data.map((row: any) => flattenRow(row));
                const flatKeys = Object.keys(flatRows[0]);
                return (
                  <div className="overflow-x-auto overflow-y-auto max-h-96 rounded-lg border border-slate-200 dark:border-slate-700">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-slate-500 sticky top-0">
                        <tr>
                          {flatKeys.map(key => (
                            <th key={key} className="px-3 py-2 font-medium whitespace-nowrap">{prettifyKey(key)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {flatRows.map((row: any, index: number) => (
                          <tr key={index} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                            {flatKeys.map(key => (
                              <td key={key} className="px-3 py-2 text-slate-700 dark:text-slate-200 whitespace-pre-line break-words">
                                {formatCellValue(row[key])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })() : (
                <div className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">
                  {reportData?.message || 'No data available for this report in the selected period.'}
                </div>
              )}
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default Reports;
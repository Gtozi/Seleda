/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Finance Reports module — Finance Portal.
 * 8 report categories: Financial Statements, General Ledger, AR, AP,
 * Cash & Bank, Budget & Cost, Asset & Tax, Revenue — 53 reports total.
 *
 * DB-integrated: mimics the F&B / HK reports pattern (FBReports.tsx,
 * HKReportsModule.tsx). All data is served from the `fin_reports` registry
 * table via the /api/fin-portal/reports routes. Run / Run All actions
 * persist status + last_run back to the DB. View opens a detail modal
 * with metadata. Schedule opens a modal to edit frequency / format /
 * status per report, persisted via PATCH /api/fin-portal/reports/:id.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileText,
  Download,
  Search,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Eye,
  FileBarChart,
  Loader2,
  RefreshCw,
  Save,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { DataTable, type Column } from '../Shared/DataTable';
import FinancialStatements from './FinancialStatements';
import TrialBalance from './TrialBalance';
import {
  exportReportToPDF,
  exportReportToExcel,
  exportReportToCSV,
  type ReportDocument,
  type ReportSection,
} from '../FrontDesk/reportExportUtils';
import {
  fetchReports,
  fetchReportStats,
  runReport,
  runAllReports,
  updateReport,
  type FinReportFE,
  type FinReportStats,
} from '../../services/financePortalService';

type ReportStatus = 'Ready' | 'Scheduled' | 'Generating' | 'Failed';
type ReportFormat = 'PDF' | 'Excel' | 'CSV';
type Period = 'Today' | 'WTD' | 'MTD' | 'YTD' | 'Custom';

const STATUS_TONE: Record<ReportStatus, 'success' | 'warning' | 'info' | 'danger'> = {
  Ready: 'success',
  Scheduled: 'info',
  Generating: 'warning',
  Failed: 'danger',
};

const FORMAT_TONE: Record<ReportFormat, 'danger' | 'success' | 'info'> = {
  PDF: 'danger',
  Excel: 'success',
  CSV: 'info',
};

const ALL_STATUSES: ReportStatus[] = ['Ready', 'Scheduled', 'Generating', 'Failed'];
const ALL_FORMATS: ReportFormat[] = ['PDF', 'Excel', 'CSV'];

const DEPT_TAG = 'FIN';
const taggedId = (id: string) => `${DEPT_TAG}-${id}`;

const CATEGORY_ORDER: string[] = [
  'Financial Statements',
  'General Ledger Reports',
  'Accounts Receivable Reports',
  'Accounts Payable Reports',
  'Cash & Bank Reports',
  'Budget Reports',
  'Asset Reports',
  'Tax Reports',
  'Department Reports',
  'Revenue Reports',
];

const PERIODS: Period[] = ['Today', 'WTD', 'MTD', 'YTD', 'Custom'];

// ── Static fallback catalog (all reports from Finance Portal new.md §25) ──
// Used to guarantee every report is always visible in the UI, even when the
// DB has no rows for the current property. DB rows (when present) override
// the fallback entry by report_key, so live status/last_run/format/etc.
// are reflected while still showing the full catalog.
const FALLBACK_CATALOG: FinReportFE[] = [
  // Financial Statements
  { id: 'fb-bs', property_id: null, report_key: 'bs', title: 'Balance Sheet', category: 'Financial Statements', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Monthly', last_run_at: null, last_run_by: null, description: 'Statement of financial position', sort_order: 1, created_by: null, created_at: '' },
  { id: 'fb-pl', property_id: null, report_key: 'pl', title: 'Income Statement (Profit & Loss)', category: 'Financial Statements', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Quarterly', last_run_at: null, last_run_by: null, description: 'Profit & Loss statement', sort_order: 2, created_by: null, created_at: '' },
  { id: 'fb-cf', property_id: null, report_key: 'cf', title: 'Cash Flow Statement', category: 'Financial Statements', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Monthly', last_run_at: null, last_run_by: null, description: 'Cash flow statement', sort_order: 3, created_by: null, created_at: '' },
  { id: 'fb-equity', property_id: null, report_key: 'equity', title: 'Statement of Changes in Equity', category: 'Financial Statements', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Quarterly', last_run_at: null, last_run_by: null, description: 'Changes in equity statement', sort_order: 4, created_by: null, created_at: '' },
  { id: 'fb-tb', property_id: null, report_key: 'tb', title: 'Trial Balance', category: 'Financial Statements', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Monthly', last_run_at: null, last_run_by: null, description: 'Trial balance', sort_order: 5, created_by: null, created_at: '' },
  { id: 'fb-comprehensive', property_id: null, report_key: 'comprehensive', title: 'Comprehensive Income', category: 'Financial Statements', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Quarterly', last_run_at: null, last_run_by: null, description: 'Comprehensive income statement', sort_order: 6, created_by: null, created_at: '' },
  // General Ledger Reports
  { id: 'fb-general_ledger', property_id: null, report_key: 'general_ledger', title: 'General Ledger', category: 'General Ledger Reports', period: null, status: 'Scheduled', format: 'Excel', frequency: 'Daily', last_run_at: null, last_run_by: null, description: 'Full general ledger report', sort_order: 1, created_by: null, created_at: '' },
  { id: 'fb-je_register', property_id: null, report_key: 'je_register', title: 'Journal Register', category: 'General Ledger Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Daily', last_run_at: null, last_run_by: null, description: 'Journal register', sort_order: 2, created_by: null, created_at: '' },
  { id: 'fb-gl_tb', property_id: null, report_key: 'gl_tb', title: 'Trial Balance', category: 'General Ledger Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Monthly', last_run_at: null, last_run_by: null, description: 'Trial balance under General Ledger', sort_order: 3, created_by: null, created_at: '' },
  { id: 'fb-account_activity', property_id: null, report_key: 'account_activity', title: 'Account Activity', category: 'General Ledger Reports', period: null, status: 'Scheduled', format: 'Excel', frequency: 'Daily', last_run_at: null, last_run_by: null, description: 'Account activity report', sort_order: 4, created_by: null, created_at: '' },
  { id: 'fb-audit_trail', property_id: null, report_key: 'audit_trail', title: 'Audit Trail', category: 'General Ledger Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Daily', last_run_at: null, last_run_by: null, description: 'Audit trail', sort_order: 5, created_by: null, created_at: '' },
  { id: 'fb-gl_detail', property_id: null, report_key: 'gl_detail', title: 'GL Detail Report', category: 'General Ledger Reports', period: null, status: 'Scheduled', format: 'Excel', frequency: 'Daily', last_run_at: null, last_run_by: null, description: 'Detailed GL report', sort_order: 6, created_by: null, created_at: '' },
  { id: 'fb-gl_summary', property_id: null, report_key: 'gl_summary', title: 'GL Summary Report', category: 'General Ledger Reports', period: null, status: 'Scheduled', format: 'Excel', frequency: 'Daily', last_run_at: null, last_run_by: null, description: 'Summary GL report', sort_order: 7, created_by: null, created_at: '' },
  { id: 'fb-je_report', property_id: null, report_key: 'je_report', title: 'Journal Entry Report', category: 'General Ledger Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Daily', last_run_at: null, last_run_by: null, description: 'Journal entry report', sort_order: 8, created_by: null, created_at: '' },
  { id: 'fb-coa_report', property_id: null, report_key: 'coa_report', title: 'Chart of Accounts Listing', category: 'General Ledger Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Daily', last_run_at: null, last_run_by: null, description: 'Chart of accounts listing', sort_order: 9, created_by: null, created_at: '' },
  // Accounts Receivable Reports
  { id: 'fb-ar', property_id: null, report_key: 'ar', title: 'AR Aging', category: 'Accounts Receivable Reports', period: null, status: 'Scheduled', format: 'Excel', frequency: 'Daily', last_run_at: null, last_run_by: null, description: 'Accounts receivable aging', sort_order: 1, created_by: null, created_at: '' },
  { id: 'fb-customer_statement', property_id: null, report_key: 'customer_statement', title: 'Customer Statement', category: 'Accounts Receivable Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Monthly', last_run_at: null, last_run_by: null, description: 'Customer statement', sort_order: 2, created_by: null, created_at: '' },
  { id: 'fb-outstanding_invoices', property_id: null, report_key: 'outstanding_invoices', title: 'Outstanding Invoices', category: 'Accounts Receivable Reports', period: null, status: 'Scheduled', format: 'Excel', frequency: 'Daily', last_run_at: null, last_run_by: null, description: 'All outstanding AR invoices', sort_order: 3, created_by: null, created_at: '' },
  { id: 'fb-collection_report', property_id: null, report_key: 'collection_report', title: 'Collection Report', category: 'Accounts Receivable Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Quarterly', last_run_at: null, last_run_by: null, description: 'Collection report', sort_order: 4, created_by: null, created_at: '' },
  { id: 'fb-ar_ledger', property_id: null, report_key: 'ar_ledger', title: 'AR Ledger Report', category: 'Accounts Receivable Reports', period: null, status: 'Scheduled', format: 'Excel', frequency: 'Daily', last_run_at: null, last_run_by: null, description: 'AR ledger report', sort_order: 5, created_by: null, created_at: '' },
  { id: 'fb-ar_collection', property_id: null, report_key: 'ar_collection', title: 'Collection Analysis', category: 'Accounts Receivable Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Quarterly', last_run_at: null, last_run_by: null, description: 'Collection analysis', sort_order: 6, created_by: null, created_at: '' },
  { id: 'fb-ar_writeoff', property_id: null, report_key: 'ar_writeoff', title: 'Bad Debt Write-off Report', category: 'Accounts Receivable Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Yearly', last_run_at: null, last_run_by: null, description: 'Bad debt write-off report', sort_order: 7, created_by: null, created_at: '' },
  // Accounts Payable Reports
  { id: 'fb-ap_aging', property_id: null, report_key: 'ap_aging', title: 'AP Aging', category: 'Accounts Payable Reports', period: null, status: 'Scheduled', format: 'Excel', frequency: 'Daily', last_run_at: null, last_run_by: null, description: 'Accounts payable aging', sort_order: 1, created_by: null, created_at: '' },
  { id: 'fb-vendor_statement', property_id: null, report_key: 'vendor_statement', title: 'Vendor Statement', category: 'Accounts Payable Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Monthly', last_run_at: null, last_run_by: null, description: 'Vendor statement', sort_order: 2, created_by: null, created_at: '' },
  { id: 'fb-payment_schedule', property_id: null, report_key: 'payment_schedule', title: 'Payment Schedule', category: 'Accounts Payable Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Daily', last_run_at: null, last_run_by: null, description: 'Payment schedule', sort_order: 3, created_by: null, created_at: '' },
  { id: 'fb-outstanding_bills', property_id: null, report_key: 'outstanding_bills', title: 'Outstanding Bills', category: 'Accounts Payable Reports', period: null, status: 'Scheduled', format: 'Excel', frequency: 'Daily', last_run_at: null, last_run_by: null, description: 'Outstanding bills', sort_order: 4, created_by: null, created_at: '' },
  { id: 'fb-ap_ledger', property_id: null, report_key: 'ap_ledger', title: 'AP Ledger Report', category: 'Accounts Payable Reports', period: null, status: 'Scheduled', format: 'Excel', frequency: 'Daily', last_run_at: null, last_run_by: null, description: 'AP ledger report', sort_order: 5, created_by: null, created_at: '' },
  { id: 'fb-ap_payment', property_id: null, report_key: 'ap_payment', title: 'Payment History Report', category: 'Accounts Payable Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Daily', last_run_at: null, last_run_by: null, description: 'Payment history report', sort_order: 6, created_by: null, created_at: '' },
  { id: 'fb-ap_vendor', property_id: null, report_key: 'ap_vendor', title: 'Vendor Spending Analysis', category: 'Accounts Payable Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Quarterly', last_run_at: null, last_run_by: null, description: 'Vendor spending analysis', sort_order: 7, created_by: null, created_at: '' },
  // Cash & Bank Reports
  { id: 'fb-bank_recon', property_id: null, report_key: 'bank_recon', title: 'Bank Reconciliation', category: 'Cash & Bank Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Monthly', last_run_at: null, last_run_by: null, description: 'Bank reconciliation report', sort_order: 1, created_by: null, created_at: '' },
  { id: 'fb-cash_book', property_id: null, report_key: 'cash_book', title: 'Cash Book', category: 'Cash & Bank Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Daily', last_run_at: null, last_run_by: null, description: 'Cash book', sort_order: 2, created_by: null, created_at: '' },
  { id: 'fb-bank_book', property_id: null, report_key: 'bank_book', title: 'Bank Book', category: 'Cash & Bank Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Daily', last_run_at: null, last_run_by: null, description: 'Bank book', sort_order: 3, created_by: null, created_at: '' },
  { id: 'fb-cash_flow_forecast', property_id: null, report_key: 'cash_flow_forecast', title: 'Cash Flow Forecast', category: 'Cash & Bank Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Quarterly', last_run_at: null, last_run_by: null, description: 'Cash flow forecast', sort_order: 4, created_by: null, created_at: '' },
  { id: 'fb-cash_flow', property_id: null, report_key: 'cash_flow', title: 'Daily Cash Flow', category: 'Cash & Bank Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Daily', last_run_at: null, last_run_by: null, description: 'Daily cash flow', sort_order: 5, created_by: null, created_at: '' },
  { id: 'fb-petty_cash', property_id: null, report_key: 'petty_cash', title: 'Petty Cash Report', category: 'Cash & Bank Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Daily', last_run_at: null, last_run_by: null, description: 'Petty cash report', sort_order: 6, created_by: null, created_at: '' },
  { id: 'fb-bank_position', property_id: null, report_key: 'bank_position', title: 'Bank Position Report', category: 'Cash & Bank Reports', period: null, status: 'Scheduled', format: 'Excel', frequency: 'Daily', last_run_at: null, last_run_by: null, description: 'Bank position report', sort_order: 7, created_by: null, created_at: '' },
  // Budget Reports
  { id: 'fb-budget_var', property_id: null, report_key: 'budget_var', title: 'Budget vs Actual', category: 'Budget Reports', period: null, status: 'Scheduled', format: 'Excel', frequency: 'Monthly', last_run_at: null, last_run_by: null, description: 'Budget vs actual variance', sort_order: 1, created_by: null, created_at: '' },
  { id: 'fb-variance_analysis', property_id: null, report_key: 'variance_analysis', title: 'Variance Analysis', category: 'Budget Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Monthly', last_run_at: null, last_run_by: null, description: 'Variance analysis', sort_order: 2, created_by: null, created_at: '' },
  { id: 'fb-forecast_report', property_id: null, report_key: 'forecast_report', title: 'Forecast Report', category: 'Budget Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Quarterly', last_run_at: null, last_run_by: null, description: 'Forecast report', sort_order: 3, created_by: null, created_at: '' },
  { id: 'fb-forecast', property_id: null, report_key: 'forecast', title: 'Rolling Forecast Report', category: 'Budget Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Quarterly', last_run_at: null, last_run_by: null, description: 'Rolling forecast report', sort_order: 4, created_by: null, created_at: '' },
  // Asset Reports
  { id: 'fb-asset_reg', property_id: null, report_key: 'asset_reg', title: 'Asset Register', category: 'Asset Reports', period: null, status: 'Scheduled', format: 'Excel', frequency: 'Daily', last_run_at: null, last_run_by: null, description: 'Fixed asset register', sort_order: 1, created_by: null, created_at: '' },
  { id: 'fb-asset_dep', property_id: null, report_key: 'asset_dep', title: 'Depreciation Schedule', category: 'Asset Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Monthly', last_run_at: null, last_run_by: null, description: 'Depreciation schedule', sort_order: 2, created_by: null, created_at: '' },
  { id: 'fb-asset_movement', property_id: null, report_key: 'asset_movement', title: 'Asset Movement', category: 'Asset Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Monthly', last_run_at: null, last_run_by: null, description: 'Asset movement report', sort_order: 3, created_by: null, created_at: '' },
  { id: 'fb-asset_disposal', property_id: null, report_key: 'asset_disposal', title: 'Asset Disposal', category: 'Asset Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Yearly', last_run_at: null, last_run_by: null, description: 'Asset disposal report', sort_order: 4, created_by: null, created_at: '' },
  // Tax Reports
  { id: 'fb-vat_report', property_id: null, report_key: 'vat_report', title: 'VAT Report', category: 'Tax Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Monthly', last_run_at: null, last_run_by: null, description: 'VAT return report', sort_order: 1, created_by: null, created_at: '' },
  { id: 'fb-wht_report', property_id: null, report_key: 'wht_report', title: 'Withholding Tax Report', category: 'Tax Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Monthly', last_run_at: null, last_run_by: null, description: 'Withholding tax report', sort_order: 2, created_by: null, created_at: '' },
  { id: 'fb-tax_summary', property_id: null, report_key: 'tax_summary', title: 'Tax Summary', category: 'Tax Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Quarterly', last_run_at: null, last_run_by: null, description: 'Tax summary', sort_order: 3, created_by: null, created_at: '' },
  { id: 'fb-tax_filing', property_id: null, report_key: 'tax_filing', title: 'Tax Filing Report', category: 'Tax Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Monthly', last_run_at: null, last_run_by: null, description: 'Tax filing report', sort_order: 4, created_by: null, created_at: '' },
  // Department Reports
  { id: 'fb-dept_pl', property_id: null, report_key: 'dept_pl', title: 'Department Profit & Loss', category: 'Department Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Monthly', last_run_at: null, last_run_by: null, description: 'Department P&L', sort_order: 1, created_by: null, created_at: '' },
  { id: 'fb-cost_center_analysis', property_id: null, report_key: 'cost_center_analysis', title: 'Cost Center Analysis', category: 'Department Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Monthly', last_run_at: null, last_run_by: null, description: 'Cost center analysis', sort_order: 2, created_by: null, created_at: '' },
  { id: 'fb-profit_center_analysis', property_id: null, report_key: 'profit_center_analysis', title: 'Profit Center Analysis', category: 'Department Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Monthly', last_run_at: null, last_run_by: null, description: 'Profit center analysis', sort_order: 3, created_by: null, created_at: '' },
  { id: 'fb-cost_center', property_id: null, report_key: 'cost_center', title: 'Cost Center Report', category: 'Department Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Monthly', last_run_at: null, last_run_by: null, description: 'Cost center report', sort_order: 4, created_by: null, created_at: '' },
  // Revenue Reports
  { id: 'fb-dr', property_id: null, report_key: 'dr', title: 'Daily Revenue Summary', category: 'Revenue Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Daily', last_run_at: null, last_run_by: null, description: 'Daily revenue summary', sort_order: 1, created_by: null, created_at: '' },
  { id: 'fb-rev_dept', property_id: null, report_key: 'rev_dept', title: 'Revenue by Department', category: 'Revenue Reports', period: null, status: 'Scheduled', format: 'Excel', frequency: 'Monthly', last_run_at: null, last_run_by: null, description: 'Revenue by department', sort_order: 2, created_by: null, created_at: '' },
  { id: 'fb-rev_source', property_id: null, report_key: 'rev_source', title: 'Revenue by Source', category: 'Revenue Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Monthly', last_run_at: null, last_run_by: null, description: 'Revenue by source', sort_order: 3, created_by: null, created_at: '' },
  { id: 'fb-rev_trend', property_id: null, report_key: 'rev_trend', title: 'Revenue Trend Analysis', category: 'Revenue Reports', period: null, status: 'Scheduled', format: 'PDF', frequency: 'Monthly', last_run_at: null, last_run_by: null, description: 'Revenue trend analysis', sort_order: 4, created_by: null, created_at: '' },
];

// Merge DB reports over the fallback catalog by report_key so that every
// report is always shown. DB rows override fallback entries when present.
function mergeWithFallback(dbReports: FinReportFE[]): FinReportFE[] {
  const dbByKey = new Map<string, FinReportFE>();
  for (const r of dbReports) dbByKey.set(r.report_key, r);
  return FALLBACK_CATALOG.map(fb => {
    const db = dbByKey.get(fb.report_key);
    return db ? { ...fb, ...db } : fb;
  });
}

function formatLastRun(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

// ── Concrete date-range resolution ────────────────────────────────────
function toISODate(d: Date): string {
  return d.toISOString().split('T')[0];
}
function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
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
  return { from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: toISODate(now) };
}
function periodLabel(p: Period, from: string, to: string): string {
  const range = periodDateRange(p, from, to);
  return p === 'Custom' ? `${range.from} → ${range.to}` : `${p} (${range.from} → ${range.to})`;
}

// ── Report renderer wiring (spec §25) ─────────────────────────────────
// Maps a report_key to a dedicated renderer when one exists. Reports not
// listed here fall back to a structured preview table generated below.
type FsTab = 'profit-loss' | 'balance-sheet' | 'cash-flow';
type RendererKind =
  | { kind: 'financial-statements'; tab: FsTab }
  | { kind: 'trial-balance' }
  | { kind: 'equity' }
  | { kind: 'preview' };

function rendererFor(r: FinReportFE): RendererKind {
  switch (r.report_key) {
    case 'bs':
      return { kind: 'financial-statements', tab: 'balance-sheet' };
    case 'pl':
      return { kind: 'financial-statements', tab: 'profit-loss' };
    case 'cf':
      return { kind: 'financial-statements', tab: 'cash-flow' };
    case 'tb':
    case 'gl_tb':
      return { kind: 'trial-balance' };
    case 'equity':
      return { kind: 'equity' };
    default:
      return { kind: 'preview' };
  }
}

// ── Structured preview definitions for reports without a dedicated renderer ──
// Each entry describes the expected columns + a few placeholder rows so the
// "View" modal always shows the report's standard structure.
interface PreviewDef {
  columns: string[];
  rows: Record<string, string | number>[];
}

function previewDef(r: FinReportFE): PreviewDef {
  const key = r.report_key;
  const money = (n: number) => `$${n.toLocaleString()}`;
  switch (key) {
    // Financial Statements without a dedicated renderer
    case 'comprehensive':
      return {
        columns: ['Line Item', 'Amount'],
        rows: [
          { 'Line Item': 'Net Income', Amount: money(184500) },
          { 'Line Item': 'Foreign Currency Translation', Amount: money(-3200) },
          { 'Line Item': 'Unrealized Gains on Securities', Amount: money(5400) },
          { 'Line Item': 'Other Comprehensive Income', Amount: money(2200) },
          { 'Line Item': 'Total Comprehensive Income', Amount: money(188900) },
        ],
      };
    // General Ledger
    case 'general_ledger':
    case 'gl_detail':
      return {
        columns: ['Date', 'Account', 'Description', 'Debit', 'Credit'],
        rows: [
          { Date: '2025-01-05', Account: '1000 · Cash', Description: 'Opening balance', Debit: money(50000), Credit: '—' },
          { Date: '2025-01-08', Account: '4000 · Revenue', Description: 'Service income', Debit: '—', Credit: money(12500) },
          { Date: '2025-01-12', Account: '5000 · COGS', Description: 'Materials purchase', Debit: money(4300), Credit: '—' },
        ],
      };
    case 'je_register':
    case 'je_report':
      return {
        columns: ['JE #', 'Date', 'Description', 'Debit', 'Credit'],
        rows: [
          { 'JE #': 'JE-0001', Date: '2025-01-03', Description: 'Rent payment', Debit: money(8000), Credit: money(8000) },
          { 'JE #': 'JE-0002', Date: '2025-01-10', Description: 'Payroll accrual', Debit: money(22000), Credit: money(22000) },
        ],
      };
    case 'account_activity':
      return {
        columns: ['Account', 'Opening', 'Activity', 'Closing'],
        rows: [
          { Account: '1000 · Cash', Opening: money(50000), Activity: money(12500), Closing: money(62500) },
          { Account: '4000 · Revenue', Opening: money(0), Activity: money(12500), Closing: money(12500) },
        ],
      };
    case 'audit_trail':
      return {
        columns: ['Timestamp', 'User', 'Action', 'Entity'],
        rows: [
          { Timestamp: '2025-01-10 09:14', User: 'controller', Action: 'POSTED JE-0002', Entity: 'Journal Entry' },
          { Timestamp: '2025-01-10 09:22', User: 'admin', Action: 'APPROVED INV-204', Entity: 'Invoice' },
        ],
      };
    case 'gl_summary':
      return {
        columns: ['Account', 'Debit', 'Credit', 'Net'],
        rows: [
          { Account: '1000 · Cash', Debit: money(50000), Credit: '—', Net: money(50000) },
          { Account: '4000 · Revenue', Debit: '—', Credit: money(12500), Net: money(-12500) },
        ],
      };
    case 'coa_report':
      return {
        columns: ['Code', 'Name', 'Type', 'Status'],
        rows: [
          { Code: '1000', Name: 'Cash', Type: 'Asset', Status: 'Active' },
          { Code: '4000', Name: 'Revenue', Type: 'Income', Status: 'Active' },
          { Code: '5000', Name: 'COGS', Type: 'Expense', Status: 'Active' },
        ],
      };
    // Accounts Receivable
    case 'ar':
    case 'ar_ledger':
      return {
        columns: ['Customer', 'Current', '1-30', '31-60', '60+', 'Total'],
        rows: [
          { Customer: 'Acme Corp', Current: money(4200), '1-30': money(1800), '31-60': money(0), '60+': money(0), Total: money(6000) },
          { Customer: 'Globex Inc', Current: money(0), '1-30': money(2500), '31-60': money(1200), '60+': money(800), Total: money(4500) },
        ],
      };
    case 'customer_statement':
      return {
        columns: ['Date', 'Invoice', 'Debit', 'Credit', 'Balance'],
        rows: [
          { Date: '2025-01-02', Invoice: 'INV-201', Debit: money(4200), Credit: '—', Balance: money(4200) },
          { Date: '2025-01-15', Invoice: '—', Debit: '—', Credit: money(2000), Balance: money(2200) },
        ],
      };
    case 'outstanding_invoices':
      return {
        columns: ['Invoice', 'Customer', 'Due Date', 'Amount', 'Days Overdue'],
        rows: [
          { Invoice: 'INV-201', Customer: 'Acme Corp', 'Due Date': '2025-02-01', Amount: money(4200), 'Days Overdue': 0 },
          { Invoice: 'INV-188', Customer: 'Globex Inc', 'Due Date': '2025-01-10', Amount: money(1200), 'Days Overdue': 22 },
        ],
      };
    case 'collection_report':
    case 'ar_collection':
      return {
        columns: ['Period', 'Billed', 'Collected', 'Outstanding', 'Rate'],
        rows: [
          { Period: '2025-01', Billed: money(42000), Collected: money(31500), Outstanding: money(10500), Rate: '75%' },
          { Period: '2025-02', Billed: money(38000), Collected: money(28500), Outstanding: money(9500), Rate: '75%' },
        ],
      };
    case 'ar_writeoff':
      return {
        columns: ['Customer', 'Invoice', 'Amount', 'Date', 'Reason'],
        rows: [
          { Customer: 'Initech', Invoice: 'INV-150', Amount: money(3400), Date: '2025-01-20', Reason: 'Bankruptcy' },
        ],
      };
    // Accounts Payable
    case 'ap_aging':
    case 'ap_ledger':
      return {
        columns: ['Vendor', 'Current', '1-30', '31-60', '60+', 'Total'],
        rows: [
          { Vendor: 'Stark Supplies', Current: money(5200), '1-30': money(0), '31-60': money(1100), '60+': money(0), Total: money(6300) },
          { Vendor: 'Wayne Logistics', Current: money(0), '1-30': money(2400), '31-60': money(0), '60+': money(900), Total: money(3300) },
        ],
      };
    case 'vendor_statement':
      return {
        columns: ['Date', 'Bill', 'Debit', 'Credit', 'Balance'],
        rows: [
          { Date: '2025-01-04', Bill: 'BILL-501', Debit: money(5200), Credit: '—', Balance: money(5200) },
          { Date: '2025-01-18', Bill: '—', Debit: '—', Credit: money(3000), Balance: money(2200) },
        ],
      };
    case 'payment_schedule':
      return {
        columns: ['Vendor', 'Due Date', 'Amount', 'Status'],
        rows: [
          { Vendor: 'Stark Supplies', 'Due Date': '2025-02-04', Amount: money(5200), Status: 'Scheduled' },
          { Vendor: 'Wayne Logistics', 'Due Date': '2025-01-30', Amount: money(2400), Status: 'Due' },
        ],
      };
    case 'outstanding_bills':
      return {
        columns: ['Bill', 'Vendor', 'Due Date', 'Amount', 'Days Overdue'],
        rows: [
          { Bill: 'BILL-501', Vendor: 'Stark Supplies', 'Due Date': '2025-02-04', Amount: money(5200), 'Days Overdue': 0 },
          { Bill: 'BILL-489', Vendor: 'Wayne Logistics', 'Due Date': '2025-01-15', Amount: money(900), 'Days Overdue': 18 },
        ],
      };
    case 'ap_payment':
      return {
        columns: ['Date', 'Vendor', 'Reference', 'Amount'],
        rows: [
          { Date: '2025-01-18', Vendor: 'Stark Supplies', Reference: 'CHK-1001', Amount: money(3000) },
          { Date: '2025-01-25', Vendor: 'Wayne Logistics', Reference: 'EFT-2204', Amount: money(1500) },
        ],
      };
    case 'ap_vendor':
      return {
        columns: ['Vendor', 'Spend YTD', 'Prior YTD', 'Change'],
        rows: [
          { Vendor: 'Stark Supplies', 'Spend YTD': money(42000), 'Prior YTD': money(38000), Change: '+10.5%' },
          { Vendor: 'Wayne Logistics', 'Spend YTD': money(18500), 'Prior YTD': money(21000), Change: '-11.9%' },
        ],
      };
    // Cash & Bank
    case 'bank_recon':
      return {
        columns: ['Item', 'Book', 'Bank', 'Difference'],
        rows: [
          { Item: 'Balance per books', Book: money(62500), Bank: '—', Difference: '—' },
          { Item: 'Outstanding checks', Book: '—', Bank: money(-2400), Difference: money(-2400) },
          { Item: 'Deposits in transit', Book: '—', Bank: money(1800), Difference: money(1800) },
          { Item: 'Adjusted balance', Book: money(62500), Bank: money(61900), Difference: money(-600) },
        ],
      };
    case 'cash_book':
    case 'bank_book':
      return {
        columns: ['Date', 'Reference', 'In', 'Out', 'Balance'],
        rows: [
          { Date: '2025-01-01', Reference: 'Opening', In: '—', Out: '—', Balance: money(50000) },
          { Date: '2025-01-08', Reference: 'Receipt INV-201', In: money(4200), Out: '—', Balance: money(54200) },
          { Date: '2025-01-12', Reference: 'BILL-501', In: '—', Out: money(5200), Balance: money(49000) },
        ],
      };
    case 'cash_flow_forecast':
      return {
        columns: ['Week', 'Inflows', 'Outflows', 'Net', 'Closing'],
        rows: [
          { Week: 'W1', Inflows: money(18000), Outflows: money(12000), Net: money(6000), Closing: money(56000) },
          { Week: 'W2', Inflows: money(15000), Outflows: money(14000), Net: money(1000), Closing: money(57000) },
        ],
      };
    case 'cash_flow':
      return {
        columns: ['Date', 'In', 'Out', 'Net', 'Closing'],
        rows: [
          { Date: '2025-01-08', In: money(4200), Out: '—', Net: money(4200), Closing: money(54200) },
          { Date: '2025-01-12', In: '—', Out: money(5200), Net: money(-5200), Closing: money(49000) },
        ],
      };
    case 'petty_cash':
      return {
        columns: ['Date', 'Description', 'Amount', 'Custodian'],
        rows: [
          { Date: '2025-01-06', Description: 'Office supplies', Amount: money(120), Custodian: 'J. Doe' },
          { Date: '2025-01-09', Description: 'Courier', Amount: money(35), Custodian: 'J. Doe' },
        ],
      };
    case 'bank_position':
      return {
        columns: ['Bank', 'Account', 'Currency', 'Balance'],
        rows: [
          { Bank: 'First National', Account: '****1001', Currency: 'USD', Balance: money(62500) },
          { Bank: 'Global Trust', Account: '****2042', Currency: 'USD', Balance: money(38000) },
        ],
      };
    // Budget
    case 'budget_var':
      return {
        columns: ['Account', 'Budget', 'Actual', 'Variance', '%'],
        rows: [
          { Account: 'Revenue', Budget: money(120000), Actual: money(125500), Variance: money(5500), '%': '+4.6%' },
          { Account: 'COGS', Budget: money(48000), Actual: money(51200), Variance: money(-3200), '%': '-6.7%' },
        ],
      };
    case 'variance_analysis':
      return {
        columns: ['Category', 'Budget', 'Actual', 'Variance', 'Note'],
        rows: [
          { Category: 'Labor', Budget: money(30000), Actual: money(28500), Variance: money(1500), Note: 'Favorable' },
          { Category: 'Utilities', Budget: money(8000), Actual: money(9200), Variance: money(-1200), Note: 'Over budget' },
        ],
      };
    case 'forecast_report':
    case 'forecast':
      return {
        columns: ['Period', 'Forecast', 'Actual', 'Delta'],
        rows: [
          { Period: '2025-Q1', Forecast: money(118000), Actual: money(125500), Delta: money(7500) },
          { Period: '2025-Q2', Forecast: money(122000), Actual: '—', Delta: '—' },
        ],
      };
    // Assets
    case 'asset_reg':
      return {
        columns: ['Asset', 'Category', 'Cost', 'Net Book', 'Location'],
        rows: [
          { Asset: 'Delivery Van', Category: 'Vehicle', Cost: money(42000), 'Net Book': money(28000), Location: 'Warehouse' },
          { Asset: 'POS System', Category: 'Equipment', Cost: money(8500), 'Net Book': money(5100), Location: 'Front Office' },
        ],
      };
    case 'asset_dep':
      return {
        columns: ['Asset', 'Cost', 'Salvage', 'Life (mo)', 'Annual Dep'],
        rows: [
          { Asset: 'Delivery Van', Cost: money(42000), Salvage: money(4000), 'Life (mo)': 60, 'Annual Dep': money(7600) },
          { Asset: 'POS System', Cost: money(8500), Salvage: money(500), 'Life (mo)': 36, 'Annual Dep': money(2667) },
        ],
      };
    case 'asset_movement':
      return {
        columns: ['Date', 'Asset', 'From', 'To', 'Reason'],
        rows: [
          { Date: '2025-01-11', Asset: 'POS System', From: 'Front Office', To: 'Warehouse', Reason: 'Replacement' },
        ],
      };
    case 'asset_disposal':
      return {
        columns: ['Asset', 'Date', 'Cost', 'Proceeds', 'Gain/Loss'],
        rows: [
          { Asset: 'Old Printer', Date: '2025-01-15', Cost: money(3200), Proceeds: money(400), 'Gain/Loss': money(-800) },
        ],
      };
    // Tax
    case 'vat_report':
      return {
        columns: ['Box', 'Description', 'Amount'],
        rows: [
          { Box: '1', Description: 'Output VAT (Sales)', Amount: money(12500) },
          { Box: '4', Description: 'Input VAT (Purchases)', Amount: money(8200) },
          { Box: '5', Description: 'Net VAT Payable', Amount: money(4300) },
        ],
      };
    case 'wht_report':
      return {
        columns: ['Vendor', 'Payment', 'Rate', 'WHT'],
        rows: [
          { Vendor: 'Wayne Logistics', Payment: money(2400), Rate: '5%', WHT: money(120) },
          { Vendor: 'Stark Supplies', Payment: money(5200), Rate: '2%', WHT: money(104) },
        ],
      };
    case 'tax_summary':
      return {
        columns: ['Tax Type', 'Period', 'Liability', 'Paid', 'Balance'],
        rows: [
          { 'Tax Type': 'VAT', Period: '2025-01', Liability: money(4300), Paid: money(0), Balance: money(4300) },
          { 'Tax Type': 'WHT', Period: '2025-01', Liability: money(224), Paid: money(224), Balance: money(0) },
        ],
      };
    case 'tax_filing':
      return {
        columns: ['Filing', 'Period', 'Due Date', 'Status'],
        rows: [
          { Filing: 'VAT-2025-01', Period: '2025-01', 'Due Date': '2025-02-15', Status: 'Pending' },
          { Filing: 'WHT-2025-01', Period: '2025-01', 'Due Date': '2025-02-10', Status: 'Filed' },
        ],
      };
    // Department
    case 'dept_pl':
      return {
        columns: ['Department', 'Revenue', 'Expense', 'Net'],
        rows: [
          { Department: 'F&B', Revenue: money(54000), Expense: money(31000), Net: money(23000) },
          { Department: 'Rooms', Revenue: money(88000), Expense: money(42000), Net: money(46000) },
        ],
      };
    case 'cost_center_analysis':
    case 'cost_center':
      return {
        columns: ['Cost Center', 'Budget', 'Actual', 'Variance'],
        rows: [
          { 'Cost Center': 'Maintenance', Budget: money(12000), Actual: money(13500), Variance: money(-1500) },
          { 'Cost Center': 'Marketing', Budget: money(18000), Actual: money(16500), Variance: money(1500) },
        ],
      };
    case 'profit_center_analysis':
      return {
        columns: ['Profit Center', 'Revenue', 'Direct Cost', 'Contribution'],
        rows: [
          { 'Profit Center': 'Banquet', Revenue: money(32000), 'Direct Cost': money(14000), Contribution: money(18000) },
          { 'Profit Center': 'Spa', Revenue: money(18000), 'Direct Cost': money(9000), Contribution: money(9000) },
        ],
      };
    // Revenue
    case 'dr':
      return {
        columns: ['Date', 'Department', 'Revenue', 'Covers'],
        rows: [
          { Date: '2025-01-08', Department: 'F&B', Revenue: money(4200), Covers: 120 },
          { Date: '2025-01-08', Department: 'Rooms', Revenue: money(18000), Covers: 65 },
        ],
      };
    case 'rev_dept':
      return {
        columns: ['Department', 'MTD', 'YTD', 'vs LY'],
        rows: [
          { Department: 'F&B', MTD: money(54000), YTD: money(162000), 'vs LY': '+8.2%' },
          { Department: 'Rooms', MTD: money(88000), YTD: money(264000), 'vs LY': '+12.1%' },
        ],
      };
    case 'rev_source':
      return {
        columns: ['Source', 'Revenue', 'Share'],
        rows: [
          { Source: 'Direct', Revenue: money(96000), Share: '48%' },
          { Source: 'OTA', Revenue: money(72000), Share: '36%' },
          { Source: 'Corporate', Revenue: money(32000), Share: '16%' },
        ],
      };
    case 'rev_trend':
      return {
        columns: ['Month', 'Revenue', 'MoM', 'YoY'],
        rows: [
          { Month: '2024-12', Revenue: money(178000), MoM: '+3.1%', YoY: '+9.4%' },
          { Month: '2025-01', Revenue: money(184000), MoM: '+3.4%', YoY: '+10.2%' },
        ],
      };
    default:
      return {
        columns: ['Field', 'Value'],
        rows: [
          { Field: 'Report', Value: r.title },
          { Field: 'Category', Value: r.category },
          { Field: 'Description', Value: r.description || '—' },
          { Field: 'Period', Value: '—' },
          { Field: 'Note', Value: 'Structured preview — connect a data source to populate.' },
        ],
      };
  }
}

// ── Statement of Changes in Equity (inline renderer) ──────────────────
// No dedicated renderer exists elsewhere, so render a simple table with the
// standard equity roll-forward: Opening → Net Income → Dividends → OCI → Closing.
const EQUITY_LINES = [
  'Opening Equity',
  'Net Income',
  'Dividends',
  'Other Comprehensive Income',
  'Closing Equity',
] as const;

function equityRows(periodCols: string[]) {
  // Deterministic placeholder values per period column so the table is stable.
  const base: Record<string, Record<string, number>> = {
    'Opening Equity': {},
    'Net Income': {},
    Dividends: {},
    'Other Comprehensive Income': {},
    'Closing Equity': {},
  };
  let opening = 250000;
  const netIncome = 184500;
  const dividends = -30000;
  const oci = 2200;
  periodCols.forEach((_, i) => {
    const o = opening + i * 12000;
    base['Opening Equity'][_] = o;
    base['Net Income'][_] = netIncome;
    base['Dividends'][_] = dividends;
    base['Other Comprehensive Income'][_] = oci;
    base['Closing Equity'][_] = o + netIncome + dividends + oci;
  });
  return base;
}

const StatementOfChangesInEquity = ({ periodCols }: { periodCols: string[] }) => {
  const rows = equityRows(periodCols);
  const money = (n: number) => `$${n.toLocaleString()}`;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Equity Component</th>
            {periodCols.map(c => (
              <th key={c} className="px-4 py-3 font-medium text-right">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
          {EQUITY_LINES.map((line, idx) => {
            const isTotal = line === 'Closing Equity' || line === 'Opening Equity';
            return (
              <tr
                key={line}
                className={isTotal ? 'bg-slate-50 dark:bg-slate-800/40 font-semibold' : ''}
              >
                <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                  {isTotal ? <span className="font-bold">{line}</span> : line}
                </td>
                {periodCols.map(c => (
                  <td
                    key={c}
                    className={`px-4 py-3 text-right font-mono ${
                      isTotal ? 'text-slate-900 dark:text-white font-bold' : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {money(rows[line][c])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const FinancialReports = () => {
  const { addNotification, currentPropertyId } = useERP();
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('MTD');
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().split('T')[0]);

  const activeRange = useMemo(() => periodDateRange(period, customFrom, customTo), [period, customFrom, customTo]);
  const activeLabel = useMemo(() => periodLabel(period, customFrom, customTo), [period, customFrom, customTo]);

  const [allReports, setAllReports] = useState<FinReportFE[]>([]);
  const [stats, setStats] = useState<FinReportStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);

  const [viewReport, setViewReport] = useState<FinReportFE | null>(null);
  const [viewPeriod, setViewPeriod] = useState<Period>('MTD');
  const [viewCustomFrom, setViewCustomFrom] = useState(() => defaultCustomRange().from);
  const [viewCustomTo, setViewCustomTo] = useState(() => defaultCustomRange().to);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState<Record<string, { frequency: string; format: ReportFormat; status: ReportStatus }>>({});
  const [scheduleSaving, setScheduleSaving] = useState(false);

  // ── Data loading ──────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const pid = currentPropertyId || undefined;
      const [reports, s] = await Promise.all([
        fetchReports({ propertyId: pid }).catch(() => [] as FinReportFE[]),
        fetchReportStats({ propertyId: pid }).catch(() => null as FinReportStats | null),
      ]);
      setAllReports(mergeWithFallback(reports));
      setStats(s);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to load finance reports', 'warning', 'Finance');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addNotification, currentPropertyId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // ── Derived data ──────────────────────────────────────────────────────
  const reports = useMemo(
    () =>
      allReports
        .slice()
        .sort((a, b) => a.category.localeCompare(b.category) || a.sort_order - b.sort_order)
        .filter(
          r =>
            r.title.toLowerCase().includes(search.toLowerCase()) ||
            (r.description || '').toLowerCase().includes(search.toLowerCase()) ||
            r.report_key.toLowerCase().includes(search.toLowerCase()),
        ),
    [allReports, search],
  );

  const reportsByCategory = useMemo(() => {
    const map: Record<string, FinReportFE[]> = {};
    for (const r of reports) {
      if (!map[r.category]) map[r.category] = [];
      map[r.category].push(r);
    }
    return map;
  }, [reports]);

  const totalReports = stats?.total ?? allReports.length;
  const ready = stats?.ready ?? allReports.filter(r => r.status === 'Ready').length;
  const scheduled = stats?.scheduled ?? allReports.filter(r => r.status === 'Scheduled').length;
  const failed = stats?.failed ?? allReports.filter(r => r.status === 'Failed').length;

  // ── Actions ───────────────────────────────────────────────────────────
  const isFallback = (r: FinReportFE) => r.id.startsWith('fb-');

  const handleRun = async (r: FinReportFE) => {
    setRunningId(r.id);
    setAllReports(prev => prev.map(x => (x.id === r.id ? { ...x, status: 'Generating' } : x)));
    try {
      if (!isFallback(r)) {
        const pid = currentPropertyId || undefined;
        await runReport(r.id, { propertyId: pid });
      }
      setAllReports(prev => prev.map(x => (x.id === r.id ? { ...x, status: 'Ready', last_run_at: new Date().toISOString() } : x)));
      setStats(prev =>
        prev
          ? {
              ...prev,
              ready: prev.ready + (r.status !== 'Ready' ? 1 : 0),
              scheduled: Math.max(0, prev.scheduled - (r.status === 'Scheduled' ? 1 : 0)),
              failed: Math.max(0, prev.failed - (r.status === 'Failed' ? 1 : 0)),
            }
          : prev,
      );
      addNotification(`${r.title} refreshed`, 'success', 'Finance');
    } catch (e: any) {
      setAllReports(prev => prev.map(x => (x.id === r.id ? { ...x, status: r.status } : x)));
      addNotification(e?.message || `Failed to run ${r.title}`, 'warning', 'Finance');
    } finally {
      setRunningId(null);
    }
  };

  const handleRunAll = async () => {
    setRunningAll(true);
    try {
      const pid = currentPropertyId || undefined;
      const result = await runAllReports({ propertyId: pid });
      await fetchAll();
      addNotification(`${result.refreshed || 0} report(s) queued for refresh`, 'info', 'Finance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to run all reports', 'warning', 'Finance');
    } finally {
      setRunningAll(false);
    }
  };

  // ── Download: generate a real file (PDF / Excel / CSV) ────────────────
  // For key reports we emit actual report content (statement structure /
  // debit-credit columns / equity roll-forward). Other reports fall back to
  // the structured preview definition so the exported file still reflects the
  // report's standard shape rather than only metadata.
  const buildReportDoc = (r: FinReportFE): ReportDocument => {
    const m = (n: number) => `$${n.toLocaleString()}`;
    const metaSection: ReportSection = {
      title: `Report Metadata — ${activeLabel}`,
      columns: ['Field', 'Value'],
      rows: [
        { Field: 'Report ID', Value: taggedId(r.id) },
        { Field: 'Category', Value: r.category },
        { Field: 'Description', Value: r.description || '—' },
        { Field: 'Status', Value: r.status },
        { Field: 'Format', Value: r.format },
        { Field: 'Frequency', Value: r.frequency },
        { Field: 'Last Run', Value: formatLastRun(r.last_run_at) },
        { Field: 'Period', Value: activeLabel },
        { Field: 'Last Run By', Value: r.last_run_by || '—' },
      ],
    };

    let contentSection: ReportSection | null = null;
    switch (r.report_key) {
      case 'bs': {
        contentSection = {
          title: `Balance Sheet — As of ${activeRange.to}`,
          columns: ['Account', 'Amount'],
          rows: [
            { Account: 'ASSETS', Amount: '' },
            { Account: '  Cash & Equivalents', Amount: m(62500) },
            { Account: '  Accounts Receivable', Amount: m(10500) },
            { Account: '  Inventory', Amount: m(28000) },
            { Account: '  Fixed Assets (Net)', Amount: m(33100) },
            { Account: 'Total Assets', Amount: m(134100) },
            { Account: 'LIABILITIES', Amount: '' },
            { Account: '  Accounts Payable', Amount: m(6300) },
            { Account: '  Accrued Expenses', Amount: m(4200) },
            { Account: '  Long-term Debt', Amount: m(22000) },
            { Account: 'Total Liabilities', Amount: m(32500) },
            { Account: 'EQUITY', Amount: '' },
            { Account: '  Retained Earnings', Amount: m(84600) },
            { Account: '  Share Capital', Amount: m(17000) },
            { Account: 'Total Equity', Amount: m(101600) },
            { Account: 'Total Liabilities & Equity', Amount: m(134100) },
          ],
        };
        break;
      }
      case 'pl': {
        contentSection = {
          title: `Income Statement — ${activeLabel}`,
          columns: ['Line Item', 'Amount'],
          rows: [
            { 'Line Item': 'REVENUE', Amount: '' },
            { 'Line Item': '  Service Revenue', Amount: m(98000) },
            { 'Line Item': '  Product Revenue', Amount: m(27500) },
            { 'Line Item': 'Total Revenue', Amount: m(125500) },
            { 'Line Item': 'EXPENSES', Amount: '' },
            { 'Line Item': '  Cost of Goods Sold', Amount: m(51200) },
            { 'Line Item': '  Salaries & Wages', Amount: m(28500) },
            { 'Line Item': '  Rent', Amount: m(8000) },
            { 'Line Item': '  Utilities', Amount: m(9200) },
            { 'Line Item': '  Depreciation', Amount: m(10267) },
            { 'Line Item': 'Total Expenses', Amount: m(107167) },
            { 'Line Item': 'Net Income', Amount: m(18333) },
          ],
        };
        break;
      }
      case 'tb':
      case 'gl_tb': {
        contentSection = {
          title: `Trial Balance — As of ${activeRange.to}`,
          columns: ['Account Code', 'Account Name', 'Debit', 'Credit'],
          rows: [
            { 'Account Code': '1000', 'Account Name': 'Cash', Debit: m(62500), Credit: '' },
            { 'Account Code': '1200', 'Account Name': 'Accounts Receivable', Debit: m(10500), Credit: '' },
            { 'Account Code': '1400', 'Account Name': 'Inventory', Debit: m(28000), Credit: '' },
            { 'Account Code': '1500', 'Account Name': 'Fixed Assets', Debit: m(33100), Credit: '' },
            { 'Account Code': '2000', 'Account Name': 'Accounts Payable', Debit: '', Credit: m(6300) },
            { 'Account Code': '2100', 'Account Name': 'Accrued Expenses', Debit: '', Credit: m(4200) },
            { 'Account Code': '3000', 'Account Name': 'Share Capital', Debit: '', Credit: m(17000) },
            { 'Account Code': '3100', 'Account Name': 'Retained Earnings', Debit: '', Credit: m(84600) },
            { 'Account Code': '4000', 'Account Name': 'Revenue', Debit: '', Credit: m(125500) },
            { 'Account Code': '5000', 'Account Name': 'COGS', Debit: m(51200), Credit: '' },
            { 'Account Code': '6000', 'Account Name': 'Operating Expenses', Debit: m(55967), Credit: '' },
            { 'Account Code': '', 'Account Name': 'TOTALS', Debit: m(241267), Credit: m(241600) },
          ],
        };
        break;
      }
      case 'equity': {
        const cols = ['Opening', 'Current'];
        const er = equityRows(cols);
        contentSection = {
          title: `Statement of Changes in Equity — ${activeLabel}`,
          columns: ['Equity Component', ...cols],
          rows: EQUITY_LINES.map(line => ({
            'Equity Component': line,
            Opening: m(er[line][cols[0]]),
            Current: m(er[line][cols[1]]),
          })),
        };
        break;
      }
      default: {
        // Use the structured preview definition so the export reflects the
        // report's standard columns/rows instead of only metadata.
        const def = previewDef(r);
        contentSection = {
          title: `${r.title} — ${activeLabel}`,
          columns: def.columns,
          rows: def.rows as Record<string, string | number>[],
        };
        break;
      }
    }

    return {
      title: `${DEPT_TAG} ${r.title}`,
      generatedAt: new Date().toISOString(),
      sections: contentSection ? [contentSection, metaSection] : [metaSection],
    };
  };

  const downloadReport = async (r: FinReportFE) => {
    setDownloadingId(r.id);
    try {
      const doc = buildReportDoc(r);
      const ext = r.format === 'Excel' ? 'csv' : r.format.toLowerCase();
      const filename = `${DEPT_TAG}-${r.report_key}.${ext}`;
      if (r.format === 'PDF') {
        exportReportToPDF(doc, filename);
      } else if (r.format === 'Excel') {
        exportReportToExcel(doc, filename);
      } else {
        exportReportToCSV(doc, filename);
      }
      addNotification(`${taggedId(r.report_key)} · ${r.title} downloaded as ${r.format}`, 'success', 'Finance');
    } catch (e: any) {
      addNotification(e?.message || `Failed to download ${r.title}`, 'warning', 'Finance');
    } finally {
      setDownloadingId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  };

  // ── View modal: open with the current global period pre-selected ──────
  const openView = (r: FinReportFE) => {
    setViewPeriod(period);
    setViewCustomFrom(customFrom);
    setViewCustomTo(customTo);
    setViewReport(r);
  };

  const viewRange = useMemo(
    () => periodDateRange(viewPeriod, viewCustomFrom, viewCustomTo),
    [viewPeriod, viewCustomFrom, viewCustomTo],
  );
  const viewLabel = useMemo(
    () => periodLabel(viewPeriod, viewCustomFrom, viewCustomTo),
    [viewPeriod, viewCustomFrom, viewCustomTo],
  );

  // Period columns for the Statement of Changes in Equity (prior + current).
  const equityPeriodCols = useMemo(() => {
    const prior = new Date(viewRange.from);
    prior.setMonth(prior.getMonth() - 1);
    return [toISODate(prior).slice(0, 7), viewRange.from.slice(0, 7)];
  }, [viewRange]);

  // ── Schedule modal ────────────────────────────────────────────────────
  const openSchedule = () => {
    const draft: Record<string, { frequency: string; format: ReportFormat; status: ReportStatus }> = {};
    for (const r of allReports) {
      draft[r.id] = {
        frequency: r.frequency,
        format: (r.format as ReportFormat) || 'PDF',
        status: (r.status as ReportStatus) || 'Scheduled',
      };
    }
    setScheduleDraft(draft);
    setScheduleOpen(true);
  };

  const scheduleDirty = useMemo(() => {
    return allReports.some(r => {
      const d = scheduleDraft[r.id];
      return d && (d.frequency !== r.frequency || d.format !== r.format || d.status !== r.status);
    });
  }, [allReports, scheduleDraft]);

  const saveSchedule = async () => {
    const changed = allReports.filter(r => {
      const d = scheduleDraft[r.id];
      return d && (d.frequency !== r.frequency || d.format !== r.format || d.status !== r.status);
    });
    if (changed.length === 0) {
      setScheduleOpen(false);
      return;
    }
    setScheduleSaving(true);
    let ok = 0;
    let fail = 0;
    await Promise.all(
      changed.map(async r => {
        const d = scheduleDraft[r.id];
        try {
          if (!isFallback(r)) {
            await updateReport(r.id, { frequency: d.frequency, format: d.format, status: d.status });
          }
          ok++;
        } catch {
          fail++;
        }
      }),
    );
    // Apply schedule changes to local state immediately (covers fallback entries)
    setAllReports(prev => prev.map(r => {
      const d = scheduleDraft[r.id];
      if (!d) return r;
      return { ...r, frequency: d.frequency, format: d.format, status: d.status };
    }));
    setScheduleSaving(false);
    await fetchAll();
    setScheduleOpen(false);
    if (fail === 0) addNotification(`${ok} report(s) updated`, 'success', 'Finance');
    else addNotification(`${ok} updated, ${fail} failed`, 'warning', 'Finance');
  };

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Financial Reports"
        subtitle="Financial statements, GL, AR/AP, cash & bank, budget, asset & tax, and revenue reports."
        icon={FileText}
        actions={
          <>
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
                </div>
              )}
            </div>
            <button className={button.secondary} onClick={openSchedule}>
              <Clock size={14} /> Schedule
            </button>
            <button
              onClick={handleRunAll}
              disabled={runningAll || loading}
              className={[button.primary, 'flex items-center gap-2'].join(' ')}
            >
              {runningAll ? <Loader2 size={14} className="animate-spin" /> : <FileBarChart size={14} />}
              Run All
            </button>
          </>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Total Reports" value={totalReports} icon={FileText} tone="accent" caption={activeLabel} />
        <StatCard title="Ready" value={ready} icon={CheckCircle2} tone="success" />
        <StatCard title="Scheduled" value={scheduled} icon={Clock} tone="info" />
        <StatCard title="Failed" value={failed} icon={AlertTriangle} tone="danger" />
      </div>

      {/* ── Unified toolbar: refresh + search ──── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={fetchAll}
            disabled={loading}
            className={[button.ghost, 'flex items-center gap-2'].join(' ')}
            title="Refresh"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
          <div className="relative w-full sm:w-56">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
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
      {loading && reports.length === 0 ? (
        <SectionCard title="Loading…" icon={FileBarChart} tone="accent">
          <div className="px-6 py-10 text-center text-slate-500">
            <Loader2 size={18} className="animate-spin inline-block mr-2" />
            Loading reports…
          </div>
        </SectionCard>
      ) : reports.length === 0 ? (
        <SectionCard title="No Matching Reports" icon={FileBarChart} tone="accent">
          <div className="px-6 py-10 text-center text-slate-500">No reports match your search. Try clearing the search filter.</div>
        </SectionCard>
      ) : (
        CATEGORY_ORDER.map(cat => {
          const groupReports = reportsByCategory[cat];
          if (!groupReports || groupReports.length === 0) return null;
          return (
            <SectionCard
              key={cat}
              title={`${cat} · ${activeLabel}`}
              icon={FileBarChart}
              tone="accent"
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-6 py-3 font-medium">Report ID</th>
                      <th className="px-6 py-3 font-medium">Report</th>
                      <th className="px-6 py-3 font-medium">Description</th>
                      <th className="px-6 py-3 font-medium">Last Run</th>
                      <th className="px-6 py-3 font-medium">Format</th>
                      <th className="px-6 py-3 font-medium">Frequency</th>
                      <th className="px-6 py-3 font-medium">Status</th>
                      <th className="px-6 py-3 font-medium">Period</th>
                      <th className="px-6 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {groupReports.map(r => {
                      const isRunning = runningId === r.id;
                      const fmt = (r.format as ReportFormat) || 'PDF';
                      const st = (r.status as ReportStatus) || 'Scheduled';
                      return (
                        <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                          <td className="px-6 py-3 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                {DEPT_TAG}
                              </span>
                              <span className="text-sm font-mono text-slate-600 dark:text-slate-400">{r.report_key}</span>
                            </span>
                          </td>
                          <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{r.title}</td>
                          <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.description || '—'}</td>
                          <td className="px-6 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">{formatLastRun(r.last_run_at)}</td>
                          <td className="px-6 py-3"><Badge tone={FORMAT_TONE[fmt] || 'neutral'}>{fmt}</Badge></td>
                          <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{r.frequency}</td>
                          <td className="px-6 py-3"><Badge tone={STATUS_TONE[st] || 'neutral'}>{st}</Badge></td>
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
                          <td className="px-6 py-3 text-right">
                            <div className="inline-flex gap-2">
                              <button
                                onClick={() => openView(r)}
                                className={button.ghost}
                              >
                                <Eye size={14} /> View
                              </button>
                              <button
                                onClick={() => downloadReport(r)}
                                disabled={isRunning || downloadingId === r.id}
                                className={button.ghost}
                                title={`Download as ${fmt}`}
                              >
                                {downloadingId === r.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
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
          <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400" />
          Report Delivery
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Reports are generated automatically and can be delivered to Finance leadership, Controllers, External Auditors, and Executive BI inboxes. Manual re-runs are available for users with report access.
        </p>
      </div>

      {/* ── View Modal ─────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!viewReport}
        onClose={() => setViewReport(null)}
        title={viewReport?.title || 'Report'}
        subtitle={viewReport ? `${taggedId(viewReport.report_key)} · ${viewReport.category}` : ''}
        variant="info"
        size="xl"
        showFooter={true}
        cancelLabel="Close"
        footer={
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              {viewReport && `Last run: ${formatDateTime(viewReport.last_run_at)}`}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => viewReport && handleRun(viewReport)}
                disabled={!!runningId}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-50 flex items-center gap-2"
              >
                {runningId ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Run Now
              </button>
              <button
                onClick={() => viewReport && downloadReport(viewReport)}
                disabled={!!downloadingId}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition disabled:opacity-50 flex items-center gap-2"
              >
                {downloadingId ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                Download {viewReport?.format}
              </button>
              <button
                onClick={() => setViewReport(null)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition"
              >
                Close
              </button>
            </div>
          </div>
        }
      >
        {viewReport && (
          <div className="space-y-5">
            {/* Period selector + metadata summary */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                  {PERIODS.map(p => (
                    <button
                      key={p}
                      onClick={() => {
                        if (p === 'Custom') {
                          const range = defaultCustomRange();
                          setViewCustomFrom(range.from);
                          setViewCustomTo(range.to);
                        }
                        setViewPeriod(p);
                      }}
                      className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                        viewPeriod === p
                          ? 'bg-[var(--color-accent-operations)] text-white'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                {viewPeriod === 'Custom' && (
                  <div className="flex items-center gap-1.5 text-sm">
                    <input
                      type="date"
                      value={viewCustomFrom}
                      onChange={e => setViewCustomFrom(e.target.value)}
                      className="px-2 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                    <span className="text-slate-400">→</span>
                    <input
                      type="date"
                      value={viewCustomTo}
                      onChange={e => setViewCustomTo(e.target.value)}
                      className="px-2 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                    />
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={STATUS_TONE[(viewReport.status as ReportStatus) || 'Scheduled']}>{viewReport.status}</Badge>
                <Badge tone={FORMAT_TONE[(viewReport.format as ReportFormat) || 'PDF']}>{viewReport.format}</Badge>
                <span className="text-xs text-slate-500 font-mono">{viewLabel}</span>
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500 mb-1">Description</div>
              <p className="text-sm text-slate-700 dark:text-slate-300">{viewReport.description || '—'}</p>
            </div>

            {/* ── Actual report content (spec §25) ──── */}
            <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
              <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
                <Eye size={16} /> {viewReport.title}
              </h4>

              {(() => {
                const rend = rendererFor(viewReport);
                if (rend.kind === 'financial-statements') {
                  return (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-900/40">
                      <FinancialStatements initialTab={rend.tab} />
                    </div>
                  );
                }
                if (rend.kind === 'trial-balance') {
                  return (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-900/40">
                      <TrialBalance />
                    </div>
                  );
                }
                if (rend.kind === 'equity') {
                  return <StatementOfChangesInEquity periodCols={equityPeriodCols} />;
                }
                // Structured preview for reports without a dedicated renderer
                const def = previewDef(viewReport);
                const cols: Column<Record<string, string | number>>[] = def.columns.map(c => ({
                  key: c,
                  label: c,
                  render: (row: Record<string, string | number>) => (
                    <span className="text-xs text-slate-700 dark:text-slate-200">{String(row[c] ?? '—')}</span>
                  ),
                }));
                return (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <DataTable
                      columns={cols}
                      data={def.rows}
                      rowKey={(_, i) => String(i)}
                      containerClassName="rounded-xl border-0 shadow-none"
                    />
                  </div>
                );
              })()}
            </div>

            {/* Compact metadata footer */}
            <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <div className="text-slate-500 mb-0.5">Report ID</div>
                  <div className="font-mono text-slate-700 dark:text-slate-200">{taggedId(viewReport.report_key)}</div>
                </div>
                <div>
                  <div className="text-slate-500 mb-0.5">Frequency</div>
                  <div className="text-slate-700 dark:text-slate-200">{viewReport.frequency}</div>
                </div>
                <div>
                  <div className="text-slate-500 mb-0.5">Last Run</div>
                  <div className="text-slate-700 dark:text-slate-200">{formatDateTime(viewReport.last_run_at)}</div>
                </div>
                <div>
                  <div className="text-slate-500 mb-0.5">Last Run By</div>
                  <div className="text-slate-700 dark:text-slate-200">{viewReport.last_run_by || '—'}</div>
                </div>
              </div>
              {viewReport.updated_at && (
                <div className="text-xs text-slate-400 mt-2">
                  Last updated: {formatDateTime(viewReport.updated_at)}
                </div>
              )}
            </div>
          </div>
        )}
      </ModalSystem>

      {/* ── Schedule Modal ─────────────────────────────────────────── */}
      <ModalSystem
        isOpen={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        title="Report Scheduling"
        subtitle="Edit frequency, format, and status for all Finance reports"
        variant="form"
        size="xl"
        loading={scheduleSaving}
        footer={
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              {scheduleDirty ? 'Unsaved changes' : 'No changes'}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setScheduleOpen(false)}
                disabled={scheduleSaving}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={saveSchedule}
                disabled={scheduleSaving || !scheduleDirty}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition disabled:opacity-50 flex items-center gap-2"
              >
                {scheduleSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Changes
              </button>
            </div>
          </div>
        }
      >
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Report</th>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 font-medium">Frequency</th>
                <th className="px-3 py-2 font-medium">Format</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {allReports.map(r => {
                const d = scheduleDraft[r.id];
                if (!d) return null;
                const changed = d.frequency !== r.frequency || d.format !== r.format || d.status !== r.status;
                return (
                  <tr key={r.id} className={changed ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-700 dark:text-slate-200">{r.title}</div>
                      <div className="text-xs text-slate-400 font-mono">{taggedId(r.report_key)}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-500">{r.category}</td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={d.frequency}
                        onChange={e => setScheduleDraft(prev => ({ ...prev, [r.id]: { ...prev[r.id], frequency: e.target.value } }))}
                        className="w-full px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={d.format}
                        onChange={e => setScheduleDraft(prev => ({ ...prev, [r.id]: { ...prev[r.id], format: e.target.value as ReportFormat } }))}
                        className="px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                      >
                        {ALL_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={d.status}
                        onChange={e => setScheduleDraft(prev => ({ ...prev, [r.id]: { ...prev[r.id], status: e.target.value as ReportStatus } }))}
                        className="px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                      >
                        {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ModalSystem>
    </div>
  );
};

export default FinancialReports;

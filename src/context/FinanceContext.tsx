/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { ERPStats } from '../types/erp';
import { JournalEntry, GlobalSaleTransaction, ChartOfAccount, ExpenseRequest } from '../types/finance';
import { initialSalesTransactions, initialExpenseRequests } from './initialState';
import { useSystem } from './SystemContext';
import { useReservation } from './ReservationContext';
import { hasSupabaseConfig } from '../lib/supabase';
import {
  fetchChartOfAccounts,
  createJournalEntry as createJournalEntryApi,
  postJournalEntry as postJournalEntryApi,
  reverseJournalEntry as reverseJournalEntryApi,
} from '../services/financeService';

/**
 * FinanceContext — financial data layer for the ERP.
 *
 * API-backed when Supabase is configured: journal entries and chart of
 * accounts are fetched from /api/fin-portal (the unified GL reader) and
 * writes go through the same API.  Falls back to in-memory state when
 * Supabase is not configured (offline / demo mode).
 *
 * NOTE: Operational PMS stats (occupancy, ADR, RevPAR) were previously
 * computed here but have been removed — they belong to the reservation
 * domain, not finance.  The `stats` field is kept for backward
 * compatibility but is no longer populated with PMS metrics.
 */

export interface FinanceContextType {
  journals: JournalEntry[];
  salesTransactions: GlobalSaleTransaction[];
  chartOfAccounts: ChartOfAccount[];
  expenseRequests: ExpenseRequest[];
  stats: ERPStats;

  addSaleTransaction: (transaction: Omit<GlobalSaleTransaction, 'id'>) => string;
  updateSaleTransactionStatus: (id: string, status: 'Completed' | 'Voided' | 'Pending') => void;
  addJournalEntry: (entry: Omit<JournalEntry, 'id'>) => string;
  addAccount: (account: ChartOfAccount) => void;
  deleteAccount: (code: string) => void;
  postAutoJournal: (params: {
    reference: string;
    description: string;
    amount: number;
    debitAccount: string;
    creditAccount: string;
    department?: string;
  }) => void;
  addExpenseRequest: (request: Omit<ExpenseRequest, 'id'>) => string;
  updateExpenseRequestStatus: (id: string, status: ExpenseRequest['status']) => void;
  createJournalEntry: (entry: Omit<JournalEntry, 'id'>) => Promise<JournalEntry>;
  postJournalEntry: (id: string) => Promise<void>;
  reverseJournalEntry: (id: string) => Promise<JournalEntry>;
  refreshData: () => Promise<void>;
}

const FinanceContext = createContext<FinanceContextType | undefined>(undefined);

export const useFinance = () => {
  const context = useContext(FinanceContext);
  if (!context) throw new Error('useFinance must be used within a FinanceProvider');
  return context;
};

/** Fetch journals from the unified GL endpoint (/api/fin-portal/journals). */
async function fetchJournalsUnified(): Promise<JournalEntry[]> {
  const token = localStorage.getItem('auth_token');
  const res = await fetch('/api/fin-portal/journals', {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) return [];
  const rows = await res.json();
  return (rows || []).map((r: any) => ({
    id: r.id,
    date: r.entry_date || r.date,
    reference: r.reference || r.id,
    description: r.description || '',
    status: (r.status === 'Posted' ? 'Posted' : r.status === 'Reversed' ? 'Reversed' : 'Draft') as JournalEntry['status'],
    createdBy: r.created_by || '',
    approvedBy: r.approved_by,
    amount: Number(r.total_debit || r.amount) || 0,
    lines: Array.isArray(r.lines) ? (typeof r.lines === 'string' ? JSON.parse(r.lines) : r.lines) : [],
    department: r.department,
  }));
}

/** Post a journal entry via the unified GL API. */
async function postJournalToApi(entry: Omit<JournalEntry, 'id'>): Promise<string | null> {
  if (!hasSupabaseConfig) return null;
  const token = localStorage.getItem('auth_token');
  const totalDebit = entry.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = entry.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  try {
    const res = await fetch('/api/fin-portal/journals', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        date: entry.date,
        reference: entry.reference,
        description: entry.description,
        department: entry.department,
        lines: entry.lines.map(l => ({
          accountId: l.accountId,
          accountName: l.accountName,
          description: l.description,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
        })),
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.id || null;
  } catch {
    return null;
  }
}

export const FinanceProvider: React.FC<{ enabled?: boolean; children: React.ReactNode }> = ({
  enabled = true,
  children,
}) => {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const { currentSystemDate, addNotification, logAudit } = useSystem();
  const { rooms, reservations } = useReservation();

  const [chartOfAccounts, setChartOfAccounts] = useState<ChartOfAccount[]>([
    { code: '1010', name: 'Cash at Hand', category: 'Asset', description: 'Physical cash in safe and registers', balance: 0 },
    { code: '1100', name: 'Accounts Receivable', category: 'Asset', description: 'Owed by guests/corporate', balance: 0 },
    { code: '4010', name: 'Room Revenue', category: 'Revenue', description: 'Direct accommodation sales', balance: 0 },
    { code: '4020', name: 'F&B Revenue', category: 'Revenue', description: 'Restaurant & Bar sales', balance: 0 },
  ]);

  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [expenseRequests, setExpenseRequests] = useState<ExpenseRequest[]>(initialExpenseRequests);
  const [salesTransactions, setSalesTransactions] = useState<GlobalSaleTransaction[]>(initialSalesTransactions);

  // Stats — kept for backward compat but no longer populated with PMS metrics.
  // Those belong to the reservation domain.  Finance-specific stats (totalRevenue)
  // are derived from journal entries when available.
  const [stats, setStats] = useState<ERPStats>({
    occupancyRate: 0, adr: 0, revpar: 0, totalRevenue: 0,
    arrivalsTodayCount: 0, departuresTodayCount: 0,
    occupiedRoomsCount: 0, dirtyRoomsCount: 0, outOfOrderCount: 0
  });

  // Compute stats — PMS operational metrics (occupancy, ADR, RevPAR) are
  // still computed here for backward compatibility because App.tsx and
  // AnalyticsDashboard consume them via useERP().stats.  The finance-specific
  // totalRevenue is derived from posted journal entries.
  const calculateFinanceStats = useCallback(() => {
    const totalRooms = rooms.length;
    const occupied = rooms.filter(r => r.status === 'Occupied Clean' || r.status === 'Occupied Dirty').length;
    const dirty = rooms.filter(r => r.status === 'Vacant Dirty' || r.status === 'Occupied Dirty').length;
    const ooo = rooms.filter(r => r.status === 'Out of Order').length;

    const currentCheckedIn = reservations.filter(r => r.status === 'CheckedIn');
    const adr = currentCheckedIn.length > 0 ? currentCheckedIn.reduce((sum, r) => sum + r.rate, 0) / currentCheckedIn.length : 0;
    const occupancyRate = totalRooms > 0 ? (occupied / totalRooms) * 100 : 0;
    const revpar = (adr * occupancyRate) / 100;
    const arrivals = reservations.filter(r => r.status === 'Confirmed' && r.checkInDate === currentSystemDate).length;
    const departures = reservations.filter(r => r.status === 'CheckedIn' && r.checkOutDate === currentSystemDate).length;

    const postedJournals = journals.filter(j => j.status === 'Posted');
    const totalRevenue = postedJournals.reduce((sum, j) => sum + (Number(j.amount) || 0), 0);

    setStats({
      occupancyRate: Math.round(occupancyRate * 10) / 10,
      adr: Math.round(adr),
      revpar: Math.round(revpar),
      totalRevenue,
      occupiedRoomsCount: occupied,
      dirtyRoomsCount: dirty,
      outOfOrderCount: ooo,
      arrivalsTodayCount: arrivals,
      departuresTodayCount: departures
    });
  }, [rooms, reservations, currentSystemDate, journals]);

  useEffect(() => {
    calculateFinanceStats();
  }, [calculateFinanceStats]);

  const refreshData = useCallback(async () => {
    if (!enabledRef.current || !hasSupabaseConfig) {
      calculateFinanceStats();
      return;
    }
    try {
      const [coa, jes] = await Promise.all([
        fetchChartOfAccounts(),
        fetchJournalsUnified(),
      ]);
      setChartOfAccounts(coa);
      setJournals(jes);
    } catch (error) {
      console.error('Error refreshing finance data:', error);
    }
    calculateFinanceStats();
  }, [calculateFinanceStats]);

  // Load data when ERP session is authenticated and Supabase is configured
  useEffect(() => {
    if (enabled && hasSupabaseConfig) {
      refreshData();
    }
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const addJournalEntry = useCallback((entry: Omit<JournalEntry, 'id'>): string => {
    // When API is available, post to the backend (fire-and-forget — the
    // next refreshData() will pull the persisted row).  When offline, use
    // in-memory state.
    if (hasSupabaseConfig) {
      postJournalToApi(entry).then(apiId => {
        if (apiId) {
          // Optimistic update with the real API id
          setJournals(prev => [{ ...entry, id: apiId }, ...prev]);
        }
      });
      return `pending-${Date.now()}`;
    }

    // Offline fallback — in-memory
    const id = `JV-${Date.now()}`;
    const newEntry = { ...entry, id };
    setJournals(prev => [newEntry, ...prev]);

    if (entry.status === 'Posted') {
      setChartOfAccounts(prevCOA => prevCOA.map(acc => {
        let newBalance = acc.balance;
        entry.lines.filter(l => l.accountId === acc.code).forEach(line => {
          const isNormalDebit = acc.category === 'Asset' || acc.category === 'Expense';
          newBalance += isNormalDebit ? (line.debit - line.credit) : (line.credit - line.debit);
        });
        return { ...acc, balance: newBalance };
      }));
    }
    return id;
  }, []);

  const createJournalEntry = useCallback(async (entry: Omit<JournalEntry, 'id'>) => {
    let newEntry: JournalEntry;
    if (hasSupabaseConfig) {
      newEntry = await createJournalEntryApi(entry);
    } else {
      const id = `JV-${Date.now()}`;
      newEntry = { ...entry, id };
    }
    setJournals(prev => [newEntry, ...prev]);
    return newEntry;
  }, []);

  const postJournalEntry = useCallback(async (id: string) => {
    if (hasSupabaseConfig) {
      // Try the unified portal API first, fall back to the legacy finance API
      try {
        const token = localStorage.getItem('auth_token');
        const res = await fetch(`/api/fin-portal/journals/${id}/post`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (res.ok) {
          await refreshData();
          return;
        }
      } catch { /* fall through to legacy API */ }
      await postJournalEntryApi(id);
      await refreshData();
    } else {
      setJournals(prev => prev.map(j => j.id === id ? { ...j, status: 'Posted' as const } : j));
    }
  }, [refreshData]);

  const reverseJournalEntry = useCallback(async (id: string) => {
    let reversed: JournalEntry;
    if (hasSupabaseConfig) {
      // Try the unified portal API first, fall back to the legacy finance API
      try {
        const token = localStorage.getItem('auth_token');
        const res = await fetch(`/api/fin-portal/journals/${id}/reverse`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (res.ok) {
          reversed = await res.json();
          await refreshData();
          return reversed;
        }
      } catch { /* fall through */ }
      reversed = await reverseJournalEntryApi(id);
    } else {
      const fallback = journals.find(j => j.id === id);
      reversed = { ...(fallback || {} as JournalEntry), id: `JV-${Date.now()}`, description: `Reversal: ${fallback?.description || ''}` };
    }
    setJournals(prev => [reversed, ...prev]);
    return reversed;
  }, [journals, refreshData]);

  const addAccount = useCallback((account: ChartOfAccount) => {
    // When API is available, persist to backend
    if (hasSupabaseConfig) {
      const token = localStorage.getItem('auth_token');
      fetch('/api/finance/chart-of-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          code: account.code,
          name: account.name,
          category: account.category,
          description: account.description,
        }),
      }).then(() => refreshData()).catch(() => {});
    }
    // Optimistic local update
    setChartOfAccounts(prev => [...prev, account]);
  }, [refreshData]);

  const deleteAccount = useCallback((code: string) => {
    if (hasSupabaseConfig) {
      const token = localStorage.getItem('auth_token');
      // Find the DB id by code — the API uses the row id, not the code
      fetch(`/api/finance/chart-of-accounts`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      })
        .then(r => r.json())
        .then((rows: any[]) => {
          const row = rows.find((r: any) => r.code === code);
          if (row) {
            return fetch(`/api/finance/chart-of-accounts/${row.id}`, {
              method: 'DELETE',
              headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            });
          }
        })
        .then(() => refreshData())
        .catch(() => {});
    }
    setChartOfAccounts(prev => prev.filter(a => a.code !== code));
  }, [refreshData]);

  const postAutoJournal = useCallback((params: {
    reference: string;
    description: string;
    amount: number;
    debitAccount: string;
    creditAccount: string;
    department?: string;
  }) => {
    const debitAcc = chartOfAccounts.find(a => a.code === params.debitAccount);
    const creditAcc = chartOfAccounts.find(a => a.code === params.creditAccount);
    const journal: Omit<JournalEntry, 'id'> = {
      date: currentSystemDate, reference: params.reference, description: params.description,
      status: 'Posted', createdBy: 'SYSTEM', amount: params.amount, department: params.department,
      lines: [
        { id: `L1-${Date.now()}`, accountId: params.debitAccount, accountName: debitAcc?.name || '?', description: params.description, debit: params.amount, credit: 0 },
        { id: `L2-${Date.now()}`, accountId: params.creditAccount, accountName: creditAcc?.name || '?', description: params.description, debit: 0, credit: params.amount }
      ]
    };
    addJournalEntry(journal);
    logAudit(`Auto Journal: ${params.description}`);
  }, [chartOfAccounts, currentSystemDate, addJournalEntry, logAudit]);

  const addSaleTransaction = useCallback((transaction: Omit<GlobalSaleTransaction, 'id'>) => {
    const id = `STX-${Date.now()}`;
    setSalesTransactions(prev => [{ ...transaction, id }, ...prev]);
    postAutoJournal({
      reference: transaction.invoiceNumber,
      description: `Sales (${transaction.module})`,
      amount: transaction.total,
      debitAccount: transaction.paymentMethod === 'Room Charge' ? '1100' : '1010',
      creditAccount: transaction.module === 'F&B POS' ? '4020' : '4030'
    });
    return id;
  }, [postAutoJournal]);

  const updateSaleTransactionStatus = useCallback((id: string, status: 'Completed' | 'Voided' | 'Pending') => {
    setSalesTransactions(prev => prev.map(t => t.id === id ? { ...t, status } : t));
  }, []);

  const addExpenseRequest = useCallback((request: Omit<ExpenseRequest, 'id'>) => {
    const id = `EXP-${Date.now()}`;
    setExpenseRequests(prev => [...prev, { ...request, id }]);
    addNotification(`New expense submitted.`, 'success', 'Finance');
    return id;
  }, [addNotification]);

  const updateExpenseRequestStatus = useCallback((id: string, status: ExpenseRequest['status']) => {
    setExpenseRequests(prev => prev.map(req => req.id === id ? { ...req, status } : req));
  }, []);

  const value = {
    journals, salesTransactions, chartOfAccounts, expenseRequests, stats,
    addSaleTransaction, updateSaleTransactionStatus, addJournalEntry,
    createJournalEntry, postJournalEntry, reverseJournalEntry,
    addAccount, deleteAccount, postAutoJournal, addExpenseRequest, updateExpenseRequestStatus,
    refreshData
  };

  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>;
};

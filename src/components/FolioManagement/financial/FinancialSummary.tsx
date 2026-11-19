/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FinancialSummary — four primary cards (spec §10):
 * Total Charges | Payments | Balance | Credit
 */
import React from 'react';
import { TrendingUp, TrendingDown, Wallet, CreditCard } from 'lucide-react';
import type { FolioV2, FolioSummaryV2 } from '../../../services/folioService';
import { CurrencyAmount } from '../shared/primitives';

function SummaryCard({
  label,
  amount,
  currency,
  icon: Icon,
  tone,
  sublabel,
}: {
  label: string;
  amount: number;
  currency: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  tone: 'charges' | 'payments' | 'balance' | 'credit';
  sublabel?: string;
}) {
  const toneClasses = {
    charges: { chip: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400', bar: 'bg-blue-500' },
    payments: { chip: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400', bar: 'bg-emerald-500' },
    balance: { chip: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400', bar: 'bg-amber-500' },
    credit: { chip: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400', bar: 'bg-purple-500' },
  };
  const c = toneClasses[tone];
  return (
    <div className="relative bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 overflow-hidden">
      <div className={`absolute top-0 left-0 right-0 h-0.5 ${c.bar}`} />
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</span>
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${c.chip}`}>
          <Icon size={15} />
        </div>
      </div>
      <CurrencyAmount
        amount={amount}
        currency={currency}
        className="text-xl font-bold text-gray-900 dark:text-white mt-2 block"
      />
      {sublabel && <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{sublabel}</p>}
    </div>
  );
}

export function FinancialSummary({
  folio,
  summary,
}: {
  folio: FolioV2;
  summary?: FolioSummaryV2;
}) {
  const charges = summary?.balanceBreakdown.totalCharges ?? folio.total_charges;
  const payments = summary?.balanceBreakdown.totalPayments ?? folio.total_payments;
  const balance = summary?.balanceBreakdown.currentBalance ?? folio.balance;
  const isCompanyOrMaster = folio.folio_type === 'Company' || folio.folio_type === 'Master';
  const creditLimit = folio.credit_limit ?? 0;
  const availableCredit = creditLimit - balance;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <SummaryCard
        label="Total Charges"
        amount={charges}
        currency={folio.currency}
        icon={TrendingUp}
        tone="charges"
      />
      <SummaryCard
        label="Payments"
        amount={payments}
        currency={folio.currency}
        icon={CreditCard}
        tone="payments"
      />
      <SummaryCard
        label="Balance"
        amount={balance}
        currency={folio.currency}
        icon={Wallet}
        tone="balance"
        sublabel={balance <= 0 ? 'Settled' : balance > 0 ? 'Outstanding' : undefined}
      />
      <SummaryCard
        label={isCompanyOrMaster ? 'Available Credit' : 'Credit'}
        amount={isCompanyOrMaster ? availableCredit : creditLimit}
        currency={folio.currency}
        icon={TrendingDown}
        tone="credit"
        sublabel={isCompanyOrMaster ? `Limit: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: folio.currency }).format(creditLimit)}` : undefined}
      />
    </div>
  );
}

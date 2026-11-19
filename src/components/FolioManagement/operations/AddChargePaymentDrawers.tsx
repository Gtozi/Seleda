/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AddChargeDrawer — post a charge (spec §14).
 * AddPaymentDrawer — post a payment (spec §16).
 */
import React, { useState, useEffect } from 'react';
import { Drawer, Field, inputCls, selectCls, DrawerFooter } from './Drawer';
import { CurrencyAmount } from '../shared/primitives';
import { postChargeV2, postPaymentV2, postSplitPaymentV2, fetchBankAccounts } from '../../../services/folioService';
import type { FolioV2, BankAccount } from '../../../services/folioService';

const CHARGE_TYPES = [
  // Accommodation
  'Room',
  // Food & Beverage — granular
  'Breakfast', 'Lunch', 'Dinner', 'Snacks', 'SoftDrink', 'Alcohol', 'F&B',
  // Amenities
  'Minibar', 'Laundry', 'Spa', 'Telephone', 'Transfer', 'Transportation',
  // Other
  'Banquet', 'GiftShop', 'Extra', 'Other',
];
const DEPARTMENTS = ['Front Office', 'F&B', 'Spa', 'Transport', 'Banquet', 'Concierge', 'Housekeeping', 'Finance'];
const PAYMENT_METHODS = ['Cash', 'Credit Card', 'Bank Transfer', 'Mobile Money', 'Account Transfer', 'City Ledger'];
const BANK_RELATED_METHODS = ['Credit Card', 'Bank Transfer', 'Mobile Money', 'Account Transfer', 'City Ledger'];

// ── AddChargeDrawer ────────────────────────────────────────────
export function AddChargeDrawer({
  open,
  folio,
  onClose,
  onPosted,
}: {
  open: boolean;
  folio: FolioV2 | null;
  onClose: () => void;
  onPosted: () => void;
}) {
  const [description, setDescription] = useState('');
  const [chargeType, setChargeType] = useState('Room');
  const [department, setDepartment] = useState('Front Office');
  const [reference, setReference] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [taxPercent, setTaxPercent] = useState(0);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subtotal = quantity * unitPrice;
  const discountAmount = subtotal * (discountPercent / 100);
  const taxAmount = (subtotal - discountAmount) * (taxPercent / 100);
  const grandTotal = subtotal - discountAmount + taxAmount;

  const reset = () => {
    setDescription(''); setChargeType('Room'); setDepartment('Front Office');
    setReference(''); setQuantity(1); setUnitPrice(0); setTaxPercent(0); setDiscountPercent(0);
    setError(null);
  };

  const submit = async () => {
    if (!folio) return;
    if (!description.trim()) { setError('Description is required'); return; }
    if (unitPrice <= 0) { setError('Unit price must be positive'); return; }
    setLoading(true); setError(null);
    try {
      await postChargeV2(folio.id, {
        description, amount: grandTotal, quantity, unitPrice,
        lineType: chargeType, department, reference: reference || undefined,
        taxAmount, discountPercent,
      });
      reset();
      onPosted();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Failed to post charge');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer
      open={open}
      title="Add Charge"
      onClose={() => { reset(); onClose(); }}
      footer={<DrawerFooter onCancel={() => { reset(); onClose(); }} onConfirm={submit} confirmLabel="Post Charge" loading={loading} />}
    >
      {error && <div className="mb-3 px-3 py-2 text-xs rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400">{error}</div>}
      <Field label="Charge Date"><input type="date" defaultValue={new Date().toISOString().slice(0, 10)} className={inputCls} /></Field>
      <Field label="Charge Type">
        <select value={chargeType} onChange={(e) => setChargeType(e.target.value)} className={selectCls}>
          {CHARGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="Department">
        <select value={department} onChange={(e) => setDepartment(e.target.value)} className={selectCls}>
          {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </Field>
      <Field label="Description"><input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} placeholder="e.g. Room charge — Deluxe King" /></Field>
      <Field label="Reference"><input value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} placeholder="RES-1001 (optional)" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantity"><input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className={inputCls} /></Field>
        <Field label="Unit Price"><input type="number" min={0} step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(Number(e.target.value))} className={inputCls} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tax %"><input type="number" min={0} step="0.01" value={taxPercent} onChange={(e) => setTaxPercent(Number(e.target.value))} className={inputCls} /></Field>
        <Field label="Discount %"><input type="number" min={0} max={100} step="0.01" value={discountPercent} onChange={(e) => setDiscountPercent(Number(e.target.value))} className={inputCls} /></Field>
      </div>
      <div className="mt-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-900/40 space-y-1 text-xs">
        <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><CurrencyAmount amount={subtotal} currency={folio?.currency} /></div>
        <div className="flex justify-between"><span className="text-gray-500">Discount</span>-<CurrencyAmount amount={discountAmount} currency={folio?.currency} /></div>
        <div className="flex justify-between"><span className="text-gray-500">Tax</span><CurrencyAmount amount={taxAmount} currency={folio?.currency} /></div>
        <div className="flex justify-between font-bold text-sm pt-1 border-t border-gray-200 dark:border-slate-700"><span>Grand Total</span><CurrencyAmount amount={grandTotal} currency={folio?.currency} /></div>
      </div>
    </Drawer>
  );
}

// ── AddPaymentDrawer (with split payment + bank account) ───────
interface PaymentSplit {
  id: string;
  amount: number;
  method: string;
  reference: string;
  bankAccountId: string;
  cardLastFour: string;
  notes: string;
}

export function AddPaymentDrawer({
  open,
  folio,
  onClose,
  onPosted,
}: {
  open: boolean;
  folio: FolioV2 | null;
  onClose: () => void;
  onPosted: () => void;
}) {
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankLoading, setBankLoading] = useState(false);
  const [splits, setSplits] = useState<PaymentSplit[]>([
    { id: 'split-1', amount: 0, method: 'Cash', reference: '', bankAccountId: '', cardLastFour: '', notes: '' },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const balance = folio?.balance ?? 0;
  const totalPaid = splits.reduce((sum, s) => sum + (s.amount || 0), 0);
  const remaining = balance - totalPaid;

  // Fetch bank accounts when drawer opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBankLoading(true);
    fetchBankAccounts()
      .then((accounts: BankAccount[]) => {
        if (cancelled) return;
        setBankAccounts(accounts);
        // Set default bank account for existing splits
        const defaultBank = accounts.find((a) => a.isDefaultForSales);
        if (defaultBank) {
          setSplits((prev) => prev.map((s) => s.bankAccountId ? s : { ...s, bankAccountId: defaultBank.id }));
        }
      })
      .catch(() => { /* bank accounts optional */ })
      .finally(() => { if (!cancelled) setBankLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  const reset = () => {
    setSplits([{ id: 'split-1', amount: 0, method: 'Cash', reference: '', bankAccountId: '', cardLastFour: '', notes: '' }]);
    setError(null); setConfirmOpen(false);
  };

  const addSplit = () => {
    const defaultBank = bankAccounts.find((a) => a.isDefaultForSales);
    setSplits((prev) => [...prev, {
      id: `split-${prev.length + 1}-${Date.now()}`,
      amount: 0,
      method: 'Cash',
      reference: '',
      bankAccountId: defaultBank?.id || '',
      cardLastFour: '',
      notes: '',
    }]);
  };

  const removeSplit = (id: string) => {
    setSplits((prev) => prev.length > 1 ? prev.filter((s) => s.id !== id) : prev);
  };

  const updateSplit = (id: string, field: keyof PaymentSplit, value: string | number) => {
    setSplits((prev) => prev.map((s) => s.id === id ? { ...s, [field]: value } : s));
  };

  const fillRemaining = (id: string) => {
    const otherTotal = splits.filter((s) => s.id !== id).reduce((sum, s) => sum + (s.amount || 0), 0);
    const remainingForThis = Math.max(0, balance - otherTotal);
    updateSplit(id, 'amount', Math.round(remainingForThis * 100) / 100);
  };

  const submit = async () => {
    if (!folio) return;
    const validSplits = splits.filter((s) => s.amount > 0);
    if (validSplits.length === 0) { setError('At least one payment with a positive amount is required'); return; }
    setLoading(true); setError(null);
    try {
      if (validSplits.length === 1) {
        const s = validSplits[0];
        await postPaymentV2(folio.id, {
          amount: s.amount,
          paymentMethod: s.method,
          reference: s.reference || undefined,
          bankAccountId: s.bankAccountId || undefined,
          cardLastFour: s.cardLastFour || undefined,
          notes: s.notes || undefined,
        });
      } else {
        await postSplitPaymentV2(folio.id, validSplits.map((s) => ({
          amount: s.amount,
          paymentMethod: s.method,
          reference: s.reference || undefined,
          bankAccountId: s.bankAccountId || undefined,
          cardLastFour: s.cardLastFour || undefined,
          notes: s.notes || undefined,
        })));
      }
      reset();
      onPosted();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Failed to post payment');
      setConfirmOpen(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer
      open={open}
      title="Add Payment"
      onClose={() => { reset(); onClose(); }}
      footer={<DrawerFooter onCancel={() => { reset(); onClose(); }} onConfirm={() => setConfirmOpen(true)} confirmLabel="Post Payment" />}
    >
      {error && <div className="mb-3 px-3 py-2 text-xs rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400">{error}</div>}
      <Field label="Payment Date"><input type="date" defaultValue={new Date().toISOString().slice(0, 10)} className={inputCls} /></Field>

      {/* Split payments */}
      <div className="space-y-3">
        {splits.map((split, idx) => (
          <div key={split.id} className="p-3 rounded-lg border border-gray-200 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-900/20">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                Payment {idx + 1}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => fillRemaining(split.id)}
                  className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 hover:bg-blue-100"
                  title="Fill remaining balance"
                >
                  Fill Balance
                </button>
                {splits.length > 1 && (
                  <button
                    onClick={() => removeSplit(split.id)}
                    className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 hover:bg-red-100"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Method">
                <select
                  value={split.method}
                  onChange={(e) => {
                    const newMethod = e.target.value;
                    updateSplit(split.id, 'method', newMethod);
                    // Clear bank account if switching to a non-bank method
                    if (!BANK_RELATED_METHODS.includes(newMethod)) {
                      updateSplit(split.id, 'bankAccountId', '');
                    } else {
                      // Auto-select default bank account
                      const defaultBank = bankAccounts.find((a) => a.isDefaultForSales);
                      if (defaultBank) updateSplit(split.id, 'bankAccountId', defaultBank.id);
                    }
                  }}
                  className={selectCls}
                >
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="Amount">
                <input type="number" min={0} step="0.01" value={split.amount} onChange={(e) => updateSplit(split.id, 'amount', Number(e.target.value))} className={inputCls} />
              </Field>
            </div>
            {BANK_RELATED_METHODS.includes(split.method) && (
              <Field label="Bank Account">
                {bankLoading ? (
                  <div className="text-xs text-gray-400 py-2">Loading bank accounts…</div>
                ) : bankAccounts.length === 0 ? (
                  <div className="text-xs text-gray-400 py-2">No active bank accounts configured</div>
                ) : (
                  <select value={split.bankAccountId} onChange={(e) => updateSplit(split.id, 'bankAccountId', e.target.value)} className={selectCls}>
                    <option value="">— Select bank account —</option>
                    {bankAccounts.map((ba) => (
                      <option key={ba.id} value={ba.id}>
                        {ba.accountName} — {ba.bankName} ({ba.accountNumber})
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
            <Field label="Reference">
              <input value={split.reference} onChange={(e) => updateSplit(split.id, 'reference', e.target.value)} className={inputCls} placeholder="Check #, txn id (optional)" />
            </Field>
            {(split.method === 'Credit Card' || split.method === 'Debit Card') && (
              <Field label="Card Last 4">
                <input value={split.cardLastFour} maxLength={4} onChange={(e) => updateSplit(split.id, 'cardLastFour', e.target.value)} className={inputCls} />
              </Field>
            )}
            <Field label="Notes">
              <input value={split.notes} onChange={(e) => updateSplit(split.id, 'notes', e.target.value)} className={inputCls} placeholder="Optional" />
            </Field>
          </div>
        ))}
      </div>

      {/* Add split button */}
      <button
        onClick={addSplit}
        className="mt-2 w-full py-2 text-xs font-semibold rounded-lg border border-dashed border-gray-300 dark:border-slate-600 text-gray-500 dark:text-gray-400 hover:border-[var(--color-accent-operations)] hover:text-[var(--color-accent-operations)] transition-colors"
      >
        + Add Another Payment Method
      </button>

      {/* Summary */}
      <div className="mt-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-900/40 space-y-1 text-xs">
        <div className="flex justify-between"><span className="text-gray-500">Current Balance</span><CurrencyAmount amount={balance} currency={folio?.currency} /></div>
        <div className="flex justify-between"><span className="text-gray-500">Total Payment</span>-<CurrencyAmount amount={totalPaid} currency={folio?.currency} /></div>
        {splits.length > 1 && (
          <div className="flex justify-between text-[10px] text-gray-400">
            <span>Split into {splits.filter(s => s.amount > 0).length} payments</span>
            <span></span>
          </div>
        )}
        <div className="flex justify-between font-bold text-sm pt-1 border-t border-gray-200 dark:border-slate-700">
          <span>Remaining Balance</span>
          <CurrencyAmount amount={remaining} currency={folio?.currency} />
        </div>
      </div>

      {confirmOpen && (
        <div className="mt-4 p-3 rounded-lg border border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-400 mb-2">
            Confirm posting {splits.filter(s => s.amount > 0).length} payment(s) totaling {totalPaid.toFixed(2)}?
          </p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmOpen(false)} className="px-3 py-1 text-xs font-semibold rounded border border-gray-300 dark:border-slate-600">Back</button>
            <button onClick={submit} disabled={loading} className="px-3 py-1 text-xs font-semibold rounded bg-[var(--color-accent-operations)] text-white disabled:opacity-50">
              {loading ? 'Posting…' : 'Confirm & Post'}
            </button>
          </div>
        </div>
      )}
    </Drawer>
  );
}

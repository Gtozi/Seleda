/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * InvoicesTab — invoice ledger (spec §19). Uses the existing
 * /api/folios/:folioId/invoices endpoint (preserved from legacy routes).
 * Action buttons: View, Print, Email, Void — all functional.
 * View/Print uses the admin-configured UnifiedInvoiceTemplate.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Eye, Printer, Mail, XCircle, FileCheck } from 'lucide-react';
import type { FolioV2 } from '../../../services/folioService';
import { fetchFolioInvoices, fetchInvoice, voidInvoice, type FolioInvoiceSummary } from '../../../services/folioService';
import { CurrencyAmount, StatusBadge, EmptyState, LoadingState } from '../shared/primitives';
import UnifiedInvoiceTemplate, { type InvoiceItem, type InvoiceFee, type InvoicePayment } from '../../Shared/UnifiedInvoiceTemplate';

interface InvoicePrintData {
  invoiceNumber: string;
  date: string;
  title: string;
  customerName: string;
  customerEmail?: string;
  customerTin?: string;
  customerVatNo?: string;
  customerVatDate?: string;
  roomNo?: string;
  stayDetails?: { checkIn?: string; checkOut?: string; nights?: number; roomType?: string; rate?: number };
  items: InvoiceItem[];
  subtotal: number;
  fees: InvoiceFee[];
  total: number;
  payments: InvoicePayment[];
  balanceDue: number;
  footerMessage?: string;
}

export function InvoicesTab({
  folio,
  onCreateInvoice,
}: {
  folio: FolioV2;
  onCreateInvoice: () => void;
}) {
  const [invoices, setInvoices] = useState<FolioInvoiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printData, setPrintData] = useState<InvoicePrintData | null>(null);
  const [printLoading, setPrintLoading] = useState(false);
  const [voidConfirm, setVoidConfirm] = useState<FolioInvoiceSummary | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFolioInvoices(folio.id);
      setInvoices(data);
    } catch (e: any) {
      setError(e.message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }, [folio.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  // Fetch invoice details and build print data for UnifiedInvoiceTemplate
  const buildPrintData = async (inv: FolioInvoiceSummary): Promise<InvoicePrintData> => {
    const data = await fetchInvoice(inv.id);
    const invoice = data.invoice;
    const reservation = data.reservation;

    const checkIn = reservation?.check_in_date ? new Date(reservation.check_in_date).toLocaleDateString() : undefined;
    const checkOut = reservation?.check_out_date ? new Date(reservation.check_out_date).toLocaleDateString() : undefined;

    let nights = 0;
    if (reservation?.check_in_date && reservation?.check_out_date) {
      const start = new Date(reservation.check_in_date);
      const end = new Date(reservation.check_out_date);
      nights = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    }

    // Group lines by description (same item → one line with summed qty)
    const rawItems: InvoiceItem[] = (data.lines || []).map((line: any) => {
      const qty = line.quantity || 1;
      const unitPrice = line.unit_price ?? (qty ? Number(line.amount) / qty : Number(line.amount));
      return {
        productName: line.description || line.line_type || 'Folio line item',
        quantity: qty,
        price: unitPrice,
      };
    });

    const itemMap = new Map<string, InvoiceItem>();
    for (const item of rawItems) {
      const key = `${item.productName}||${item.price}`;
      const existing = itemMap.get(key);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        itemMap.set(key, { ...item });
      }
    }
    const items: InvoiceItem[] = Array.from(itemMap.values());

    const fees: InvoiceFee[] = [];
    if (Number(invoice.tax_total || 0) > 0) {
      fees.push({ label: 'Tax', amount: Number(invoice.tax_total) });
    }
    if (Number(invoice.discount_total || 0) > 0) {
      fees.push({ label: 'Discount', amount: Number(invoice.discount_total), isDiscount: true });
    }

    const payments: InvoicePayment[] = (data.payments || []).map((pmt: any) => ({
      method: pmt.payment_method,
      amount: Number(pmt.amount),
      date: pmt.payment_date ? new Date(pmt.payment_date).toLocaleString() : undefined,
    }));

    const subtotal = Number(invoice.subtotal || invoice.total || 0);

    return {
      invoiceNumber: invoice.invoice_number,
      date: new Date(invoice.issue_date).toLocaleString(),
      title: invoice.invoice_type === 'Group Master' ? 'GROUP MASTER INVOICE' : 'OFFICIAL VAT INVOICE',
      customerName: invoice.customer_name || reservation?.guest_name || 'Guest',
      customerEmail: invoice.customer_email || reservation?.guest_email || undefined,
      customerTin: invoice.customer_tin || reservation?.guest_tin || undefined,
      customerVatNo: invoice.customer_vat_no || reservation?.guest_vat_no || undefined,
      customerVatDate: invoice.customer_vat_date || undefined,
      roomNo: reservation?.room_number || undefined,
      stayDetails: checkIn && checkOut
        ? { checkIn, checkOut, nights, roomType: 'Standard', rate: subtotal / (nights || 1) }
        : undefined,
      items: items.length > 0 ? items : [{ productName: 'Folio charges', quantity: 1, price: subtotal }],
      subtotal,
      fees,
      total: Number(invoice.total || 0),
      payments,
      balanceDue: Number(invoice.total || 0) - Number(invoice.amount_paid || 0),
      footerMessage: invoice.notes || `Invoice ${invoice.invoice_number} — ${invoice.status}`,
    };
  };

  const handleView = async (inv: FolioInvoiceSummary) => {
    setPrintLoading(true);
    try {
      const data = await buildPrintData(inv);
      setPrintData(data);
    } catch (e: any) {
      setError(e.message || 'Failed to load invoice');
    } finally {
      setPrintLoading(false);
    }
  };

  const handlePrint = async (inv: FolioInvoiceSummary) => {
    setPrintLoading(true);
    try {
      const data = await buildPrintData(inv);
      setPrintData(data);
      // Wait for UnifiedInvoiceTemplate to render, then trigger print
      setTimeout(() => window.print(), 400);
    } catch (e: any) {
      setError(e.message || 'Failed to load invoice for printing');
    } finally {
      setPrintLoading(false);
    }
  };

  const handleEmail = (inv: FolioInvoiceSummary) => {
    const subject = encodeURIComponent(`Invoice ${inv.invoice_number}`);
    const body = encodeURIComponent(
      `Dear Customer,\n\nPlease find your invoice details below:\n\n` +
      `Invoice #: ${inv.invoice_number}\n` +
      `Date: ${inv.issue_date}\n` +
      `Total: ${inv.total}\n` +
      `Status: ${inv.status}\n\n` +
      `Thank you for your business.`
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const handleVoid = async () => {
    if (!voidConfirm) return;
    setVoiding(true);
    try {
      await voidInvoice(voidConfirm.id, 'Manually voided from folio management');
      setToast(`Invoice ${voidConfirm.invoice_number} voided`);
      setVoidConfirm(null);
      load();
    } catch (e: any) {
      setError(e.message || 'Failed to void invoice');
    } finally {
      setVoiding(false);
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">Invoices</h3>
        <button
          onClick={onCreateInvoice}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--color-accent-operations)] text-white hover:opacity-90"
        >
          <Plus size={13} /> Create Invoice
        </button>
      </div>

      {toast && (
        <div className="mb-3 px-3 py-2 text-xs rounded-lg bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
          {toast}
        </div>
      )}

      {loading ? (
        <LoadingState label="Loading invoices…" />
      ) : error ? (
        <EmptyState title="Failed to load" description={error} />
      ) : invoices.length === 0 ? (
        <EmptyState title="No invoices" description="No invoices have been generated for this folio." icon={FileCheck} />
      ) : (
        <div className="overflow-x-auto bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
                <th className="py-2 px-3 font-semibold">Invoice #</th>
                <th className="py-2 px-3 font-semibold">Date</th>
                <th className="py-2 px-3 font-semibold text-right">Subtotal</th>
                <th className="py-2 px-3 font-semibold text-right">Tax</th>
                <th className="py-2 px-3 font-semibold text-right">Total</th>
                <th className="py-2 px-3 font-semibold text-right">Paid</th>
                <th className="py-2 px-3 font-semibold text-right">Balance</th>
                <th className="py-2 px-3 font-semibold">Status</th>
                <th className="py-2 px-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {invoices.map((inv) => (
                <tr key={inv.id} className={`hover:bg-slate-50 dark:hover:bg-slate-700/40 ${inv.is_voided ? 'opacity-50' : ''}`}>
                  <td className="py-2 px-3 font-mono text-gray-700 dark:text-gray-200">{inv.invoice_number}</td>
                  <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{inv.issue_date}</td>
                  <td className="py-2 px-3 text-right"><CurrencyAmount amount={inv.subtotal} currency={folio.currency} /></td>
                  <td className="py-2 px-3 text-right"><CurrencyAmount amount={inv.tax_total} currency={folio.currency} /></td>
                  <td className="py-2 px-3 text-right font-semibold"><CurrencyAmount amount={inv.total} currency={folio.currency} /></td>
                  <td className="py-2 px-3 text-right"><CurrencyAmount amount={inv.amount_paid} currency={folio.currency} /></td>
                  <td className="py-2 px-3 text-right font-semibold"><CurrencyAmount amount={inv.total - inv.amount_paid} currency={folio.currency} /></td>
                  <td className="py-2 px-3"><StatusBadge status={inv.status} kind="invoice" size="xs" /></td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleView(inv)}
                        disabled={printLoading}
                        title="View"
                        className="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 disabled:opacity-50"
                      >
                        <Eye size={13} />
                      </button>
                      <button
                        onClick={() => handlePrint(inv)}
                        disabled={printLoading}
                        title="Print"
                        className="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 disabled:opacity-50"
                      >
                        <Printer size={13} />
                      </button>
                      <button
                        onClick={() => handleEmail(inv)}
                        title="Email"
                        className="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
                      >
                        <Mail size={13} />
                      </button>
                      {!inv.is_voided && inv.status !== 'Paid' && (
                        <button
                          onClick={() => setVoidConfirm(inv)}
                          title="Void"
                          className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                        >
                          <XCircle size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {printLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="text-xs text-white bg-slate-800 px-4 py-3 rounded-lg">Loading invoice…</div>
        </div>
      )}

      {/* Full Invoice Preview / Print — uses admin-configured UnifiedInvoiceTemplate */}
      {printData && (
        <UnifiedInvoiceTemplate
          invoiceNumber={printData.invoiceNumber}
          date={printData.date}
          title={printData.title}
          customerName={printData.customerName}
          customerEmail={printData.customerEmail}
          customerTin={printData.customerTin}
          customerVatNo={printData.customerVatNo}
          customerVatDate={printData.customerVatDate}
          roomNo={printData.roomNo}
          stayDetails={printData.stayDetails}
          items={printData.items}
          subtotal={printData.subtotal}
          fees={printData.fees}
          total={printData.total}
          payments={printData.payments}
          balanceDue={printData.balanceDue}
          footerMessage={printData.footerMessage}
          onClose={() => setPrintData(null)}
        />
      )}

      {/* ── Void Confirmation ── */}
      {voidConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setVoidConfirm(null)} />
          <div className="relative max-w-sm w-full bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-red-50 dark:bg-red-900/30">
                <XCircle size={20} className="text-red-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">Void Invoice?</h3>
                <p className="text-xs text-gray-500">{voidConfirm.invoice_number}</p>
              </div>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-300 mb-4">
              Voiding this invoice will mark it as voided, unlink its charge lines (so they can be re-invoiced), and cannot be undone. The folio balance will be recalculated.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setVoidConfirm(null)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 dark:border-slate-600"
              >
                Cancel
              </button>
              <button
                onClick={handleVoid}
                disabled={voiding}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white disabled:opacity-50"
              >
                {voiding ? 'Voiding…' : 'Void Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

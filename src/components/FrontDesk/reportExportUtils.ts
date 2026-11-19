/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * reportExportUtils — shared report export/print helpers (PDF via jsPDF +
 * autotable, Excel via xlsx, CSV via Blob, Print via a printable window).
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

export interface ReportSection {
  title: string;
  columns: string[];
  rows: Record<string, any>[];
}

export interface ReportDocument {
  title: string;
  generatedAt: string;
  sections: ReportSection[];
}

const sanitize = (v: any): string =>
  v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);

const sectionBody = (s: ReportSection) =>
  s.rows.map(r => s.columns.map(c => sanitize(r[c])));

export function exportReportToPDF(doc: ReportDocument, filename: string): void {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt' });
  const width = pdf.internal.pageSize.getWidth();
  pdf.setFontSize(16);
  pdf.text(doc.title, 40, 40);
  pdf.setFontSize(9);
  pdf.setTextColor(120);
  pdf.text(`Generated: ${doc.generatedAt}`, 40, 56);
  pdf.setTextColor(0);
  let y = 70;
  doc.sections.forEach((s, i) => {
    if (i > 0) y = ((pdf as any).lastAutoTable?.finalY ?? y) + 18;
    pdf.setFontSize(11);
    pdf.text(s.title, 40, y);
    autoTable(pdf, {
      head: [s.columns],
      body: sectionBody(s),
      startY: y + 8,
      margin: { left: 40, right: 40 },
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [79, 70, 229] },
      tableWidth: width - 80,
    });
  });
  pdf.save(filename.replace(/\.\w+$/, '') + '.pdf');
}

export function exportReportToExcel(doc: ReportDocument, filename: string): void {
  const wb = XLSX.utils.book_new();
  const aoa: any[][] = [[doc.title], [`Generated: ${doc.generatedAt}`], []];
  doc.sections.forEach(s => {
    aoa.push([s.title], s.columns, ...sectionBody(s), []);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const colCount = Math.max(...doc.sections.map(s => s.columns.length), 1);
  ws['!cols'] = Array.from({ length: colCount }, (_, i) => {
    const longest = Math.max(
      12,
      ...doc.sections.flatMap(s => [
        (s.columns[i] ?? '').length,
        ...s.rows.map(r => sanitize(r[s.columns[i]] ?? '').length),
      ])
    );
    return { wch: Math.min(60, longest + 2) };
  });
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  XLSX.writeFile(wb, filename.replace(/\.\w+$/, '') + '.xlsx');
}

export function exportReportToCSV(doc: ReportDocument, filename: string): void {
  const lines: string[] = [];
  lines.push(doc.title);
  lines.push(`Generated: ${doc.generatedAt}`);
  lines.push('');
  for (const section of doc.sections) {
    lines.push(section.title);
    lines.push(section.columns.join(','));
    for (const row of section.rows) {
      lines.push(section.columns.map(c => `"${sanitize(row[c]).replace(/"/g, '""')}"`).join(','));
    }
    lines.push('');
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Opens a printable window with the rendered report and triggers print. */
export function printReport(doc: ReportDocument): void {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return;
  const sections = doc.sections.map(s => `
    <h2>${s.title}</h2>
    <table>
      <thead><tr>${s.columns.map(c => `<th>${c}</th>`).join('')}</tr></thead>
      <tbody>${s.rows.map(r => `<tr>${s.columns.map(c => `<td>${sanitize(r[c])}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`).join('');
  win.document.write(`<!doctype html><html><head><title>${doc.title}</title><style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 32px; color: #0f172a; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    .gen { font-size: 12px; color: #64748b; margin-bottom: 24px; }
    h2 { font-size: 14px; margin: 24px 0 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
    th { background: #eef2ff; }
    @media print { body { margin: 0; } }
  </style></head><body>
    <h1>${doc.title}</h1>
    <div class="gen">Generated: ${doc.generatedAt}</div>
    ${sections}
  </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 300);
}

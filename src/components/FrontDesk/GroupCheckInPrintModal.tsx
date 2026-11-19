/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Stub — GroupCheckInPrintModal. The original file was lost when the FrontDesk
 * folder was reorganized into FrontOffice. This stub allows the build to
 * pass. Replace with the actual print modal implementation if needed.
 */

export default function GroupCheckInPrintModal({ data, onClose }: { data: any; onClose: () => void }) {
  if (!data) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 print:block print:bg-white">
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md print:shadow-none print:rounded-none">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 print:text-black">Group Check-In</h2>
        <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300 print:text-black">
          <p><strong>Group:</strong> {data?.groupName || '—'}</p>
          <p><strong>Contact:</strong> {data?.contactName || '—'}</p>
          <p><strong>Email:</strong> {data?.contactEmail || '—'}</p>
          <p><strong>Phone:</strong> {data?.contactPhone || '—'}</p>
          <p><strong>Group ID:</strong> {data?.groupId || '—'}</p>
          <p><strong>Rooms:</strong> {data?.roomCount || '—'}</p>
          <p><strong>Check-In Date:</strong> {data?.checkInDate || '—'}</p>
        </div>
        <div className="flex justify-end gap-2 mt-6 print:hidden">
          <button onClick={() => window.print()} className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700">Print</button>
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700">Close</button>
        </div>
      </div>
    </div>
  );
}

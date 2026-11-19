/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Stub — RecurringSeriesTab. The original file was lost when the FrontDesk
 * folder was reorganized into FrontOffice. This stub allows the build to
 * pass. Replace with the actual implementation if needed.
 */

import { Users } from 'lucide-react';

export default function RecurringSeriesTab({
  roomTypes = [],
  currentPropertyId = null,
  onRefresh = () => {},
}: {
  roomTypes?: any[];
  currentPropertyId?: string | null;
  onRefresh?: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 border border-gray-200 dark:border-slate-700 text-center">
        <Users className="w-10 h-10 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Recurring Series management is not yet available in this build.
        </p>
      </div>
    </div>
  );
}

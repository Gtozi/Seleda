/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 *
 * F&B Integrations — F&B Portal.
 * Lists all 19 portal integrations from the spec (§31 Portal Integrations).
 */

import { useState } from 'react';
import {
  Link2,
  Building2,
  Users,
  Globe,
  ConciergeBell,
  PartyPopper,
  Server,
  Database,
  ShoppingCart,
  Wallet,
  UserCheck,
  Tag,
  TrendingUp,
  BedDouble,
  Wrench,
  Shield,
  Car,
  ClipboardList,
  BarChart3,
  Settings,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';

interface Integration {
  id: string;
  portal: string;
  integration: string;
  icon: typeof Building2;
  status: 'Connected' | 'Pending' | 'Error' | 'Not Configured';
  lastSync: string;
}

const INTEGRATIONS: Integration[] = [
  { id: 'pms', portal: 'Front Office / PMS', integration: 'Room Charges, Guest Profiles, In-House Guests', icon: Building2, status: 'Connected', lastSync: '5 min ago' },
  { id: 'guest-portal', portal: 'Guest Portal', integration: 'Room Service, Restaurant Reservations, Dining Orders', icon: Users, status: 'Connected', lastSync: 'Real-time' },
  { id: 'public-booking', portal: 'Public Booking Portal', integration: 'Restaurant Reservations, F&B Packages, Offers', icon: Globe, status: 'Connected', lastSync: '10 min ago' },
  { id: 'concierge', portal: 'Concierge', integration: 'Restaurant Reservations, Dining Recommendations', icon: ConciergeBell, status: 'Connected', lastSync: '15 min ago' },
  { id: 'banquet', portal: 'Banquet & Events', integration: 'BEO, Event Menus, Catering Requirements', icon: PartyPopper, status: 'Connected', lastSync: '12 min ago' },
  { id: 'kds', portal: 'Kitchen / KDS', integration: 'Production Orders, Station Routing, Preparation Status', icon: Server, status: 'Connected', lastSync: '1 min ago' },
  { id: 'inventory', portal: 'Inventory', integration: 'Consumption, Waste, Stock Availability, Variance', icon: Database, status: 'Connected', lastSync: 'Real-time' },
  { id: 'procurement', portal: 'Procurement', integration: 'Purchase Requisitions, Supplier Requirements', icon: ShoppingCart, status: 'Connected', lastSync: '10 min ago' },
  { id: 'finance', portal: 'Finance & Accounting', integration: 'Revenue, Tax, Payments, Cost Accounting', icon: Wallet, status: 'Connected', lastSync: 'Real-time' },
  { id: 'hr', portal: 'HR & Payroll', integration: 'Staff, Scheduling, Labor Cost', icon: UserCheck, status: 'Connected', lastSync: '30 min ago' },
  { id: 'crm', portal: 'Sales, Marketing & CRM', integration: 'Promotions, Corporate Accounts, Loyalty', icon: Tag, status: 'Connected', lastSync: '15 min ago' },
  { id: 'revenue', portal: 'Revenue Management', integration: 'Packages, Pricing, Demand', icon: TrendingUp, status: 'Pending', lastSync: '—' },
  { id: 'housekeeping', portal: 'Housekeeping', integration: 'Linen, Cleaning, Outlet Readiness', icon: BedDouble, status: 'Connected', lastSync: '20 min ago' },
  { id: 'engineering', portal: 'Engineering', integration: 'Kitchen Equipment, Repairs, Preventive Maintenance', icon: Wrench, status: 'Connected', lastSync: '1 h ago' },
  { id: 'security', portal: 'Security & Risk', integration: 'Food Safety, Incidents, Compliance', icon: Shield, status: 'Connected', lastSync: '25 min ago' },
  { id: 'transportation', portal: 'Transportation', integration: 'Event / Group Dining Transportation', icon: Car, status: 'Not Configured', lastSync: '—' },
  { id: 'hotel-ops', portal: 'Hotel Operations', integration: 'Operational Issues, Escalations, Approvals', icon: ClipboardList, status: 'Connected', lastSync: '18 min ago' },
  { id: 'bi', portal: 'Executive & BI', integration: 'F&B KPIs, Profitability, Analytics', icon: BarChart3, status: 'Connected', lastSync: '30 min ago' },
  { id: 'admin', portal: 'System Administration', integration: 'Users, Roles, Configuration, Workflow, Audit', icon: Settings, status: 'Connected', lastSync: '1 h ago' },
];

const STATUS_TONE: Record<Integration['status'], 'success' | 'warning' | 'danger' | 'neutral'> = {
  Connected: 'success',
  Pending: 'warning',
  Error: 'danger',
  'Not Configured': 'neutral',
};

export default function Integrations() {
  const { addNotification } = useERP();
  const [search, setSearch] = useState('');

  const connected = INTEGRATIONS.filter(i => i.status === 'Connected').length;
  const pending = INTEGRATIONS.filter(i => i.status === 'Pending').length;
  const notConfigured = INTEGRATIONS.filter(i => i.status === 'Not Configured').length;

  const filtered = INTEGRATIONS.filter(i =>
    i.portal.toLowerCase().includes(search.toLowerCase()) ||
    i.integration.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className={['accent-fb', layout.sectionStack].join(' ')}>
      <PageHeader
        title="Portal Integrations"
        subtitle="F&B Portal integrations with all hotel operational and enterprise systems"
        icon={Link2}
        actions={
          <>
            <button onClick={() => addNotification('Integration sync queued', 'info', 'F&B')} className={button.secondary}>
              <RefreshCw className="w-4 h-4" /> Sync All
            </button>
            <button onClick={() => addNotification('Integration settings opened', 'info', 'F&B')} className={button.primary}>
              <Settings className="w-4 h-4" /> Configure
            </button>
          </>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Connected" value={connected} icon={CheckCircle2} tone="success" caption={`of ${INTEGRATIONS.length}`} />
        <StatCard title="Pending" value={pending} icon={RefreshCw} tone="warning" />
        <StatCard title="Not Configured" value={notConfigured} icon={AlertTriangle} tone="neutral" />
        <StatCard title="Data Flow" value="2.4K/h" icon={Link2} tone="info" />
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search integrations..."
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
        />
      </div>

      <SectionCard title="All Portal Integrations" icon={Link2} tone="accent">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-6 py-3 font-medium">Portal</th>
                <th className="px-6 py-3 font-medium">Integration Scope</th>
                <th className="px-6 py-3 font-medium">Last Sync</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
              {filtered.map(i => (
                <tr key={i.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                  <td className="px-6 py-3 font-medium text-gray-900 dark:text-white flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]">
                      <i.icon className="w-4 h-4" />
                    </div>
                    {i.portal}
                  </td>
                  <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{i.integration}</td>
                  <td className="px-6 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">{i.lastSync}</td>
                  <td className="px-6 py-3"><Badge tone={STATUS_TONE[i.status]}>{i.status}</Badge></td>
                  <td className="px-6 py-3 text-right">
                    <button onClick={() => addNotification(`Sync ${i.portal}`, i.status === 'Not Configured' ? 'warning' : 'success', 'F&B')} className={button.ghost}>
                      {i.status === 'Not Configured' ? 'Configure' : 'Sync'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div className="bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-900/20 dark:to-blue-900/20 rounded-xl p-6 border border-indigo-200 dark:border-indigo-800">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
          <Link2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          Integration Principle
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          F&B manages what is sold and how the business operates. Other portals consume F&B master data through these integrations and feed back transactional data (POS sales, KDS production, Inventory consumption, etc.) without duplicating business objects.
        </p>
      </div>
    </div>
  );
}

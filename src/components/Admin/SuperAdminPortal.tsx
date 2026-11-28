/**
 * Super Admin Portal
 * Dedicated portal for super-admins to manage tenants and users across the platform
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Users, Settings, BarChart3, Shield, LogOut, ChevronRight, ChevronDown, Plus, Edit, Trash2, X, Save, Loader2, Download, Upload, Database, UserMinus, UserPlus, Unlock, Globe, RotateCcw, KeyRound } from 'lucide-react';
import { User } from '../../types/erp';
import { BASE_DOMAIN, getApiBaseUrl } from '../../lib/subdomain';
import { DEPARTMENTS } from '../../config/departments';
import { getTabsForDepartment } from '../../config/departmentTabs';
import { CORE_ADMIN_MODULES } from './adminModules';
import { PUBLIC_PORTAL_MODULES, GUEST_PORTAL_MODULES } from '../../config/portalModules';
import PasswordResetRequests from './PasswordResetRequests';

const ROLE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'admin', label: 'Admin (full access)' },
  { value: 'executive', label: 'Executive' },
  { value: 'general_manager', label: 'General Manager' },
  { value: 'frontoffice', label: 'Front Office' },
  { value: 'front office manager', label: 'Front Office Manager' },
  { value: 'housekeeping', label: 'Housekeeping' },
  { value: 'fb_manager', label: 'F&B Manager' },
  { value: 'engineering', label: 'Engineering' },
  { value: 'finance', label: 'Finance' },
  { value: 'hr', label: 'HR' },
  { value: 'staff', label: 'Staff' },
];

const USER_STATUS_OPTIONS = ['Active', 'Pending', 'Inactive', 'Suspended', 'Locked'] as const;

const statusBadgeCls = (status: string) => {
  switch (status) {
    case 'Active':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'Locked':
    case 'Suspended':
      return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400';
    case 'Pending':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300';
  }
};

interface Tenant {
  id: string;
  name: string;
  code: string;
  status: string;
  created_at: string;
  legal_name?: string;
  email?: string;
  phone?: string;
  settings?: {
    logoUrl?: string;
    [key: string]: any;
  };
}

/** Shared logo uploader/URL input with live preview for SuperAdmin forms. */
const LogoUploadField: React.FC<{
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
}> = ({ label, hint, value, onChange }) => {
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      const img = new Image();
      img.onload = () => {
        const maxDim = 512;
        const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          onChange(canvas.toDataURL('image/png'));
        } else {
          onChange(dataUrl);
        }
      };
      img.onerror = () => onChange(dataUrl);
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 flex items-center justify-center overflow-hidden shrink-0">
          {value ? (
            <img src={value} alt="Logo preview" className="w-full h-full object-contain p-1" />
          ) : (
            <Building2 size={20} className="text-slate-400" />
          )}
        </div>
        <div className="flex-1 space-y-1.5 min-w-0">
          <div className="flex items-center gap-2">
            <label className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg text-xs font-medium cursor-pointer hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors inline-flex items-center gap-1.5">
              <Upload size={13} /> Upload Image
              <input type="file" accept="image/*" onChange={handleFile} className="hidden" />
            </label>
            {value && (
              <button
                type="button"
                onClick={() => onChange('')}
                className="px-2.5 py-1.5 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors"
              >
                Remove
              </button>
            )}
          </div>
          <input
            type="text"
            value={value.startsWith('data:') ? '' : value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={value.startsWith('data:') ? 'Uploaded image (paste URL to replace)' : 'https://... or upload an image'}
            className="w-full px-3 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
          />
        </div>
      </div>
      {hint && <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
};

interface TenantUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  isDefault: boolean;
  isSuperAdmin: boolean;
}

interface PlatformStats {
  totalTenants: number;
  activeTenants: number;
  totalUsers: number;
  totalProperties: number;
}

interface PlatformHealth {
  status: string;
  authStore?: string;
}

interface AdminPortalProps {
  currentUser: User;
  onLogout: () => void;
}

const isLocalHost = () =>
  typeof window !== 'undefined' &&
  (window.location.hostname.includes('localhost') || window.location.hostname.includes('127.0.0.1'));

const tenantUrl = (code: string) =>
  isLocalHost()
    ? `${window.location.origin}/?subdomain=${encodeURIComponent(code)}`
    : `https://${code}.${BASE_DOMAIN}`;

export const SuperAdminPortal: React.FC<AdminPortalProps> = ({ currentUser, onLogout }) => {
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [health, setHealth] = useState<PlatformHealth | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'tenants' | 'users' | 'portal' | 'settings' | 'password_resets'>('overview');

  // Redirect non-super-admins
  useEffect(() => {
    if (!currentUser?.isSuperAdmin) {
      navigate('/erp');
      return;
    }
  }, [currentUser, navigate]);

  // Fetch tenants, platform stats, and health check in parallel
  const fetchTenants = useCallback(async () => {
    setLoadError(null);
    const apiBase = getApiBaseUrl();
    try {
      const [tenantsRes, statsRes, healthRes] = await Promise.all([
        fetch(`${apiBase}/api/admin/tenants`, { credentials: 'include' }),
        fetch(`${apiBase}/api/admin/stats`, { credentials: 'include' }),
        fetch(`${apiBase}/api/health`, { credentials: 'include' }),
      ]);

      if (tenantsRes.ok) {
        const data = await tenantsRes.json();
        setTenants(data.tenants || []);
      } else {
        const err = await tenantsRes.json().catch(() => ({}));
        setLoadError(err.error || `Failed to load tenants (${tenantsRes.status})`);
      }

      if (statsRes.ok) {
        const data = await statsRes.json();
        if (data.stats) setStats(data.stats);
      }

      if (healthRes.ok) {
        const data = await healthRes.json();
        setHealth({ status: data.status || 'operational', authStore: data.authStore });
      } else {
        setHealth({ status: 'degraded' });
      }
    } catch (error) {
      console.error('Failed to fetch platform data:', error);
      setLoadError('Failed to connect to admin API');
      setHealth({ status: 'unreachable' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);

  if (!currentUser?.isSuperAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white font-extrabold">
              SA
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">Super Admin Portal</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">Platform Management</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-600 dark:text-slate-300">
              {currentUser.name}
            </span>
            <button
              onClick={onLogout}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-300 transition-colors"
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 overflow-x-auto">
        <div className="flex gap-6">
          {[
            { id: 'overview', label: 'Overview', icon: BarChart3 },
            { id: 'tenants', label: 'Tenants', icon: Building2 },
            { id: 'users', label: 'Users', icon: Users },
            { id: 'portal', label: 'Portal Management', icon: Shield },
            { id: 'settings', label: 'Settings', icon: Settings },
            { id: 'password_resets', label: 'Password Resets', icon: KeyRound },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="p-6">
        {loadError && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-sm text-rose-700 dark:text-rose-300">
            {loadError}
          </div>
        )}
        {activeTab === 'overview' && <OverviewTab tenants={tenants} stats={stats} health={health} loading={loading} />}
        {activeTab === 'tenants' && <TenantsTab tenants={tenants} loading={loading} onRefresh={fetchTenants} />}
        {activeTab === 'users' && <UsersTab tenants={tenants} onUsersChanged={fetchTenants} />}
        {activeTab === 'portal' && <PortalManagementTab tenants={tenants} />}
        {activeTab === 'settings' && <SettingsTab />}
        {activeTab === 'password_resets' && <PasswordResetRequests apiPath="/api/admin/platform-password-reset-requests" />}
      </main>
    </div>
  );
};

// Overview Tab
const OverviewTab: React.FC<{ tenants: Tenant[]; stats: PlatformStats | null; health: PlatformHealth | null; loading: boolean }> = ({ tenants, stats, health, loading }) => {
  const activeTenants = stats?.activeTenants ?? tenants.filter(t => t.status === 'Active').length;
  const totalTenants = stats?.totalTenants ?? tenants.length;
  const isHealthy = health?.status === 'operational';
  const healthLabel = loading
    ? '…'
    : !health
      ? 'Unknown'
      : isHealthy
        ? 'Operational'
        : health.status === 'degraded'
          ? 'Degraded'
          : 'Unreachable';

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Platform Overview</h2>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">Total Tenants</p>
              <p className="text-3xl font-bold text-slate-900 dark:text-white">{loading ? '…' : totalTenants}</p>
              {stats && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {stats.totalProperties} {stats.totalProperties === 1 ? 'property' : 'properties'}
                </p>
              )}
            </div>
            <Building2 className="text-indigo-600" size={32} />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">Active Tenants</p>
              <p className="text-3xl font-bold text-emerald-600">{loading ? '…' : activeTenants}</p>
            </div>
            <Shield className="text-emerald-600" size={32} />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">Total Users</p>
              <p className="text-3xl font-bold text-slate-900 dark:text-white">{loading ? '…' : (stats?.totalUsers ?? '—')}</p>
            </div>
            <Users className="text-blue-600" size={32} />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">System Health</p>
              <p className={`text-3xl font-bold ${isHealthy ? 'text-emerald-600' : loading ? 'text-slate-400' : 'text-amber-600'}`}>
                {healthLabel}
              </p>
              {health?.authStore && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Auth: {health.authStore}</p>
              )}
            </div>
            <BarChart3 className={isHealthy ? 'text-emerald-600' : 'text-amber-600'} size={32} />
          </div>
        </div>
      </div>

      {/* Recent Tenants */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="font-semibold text-slate-900 dark:text-white">Recent Tenants</h3>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-700">
          {loading ? (
            <div className="p-6 text-center text-slate-500">Loading...</div>
          ) : tenants.slice(0, 5).map((tenant) => (
            <div key={tenant.id} className="px-6 py-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-900 dark:text-white">{tenant.name}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">{tenant.code}</p>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                tenant.status === 'Active' 
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
              }`}>
                {tenant.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// Tenants Tab
const TenantsTab: React.FC<{ tenants: Tenant[]; loading: boolean; onRefresh: () => void }> = ({ tenants, loading, onRefresh }) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showUsersModal, setShowUsersModal] = useState(false);
  const [showDataModal, setShowDataModal] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleEdit = (tenant: Tenant) => {
    setSelectedTenant(tenant);
    setShowEditModal(true);
  };

  const handleDelete = (tenant: Tenant) => {
    setSelectedTenant(tenant);
    setShowDeleteModal(true);
  };

  const fetchTenantUsers = async (tenant: Tenant) => {
    setLoadingUsers(true);
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/admin/tenants/${tenant.id}/users`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setTenantUsers(data.users || []);
      }
    } catch (error) {
      console.error('Failed to fetch tenant users:', error);
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleManageUsers = async (tenant: Tenant) => {
    setSelectedTenant(tenant);
    setShowUsersModal(true);
    await fetchTenantUsers(tenant);
  };

  const handleManageData = (tenant: Tenant) => {
    setSelectedTenant(tenant);
    setShowDataModal(true);
  };

  const confirmDelete = async () => {
    if (!selectedTenant) return;
    setDeleting(true);
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/admin/tenants/${selectedTenant.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        setShowDeleteModal(false);
        setSelectedTenant(null);
        onRefresh();
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to delete tenant');
      }
    } catch (error) {
      console.error('Failed to delete tenant:', error);
      alert('Failed to delete tenant');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Tenant Management</h2>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2"
        >
          <Plus size={16} />
          Create Tenant
        </button>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Tenant
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Code
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Created
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                  Loading tenants...
                </td>
              </tr>
            ) : tenants.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                  No tenants found
                </td>
              </tr>
            ) : (
              tenants.map((tenant) => (
                <tr key={tenant.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      {tenant.settings?.logoUrl ? (
                        <img
                          src={tenant.settings.logoUrl}
                          alt={tenant.name}
                          className="w-10 h-10 rounded-lg object-contain bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-0.5 shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center shrink-0">
                          <Building2 className="text-indigo-600" size={20} />
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-slate-900 dark:text-white">{tenant.name}</p>
                        {tenant.legal_name && (
                          <p className="text-xs text-slate-500 dark:text-slate-400">{tenant.legal_name}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300 font-mono whitespace-nowrap">
                    <div>{tenant.code}</div>
                    <a
                      href={tenantUrl(tenant.code)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                      title="Open tenant portal"
                    >
                      {tenant.code}.{BASE_DOMAIN}
                    </a>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      tenant.status === 'Active' 
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                    }`}>
                      {tenant.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300 whitespace-nowrap">
                    {new Date(tenant.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleManageData(tenant)}
                        className="p-2 text-slate-600 hover:text-emerald-600 dark:text-slate-300 dark:hover:text-emerald-400 transition-colors"
                        title="Export/Import Data"
                      >
                        <Database size={16} />
                      </button>
                      <button
                        onClick={() => handleManageUsers(tenant)}
                        className="p-2 text-slate-600 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400 transition-colors"
                        title="Manage Users"
                      >
                        <Users size={16} />
                      </button>
                      <button
                        onClick={() => handleEdit(tenant)}
                        className="p-2 text-slate-600 hover:text-blue-600 dark:text-slate-300 dark:hover:text-blue-400 transition-colors"
                        title="Edit Tenant"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(tenant)}
                        className="p-2 text-slate-600 hover:text-red-600 dark:text-slate-300 dark:hover:text-red-400 transition-colors"
                        title="Delete Tenant"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showCreateModal && <CreateTenantModal onClose={() => setShowCreateModal(false)} onSuccess={onRefresh} />}
      {showEditModal && selectedTenant && <EditTenantModal tenant={selectedTenant} onClose={() => setShowEditModal(false)} onSuccess={onRefresh} />}
      {showDeleteModal && selectedTenant && (
        <DeleteTenantModal
          tenant={selectedTenant}
          onClose={() => setShowDeleteModal(false)}
          onConfirm={confirmDelete}
          deleting={deleting}
        />
      )}
      {showUsersModal && selectedTenant && (
        <TenantUsersModal
          tenant={selectedTenant}
          users={tenantUsers}
          loading={loadingUsers}
          onClose={() => setShowUsersModal(false)}
          onRefresh={() => {
            fetchTenantUsers(selectedTenant);
            onRefresh();
          }}
        />
      )}
      {showDataModal && selectedTenant && (
        <TenantDataModal
          tenant={selectedTenant}
          onClose={() => setShowDataModal(false)}
          onRefresh={onRefresh}
        />
      )}
    </div>
  );
};

// Create Tenant Modal
const CreateTenantModal: React.FC<{ onClose: () => void; onSuccess: () => void }> = ({ onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    legalName: '',
    email: '',
    phone: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${getApiBaseUrl()}/api/admin/tenants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        onClose();
        onSuccess();
      } else {
        const data = await response.json().catch(() => ({}));
        setError(data.error || 'Failed to create tenant');
      }
    } catch (error) {
      console.error('Failed to create tenant:', error);
      setError('Failed to create tenant');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-md w-full">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Create New Tenant</h3>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Tenant Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Tenant Code *
            </label>
            <input
              type="text"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white font-mono"
              required
              placeholder="e.g., hotel-chain-1"
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Becomes the tenant portal at https://{formData.code || 'tenant'}.{BASE_DOMAIN}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Legal Name
            </label>
            <input
              type="text"
              value={formData.legalName}
              onChange={(e) => setFormData({ ...formData, legalName: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Email
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Phone
            </label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
            />
          </div>

          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Tenant'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Edit Tenant Modal
const EditTenantModal: React.FC<{ tenant: Tenant; onClose: () => void; onSuccess: () => void }> = ({ tenant, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    name: tenant.name,
    legalName: tenant.legal_name || '',
    email: tenant.email || '',
    phone: tenant.phone || '',
    status: tenant.status,
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch(`${getApiBaseUrl()}/api/admin/tenants/${tenant.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        onClose();
        onSuccess();
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to update tenant');
      }
    } catch (error) {
      console.error('Failed to update tenant:', error);
      alert('Failed to update tenant');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-md w-full">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Edit Tenant</h3>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Tenant Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Legal Name
            </label>
            <input
              type="text"
              value={formData.legalName}
              onChange={(e) => setFormData({ ...formData, legalName: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Email
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Phone
            </label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Status
            </label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
            >
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
              <option value="Suspended">Suspended</option>
            </select>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              {loading ? 'Updating...' : 'Update Tenant'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Delete Tenant Modal
const DeleteTenantModal: React.FC<{ tenant: Tenant; onClose: () => void; onConfirm: () => void; deleting: boolean }> = ({ tenant, onClose, onConfirm, deleting }) => {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-md w-full">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Delete Tenant</h3>
        </div>

        <div className="p-6">
          <p className="text-slate-600 dark:text-slate-300 mb-4">
            Are you sure you want to delete the tenant <strong>{tenant.name}</strong>?
          </p>
          <p className="text-sm text-red-600 dark:text-red-400 mb-4">
            This action cannot be undone. The tenant will be permanently deleted if it has no users or properties.
          </p>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={deleting}
              className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {deleting ? 'Deleting...' : 'Delete Tenant'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Tenant Users Modal — create or assign tenant admin/staff accounts and manage access
const TenantUsersModal: React.FC<{ tenant: Tenant; users: TenantUser[]; loading: boolean; onClose: () => void; onRefresh: () => void }> = ({ tenant, users, loading, onClose, onRefresh }) => {
  const [showCreate, setShowCreate] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [loadingAllUsers, setLoadingAllUsers] = useState(false);
  const [assignForm, setAssignForm] = useState({ userId: '', isDefault: true, isSuperAdmin: false });
  const [assigning, setAssigning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; password?: string } | null>(null);
  const [form, setForm] = useState({ name: '', email: '', username: '', password: '', role: 'admin', isSuperAdmin: false });
  const [error, setError] = useState('');

  const apiBase = getApiBaseUrl();

  const openAssignForm = async () => {
    const next = !showAssign;
    setShowAssign(next);
    setShowCreate(false);
    setError('');
    if (!next) return;

    setLoadingAllUsers(true);
    try {
      const response = await fetch(`${apiBase}/api/admin/users/all`, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setAllUsers(data.users || []);
      }
    } catch {
      setError('Failed to load existing users');
    } finally {
      setLoadingAllUsers(false);
    }
  };

  const assignedIds = new Set(users.map(u => u.id));
  const assignableUsers = allUsers.filter(u => !assignedIds.has(u.id));

  const handleAssignExisting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignForm.userId) return;
    setAssigning(true);
    setError('');
    try {
      const response = await fetch(`${apiBase}/api/admin/tenants/${tenant.id}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(assignForm),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Failed to assign user');
        return;
      }
      setAssignForm({ userId: '', isDefault: true, isSuperAdmin: false });
      setShowAssign(false);
      onRefresh();
    } catch {
      setError('Failed to assign user');
    } finally {
      setAssigning(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      const response = await fetch(`${apiBase}/api/admin/tenants/${tenant.id}/users/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          username: form.username || undefined,
          password: form.password || undefined,
          role: form.role,
          isSuperAdmin: form.isSuperAdmin,
          isDefault: users.length === 0,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Failed to create user');
        return;
      }
      setCreatedCredentials({ email: data.user?.email || form.email, password: data.temporaryPassword });
      setForm({ name: '', email: '', username: '', password: '', role: 'admin', isSuperAdmin: false });
      setShowCreate(false);
      onRefresh();
    } catch {
      setError('Failed to create user');
    } finally {
      setCreating(false);
    }
  };

  const handleActivateUser = async (userId: string) => {
    setBusyUserId(userId);
    try {
      const response = await fetch(`${apiBase}/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'Active' }),
      });
      if (response.ok) onRefresh();
      else alert((await response.json()).error || 'Failed to activate user');
    } catch {
      alert('Failed to activate user');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleRemove = async (userId: string) => {
    if (!confirm('Remove this user\'s access to the tenant? Their account is not deleted.')) return;
    setBusyUserId(userId);
    try {
      const response = await fetch(`${apiBase}/api/admin/tenants/${tenant.id}/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (response.ok) onRefresh();
      else alert((await response.json()).error || 'Failed to remove user');
    } catch {
      alert('Failed to remove user');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleDeleteUser = async (userId: string, userName: string) => {
    if (!confirm(`Permanently delete user "${userName}"? This will remove their account from all tenants and cannot be undone.`)) return;
    setBusyUserId(userId);
    try {
      const response = await fetch(`${apiBase}/api/admin/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (response.ok) onRefresh();
      else alert((await response.json()).error || 'Failed to delete user');
    } catch {
      alert('Failed to delete user');
    } finally {
      setBusyUserId(null);
    }
  };

  const inputCls = 'w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
            Users - {tenant.name}
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {createdCredentials && (
            <div className="mb-4 p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg">
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">User created — share these credentials once:</p>
              <p className="text-sm text-emerald-700 dark:text-emerald-400 mt-1">Email: {createdCredentials.email}</p>
              {createdCredentials.password && (
                <p className="text-sm text-emerald-700 dark:text-emerald-400">Temporary password: <code className="font-mono bg-emerald-100 dark:bg-emerald-900/40 px-1 rounded">{createdCredentials.password}</code></p>
              )}
              <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-1">They will be required to set a new password on first login at https://{tenant.code}.{BASE_DOMAIN}</p>
              <button onClick={() => setCreatedCredentials(null)} className="mt-2 text-xs text-emerald-700 dark:text-emerald-400 underline">Dismiss</button>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Assigned Users</h4>
            <div className="flex items-center gap-2">
              <button
                onClick={openAssignForm}
                className="px-3 py-1.5 border border-indigo-600 text-indigo-600 dark:text-indigo-400 text-sm rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors flex items-center gap-1"
              >
                <UserPlus size={14} /> Assign Existing
              </button>
              <button
                onClick={() => { setShowCreate(!showCreate); setShowAssign(false); setError(''); }}
                className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-1"
              >
                <Plus size={14} /> Add User
              </button>
            </div>
          </div>

          {showAssign && (
            <form onSubmit={handleAssignExisting} className="mb-6 p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900/40 space-y-3">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Assign existing user to {tenant.name}</p>
              {loadingAllUsers ? (
                <p className="text-xs text-slate-500">Loading users...</p>
              ) : assignableUsers.length === 0 ? (
                <p className="text-xs text-slate-500">All existing users are already assigned to this tenant.</p>
              ) : (
                <>
                  <select
                    required
                    value={assignForm.userId}
                    onChange={e => setAssignForm({ ...assignForm, userId: e.target.value })}
                    className={inputCls}
                  >
                    <option value="">-- Select a user --</option>
                    {assignableUsers.map((u: any) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.email}){!u.hasTenant ? ' — Orphaned' : ''}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-4 flex-wrap">
                    <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                      <input type="checkbox" checked={assignForm.isDefault} onChange={e => setAssignForm({ ...assignForm, isDefault: e.target.checked })} className="rounded" />
                      Set as default tenant
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                      <input type="checkbox" checked={assignForm.isSuperAdmin} onChange={e => setAssignForm({ ...assignForm, isSuperAdmin: e.target.checked })} className="rounded" />
                      Super admin
                    </label>
                  </div>
                </>
              )}
              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={assigning || !assignForm.userId} className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
                  {assigning ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                  {assigning ? 'Assigning…' : 'Assign User'}
                </button>
                <button type="button" onClick={() => { setShowAssign(false); setError(''); }} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">
                  Cancel
                </button>
              </div>
            </form>
          )}

          {showCreate && (
            <form onSubmit={handleCreate} className="mb-6 p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900/40 space-y-3">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">New user for {tenant.name}</p>
              <div className="grid grid-cols-2 gap-3">
                <input required placeholder="Full name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inputCls} />
                <input required type="email" placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className={inputCls} />
                <input placeholder="Username (optional)" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} className={inputCls} />
                <input placeholder="Password (blank = generate)" type="text" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} className={inputCls} />
              </div>
              <div className="flex items-center gap-4">
                <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className={inputCls + ' w-auto'}>
                  {ROLE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                  <input type="checkbox" checked={form.isSuperAdmin} onChange={e => setForm({ ...form, isSuperAdmin: e.target.checked })} className="rounded" />
                  Super admin
                </label>
              </div>
              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={creating} className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
                  {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  {creating ? 'Creating…' : 'Create User'}
                </button>
                <button type="button" onClick={() => { setShowCreate(false); setError(''); }} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">
                  Cancel
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="text-center text-slate-500 py-8">Loading users...</div>
          ) : users.length === 0 ? (
            <div className="text-center text-slate-500 py-8">No users assigned to this tenant</div>
          ) : (
            <div className="space-y-3">
              {users.map((user) => (
                <div key={user.id} className="flex items-center justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                      <Users className="text-indigo-600" size={20} />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900 dark:text-white">{user.name}</p>
                      <p className="text-sm text-slate-500 dark:text-slate-400">{user.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {user.isSuperAdmin && (
                      <span className="px-2 py-1 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 text-xs rounded-full">
                        Super Admin
                      </span>
                    )}
                    {user.isDefault && (
                      <span className="px-2 py-1 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-xs rounded-full">
                        Default
                      </span>
                    )}
                    <span className={`px-2 py-1 text-xs rounded-full ${statusBadgeCls(user.status)}`}>
                      {user.status}
                    </span>
                    {user.status !== 'Active' && (
                      <button
                        onClick={() => handleActivateUser(user.id)}
                        disabled={busyUserId === user.id}
                        className="p-1.5 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 disabled:opacity-50"
                        title="Activate / Unlock user"
                      >
                        <Unlock size={16} />
                      </button>
                    )}
                    <button
                      onClick={() => handleRemove(user.id)}
                      disabled={busyUserId === user.id}
                      className="p-1.5 text-slate-400 hover:text-orange-600 dark:hover:text-orange-400 disabled:opacity-50"
                      title="Remove tenant access"
                    >
                      {busyUserId === user.id ? <Loader2 size={16} className="animate-spin" /> : <UserMinus size={16} />}
                    </button>
                    <button
                      onClick={() => handleDeleteUser(user.id, user.name)}
                      disabled={busyUserId === user.id}
                      className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
                      title="Delete user permanently"
                    >
                      {busyUserId === user.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Users Tab - Manage users across all tenants
const UsersTab: React.FC<{ tenants: Tenant[]; onUsersChanged?: () => void }> = ({ tenants, onUsersChanged }) => {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTenant, setSelectedTenant] = useState<string>('all');
  const [showOrphanedOnly, setShowOrphanedOnly] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<any | null>(null);
  const [editTarget, setEditTarget] = useState<any | null>(null);

  const apiBase = getApiBaseUrl();

  const fetchAllUsers = useCallback(async () => {
    try {
      const response = await fetch(`${apiBase}/api/admin/users/all`, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setUsers(data.users || []);
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchAllUsers();
  }, [fetchAllUsers]);

  const handleQuickUnlock = async (user: any) => {
    setBusyUserId(user.id);
    try {
      const response = await fetch(`${apiBase}/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'Active' }),
      });
      if (response.ok) {
        await fetchAllUsers();
      } else {
        alert((await response.json().catch(() => ({}))).error || 'Failed to unlock user');
      }
    } catch {
      alert('Failed to unlock user');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleUnassignTenant = async (userId: string, tenantId: string, tenantName: string) => {
    if (!confirm(`Remove user's access to "${tenantName}"?`)) return;
    setBusyUserId(userId);
    try {
      const response = await fetch(`${apiBase}/api/admin/tenants/${tenantId}/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (response.ok) {
        await fetchAllUsers();
      } else {
        alert((await response.json().catch(() => ({}))).error || 'Failed to remove tenant assignment');
      }
    } catch {
      alert('Failed to remove tenant assignment');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleDeleteUser = async (userId: string, userName: string) => {
    if (!confirm(`Permanently delete user "${userName}"? This will remove their account from all tenants and cannot be undone.`)) return;
    setBusyUserId(userId);
    try {
      const response = await fetch(`${apiBase}/api/admin/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (response.ok) {
        setUsers(prev => prev.filter(u => u.id !== userId));
        onUsersChanged?.();
      } else {
        alert((await response.json().catch(() => ({}))).error || 'Failed to delete user');
      }
    } catch {
      alert('Failed to delete user');
    } finally {
      setBusyUserId(null);
    }
  };

  const filteredUsers = users.filter(user => {
    if (showOrphanedOnly && user.hasTenant) return false;
    if (!showOrphanedOnly && selectedTenant !== 'all') {
      return user.tenants.some((t: any) => t.tenantId === selectedTenant);
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">User Management</h2>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <input
              type="checkbox"
              checked={showOrphanedOnly}
              onChange={(e) => setShowOrphanedOnly(e.target.checked)}
              className="rounded"
            />
            Show orphaned only
          </label>
          <select
            value={selectedTenant}
            onChange={(e) => setSelectedTenant(e.target.value)}
            disabled={showOrphanedOnly}
            className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white disabled:opacity-50"
          >
            <option value="all">All Tenants</option>
            {tenants.map(tenant => (
              <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                User
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Tenant
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Role
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Flags
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                  Loading users...
                </td>
              </tr>
            ) : filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                  No users found
                </td>
              </tr>
            ) : (
              filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center shrink-0">
                        <Users className="text-indigo-600" size={20} />
                      </div>
                      <div>
                        <p className="font-medium text-slate-900 dark:text-white">{user.name}</p>
                        <p className="text-sm text-slate-500 dark:text-slate-400">{user.email}</p>
                        {!user.hasTenant && (
                          <p className="text-xs text-orange-600 dark:text-orange-400">No tenant assigned</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">
                    {user.tenants.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {user.tenants.map((t: any) => (
                          <span key={t.tenantId} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 dark:bg-slate-700 rounded text-xs">
                            <span>{t.tenantName}</span>
                            <button
                              onClick={() => handleUnassignTenant(user.id, t.tenantId, t.tenantName)}
                              disabled={busyUserId === user.id}
                              className="text-slate-400 hover:text-rose-500 disabled:opacity-50"
                              title={`Remove from ${t.tenantName}`}
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300 whitespace-nowrap">
                    {user.role}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusBadgeCls(user.status)}`}>
                      {user.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex gap-1">
                      {user.tenants.some((t: any) => t.isSuperAdmin) && (
                        <span className="px-2 py-1 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 text-xs rounded-full">
                          SA
                        </span>
                      )}
                      {user.tenants.some((t: any) => t.isDefault) && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-xs rounded-full">
                          Def
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      {user.status !== 'Active' && (
                        <button
                          onClick={() => handleQuickUnlock(user)}
                          disabled={busyUserId === user.id}
                          className="p-1.5 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 disabled:opacity-50"
                          title="Activate / Unlock user"
                        >
                          <Unlock size={16} />
                        </button>
                      )}
                      <button
                        onClick={() => setAssignTarget(user)}
                        disabled={busyUserId === user.id}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-50"
                        title="Assign to tenant"
                      >
                        <UserPlus size={16} />
                      </button>
                      <button
                        onClick={() => setEditTarget(user)}
                        disabled={busyUserId === user.id}
                        className="p-1.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 disabled:opacity-50"
                        title="Edit role & status"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteUser(user.id, user.name)}
                        disabled={busyUserId === user.id}
                        className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
                        title="Delete user permanently"
                      >
                        {busyUserId === user.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {assignTarget && (
        <AssignTenantModal
          user={assignTarget}
          tenants={tenants}
          onClose={() => setAssignTarget(null)}
          onSuccess={() => { setAssignTarget(null); fetchAllUsers(); }}
        />
      )}

      {editTarget && (
        <EditUserModal
          user={editTarget}
          onClose={() => setEditTarget(null)}
          onSuccess={() => { setEditTarget(null); fetchAllUsers(); }}
        />
      )}
    </div>
  );
};

// Assign Tenant Modal (from Users Tab)
const AssignTenantModal: React.FC<{ user: any; tenants: Tenant[]; onClose: () => void; onSuccess: () => void }> = ({ user, tenants, onClose, onSuccess }) => {
  const activeTenants = tenants.filter(t => t.status === 'Active');
  const [tenantId, setTenantId] = useState(activeTenants[0]?.id || '');
  const [isDefault, setIsDefault] = useState(!user.hasTenant);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/admin/tenants/${tenantId}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId: user.id, isDefault, isSuperAdmin }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'Failed to assign tenant');
        return;
      }
      onSuccess();
    } catch {
      setError('Failed to assign tenant');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-md w-full">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Assign Tenant</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="text-sm text-slate-600 dark:text-slate-300">
            Assign <strong>{user.name}</strong> ({user.email}) to a tenant:
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Tenant *
            </label>
            <select
              required
              value={tenantId}
              onChange={e => setTenantId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
            >
              {activeTenants.length === 0 ? (
                <option value="">No active tenants</option>
              ) : (
                activeTenants.map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
                ))
              )}
            </select>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
              <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} className="rounded" />
              Set as default tenant
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
              <input type="checkbox" checked={isSuperAdmin} onChange={e => setIsSuperAdmin(e.target.checked)} className="rounded" />
              Grant super-admin privileges
            </label>
          </div>

          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !tenantId}
              className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              {saving ? 'Assigning...' : 'Assign Tenant'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Edit User Role & Status Modal (from Users Tab)
const EditUserModal: React.FC<{ user: any; onClose: () => void; onSuccess: () => void }> = ({ user, onClose, onSuccess }) => {
  const [role, setRole] = useState(user.role || 'staff');
  const [status, setStatus] = useState(user.status || 'Active');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const hasListedRole = ROLE_OPTIONS.some(r => r.value === role);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role, status }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'Failed to update user');
        return;
      }
      onSuccess();
    } catch {
      setError('Failed to update user');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-md w-full">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Edit User</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="text-sm text-slate-600 dark:text-slate-300">
            <strong>{user.name}</strong> ({user.email})
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Role
            </label>
            <select
              value={role}
              onChange={e => setRole(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
            >
              {!hasListedRole && <option value={role}>{role}</option>}
              {ROLE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Account Status
            </label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
            >
              {USER_STATUS_OPTIONS.map(st => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
            {user.status === 'Locked' && status === 'Active' && (
              <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                Setting status to Active will also clear failed login lockouts.
              </p>
            )}
          </div>

          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Portal Management Tab - Manage tenant portals and modules
const PortalManagementTab: React.FC<{ tenants: Tenant[] }> = ({ tenants }) => {
  const [selectedTenant, setSelectedTenant] = useState<string>('');
  const [moduleToggles, setModuleToggles] = useState<Record<string, boolean>>({});
  const [globalToggles, setGlobalToggles] = useState<Record<string, boolean>>({});
  const [portalEnabled, setPortalEnabled] = useState(true);
  const [customDomain, setCustomDomain] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedDepartments, setExpandedDepartments] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Get modules for a department
  const modulesForDepartment = (deptKey: string) => {
    if (deptKey === 'admin') {
      return CORE_ADMIN_MODULES.map(m => ({ tabId: m.id, modId: m.id, label: m.label }));
    }
    if (deptKey === 'public') {
      return PUBLIC_PORTAL_MODULES.map(m => ({ tabId: m.id, modId: `public_${m.id}`, label: m.label }));
    }
    if (deptKey === 'guest') {
      return GUEST_PORTAL_MODULES.map(m => ({ tabId: m.id, modId: `guest_${m.id}`, label: m.label }));
    }
    return getTabsForDepartment(deptKey).map(t => ({ tabId: t.id, modId: t.modId, label: t.label }));
  };

  // All manageable portals: ERP departments + public & guest portals
  const portalEntries = [
    ...DEPARTMENTS.map(d => ({ key: d.key, label: d.label, url: `/erp/${d.urlSegment}`, modules: modulesForDepartment(d.key), locked: ['admin', 'settings'].includes(d.key) })),
    { key: 'public', label: 'Public Portal', url: '/public-portal', modules: modulesForDepartment('public'), locked: false },
    { key: 'guest', label: 'Guest Portal', url: '/guest', modules: modulesForDepartment('guest'), locked: false },
  ];

  // Load module toggles and portal flags for selected tenant
  useEffect(() => {
    setNotice(null);
    if (!selectedTenant) {
      setModuleToggles({});
      setGlobalToggles({});
      setPortalEnabled(true);
      setCustomDomain('');
      setDirty(false);
      return;
    }

    let active = true;
    const loadModuleToggles = async () => {
      setLoading(true);
      try {
        const apiBase = getApiBaseUrl();
        const response = await fetch(`${apiBase}/api/admin/tenants/${selectedTenant}/module-toggles`, {
          credentials: 'include',
        });
        if (!active) return;
        if (response.ok) {
          const data = await response.json();
          setModuleToggles(data.moduleToggles || {});
          setGlobalToggles(data.globalToggles || {});
          setPortalEnabled(data.portalSettings?.enabled !== false);
          setCustomDomain(data.portalSettings?.customDomain || '');
          setDirty(false);
        } else {
          const err = await response.json().catch(() => ({}));
          setNotice({ type: 'error', message: err.error || 'Failed to load tenant portal configuration' });
        }
      } catch (error) {
        console.error('Failed to fetch module toggles:', error);
        if (active) setNotice({ type: 'error', message: 'Failed to load tenant portal configuration' });
      } finally {
        if (active) setLoading(false);
      }
    };

    loadModuleToggles();
    return () => { active = false; };
  }, [selectedTenant]);

  // Effective state: tenant override wins, otherwise fall back to the global toggle.
  const globalEnabled = (key: string) => globalToggles[key] !== false;
  const enabled = (key: string) =>
    moduleToggles[key] !== undefined ? moduleToggles[key] !== false : globalEnabled(key);

  // When the chosen value matches the global default, drop the override so the
  // tenant inherits future global changes instead of pinning a stale value.
  const setOverride = (key: string, next: boolean) => {
    setModuleToggles(prev => {
      const copy = { ...prev };
      if (next === globalEnabled(key)) delete copy[key];
      else copy[key] = next;
      return copy;
    });
    setDirty(true);
    setNotice(null);
  };

  const resetOverride = (key: string) => {
    setModuleToggles(prev => {
      if (prev[key] === undefined) return prev;
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
    setDirty(true);
    setNotice(null);
  };

  const togglePortal = (key: string) => setOverride(key, !enabled(key));

  const toggleModule = (deptKey: string, tabId: string) =>
    setOverride(`${deptKey}_${tabId}`, !enabled(`${deptKey}_${tabId}`));

  const toggleDepartment = (deptKey: string) => {
    setExpandedDepartments(prev => {
      const next = new Set(prev);
      if (next.has(deptKey)) next.delete(deptKey);
      else next.add(deptKey);
      return next;
    });
  };

  const saveModuleToggles = async () => {
    if (!selectedTenant) return;
    setSaving(true);
    setNotice(null);
    try {
      const apiBase = getApiBaseUrl();
      const response = await fetch(`${apiBase}/api/admin/tenants/${selectedTenant}/module-toggles`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          moduleToggles,
          portalSettings: {
            enabled: portalEnabled,
            customDomain: customDomain.trim() || null,
          },
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        if (data.portalSettings) {
          setPortalEnabled(data.portalSettings.enabled !== false);
          setCustomDomain(data.portalSettings.customDomain || '');
        }
        setDirty(false);
        setNotice({ type: 'success', message: 'Portal settings and module toggles saved successfully.' });
      } else {
        setNotice({ type: 'error', message: data.error || 'Failed to save module toggles' });
      }
    } catch (error) {
      console.error('Failed to save module toggles:', error);
      setNotice({ type: 'error', message: 'Failed to save module toggles' });
    } finally {
      setSaving(false);
    }
  };

  const selectedTenantData = tenants.find(t => t.id === selectedTenant);
  const publicBookingEffective = portalEnabled && enabled('public_booking');
  const guestPortalEffective = portalEnabled && enabled('guest');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Portal & Module Management</h2>
          <p className="text-slate-600 dark:text-slate-400">
            Enable or disable portals, customer booking access, and ERP modules per tenant
          </p>
        </div>
        {selectedTenant && (
          <button
            onClick={saveModuleToggles}
            disabled={!dirty || saving || loading}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        )}
      </div>

      {/* Tenant Selector */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          Select Tenant
        </label>
        <select
          value={selectedTenant}
          onChange={(e) => setSelectedTenant(e.target.value)}
          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
        >
          <option value="">-- Select a tenant --</option>
          {tenants.map(tenant => (
            <option key={tenant.id} value={tenant.id}>{tenant.name} ({tenant.code})</option>
          ))}
        </select>
      </div>

      {notice && (
        <div
          className={`px-4 py-3 rounded-lg border text-sm ${
            notice.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
          }`}
        >
          {notice.message}
        </div>
      )}

      {/* Module Toggles & Customer Portal Delivery */}
      {selectedTenant && (
        <div className="space-y-6">
          {/* Customer Portal Delivery Controls */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 space-y-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <Globe size={18} className="text-indigo-500" />
                  {selectedTenantData?.name} - Customer Portal Access
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Controls public booking & guest self-service availability for {selectedTenantData?.code}.{BASE_DOMAIN}. Overrides global defaults when changed.
                </p>
              </div>
              <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  Tenant Portals Master Switch
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPortalEnabled(prev => !prev);
                    setDirty(true);
                    setNotice(null);
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                    portalEnabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
                  }`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                    portalEnabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`} />
                </button>
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Public Booking Card */}
              <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/30 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">Public Booking</span>
                  <button
                    type="button"
                    disabled={!portalEnabled}
                    onClick={() => togglePortal('public_booking')}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                      publicBookingEffective ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
                    }`}
                  >
                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                      publicBookingEffective ? 'translate-x-5' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className={publicBookingEffective ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-rose-600 dark:text-rose-400 font-medium'}>
                    {publicBookingEffective ? 'Enabled' : (!portalEnabled ? 'Blocked by Master Switch' : 'Disabled')}
                  </span>
                  {moduleToggles.public_booking !== undefined ? (
                    <button
                      type="button"
                      onClick={() => resetOverride('public_booking')}
                      className="text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      Reset to global ({globalEnabled('public_booking') ? 'On' : 'Off'})
                    </button>
                  ) : (
                    <span className="text-slate-400">Inherits global</span>
                  )}
                </div>
              </div>

              {/* Guest Portal Card */}
              <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/30 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">Guest Portal</span>
                  <button
                    type="button"
                    disabled={!portalEnabled}
                    onClick={() => togglePortal('guest')}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                      guestPortalEffective ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
                    }`}
                  >
                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                      guestPortalEffective ? 'translate-x-5' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className={guestPortalEffective ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-rose-600 dark:text-rose-400 font-medium'}>
                    {guestPortalEffective ? 'Enabled' : (!portalEnabled ? 'Blocked by Master Switch' : 'Disabled')}
                  </span>
                  {moduleToggles.guest !== undefined ? (
                    <button
                      type="button"
                      onClick={() => resetOverride('guest')}
                      className="text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      Reset to global ({globalEnabled('guest') ? 'On' : 'Off'})
                    </button>
                  ) : (
                    <span className="text-slate-400">Inherits global</span>
                  )}
                </div>
              </div>

              {/* Custom Domain */}
              <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/30 space-y-2">
                <label className="block text-sm font-semibold text-slate-900 dark:text-white">
                  Custom Domain (Optional)
                </label>
                <input
                  type="text"
                  value={customDomain}
                  onChange={(e) => {
                    setCustomDomain(e.target.value);
                    setDirty(true);
                    setNotice(null);
                  }}
                  placeholder={`booking.${BASE_DOMAIN}`}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white font-mono"
                />
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="font-semibold text-slate-900 dark:text-white">
                {selectedTenantData?.name} - Portal & Module Toggles
              </h3>
              {loading && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Loading...</p>}
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {portalEntries.map(entry => {
                const locked = entry.locked;
                const on = locked || enabled(entry.key);
                const isExpanded = expandedDepartments.has(entry.key);

                return (
                  <div key={entry.key} className="bg-white dark:bg-slate-800">
                    {/* Portal Row */}
                    <div className="flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition">
                      <button
                        onClick={() => toggleDepartment(entry.key)}
                        className="flex items-center gap-3 flex-1 text-left"
                      >
                        {isExpanded ? (
                          <ChevronDown size={16} className="text-slate-400" />
                        ) : (
                          <ChevronRight size={16} className="text-slate-400" />
                        )}
                        <Building2 size={18} className="text-slate-400 shrink-0" />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-900 dark:text-white">{entry.label}</span>
                            {locked && (
                              <span className="px-2 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-xs rounded-full">
                                Protected
                              </span>
                            )}
                            {on && !locked && (
                              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs rounded-full">
                                Enabled
                              </span>
                            )}
                            {!on && !locked && (
                              <span className="px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-xs rounded-full">
                                Disabled
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                            {entry.url} · {entry.modules.length} modules
                          </div>
                        </div>
                      </button>
                      <button
                        disabled={locked}
                        onClick={() => togglePortal(entry.key)}
                        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                          on ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
                        }`}
                      >
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                          on ? 'translate-x-5' : 'translate-x-0.5'
                        }`} />
                      </button>
                    </div>

                    {/* Module Rows */}
                    {isExpanded && entry.modules.length > 0 && (
                      <div className="px-4 pb-4 pl-12">
                        <div className="space-y-2">
                          {entry.modules.map(module => {
                            const moduleKey = `${entry.key}_${module.tabId}`;
                            const moduleOn = enabled(moduleKey);
                            const moduleLocked = entry.locked;

                            return (
                              <div
                                key={module.tabId}
                                className="flex items-center justify-between gap-3 p-2.5 bg-slate-50 dark:bg-slate-900/40 rounded-lg border border-slate-100 dark:border-slate-700"
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-bold text-slate-900 dark:text-white truncate">{module.label}</div>
                                  <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                                    {module.modId}
                                  </div>
                                </div>
                                <button
                                  disabled={moduleLocked}
                                  onClick={() => toggleModule(entry.key, module.tabId)}
                                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                                    moduleOn ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
                                  }`}
                                >
                                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                    moduleOn ? 'translate-x-4' : 'translate-x-0.5'
                                  }`} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface PlatformSettingsState {
  maintenanceMode: boolean;
  maintenanceMessage: string;
  publicBookingEnabled: boolean;
  guestPortalEnabled: boolean;
  sessionTimeout: number;
  maxConcurrentSessions: number;
  passwordComplexity: 'low' | 'medium' | 'high';
  forceMfa: boolean;
  strictPasswordRotation: boolean;
  backupFrequency: 'daily' | 'weekly' | 'manual';
  systemLogLevel: 'info' | 'detailed' | 'debug';
  erpLogo: string;
  erpName: string;
  erpFavicon: string;
  updatedAt?: string | null;
}

const DEFAULT_PLATFORM_SETTINGS: PlatformSettingsState = {
  maintenanceMode: false,
  maintenanceMessage: '',
  publicBookingEnabled: true,
  guestPortalEnabled: true,
  sessionTimeout: 0,
  maxConcurrentSessions: 3,
  passwordComplexity: 'medium',
  forceMfa: false,
  strictPasswordRotation: false,
  backupFrequency: 'daily',
  systemLogLevel: 'info',
  erpLogo: '',
  erpName: 'SELEDA',
  erpFavicon: '',
  updatedAt: null,
};

// Settings Tab - Platform-wide operational, portal default, and security settings
const SettingsTab: React.FC = () => {
  const [settings, setSettings] = useState<PlatformSettingsState>(DEFAULT_PLATFORM_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadPlatformSettings = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const apiBase = getApiBaseUrl();
      const response = await fetch(`${apiBase}/api/admin/platform-settings`, {
        credentials: 'include',
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.settings) {
        setSettings({ ...DEFAULT_PLATFORM_SETTINGS, ...data.settings });
        setDirty(false);
      } else {
        setNotice({ type: 'error', message: data.error || 'Failed to load platform settings' });
      }
    } catch {
      setNotice({ type: 'error', message: 'Failed to load platform settings' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlatformSettings();
  }, [loadPlatformSettings]);

  const updateField = <K extends keyof PlatformSettingsState>(key: K, value: PlatformSettingsState[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setDirty(true);
    setNotice(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const apiBase = getApiBaseUrl();
      const response = await fetch(`${apiBase}/api/admin/platform-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          maintenanceMode: settings.maintenanceMode,
          maintenanceMessage: settings.maintenanceMessage,
          publicBookingEnabled: settings.publicBookingEnabled,
          guestPortalEnabled: settings.guestPortalEnabled,
          sessionTimeout: Number(settings.sessionTimeout) || 0,
          maxConcurrentSessions: Math.max(1, Number(settings.maxConcurrentSessions) || 3),
          passwordComplexity: settings.passwordComplexity,
          forceMfa: settings.forceMfa,
          strictPasswordRotation: settings.strictPasswordRotation,
          backupFrequency: settings.backupFrequency,
          systemLogLevel: settings.systemLogLevel,
          erpLogo: settings.erpLogo,
          erpName: settings.erpName,
          erpFavicon: settings.erpFavicon,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.settings) {
        setSettings({ ...DEFAULT_PLATFORM_SETTINGS, ...data.settings });
        setDirty(false);
        setNotice({ type: 'success', message: 'Platform settings updated and cache refreshed.' });
      } else {
        setNotice({ type: 'error', message: data.error || 'Failed to save platform settings' });
      }
    } catch {
      setNotice({ type: 'error', message: 'Failed to save platform settings' });
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm';

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Platform Settings</h2>
          <p className="text-slate-600 dark:text-slate-400">
            Configure platform-wide maintenance mode, portal defaults, and security policy ({BASE_DOMAIN})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadPlatformSettings}
            disabled={loading || saving}
            className="px-3 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 text-sm disabled:opacity-50"
          >
            <RotateCcw size={15} /> Reload
          </button>
          <button
            type="submit"
            disabled={!dirty || loading || saving}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 text-sm disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>

      {notice && (
        <div
          className={`px-4 py-3 rounded-lg border text-sm ${
            notice.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
          }`}
        >
          {notice.message}
        </div>
      )}

      {loading ? (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-10 text-center text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading platform settings...
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Portal Defaults & Maintenance */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 space-y-5">
            <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 pb-3">
              <Globe size={18} className="text-indigo-500" />
              <h3 className="font-semibold text-slate-900 dark:text-white">Maintenance & Global Portal Defaults</h3>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-slate-900 dark:text-white">Maintenance Mode</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Blocks public booking submissions with the notice below
                </div>
              </div>
              <button
                type="button"
                onClick={() => updateField('maintenanceMode', !settings.maintenanceMode)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  settings.maintenanceMode ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600'
                }`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  settings.maintenanceMode ? 'translate-x-5' : 'translate-x-0.5'
                }`} />
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Maintenance Message
              </label>
              <textarea
                rows={2}
                value={settings.maintenanceMessage}
                onChange={(e) => updateField('maintenanceMessage', e.target.value)}
                placeholder="System is under scheduled maintenance. Please try again later."
                className={inputCls}
              />
            </div>

            <div className="flex items-center justify-between gap-4 pt-2 border-t border-slate-100 dark:border-slate-700">
              <div>
                <div className="text-sm font-medium text-slate-900 dark:text-white">Default Public Booking Engine</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Fallback when a tenant has no per-tenant override in Portal Management
                </div>
              </div>
              <button
                type="button"
                onClick={() => updateField('publicBookingEnabled', !settings.publicBookingEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  settings.publicBookingEnabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
                }`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  settings.publicBookingEnabled ? 'translate-x-5' : 'translate-x-0.5'
                }`} />
              </button>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-slate-900 dark:text-white">Default Guest Portal</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Fallback when a tenant has no per-tenant override in Portal Management
                </div>
              </div>
              <button
                type="button"
                onClick={() => updateField('guestPortalEnabled', !settings.guestPortalEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  settings.guestPortalEnabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
                }`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  settings.guestPortalEnabled ? 'translate-x-5' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
          </div>

          {/* Security & Session Policy + Operations */}
          <div className="space-y-6">
            <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 pb-3">
                <Shield size={18} className="text-indigo-500" />
                <h3 className="font-semibold text-slate-900 dark:text-white">Security & Session Policy</h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Session Idle Timeout (min)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={43200}
                    value={settings.sessionTimeout}
                    onChange={(e) => updateField('sessionTimeout', Math.max(0, parseInt(e.target.value || '0', 10)))}
                    className={inputCls}
                  />
                  <p className="text-xs text-slate-400 mt-1">0 uses default (8 hours)</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Max Concurrent Sessions
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={settings.maxConcurrentSessions}
                    onChange={(e) => updateField('maxConcurrentSessions', Math.max(1, parseInt(e.target.value || '3', 10)))}
                    className={inputCls}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Password Complexity
                </label>
                <select
                  value={settings.passwordComplexity}
                  onChange={(e) => updateField('passwordComplexity', e.target.value as 'low' | 'medium' | 'high')}
                  className={inputCls}
                >
                  <option value="low">Low (minimum length)</option>
                  <option value="medium">Medium (mixed case + numbers)</option>
                  <option value="high">High (uppercase, lowercase, digit, symbol)</option>
                </select>
              </div>

              <div className="flex flex-wrap gap-6 pt-2">
                <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.forceMfa}
                    onChange={(e) => updateField('forceMfa', e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Force MFA
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.strictPasswordRotation}
                    onChange={(e) => updateField('strictPasswordRotation', e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Strict Password Rotation
                </label>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 pb-3">
                <Settings size={18} className="text-indigo-500" />
                <h3 className="font-semibold text-slate-900 dark:text-white">System Operations</h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Backup Frequency
                  </label>
                  <select
                    value={settings.backupFrequency}
                    onChange={(e) => updateField('backupFrequency', e.target.value as 'daily' | 'weekly' | 'manual')}
                    className={inputCls}
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="manual">Manual</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    System Log Level
                  </label>
                  <select
                    value={settings.systemLogLevel}
                    onChange={(e) => updateField('systemLogLevel', e.target.value as 'info' | 'detailed' | 'debug')}
                    className={inputCls}
                  >
                    <option value="info">Info</option>
                    <option value="detailed">Detailed</option>
                    <option value="debug">Debug</option>
                  </select>
                </div>
              </div>

              {settings.updatedAt && (
                <p className="text-xs text-slate-400">
                  Last updated: {new Date(settings.updatedAt).toLocaleString()}
                </p>
              )}
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 pb-3">
                <Building2 size={18} className="text-indigo-500" />
                <h3 className="font-semibold text-slate-900 dark:text-white">ERP, POS &amp; KDS Branding</h3>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Platform / ERP Name
                </label>
                <input
                  type="text"
                  value={settings.erpName}
                  onChange={(e) => updateField('erpName', e.target.value)}
                  placeholder="SELEDA"
                  className={inputCls}
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Used across ERP, POS, and KDS headers and login screens
                </p>
              </div>

              <LogoUploadField
                label="Platform / ERP Logo"
                hint="Displayed in ERP, POS, and KDS headers and login screens"
                value={settings.erpLogo}
                onChange={(erpLogo) => updateField('erpLogo', erpLogo)}
              />

              <LogoUploadField
                label="Website Icon (Favicon)"
                hint="Browser tab icon for ERP, POS, KDS, Admin, and login pages (falls back to ERP Logo if empty)"
                value={settings.erpFavicon}
                onChange={(erpFavicon) => updateField('erpFavicon', erpFavicon)}
              />
            </div>
          </div>
        </div>
      )}
    </form>
  );
};

// Tenant Data Management Modal — export, import, delete tenant data
const TenantDataModal: React.FC<{ tenant: Tenant; onClose: () => void; onRefresh: () => void }> = ({ tenant, onClose, onRefresh }) => {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);

  const apiBase = getApiBaseUrl();

  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await fetch(`${apiBase}/api/admin/tenants/${tenant.id}/export`, { credentials: 'include' });
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tenant-${tenant.code}-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        alert('Export failed');
      }
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteData = async () => {
    if (!confirm('DANGER: This will delete ALL data for this tenant. This cannot be undone. Continue?')) return;
    setDeleting(true);
    try {
      const response = await fetch(`${apiBase}/api/admin/tenants/${tenant.id}/data`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (response.ok) {
        alert('Tenant data deleted successfully');
        onRefresh();
      } else {
        const data = await response.json();
        alert(data.error || 'Delete failed');
      }
    } catch (error) {
      console.error('Delete failed:', error);
      alert('Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    try {
      const text = await importFile.text();
      const data = JSON.parse(text);
      const response = await fetch(`${apiBase}/api/admin/tenants/${tenant.id}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ data }),
      });
      if (response.ok) {
        const result = await response.json();
        alert(`Imported ${result.imported} rows${result.errors?.length ? `\nErrors: ${result.errors.join(', ')}` : ''}`);
        setImportFile(null);
        onRefresh();
      } else {
        const err = await response.json();
        alert(err.error || 'Import failed');
      }
    } catch (error) {
      console.error('Import failed:', error);
      alert('Import failed - invalid JSON or network error');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-2xl w-full">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Database size={20} /> Data Management: {tenant.name}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex flex-col items-center gap-2 p-4 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors disabled:opacity-50"
            >
              <Download size={24} className="text-emerald-600" />
              <span className="text-sm font-medium text-slate-900 dark:text-white">Export Data</span>
              <span className="text-xs text-slate-500">Download full tenant backup</span>
            </button>

            <label className="flex flex-col items-center gap-2 p-4 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer">
              <Upload size={24} className="text-blue-600" />
              <span className="text-sm font-medium text-slate-900 dark:text-white">Import Data</span>
              <span className="text-xs text-slate-500">Upload backup JSON</span>
              <input
                type="file"
                accept=".json"
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                className="hidden"
              />
              {importFile && <span className="text-xs text-blue-600 truncate max-w-full">{importFile.name}</span>}
            </label>

            <button
              onClick={handleDeleteData}
              disabled={deleting}
              className="flex flex-col items-center gap-2 p-4 border border-red-200 dark:border-red-900/30 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
            >
              <Trash2 size={24} className="text-red-600" />
              <span className="text-sm font-medium text-slate-900 dark:text-white">Delete Data</span>
              <span className="text-xs text-slate-500">Clear all tenant data</span>
            </button>
          </div>

          {importFile && (
            <button
              onClick={handleImport}
              disabled={importing}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {importing ? <Loader2 size={16} className="animate-spin" /> : 'Import Backup'}
            </button>
          )}

          <div className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/40 p-3 rounded-lg">
            <p className="font-medium mb-1">Notes:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Export downloads a JSON file with all tenant data (properties, rooms, reservations, guests, etc.)</li>
              <li>Import restores data from a backup — use Delete Data first to clear existing rows</li>
              <li>Delete Data removes ALL tenant data — dangerous, cannot be undone</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Super Admin Portal
 * Dedicated portal for super-admins to manage tenants and users across the platform
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Users, Settings, BarChart3, Shield, LogOut, ChevronRight, ChevronDown, Plus, Edit, Trash2, X, Save, Loader2 } from 'lucide-react';
import { User } from '../../types/erp';
import { getSubdomainInfo } from '../../lib/subdomain';
import { DEPARTMENTS } from '../../config/departments';
import { getTabsForDepartment } from '../../config/departmentTabs';
import { CORE_ADMIN_MODULES } from './adminModules';
import { PUBLIC_PORTAL_MODULES, GUEST_PORTAL_MODULES } from '../../config/portalModules';

interface Tenant {
  id: string;
  name: string;
  code: string;
  status: string;
  created_at: string;
  legal_name?: string;
  email?: string;
  phone?: string;
}

interface TenantUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  isDefault: boolean;
  isSuperAdmin: boolean;
}

interface AdminPortalProps {
  currentUser: User;
  onLogout: () => void;
}

// Base domain for tenant subdomains (admin.seledabet.com → seledabet.com)
const BASE_DOMAIN = typeof window !== 'undefined'
  ? window.location.hostname.split('.').slice(-2).join('.')
  : 'seledabet.com';
const tenantUrl = (code: string) => `https://${code}.${BASE_DOMAIN}`;

export const SuperAdminPortal: React.FC<AdminPortalProps> = ({ currentUser, onLogout }) => {
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'tenants' | 'users' | 'portal' | 'settings'>('overview');

  // Redirect non-super-admins
  useEffect(() => {
    if (!currentUser?.isSuperAdmin) {
      navigate('/erp');
      return;
    }
  }, [currentUser, navigate]);

  // Fetch tenants
  const fetchTenants = async () => {
    try {
      const apiBase = getSubdomainInfo().isAdmin ? `https://admin.${window.location.hostname.split('.').slice(-2).join('.')}` : '';
      const response = await fetch(`${apiBase}/api/admin/tenants`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setTenants(data.tenants || []);
      }
    } catch (error) {
      console.error('Failed to fetch tenants:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenants();
  }, []);

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
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6">
        <div className="flex gap-6">
          {[
            { id: 'overview', label: 'Overview', icon: BarChart3 },
            { id: 'tenants', label: 'Tenants', icon: Building2 },
            { id: 'users', label: 'Users', icon: Users },
            { id: 'portal', label: 'Portal Management', icon: Shield },
            { id: 'settings', label: 'Settings', icon: Settings },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
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
        {activeTab === 'overview' && <OverviewTab tenants={tenants} loading={loading} />}
        {activeTab === 'tenants' && <TenantsTab tenants={tenants} loading={loading} onRefresh={fetchTenants} />}
        {activeTab === 'users' && <UsersTab tenants={tenants} />}
        {activeTab === 'portal' && <PortalManagementTab tenants={tenants} />}
        {activeTab === 'settings' && <SettingsTab />}
      </main>
    </div>
  );
};

// Overview Tab
const OverviewTab: React.FC<{ tenants: Tenant[]; loading: boolean }> = ({ tenants, loading }) => {
  const activeTenants = tenants.filter(t => t.status === 'Active').length;
  const totalTenants = tenants.length;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Platform Overview</h2>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">Total Tenants</p>
              <p className="text-3xl font-bold text-slate-900 dark:text-white">{totalTenants}</p>
            </div>
            <Building2 className="text-indigo-600" size={32} />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">Active Tenants</p>
              <p className="text-3xl font-bold text-emerald-600">{activeTenants}</p>
            </div>
            <Shield className="text-emerald-600" size={32} />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">Total Users</p>
              <p className="text-3xl font-bold text-slate-900 dark:text-white">-</p>
            </div>
            <Users className="text-blue-600" size={32} />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">System Health</p>
              <p className="text-3xl font-bold text-emerald-600">Good</p>
            </div>
            <BarChart3 className="text-emerald-600" size={32} />
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
      const apiBase = getSubdomainInfo().isAdmin ? `https://admin.${window.location.hostname.split('.').slice(-2).join('.')}` : '';
      const response = await fetch(`${apiBase}/api/admin/tenants/${tenant.id}/users`, {
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

  const confirmDelete = async () => {
    if (!selectedTenant) return;
    setDeleting(true);
    try {
      const apiBase = getSubdomainInfo().isAdmin ? `https://admin.${window.location.hostname.split('.').slice(-2).join('.')}` : '';
      const response = await fetch(`${apiBase}/api/admin/tenants/${selectedTenant.id}`, {
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

      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
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
                      <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                        <Building2 className="text-indigo-600" size={20} />
                      </div>
                      <div>
                        <p className="font-medium text-slate-900 dark:text-white">{tenant.name}</p>
                        {tenant.legal_name && (
                          <p className="text-xs text-slate-500 dark:text-slate-400">{tenant.legal_name}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300 font-mono">
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
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      tenant.status === 'Active' 
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                    }`}>
                      {tenant.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">
                    {new Date(tenant.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
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

      {showCreateModal && <CreateTenantModal onClose={() => setShowCreateModal(false)} />}
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
          onRefresh={() => fetchTenantUsers(selectedTenant)}
        />
      )}
    </div>
  );
};

// Create Tenant Modal
const CreateTenantModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    legalName: '',
    email: '',
    phone: '',
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const apiBase = getSubdomainInfo().isAdmin ? `https://admin.${window.location.hostname.split('.').slice(-2).join('.')}` : '';
      const response = await fetch(`${apiBase}/api/admin/tenants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        onClose();
        window.location.reload();
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to create tenant');
      }
    } catch (error) {
      console.error('Failed to create tenant:', error);
      alert('Failed to create tenant');
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
      const apiBase = getSubdomainInfo().isAdmin ? `https://admin.${window.location.hostname.split('.').slice(-2).join('.')}` : '';
      const response = await fetch(`${apiBase}/api/admin/tenants/${tenant.id}`, {
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

// Tenant Users Modal — create tenant admin/staff accounts and manage access
const TenantUsersModal: React.FC<{ tenant: Tenant; users: TenantUser[]; loading: boolean; onClose: () => void; onRefresh: () => void }> = ({ tenant, users, loading, onClose, onRefresh }) => {
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; password?: string } | null>(null);
  const [form, setForm] = useState({ name: '', email: '', username: '', password: '', role: 'admin', isSuperAdmin: false });
  const [error, setError] = useState('');

  const apiBase = getSubdomainInfo().isAdmin ? `https://admin.${window.location.hostname.split('.').slice(-2).join('.')}` : '';

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

  const handleRemove = async (userId: string) => {
    if (!confirm('Remove this user\'s access to the tenant? Their account is not deleted.')) return;
    setRemoving(userId);
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
      setRemoving(null);
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

          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Assigned Users</h4>
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-1"
            >
              <Plus size={14} /> Add User
            </button>
          </div>

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
                  <option value="admin">Admin (full access)</option>
                  <option value="executive">Executive</option>
                  <option value="general_manager">General Manager</option>
                  <option value="frontoffice">Front Office</option>
                  <option value="housekeeping">Housekeeping</option>
                  <option value="fb_manager">F&B Manager</option>
                  <option value="engineering">Engineering</option>
                  <option value="finance">Finance</option>
                  <option value="hr">HR</option>
                  <option value="staff">Staff</option>
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
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      user.status === 'Active'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                    }`}>
                      {user.status}
                    </span>
                    <button
                      onClick={() => handleRemove(user.id)}
                      disabled={removing === user.id}
                      className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
                      title="Remove tenant access"
                    >
                      {removing === user.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
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
const UsersTab: React.FC<{ tenants: Tenant[] }> = ({ tenants }) => {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTenant, setSelectedTenant] = useState<string>('all');

  useEffect(() => {
    const fetchAllUsers = async () => {
      try {
        const apiBase = getSubdomainInfo().isAdmin ? `https://admin.${window.location.hostname.split('.').slice(-2).join('.')}` : '';
        
        const promises = tenants.map(tenant => 
          fetch(`${apiBase}/api/admin/tenants/${tenant.id}/users`, { credentials: 'include' })
            .then(res => res.ok ? res.json() : { users: [] })
            .then(data => data.users.map((user: any) => ({ ...user, tenantName: tenant.name, tenantId: tenant.id })))
        );

        const results = await Promise.all(promises);
        setUsers(results.flat());
      } catch (error) {
        console.error('Failed to fetch users:', error);
      } finally {
        setLoading(false);
      }
    };

    if (tenants.length > 0) {
      fetchAllUsers();
    }
  }, [tenants]);

  const filteredUsers = selectedTenant === 'all' 
    ? users 
    : users.filter(u => u.tenantId === selectedTenant);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">User Management</h2>
        <select
          value={selectedTenant}
          onChange={(e) => setSelectedTenant(e.target.value)}
          className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
        >
          <option value="all">All Tenants</option>
          {tenants.map(tenant => (
            <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
          ))}
        </select>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
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
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                  Loading users...
                </td>
              </tr>
            ) : filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                  No users found
                </td>
              </tr>
            ) : (
              filteredUsers.map((user) => (
                <tr key={`${user.tenantId}-${user.id}`} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                        <Users className="text-indigo-600" size={20} />
                      </div>
                      <div>
                        <p className="font-medium text-slate-900 dark:text-white">{user.name}</p>
                        <p className="text-sm text-slate-500 dark:text-slate-400">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">
                    {user.tenantName}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">
                    {user.role}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      user.status === 'Active' 
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                    }`}>
                      {user.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex gap-1">
                      {user.isSuperAdmin && (
                        <span className="px-2 py-1 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 text-xs rounded-full">
                          SA
                        </span>
                      )}
                      {user.isDefault && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-xs rounded-full">
                          Def
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Portal Management Tab - Manage tenant portals and modules
const PortalManagementTab: React.FC<{ tenants: Tenant[] }> = ({ tenants }) => {
  const [selectedTenant, setSelectedTenant] = useState<string>('');
  const [moduleToggles, setModuleToggles] = useState<Record<string, boolean>>({});
  const [globalToggles, setGlobalToggles] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedDepartments, setExpandedDepartments] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);

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

  // Load module toggles for selected tenant
  useEffect(() => {
    if (!selectedTenant) {
      setModuleToggles({});
      setDirty(false);
      return;
    }

    const loadModuleToggles = async () => {
      setLoading(true);
      try {
        const apiBase = getSubdomainInfo().isAdmin ? `https://admin.${window.location.hostname.split('.').slice(-2).join('.')}` : '';
        const response = await fetch(`${apiBase}/api/admin/tenants/${selectedTenant}/module-toggles`, {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          setModuleToggles(data.moduleToggles || {});
          setGlobalToggles(data.globalToggles || {});
          setDirty(false);
        }
      } catch (error) {
        console.error('Failed to fetch module toggles:', error);
      } finally {
        setLoading(false);
      }
    };

    loadModuleToggles();
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
    try {
      const apiBase = getSubdomainInfo().isAdmin ? `https://admin.${window.location.hostname.split('.').slice(-2).join('.')}` : '';
      const response = await fetch(`${apiBase}/api/admin/tenants/${selectedTenant}/module-toggles`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ moduleToggles }),
      });

      if (response.ok) {
        setDirty(false);
        alert('Module toggles saved successfully');
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to save module toggles');
      }
    } catch (error) {
      console.error('Failed to save module toggles:', error);
      alert('Failed to save module toggles');
    } finally {
      setSaving(false);
    }
  };

  const selectedTenantData = tenants.find(t => t.id === selectedTenant);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Portal & Module Management</h2>
          <p className="text-slate-600 dark:text-slate-400">
            Enable or disable portals and modules for each tenant
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

      {/* Module Toggles */}
      {selectedTenant && (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
            <h3 className="font-semibold text-slate-900 dark:text-white">
              {selectedTenantData?.name} - Portal & Module Settings
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
      )}
    </div>
  );
};

// Settings Tab (placeholder)
const SettingsTab: React.FC = () => {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Platform Settings</h2>
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-8 text-center">
        <Settings className="mx-auto text-slate-400 mb-4" size={48} />
        <p className="text-slate-500 dark:text-slate-400">Platform settings coming soon</p>
      </div>
    </div>
  );
};

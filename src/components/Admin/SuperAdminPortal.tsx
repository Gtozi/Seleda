/**
 * Super Admin Portal
 * Dedicated portal for super-admins to manage tenants and users across the platform
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Users, Settings, BarChart3, Shield, LogOut, ChevronRight } from 'lucide-react';
import { User } from '../../types/erp';
import { useERP } from '../../context/ERPContext';
import { verifySession } from '../../lib/auth';
import { getSubdomainInfo } from '../../lib/subdomain';

interface Tenant {
  id: string;
  name: string;
  code: string;
  status: string;
  created_at: string;
}

interface AdminPortalProps {
  currentUser: User;
  onLogout: () => void;
}

export const SuperAdminPortal: React.FC<AdminPortalProps> = ({ currentUser, onLogout }) => {
  const navigate = useNavigate();
  const { formatAmount } = useERP();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'tenants' | 'users' | 'settings'>('overview');

  // Redirect non-super-admins
  useEffect(() => {
    if (!currentUser?.isSuperAdmin) {
      navigate('/erp');
      return;
    }
  }, [currentUser, navigate]);

  // Fetch tenants
  useEffect(() => {
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
        {activeTab === 'tenants' && <TenantsTab tenants={tenants} loading={loading} />}
        {activeTab === 'users' && <UsersTab />}
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
const TenantsTab: React.FC<{ tenants: Tenant[]; loading: boolean }> = ({ tenants, loading }) => {
  const [showCreateModal, setShowCreateModal] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Tenant Management</h2>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
        >
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
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300 font-mono">
                    {tenant.code}
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
                    <button className="text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 text-sm font-medium">
                      Manage
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showCreateModal && <CreateTenantModal onClose={() => setShowCreateModal(false)} />}
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

// Users Tab (placeholder)
const UsersTab: React.FC = () => {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-slate-900 dark:text-white">User Management</h2>
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-8 text-center">
        <Users className="mx-auto text-slate-400 mb-4" size={48} />
        <p className="text-slate-500 dark:text-slate-400">User management across tenants coming soon</p>
      </div>
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

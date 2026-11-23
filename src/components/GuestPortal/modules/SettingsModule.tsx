/**
 * Settings Module
 * Account settings persisted to guests.preferences.portalSettings via
 * GET/PUT /api/guest-portal/settings/:guestId. Sign Out and Change
 * Password call the real /api/auth endpoints.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Settings,
  Bell,
  Lock,
  Globe,
  Accessibility,
  Shield,
  LogOut,
  Save,
  Loader2,
  AlertCircle,
  CheckCircle2,
  X
} from 'lucide-react';
import { logout } from '../../../lib/auth';

interface SettingsModuleProps {
  reservationId?: string;
  guestId?: string;
}

interface SettingsState {
  notifications: {
    email: boolean;
    sms: boolean;
    push: boolean;
    marketing: boolean;
  };
  language: 'en' | 'am' | 'ti';
  theme: 'light' | 'dark' | 'system';
  privacy: {
    profileVisibility: 'public' | 'private';
    dataSharing: boolean;
  };
  accessibility: {
    fontSize: 'small' | 'medium' | 'large';
    highContrast: boolean;
    reducedMotion: boolean;
  };
}

const DEFAULT_SETTINGS: SettingsState = {
  notifications: { email: true, sms: true, push: true, marketing: false },
  language: 'en',
  theme: 'system',
  privacy: { profileVisibility: 'private', dataSharing: false },
  accessibility: { fontSize: 'medium', highContrast: false, reducedMotion: false },
};

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const SPECIAL_CHARS = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/;

function validatePasswordComplexity(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (password.length < 8) errors.push('At least 8 characters');
  if (!/[A-Z]/.test(password)) errors.push('One uppercase letter');
  if (!/[a-z]/.test(password)) errors.push('One lowercase letter');
  if (!/\d/.test(password)) errors.push('One number');
  if (!SPECIAL_CHARS.test(password)) errors.push('One special character (!@#$%^&*...)');
  return { valid: errors.length === 0, errors };
}

const SettingsModule: React.FC<SettingsModuleProps> = ({
  reservationId,
  guestId
}) => {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [resolvedReservationId, setResolvedReservationId] = useState<string | undefined>(reservationId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordValidationErrors, setPasswordValidationErrors] = useState<string[]>([]);

  const loadSettings = useCallback(async () => {
    if (!guestId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);

      let resvId = reservationId;
      if (!resvId) {
        // Needed as the canActForGuest credential — in-house stay first,
        // else soonest upcoming.
        const res = await fetch(`/api/guest-portal/reservations/${encodeURIComponent(guestId)}`, {
          headers: authHeaders(), credentials: 'include',
        });
        const payload = await res.json().catch(() => ({}));
        if (res.ok) {
          const rows: any[] = payload.reservations || [];
          const today = new Date().toISOString().slice(0, 10);
          resvId = rows.find(r => r.status === 'CheckedIn')?.id
            || rows.filter(r => ['Reserved', 'Pending', 'Confirmed'].includes(r.status)
                && r.checkInDate <= today && r.checkOutDate >= today)[0]?.id
            || rows.filter(r => ['Reserved', 'Pending', 'Confirmed'].includes(r.status))
                .sort((a, b) => a.checkInDate.localeCompare(b.checkInDate))[0]?.id;
        }
      }
      setResolvedReservationId(resvId);

      const qs = resvId ? `?reservationId=${encodeURIComponent(resvId)}` : '';
      const res = await fetch(`/api/guest-portal/settings/${encodeURIComponent(guestId)}${qs}`, {
        headers: authHeaders(),
        credentials: 'include',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Failed to load settings (${res.status})`);
      setSettings({ ...DEFAULT_SETTINGS, ...(payload.settings || {}) });
    } catch (e: any) {
      setError(e?.message || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [guestId, reservationId]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const handleSave = async () => {
    if (!guestId || saving) return;
    setSaving(true);
    setSaveSuccess(false);
    setError(null);
    try {
      const res = await fetch(`/api/guest-portal/settings/${encodeURIComponent(guestId)}`, {
        method: 'PUT',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ settings, reservationId: resolvedReservationId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Failed to save (${res.status})`);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e: any) {
      setError(e?.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleNotificationChange = (key: keyof SettingsState['notifications']) => {
    setSettings({
      ...settings,
      notifications: {
        ...settings.notifications,
        [key]: !settings.notifications[key]
      }
    });
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      // Revokes guest_sessions + user_sessions and clears the shared cookie.
      await Promise.allSettled([
        fetch('/api/guest-portal/auth/logout', { method: 'POST', credentials: 'include' }),
        logout(),
      ]);
    } finally {
      localStorage.removeItem('auth_token');
      sessionStorage.removeItem('guest_portal_guest_id');
      sessionStorage.removeItem('guest_portal_reservation_id');
      navigate('/');
    }
  };

  const handleChangePassword = async () => {
    if (passwordSaving) return;
    setPasswordError(null);
    if (!currentPassword || !newPassword) {
      setPasswordError('Both current and new password are required');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }
    const validation = validatePasswordComplexity(newPassword);
    if (!validation.valid) {
      setPasswordError('Password does not meet requirements');
      setPasswordValidationErrors(validation.errors);
      return;
    }
    try {
      setPasswordSaving(true);
      const res = await fetch('/api/guest-portal/auth/change-password', {
        method: 'POST',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const text = await res.text();
      let payload: any;
      try {
        payload = JSON.parse(text);
      } catch {
        // Fallback: if HTML returned, show generic error
        if (!res.ok) {
          setPasswordError(`Password change failed (${res.status})`);
          return;
        }
        payload = {};
      }
      if (!res.ok) throw new Error(payload.error || `Failed to change password (${res.status})`);
      setPasswordSuccess(true);
      setTimeout(() => {
        setShowPasswordModal(false);
        setPasswordSuccess(false);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setPasswordValidationErrors([]);
      }, 1500);
    } catch (e: any) {
      setPasswordError(e?.message || 'Failed to change password');
    } finally {
      setPasswordSaving(false);
    }
  };

  if (!guestId) {
    return (
      <div className="p-4 sm:p-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <Settings className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Sign in required</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Sign in to manage your account settings.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 flex flex-col items-center justify-center py-16 text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin mb-3" />
        <p className="text-sm">Loading settings...</p>
      </div>
    );
  }

  const Toggle = ({ on, onChange }: { on: boolean; onChange: () => void }) => (
    <button
      onClick={onChange}
      className={`w-12 h-6 rounded-full transition ${on ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}
    >
      <div className={`w-5 h-5 bg-white rounded-full shadow transform transition ${on ? 'translate-x-6' : 'translate-x-0.5'}`} />
    </button>
  );

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Settings</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Manage your account preferences
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saveSuccess && (
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 size={16} />
              <span className="text-sm font-medium">Settings saved</span>
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          <AlertCircle size={16} />
          {error}
          <button onClick={loadSettings} className="ml-auto underline">Retry</button>
        </div>
      )}

      {/* Notification Settings */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/20 rounded-lg flex items-center justify-center">
            <Bell size={20} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Notification Preferences</h3>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-slate-900 dark:text-white">Email Notifications</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Receive updates via email</div>
            </div>
            <Toggle on={settings.notifications.email} onChange={() => handleNotificationChange('email')} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-slate-900 dark:text-white">SMS Notifications</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Receive text message updates</div>
            </div>
            <Toggle on={settings.notifications.sms} onChange={() => handleNotificationChange('sms')} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-slate-900 dark:text-white">Push Notifications</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Receive mobile app notifications</div>
            </div>
            <Toggle on={settings.notifications.push} onChange={() => handleNotificationChange('push')} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-slate-900 dark:text-white">Marketing Communications</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Receive promotional offers</div>
            </div>
            <Toggle on={settings.notifications.marketing} onChange={() => handleNotificationChange('marketing')} />
          </div>
        </div>
      </div>

      {/* Language & Theme */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/20 rounded-lg flex items-center justify-center">
            <Globe size={20} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Language & Appearance</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Language
            </label>
            <select
              value={settings.language}
              onChange={(e) => setSettings({ ...settings, language: e.target.value as any })}
              className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="en">English</option>
              <option value="am">Amharic</option>
              <option value="ti">Tigrinya</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Theme
            </label>
            <select
              value={settings.theme}
              onChange={(e) => setSettings({ ...settings, theme: e.target.value as any })}
              className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System Default</option>
            </select>
          </div>
        </div>
      </div>

      {/* Privacy Settings */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/20 rounded-lg flex items-center justify-center">
            <Shield size={20} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Privacy & Security</h3>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Profile Visibility
            </label>
            <select
              value={settings.privacy.profileVisibility}
              onChange={(e) => setSettings({
                ...settings,
                privacy: { ...settings.privacy, profileVisibility: e.target.value as any }
              })}
              className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-slate-900 dark:text-white">Data Sharing</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Allow sharing of anonymous usage data</div>
            </div>
            <Toggle
              on={settings.privacy.dataSharing}
              onChange={() => setSettings({
                ...settings,
                privacy: { ...settings.privacy, dataSharing: !settings.privacy.dataSharing }
              })}
            />
          </div>
        </div>
      </div>

      {/* Accessibility Settings */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/20 rounded-lg flex items-center justify-center">
            <Accessibility size={20} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Accessibility</h3>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Font Size
            </label>
            <select
              value={settings.accessibility.fontSize}
              onChange={(e) => setSettings({
                ...settings,
                accessibility: { ...settings.accessibility, fontSize: e.target.value as any }
              })}
              className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-slate-900 dark:text-white">High Contrast</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Increase contrast for better visibility</div>
            </div>
            <Toggle
              on={settings.accessibility.highContrast}
              onChange={() => setSettings({
                ...settings,
                accessibility: { ...settings.accessibility, highContrast: !settings.accessibility.highContrast }
              })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-slate-900 dark:text-white">Reduced Motion</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Minimize animations and transitions</div>
            </div>
            <Toggle
              on={settings.accessibility.reducedMotion}
              onChange={() => setSettings({
                ...settings,
                accessibility: { ...settings.accessibility, reducedMotion: !settings.accessibility.reducedMotion }
              })}
            />
          </div>
        </div>
      </div>

      {/* Account Actions */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/20 rounded-lg flex items-center justify-center">
            <Settings size={20} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Account Actions</h3>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => { setPasswordError(null); setShowPasswordModal(true); }}
            className="w-full flex items-center gap-3 p-3 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/20 transition"
          >
            <Lock size={18} className="text-slate-400" />
            <span className="font-medium text-slate-700 dark:text-slate-300">Change Password</span>
          </button>
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="w-full flex items-center gap-3 p-3 border border-red-200 dark:border-red-700/50 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition text-red-600 dark:text-red-400 disabled:opacity-50"
          >
            {signingOut ? <Loader2 size={18} className="animate-spin" /> : <LogOut size={18} />}
            <span className="font-medium">{signingOut ? 'Signing out…' : 'Sign Out'}</span>
          </button>
        </div>
      </div>

      {/* Change Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 sm:p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Change Password</h3>
              <button
                onClick={() => setShowPasswordModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Current Password
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    const validation = validatePasswordComplexity(e.target.value);
                    setPasswordValidationErrors(validation.errors);
                  }}
                  autoComplete="new-password"
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <div className="mt-2 space-y-1">
                  <div className="text-xs text-slate-500 dark:text-slate-400">Password must contain:</div>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    <div className={`flex items-center gap-1 ${newPassword.length >= 8 ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {newPassword.length >= 8 ? <CheckCircle2 size={12} /> : <div className="w-3 h-3 rounded-full border border-slate-300" />}
                      8+ characters
                    </div>
                    <div className={`flex items-center gap-1 ${/[A-Z]/.test(newPassword) ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {/[A-Z]/.test(newPassword) ? <CheckCircle2 size={12} /> : <div className="w-3 h-3 rounded-full border border-slate-300" />}
                      Uppercase
                    </div>
                    <div className={`flex items-center gap-1 ${/[a-z]/.test(newPassword) ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {/[a-z]/.test(newPassword) ? <CheckCircle2 size={12} /> : <div className="w-3 h-3 rounded-full border border-slate-300" />}
                      Lowercase
                    </div>
                    <div className={`flex items-center gap-1 ${/\d/.test(newPassword) ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {/\d/.test(newPassword) ? <CheckCircle2 size={12} /> : <div className="w-3 h-3 rounded-full border border-slate-300" />}
                      Number
                    </div>
                    <div className={`flex items-center gap-1 col-span-2 ${SPECIAL_CHARS.test(newPassword) ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {SPECIAL_CHARS.test(newPassword) ? <CheckCircle2 size={12} /> : <div className="w-3 h-3 rounded-full border border-slate-300" />}
                      Special character (!@#$%^&*...)
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {passwordError && (
                <div className="flex flex-col gap-1 text-sm text-red-600 dark:text-red-400">
                  <div className="flex items-center gap-2">
                    <AlertCircle size={14} />
                    {passwordError}
                  </div>
                  {passwordValidationErrors.length > 0 && (
                    <ul className="list-disc list-inside pl-4 mt-1 text-xs">
                      {passwordValidationErrors.map((err, i) => <li key={i}>{err}</li>)}
                    </ul>
                  )}
                </div>
              )}
              {passwordSuccess && (
                <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={14} />
                  Password updated successfully
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowPasswordModal(false)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/20 transition text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleChangePassword}
                disabled={passwordSaving}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {passwordSaving ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
                Update Password
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsModule;

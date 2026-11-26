/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Building2, 
  Key, 
  Lock, 
  Mail, 
  ArrowRight, 
  Eye, 
  EyeOff, 
  CheckCircle2, 
  AlertCircle
} from 'lucide-react';
import { User } from '../types/erp';
import { login, forgotPassword } from '../lib/auth';
import { loginSchema } from '../schemas/validationSchemas';
import { z } from 'zod';


interface LoginPageProps {
  onLoginSuccess: (user: User, forcePasswordChange?: boolean) => void;
}

export default function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);
  const [forgotError, setForgotError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate with Zod schema
    const parseResult = loginSchema.safeParse({ email, password });
    if (!parseResult.success) {
      setError(parseResult.error.issues[0]?.message || 'Invalid input');
      return;
    }

    setIsLoading(true);
    const result = await login(email.trim(), password);
    setIsLoading(false);

    if (!result.success || !result.user) {
      setError(result.error || 'Invalid credentials. Please check your email and password.');
      return;
    }

    setSuccess(true);
    setTimeout(() => {
      onLoginSuccess(result.user!, result.forcePasswordChange);
    }, 500);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError(null);
    setForgotMessage(null);
    if (!forgotIdentifier.trim()) {
      setForgotError('Enter your email or username');
      return;
    }
    setForgotLoading(true);
    const result = await forgotPassword(forgotIdentifier.trim());
    setForgotLoading(false);
    if (!result.success) {
      setForgotError(result.error || 'Request failed. Please try again.');
      return;
    }
    setForgotMessage(result.message || 'Your administrator has been notified.');
  };

  return (
    <div className="flex-1 w-full flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 min-h-[calc(100vh-57px)]" id="login-module-screen">
      <div className="w-full max-w-md bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border border-slate-200 dark:border-slate-800 rounded-3xl shadow-xl card-shadow animate-fade-in-up">
        
        {/* Header */}
        <div className="p-8 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-white font-serif font-bold text-xl shadow-lg shadow-amber-500/20">H</div>
            <div>
              <span className="font-serif font-bold text-sm text-slate-900 dark:text-white block uppercase tracking-wide">Gheralta</span>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-sans">Enterprise Portal</span>
            </div>
          </div>

          <h1 className="text-2xl font-serif font-bold text-slate-900 dark:text-white mb-2">Sign In</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 font-sans">
            Access your dashboard
          </p>
        </div>

        {/* Login form */}
        <div className="p-8">
          <form onSubmit={handleSubmit} className="space-y-5" id="login-form">
            {error && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 rounded-xl flex items-center gap-2.5 text-sm animate-bounce-subtle">
                <AlertCircle size={16} className="text-rose-600 dark:text-rose-500 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 rounded-xl flex items-center gap-2.5 text-sm animate-bounce-subtle">
                <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-500 flex-shrink-0" />
                <span>Authentication successful! Redirecting...</span>
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-900 dark:text-white block font-serif" htmlFor="email-input">Email</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    id="email-input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    autoComplete="email"
                    required
                    disabled={isLoading || success}
                    className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all text-sm font-sans smooth-transition"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-slate-900 dark:text-white block font-serif" htmlFor="password-input">Password</label>
                  <button
                    type="button"
                    onClick={() => { setShowForgot(v => !v); setForgotError(null); setForgotMessage(null); }}
                    className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline transition smooth-transition"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    id="password-input"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    autoComplete="current-password"
                    required
                    disabled={isLoading || success}
                    className="w-full pl-10 pr-10 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all text-sm font-sans smooth-transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition smooth-transition"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {showForgot && (
                <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl space-y-3">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Enter your email or username. Your administrator will be notified and can issue you a temporary password.
                  </p>
                  {forgotError && (
                    <div className="p-2.5 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 rounded-lg flex items-center gap-2 text-xs">
                      <AlertCircle size={14} className="flex-shrink-0" />
                      <span>{forgotError}</span>
                    </div>
                  )}
                  {forgotMessage && (
                    <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 rounded-lg flex items-center gap-2 text-xs">
                      <CheckCircle2 size={14} className="flex-shrink-0" />
                      <span>{forgotMessage}</span>
                    </div>
                  )}
                  <form onSubmit={handleForgotPassword} className="flex gap-2">
                    <input
                      type="text"
                      value={forgotIdentifier}
                      onChange={(e) => setForgotIdentifier(e.target.value)}
                      placeholder="Email or username"
                      disabled={forgotLoading || !!forgotMessage}
                      className="flex-1 px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 text-sm"
                    />
                    <button
                      type="submit"
                      disabled={forgotLoading || !!forgotMessage}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50"
                    >
                      {forgotLoading ? 'Sending…' : 'Request reset'}
                    </button>
                  </form>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading || success}
              className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-serif font-medium text-sm rounded-xl shadow-lg shadow-amber-500/20 transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed mt-2 smooth-transition"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Signing in...</span>
                </>
              ) : success ? (
                <span>Access Granted</span>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}


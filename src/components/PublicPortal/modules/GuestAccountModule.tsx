/**
 * Guest Account Module
 * Sign up, login, view reservations, saved searches, wishlist, and payment methods
 */

import { useState } from 'react';
import { User, Calendar, Heart, CreditCard, LogIn, UserPlus } from 'lucide-react';
import { ModuleHeader } from '../shared';

const GuestAccountModule: React.FC = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');

  return (
    <div className="space-y-6">
      <ModuleHeader title="My Account" subtitle="Manage your bookings and preferences" gradient="from-indigo-600 to-blue-600" />

      {!isLoggedIn ? (
        <div className="max-w-md mx-auto">
          <div className="bg-white dark:bg-stone-800 rounded-2xl p-6 shadow-sm border border-stone-200/70">
            <div className="flex gap-4 mb-6">
              <button
                onClick={() => setActiveTab('login')}
                className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                  activeTab === 'login' ? 'bg-indigo-600 text-white' : 'bg-stone-100 dark:bg-stone-700 text-stone-700 dark:text-stone-300'
                }`}
              >
                Login
              </button>
              <button
                onClick={() => setActiveTab('register')}
                className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                  activeTab === 'register' ? 'bg-indigo-600 text-white' : 'bg-stone-100 dark:bg-stone-700 text-stone-700 dark:text-stone-300'
                }`}
              >
                Register
              </button>
            </div>

            {activeTab === 'login' ? (
              <form className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">Email</label>
                  <input type="email" className="w-full px-4 py-2 border border-stone-300 dark:border-stone-600 rounded-lg dark:bg-stone-700 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">Password</label>
                  <input type="password" className="w-full px-4 py-2 border border-stone-300 dark:border-stone-600 rounded-lg dark:bg-stone-700 dark:text-white" />
                </div>
                <button
                  type="button"
                  onClick={() => setIsLoggedIn(true)}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-full font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  <LogIn size={20} />
                  Login
                </button>
              </form>
            ) : (
              <form className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">Full Name</label>
                  <input type="text" className="w-full px-4 py-2 border border-stone-300 dark:border-stone-600 rounded-lg dark:bg-stone-700 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">Email</label>
                  <input type="email" className="w-full px-4 py-2 border border-stone-300 dark:border-stone-600 rounded-lg dark:bg-stone-700 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">Password</label>
                  <input type="password" className="w-full px-4 py-2 border border-stone-300 dark:border-stone-600 rounded-lg dark:bg-stone-700 dark:text-white" />
                </div>
                <button
                  type="button"
                  onClick={() => setIsLoggedIn(true)}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-full font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  <UserPlus size={20} />
                  Create Account
                </button>
              </form>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <button className="bg-white dark:bg-stone-800 p-6 rounded-2xl shadow-sm hover:shadow-sm border border-stone-200/70 border border-stone-200/70 transition-shadow">
              <Calendar size={32} className="text-indigo-600 mb-3" />
              <h3 className="font-semibold text-stone-900 dark:text-white">My Reservations</h3>
              <p className="text-sm text-stone-600 dark:text-stone-400">View and manage bookings</p>
            </button>
            <button className="bg-white dark:bg-stone-800 p-6 rounded-2xl shadow-sm hover:shadow-sm border border-stone-200/70 border border-stone-200/70 transition-shadow">
              <Heart size={32} className="text-indigo-600 mb-3" />
              <h3 className="font-semibold text-stone-900 dark:text-white">Wishlist</h3>
              <p className="text-sm text-stone-600 dark:text-stone-400">Saved properties</p>
            </button>
            <button className="bg-white dark:bg-stone-800 p-6 rounded-2xl shadow-sm hover:shadow-sm border border-stone-200/70 border border-stone-200/70 transition-shadow">
              <CreditCard size={32} className="text-indigo-600 mb-3" />
              <h3 className="font-semibold text-stone-900 dark:text-white">Payment Methods</h3>
              <p className="text-sm text-stone-600 dark:text-stone-400">Manage cards</p>
            </button>
            <button className="bg-white dark:bg-stone-800 p-6 rounded-2xl shadow-sm hover:shadow-sm border border-stone-200/70 border border-stone-200/70 transition-shadow">
              <User size={32} className="text-indigo-600 mb-3" />
              <h3 className="font-semibold text-stone-900 dark:text-white">Profile Settings</h3>
              <p className="text-sm text-stone-600 dark:text-stone-400">Update information</p>
            </button>
          </div>

          <div className="bg-white dark:bg-stone-800 rounded-2xl p-6 shadow-sm border border-stone-200/70">
            <h2 className="text-xl font-bold text-stone-900 dark:text-white mb-4">Recent Reservations</h2>
            <div className="space-y-4">
              <div className="border border-stone-200 dark:border-stone-700 rounded-lg p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold text-stone-900 dark:text-white">Deluxe Room - SELEDA Grand Hotel</h3>
                    <p className="text-sm text-stone-600 dark:text-stone-400">Aug 15-20, 2026</p>
                  </div>
                  <span className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-3 py-1 rounded-full text-sm">Confirmed</span>
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={() => setIsLoggedIn(false)}
            className="w-full bg-stone-200 dark:bg-stone-700 hover:bg-stone-300 dark:hover:bg-stone-600 text-stone-700 dark:text-stone-300 py-3 rounded-full font-semibold transition-colors"
          >
            Logout
          </button>
        </div>
      )}
    </div>
  );
};

export default GuestAccountModule;
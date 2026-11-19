import { useEffect, useState } from 'react';

type FlagMap = Record<string, { enabled: boolean; rolloutPct: number }>;

let flagsPromise: Promise<FlagMap> | null = null;

const loadFlags = (): Promise<FlagMap> => {
  if (!flagsPromise) {
    const token = localStorage.getItem('erp_token');
    flagsPromise = fetch('/api/admin/control/runtime/flags', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => (r.ok ? r.json() : { flags: {} }))
      .then(j => j.flags || {})
      .catch(() => ({}));
  }
  return flagsPromise;
};

/** Reload flags on next use (call after toggling flags in Admin). */
export const resetFeatureFlags = () => { flagsPromise = null; };

/**
 * Admin-managed feature flag. Unknown flags return `defaultValue`.
 * Partial rollouts (<100%) are treated as off on the client; gate those server-side with `isFeatureEnabled`.
 */
export function useFeatureFlag(key: string, defaultValue = false): boolean {
  const [value, setValue] = useState(defaultValue);
  useEffect(() => {
    let alive = true;
    loadFlags().then(flags => {
      const f = flags[key];
      if (alive) setValue(f ? f.enabled && f.rolloutPct >= 100 : defaultValue);
    });
    return () => { alive = false; };
  }, [key, defaultValue]);
  return value;
}

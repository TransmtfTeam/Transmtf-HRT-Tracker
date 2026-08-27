import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import apiClient from '../api/client';
import { useAuth } from './AuthContext';
import { useSecurityPassword } from './SecurityPasswordContext';
import { computeDataHash, projectForSync, SYNC_HASH_SCHEMA } from '../utils/dataHash';
import { classifyChanges } from '../utils/syncDecision';
import { DEFAULT_WEIGHT_KG } from '../utils/weight';
import { isLogoutInProgress } from '../utils/authSessionState';
import type { ConflictState, FieldDiff } from '../components/SyncConflictModal';

interface CloudSyncContextType {
  isSyncing: boolean;
  lastSyncTime: Date | null;
  syncError: string | null;
  pendingConflict: ConflictState | null;
  resolveConflict: (resolution: 'local' | 'cloud' | 'merge', mergedData?: Record<string, any>) => void;
}

const CloudSyncContext = createContext<CloudSyncContextType | undefined>(undefined);

const LAST_SYNC_TIME_KEY = 'hrt-last-sync-time';
const LAST_PULL_TIME_KEY = 'hrt-last-pull-time';
const LAST_DATA_UPDATED_KEY = 'hrt-last-data-updated';
const LAST_KNOWN_CLOUD_UPDATED_KEY = 'hrt-last-known-cloud-updated';
const LAST_KNOWN_CLOUD_HASH_KEY = 'hrt-last-known-cloud-hash';
const SYNC_INTERVAL = 3000; // 3 seconds
const PULL_CHECK_INTERVAL = 3000; // 3 seconds

// Record the cloud baseline = the cloud state we last successfully synced with.
// This lets us distinguish "local-only changes since baseline" (safe to push) from
// "cloud changed under us while we also changed locally" (real conflict).
function setCloudBaseline(cloudUpdated: string | null | undefined, cloudHash: string) {
  if (cloudUpdated) {
    localStorage.setItem(LAST_KNOWN_CLOUD_UPDATED_KEY, cloudUpdated);
  }
  localStorage.setItem(LAST_KNOWN_CLOUD_HASH_KEY, cloudHash);
}

// Deep-equal for comparing field values (handles arrays, objects, primitives)
function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v: any, i: number) => deepEqual(v, b[i]));
  }
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k, i) => keysB[i] === k && deepEqual(a[k], b[k]));
}

const SYNC_FIELDS = [
  'events', 'weight', 'labResults', 'lang',
  'calibrationModel', 'calibrationMode', 'applyE2LearningToCPA',
  'applyCPAInhibitionToE2', 'themeColor', 'themeMode', 'darkMode',
  'gelProducts',
] as const;

function computeFieldDiffs(localData: Record<string, any>, cloudData: Record<string, any>): FieldDiff[] {
  // Normalize both sides through the shared projection so an absent field on one
  // side (e.g. an older client that never wrote gelProducts) compares equal to
  // the other side's default instead of producing a spurious diff.
  const lp = projectForSync(localData);
  const cp = projectForSync(cloudData);
  const diffs: FieldDiff[] = [];
  for (const field of SYNC_FIELDS) {
    if (!deepEqual(lp[field], cp[field])) {
      diffs.push({ field, localValue: lp[field], cloudValue: cp[field] });
    }
  }
  return diffs;
}

// Synced lists we refuse to clear silently: pulling an empty/absent cloud copy
// over a non-empty local list is treated as a conflict, not an auto-overwrite.
const PROTECTED_LIST_FIELDS = ['events', 'labResults', 'gelProducts'] as const;

function pullWouldClearLocalList(localData: Record<string, any>, cloudData: Record<string, any>): boolean {
  return PROTECTED_LIST_FIELDS.some((f) => {
    const lv = localData[f];
    const cv = cloudData[f];
    return Array.isArray(lv) && lv.length > 0 && (!Array.isArray(cv) || cv.length === 0);
  });
}

export const CloudSyncProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const { hasSecurityPassword, isVerified, securityPassword, passwordVerificationFailed } = useSecurityPassword();
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pendingConflict, setPendingConflict] = useState<ConflictState | null>(null);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isSyncingRef = useRef(false);
  const conflictPendingRef = useRef(false);

  // ── common guards ──
  const canSync = useCallback(() => {
    if (!isAuthenticated || isLogoutInProgress()) return false;
    if (hasSecurityPassword && !isVerified) return false;
    if (hasSecurityPassword && passwordVerificationFailed) return false;
    if (hasSecurityPassword && !securityPassword) return false;
    if (conflictPendingRef.current) return false;
    if (isSyncingRef.current) return false;
    return true;
  }, [isAuthenticated, hasSecurityPassword, isVerified, securityPassword, passwordVerificationFailed]);

  // ── getLocalDataSnapshot ──
  const getLocalDataSnapshot = useCallback(() => {
    const events = localStorage.getItem('hrt-events');
    const weight = localStorage.getItem('hrt-weight');
    const labResults = localStorage.getItem('hrt-lab-results');
    const lang = localStorage.getItem('hrt-lang');
    const calibrationModel = localStorage.getItem('hrt-calibration-model') || 'ekf';
    const calibrationMode = localStorage.getItem('hrt-calibration-mode') || 'retrospective';
    const applyE2Raw = localStorage.getItem('hrt-apply-e2-learning-to-cpa');
    const applyCPARaw = localStorage.getItem('hrt-apply-cpa-inhibition-to-e2');
    const themeColor = localStorage.getItem('hrt-theme-color') || 'sakura';
    const savedThemeMode = localStorage.getItem('hrt-theme-mode');
    const darkModeRaw = localStorage.getItem('hrt-dark-mode');
    const gelProductsRaw = localStorage.getItem('hrt-gel-products');

    const storedLastModified = localStorage.getItem('hrt-last-modified');
    const storedLastDataUpdated = localStorage.getItem(LAST_DATA_UPDATED_KEY);
    // Parse defensively: a single corrupted localStorage entry (e.g. truncated by
    // a browser crash or quota eviction) must not throw out of this function — that
    // would make every subsequent sync silently fail with no user-visible signal.
    const safeParseArray = (raw: string | null): any[] => {
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };
    const parsedEvents = safeParseArray(events);
    const parsedWeightRaw = weight ? parseFloat(weight) : DEFAULT_WEIGHT_KG;
    const parsedWeight = Number.isFinite(parsedWeightRaw) && parsedWeightRaw > 0
      ? parsedWeightRaw
      : DEFAULT_WEIGHT_KG;
    const parsedLabResults = safeParseArray(labResults);
    const resolvedLang = lang || 'en';
    const applyE2LearningToCPA = applyE2Raw === '1' || applyE2Raw?.toLowerCase() === 'true';
    const applyCPAInhibitionToE2 = applyCPARaw === '1' || applyCPARaw?.toLowerCase() === 'true';
    const darkMode = darkModeRaw === '1' || darkModeRaw === 'true';
    const themeMode = savedThemeMode === 'system' || savedThemeMode === 'light' || savedThemeMode === 'dark'
      ? savedThemeMode
      : darkMode ? 'dark' : 'light';
    const gelProducts = safeParseArray(gelProductsRaw);
    const dataHash = computeDataHash({
      events: parsedEvents,
      weight: parsedWeight,
      labResults: parsedLabResults,
      lang: resolvedLang,
      calibrationModel,
      calibrationMode,
      applyE2LearningToCPA,
      applyCPAInhibitionToE2,
      themeColor,
      themeMode,
      darkMode,
      gelProducts,
    });
    localStorage.setItem('hrt-data-hash', dataHash);

    return {
      events: parsedEvents,
      weight: parsedWeight,
      labResults: parsedLabResults,
      lang: resolvedLang,
      calibrationModel,
      calibrationMode,
      applyE2LearningToCPA,
      applyCPAInhibitionToE2,
      themeColor,
      themeMode,
      darkMode,
      gelProducts,
      lastModified: storedLastModified,
      lastDataUpdated: storedLastDataUpdated,
      dataHash,
    };
  }, []);

  // ── push (raw, no pull-check) ──
  const pushLocalDataToCloud = useCallback(async (localData: {
    events: any[];
    weight: number;
    labResults: any[];
    lang: string;
    calibrationModel?: string;
    calibrationMode?: string;
    applyE2LearningToCPA?: boolean;
    applyCPAInhibitionToE2?: boolean;
    themeColor?: string;
    themeMode?: string;
    darkMode?: boolean;
    gelProducts?: any[];
    lastModified: string;
    lastDataUpdated?: string | null;
  }) => {
    const response = await apiClient.updateUserData({
      data: {
        ...localData,
        lastDataUpdated: localData.lastDataUpdated || localData.lastModified,
      },
      password: hasSecurityPassword ? securityPassword : undefined,
    });

    if (response.success) {
      const now = new Date();
      const dataHash = computeDataHash({
        events: localData.events,
        weight: localData.weight,
        labResults: localData.labResults,
        lang: localData.lang,
        calibrationModel: localData.calibrationModel,
        calibrationMode: localData.calibrationMode,
        applyE2LearningToCPA: localData.applyE2LearningToCPA,
        applyCPAInhibitionToE2: localData.applyCPAInhibitionToE2,
        themeColor: localData.themeColor,
        themeMode: localData.themeMode,
        darkMode: localData.darkMode,
        gelProducts: localData.gelProducts,
      });
      setLastSyncTime(now);
      localStorage.setItem(LAST_SYNC_TIME_KEY, now.toISOString());
      localStorage.setItem('hrt-last-modified', localData.lastModified);
      localStorage.setItem('hrt-data-hash', dataHash);
      if (localData.lastDataUpdated) {
        localStorage.setItem(LAST_DATA_UPDATED_KEY, localData.lastDataUpdated);
      }
      // After a successful push, the cloud's state == what we just uploaded,
      // so record it as the new baseline.
      setCloudBaseline(localData.lastDataUpdated || localData.lastModified, dataHash);
      return true;
    }

    setSyncError(response.error || 'Failed to sync to cloud');
    return false;
  }, [hasSecurityPassword, securityPassword]);

  const shouldPullFromCloud = useCallback(() => {
    const lastPull = localStorage.getItem(LAST_PULL_TIME_KEY);
    if (!lastPull) return true;
    return Date.now() - new Date(lastPull).getTime() >= SYNC_INTERVAL;
  }, []);

  // Load last sync time from localStorage
  useEffect(() => {
    if (isAuthenticated) {
      const lastSync = localStorage.getItem(LAST_SYNC_TIME_KEY);
      if (lastSync) setLastSyncTime(new Date(lastSync));
    } else {
      setLastSyncTime(null);
    }
  }, [isAuthenticated]);

  // ── apply cloud data to local ──
  const applyCloudToLocal = useCallback((data: any, localData: Record<string, any>, fallbackTimestamp?: string) => {
    const resolvedLang = data?.lang || localData.lang;
    if (data?.events) localStorage.setItem('hrt-events', JSON.stringify(data.events));
    if (data?.weight !== undefined) localStorage.setItem('hrt-weight', data.weight.toString());
    if (data?.labResults) localStorage.setItem('hrt-lab-results', JSON.stringify(data.labResults));
    if (data?.lang) localStorage.setItem('hrt-lang', data.lang);
    if (data?.calibrationModel) localStorage.setItem('hrt-calibration-model', data.calibrationModel);
    if (data?.calibrationMode) localStorage.setItem('hrt-calibration-mode', data.calibrationMode);
    if (data?.applyE2LearningToCPA !== undefined) localStorage.setItem('hrt-apply-e2-learning-to-cpa', data.applyE2LearningToCPA ? '1' : '0');
    if (data?.applyCPAInhibitionToE2 !== undefined) localStorage.setItem('hrt-apply-cpa-inhibition-to-e2', data.applyCPAInhibitionToE2 ? '1' : '0');
    if (data?.themeColor) localStorage.setItem('hrt-theme-color', data.themeColor);
    if (data?.themeMode === 'system' || data?.themeMode === 'light' || data?.themeMode === 'dark') {
      localStorage.setItem('hrt-theme-mode', data.themeMode);
    } else if (data?.darkMode !== undefined) {
      localStorage.setItem('hrt-theme-mode', data.darkMode ? 'dark' : 'light');
    }
    if (data?.darkMode !== undefined) localStorage.setItem('hrt-dark-mode', data.darkMode ? '1' : '0');
    if (data?.gelProducts !== undefined) localStorage.setItem('hrt-gel-products', JSON.stringify(data.gelProducts));
    if (data?.lastModified || fallbackTimestamp) localStorage.setItem('hrt-last-modified', data?.lastModified || fallbackTimestamp || '');
    if (data?.lastDataUpdated || fallbackTimestamp) localStorage.setItem(LAST_DATA_UPDATED_KEY, data?.lastDataUpdated || fallbackTimestamp || '');
    const dataHash = computeDataHash({
      events: data?.events || [],
      weight: data?.weight ?? localData.weight,
      labResults: data?.labResults || [],
      lang: resolvedLang,
      calibrationModel: data?.calibrationModel || localData.calibrationModel,
      calibrationMode: data?.calibrationMode || localData.calibrationMode,
      applyE2LearningToCPA: data?.applyE2LearningToCPA ?? localData.applyE2LearningToCPA,
      applyCPAInhibitionToE2: data?.applyCPAInhibitionToE2 ?? localData.applyCPAInhibitionToE2,
      themeColor: data?.themeColor || localData.themeColor,
      themeMode: data?.themeMode || localData.themeMode,
      darkMode: data?.darkMode ?? localData.darkMode,
      gelProducts: data?.gelProducts ?? localData.gelProducts,
    });
    localStorage.setItem('hrt-data-hash', dataHash);
    // After applying cloud data locally, our local state == cloud state,
    // so the cloud version we just pulled becomes the new baseline.
    setCloudBaseline(data?.lastDataUpdated || fallbackTimestamp || null, dataHash);
    window.dispatchEvent(new StorageEvent('storage', { key: 'hrt-data-synced', newValue: Date.now().toString() }));
  }, []);

  // ════════════════════════════════════════════════════════════
  //  UNIFIED SYNC — pull-before-push, conflict detection
  //  Called both by the 3-second poll AND by local-data-change.
  // ════════════════════════════════════════════════════════════
  const performSync = useCallback(async () => {
    if (!canSync()) return;

    isSyncingRef.current = true;
    setIsSyncing(true);
    setSyncError(null);

    try {
      // ① Pull cloud data
      const response = await apiClient.getUserData({
        password: hasSecurityPassword ? securityPassword : undefined,
      });

      const localData = getLocalDataSnapshot();
      const now = new Date();

      if (!response.success || !response.data) {
        // GET failed — DO NOT push: we have no idea what cloud actually contains,
        // and pushing blindly would set a stale baseline. The next 3-second poll
        // will retry once the network/auth recovers. Local changes remain in
        // localStorage and will be pushed on the next successful sync.
        setSyncError(response.error || 'Failed to fetch cloud data');
        return;
      }

      const cloudData = response.data.data;

      // ② No cloud data exists → push local
      if (!cloudData) {
        if (localData.lastModified) {
          await pushLocalDataToCloud({ ...localData, lastModified: localData.lastModified });
        }
        setLastSyncTime(now);
        localStorage.setItem(LAST_SYNC_TIME_KEY, now.toISOString());
        localStorage.setItem(LAST_PULL_TIME_KEY, now.toISOString());
        return;
      }

      // ③ Compare hashes
      const cloudHash = computeDataHash({
        events: cloudData.events || [],
        weight: cloudData.weight ?? localData.weight,
        labResults: cloudData.labResults || [],
        lang: cloudData.lang || localData.lang,
        calibrationModel: cloudData.calibrationModel || '',
        calibrationMode: cloudData.calibrationMode || '',
        applyE2LearningToCPA: cloudData.applyE2LearningToCPA ?? localData.applyE2LearningToCPA,
        applyCPAInhibitionToE2: cloudData.applyCPAInhibitionToE2 ?? localData.applyCPAInhibitionToE2,
        themeColor: cloudData.themeColor || localData.themeColor,
        themeMode: cloudData.themeMode || (cloudData.darkMode === undefined ? localData.themeMode : cloudData.darkMode ? 'dark' : 'light'),
        darkMode: cloudData.darkMode ?? localData.darkMode,
        gelProducts: cloudData.gelProducts || [],
      });

      if (cloudHash === localData.dataHash) {
        // Data identical — just sync the lastDataUpdated if missing
        if (!localData.lastDataUpdated && cloudData.lastDataUpdated) {
          localStorage.setItem(LAST_DATA_UPDATED_KEY, cloudData.lastDataUpdated);
        } else if (localData.lastDataUpdated && !cloudData.lastDataUpdated) {
          // Cloud lacks the field, push once so it's recorded
          await pushLocalDataToCloud({ ...localData, lastModified: localData.lastModified || now.toISOString() });
        }
        // Local == cloud, refresh baseline so future pushes don't trip false conflicts
        setCloudBaseline(cloudData.lastDataUpdated || localData.lastDataUpdated || null, cloudHash);
        setLastSyncTime(now);
        localStorage.setItem(LAST_SYNC_TIME_KEY, now.toISOString());
        localStorage.setItem(LAST_PULL_TIME_KEY, now.toISOString());
        return;
      }

      // ④ Data differs — distinguish "local-only changes since baseline" (push, no prompt)
      //    from "cloud changed under us while local also changed" (real conflict).
      const lastKnownCloudUpdated = localStorage.getItem(LAST_KNOWN_CLOUD_UPDATED_KEY);
      const lastKnownCloudHash = localStorage.getItem(LAST_KNOWN_CLOUD_HASH_KEY);
      const cloudDataUpdated = cloudData.lastDataUpdated as string | undefined;
      const localDataUpdated = localData.lastDataUpdated as string | null;

      // Classify whether each side changed since the baseline (pure, tested in
      // src/utils/syncDecision.test.ts — handles the hash-schema-evolution case).
      const { cloudChanged: cloudChangedSinceBaseline, localChanged: localChangedSinceBaseline } = classifyChanges({
        lastKnownCloudUpdated,
        lastKnownCloudHash,
        cloudDataUpdated,
        cloudHash,
        localHash: localData.dataHash,
        localLastModified: localData.lastModified,
        schemaPrefix: SYNC_HASH_SCHEMA,
      });

      // Pull cloud → local, but NEVER silently clear a non-empty local list with
      // an empty/absent cloud copy — escalate to a conflict instead. Used by every
      // pull path (incl. the step-⑤ fallback) so a stale-schema baseline that lands
      // in fallback can't route around the guard. Returns true if it escalated.
      const tryPull = (fallbackTs?: string): boolean => {
        if (pullWouldClearLocalList(localData, cloudData)) {
          const diffs = computeFieldDiffs(localData, cloudData);
          if (diffs.length > 0) {
            conflictPendingRef.current = true;
            setPendingConflict({
              localData,
              cloudData,
              diffs,
              localTime: localDataUpdated || '',
              cloudTime: cloudDataUpdated || '',
            });
            return true;
          }
        }
        applyCloudToLocal(cloudData, localData, fallbackTs);
        return false;
      };

      if (!cloudChangedSinceBaseline && localChangedSinceBaseline) {
        // Only local changed → safe to push without prompting
        await pushLocalDataToCloud({
          ...localData,
          lastModified: localData.lastModified || now.toISOString(),
        });
        setLastSyncTime(now);
        localStorage.setItem(LAST_SYNC_TIME_KEY, now.toISOString());
        localStorage.setItem(LAST_PULL_TIME_KEY, now.toISOString());
        return;
      }

      if (cloudChangedSinceBaseline && !localChangedSinceBaseline) {
        // Only cloud changed → pull, guarded against silently clearing local lists.
        if (tryPull()) return;
        setLastSyncTime(now);
        localStorage.setItem(LAST_SYNC_TIME_KEY, now.toISOString());
        localStorage.setItem(LAST_PULL_TIME_KEY, now.toISOString());
        return;
      }

      if (cloudChangedSinceBaseline && localChangedSinceBaseline) {
        // Both sides diverged from the shared baseline → genuine conflict.
        // Never fall through to timestamp-based auto-resolution here — that would
        // silently overwrite one side's changes. Always prompt the user.
        const diffs = computeFieldDiffs(localData, cloudData);
        if (diffs.length > 0) {
          conflictPendingRef.current = true;
          setPendingConflict({
            localData,
            cloudData,
            diffs,
            localTime: localDataUpdated || '',
            cloudTime: cloudDataUpdated || '',
          });
        }
        return;
      }
      // else: !cloudChanged && !localChanged yet hash differs — shouldn't happen
      // after baseline is set (step ③ would have matched). Fall through for safety.

      // ⑤ Fallback: only reached when no baseline exists yet AND step ④ couldn't decide
      // (e.g. !localChanged && !cloudChanged but hashes differ — extremely rare).
      // Use lastModified to pick a winner conservatively, then establish a baseline.
      const cloudLM = cloudData.lastModified as string | undefined;
      const localLM = localData.lastModified;

      if (cloudLM && localLM) {
        if (new Date(localLM) > new Date(cloudLM)) {
          await pushLocalDataToCloud(localData);
        } else {
          // Cloud newer, or equal lastModified with different hashes — prefer cloud,
          // but guard against silently clearing local lists (escalates to conflict).
          if (tryPull()) return;
        }
      } else if (!cloudLM && localLM) {
        await pushLocalDataToCloud({ ...localData, lastModified: localLM });
      } else if (cloudLM && !localLM) {
        if (tryPull()) return;
      } else {
        // Neither has timestamps — prefer cloud (server-authoritative on cold start),
        // still guarded so a cold-start pull can't wipe non-empty local lists.
        if (tryPull(now.toISOString())) return;
      }

      setLastSyncTime(now);
      localStorage.setItem(LAST_SYNC_TIME_KEY, now.toISOString());
      localStorage.setItem(LAST_PULL_TIME_KEY, now.toISOString());
    } catch (error) {
      console.error('Sync error:', error);
      setSyncError(error instanceof Error ? error.message : 'Sync failed');
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [canSync, hasSecurityPassword, securityPassword, getLocalDataSnapshot, pushLocalDataToCloud, applyCloudToLocal]);

  // ── Resolve conflict ──
  const resolveConflict = useCallback(async (
    resolution: 'local' | 'cloud' | 'merge',
    mergedData?: Record<string, any>,
  ) => {
    if (!pendingConflict) return;

    const { localData, cloudData } = pendingConflict;
    const now = new Date().toISOString();

    try {
      isSyncingRef.current = true;
      setIsSyncing(true);

      if (resolution === 'local') {
        await pushLocalDataToCloud({ ...localData, lastModified: now, lastDataUpdated: now });
        localStorage.setItem('hrt-last-modified', now);
        localStorage.setItem(LAST_DATA_UPDATED_KEY, now);
      } else if (resolution === 'cloud') {
        applyCloudToLocal({ ...cloudData, lastModified: now, lastDataUpdated: now }, localData);
        localStorage.setItem('hrt-last-modified', now);
        localStorage.setItem(LAST_DATA_UPDATED_KEY, now);
        const updatedLocal = getLocalDataSnapshot();
        await pushLocalDataToCloud({ ...updatedLocal, lastModified: now, lastDataUpdated: now });
      } else if (resolution === 'merge' && mergedData) {
        applyCloudToLocal({ ...mergedData, lastModified: now, lastDataUpdated: now }, localData);
        localStorage.setItem('hrt-last-modified', now);
        localStorage.setItem(LAST_DATA_UPDATED_KEY, now);
        const updatedLocal = getLocalDataSnapshot();
        await pushLocalDataToCloud({ ...updatedLocal, lastModified: now, lastDataUpdated: now });
      }

      const syncNow = new Date();
      setLastSyncTime(syncNow);
      localStorage.setItem(LAST_SYNC_TIME_KEY, syncNow.toISOString());
      localStorage.setItem(LAST_PULL_TIME_KEY, syncNow.toISOString());
    } catch (error) {
      console.error('Conflict resolution error:', error);
      setSyncError(error instanceof Error ? error.message : 'Failed to resolve conflict');
    } finally {
      setPendingConflict(null);
      conflictPendingRef.current = false;
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [pendingConflict, pushLocalDataToCloud, applyCloudToLocal, getLocalDataSnapshot]);

  // ── Watch for local data changes → trigger unified sync ──
  useEffect(() => {
    if (!isAuthenticated || isLogoutInProgress()) return;

    const handleStorageChange = (e: StorageEvent) => {
      if (e.storageArea !== localStorage) return;
      const syncKeys = ['hrt-events', 'hrt-weight', 'hrt-lab-results', 'hrt-lang', 'hrt-calibration-model', 'hrt-calibration-mode', 'hrt-apply-e2-learning-to-cpa', 'hrt-apply-cpa-inhibition-to-e2', 'hrt-theme-color', 'hrt-theme-mode', 'hrt-dark-mode', 'hrt-gel-products'];
      if (e.key && syncKeys.includes(e.key)) performSync();
    };

    const handleLocalUpdate = () => performSync();

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('hrt-local-data-updated', handleLocalUpdate as EventListener);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('hrt-local-data-updated', handleLocalUpdate as EventListener);
    };
  }, [isAuthenticated, performSync]);

  // ── Periodic poll + initial sync ──
  useEffect(() => {
    if (!isAuthenticated || isLogoutInProgress()) return;

    // Initial sync on mount / auth change
    performSync();

    pollIntervalRef.current = setInterval(() => {
      if (shouldPullFromCloud()) performSync();
    }, PULL_CHECK_INTERVAL);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [isAuthenticated, performSync, shouldPullFromCloud]);

  return (
    <CloudSyncContext.Provider
      value={{ isSyncing, lastSyncTime, syncError, pendingConflict, resolveConflict }}
    >
      {children}
    </CloudSyncContext.Provider>
  );
};

export const useCloudSync = () => {
  const context = useContext(CloudSyncContext);
  if (!context) throw new Error('useCloudSync must be used within a CloudSyncProvider');
  return context;
};

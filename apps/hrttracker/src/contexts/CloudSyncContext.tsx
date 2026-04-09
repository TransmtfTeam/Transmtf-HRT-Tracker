import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import apiClient from '../api/client';
import { useAuth } from './AuthContext';
import { useSecurityPassword } from './SecurityPasswordContext';
import { computeDataHash, isLogoutInProgress } from '../../logic';

interface CloudSyncContextType {
  isSyncing: boolean;
  lastSyncTime: Date | null;
  syncError: string | null;
}

const CloudSyncContext = createContext<CloudSyncContextType | undefined>(undefined);

const LAST_SYNC_TIME_KEY = 'hrt-last-sync-time';
const LAST_PULL_TIME_KEY = 'hrt-last-pull-time';
const SYNC_INTERVAL = 3000; // 3 seconds
const PULL_CHECK_INTERVAL = 3000; // 3 seconds

export const CloudSyncProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const { hasSecurityPassword, isVerified, securityPassword, passwordVerificationFailed } = useSecurityPassword();
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isSyncingRef = useRef(false);

  const getLocalDataSnapshot = useCallback(() => {
    const events = localStorage.getItem('hrt-events');
    const weight = localStorage.getItem('hrt-weight');
    const labResults = localStorage.getItem('hrt-lab-results');
    const lang = localStorage.getItem('hrt-lang');
    const calibrationModel = localStorage.getItem('hrt-calibration-model') || 'ekf';
    const applyE2Raw = localStorage.getItem('hrt-apply-e2-learning-to-cpa');
    const applyCPARaw = localStorage.getItem('hrt-apply-cpa-inhibition-to-e2');

    const storedLastModified = localStorage.getItem('hrt-last-modified');
    const parsedEvents = events ? JSON.parse(events) : [];
    const parsedWeight = weight ? parseFloat(weight) : 60;
    const parsedLabResults = labResults ? JSON.parse(labResults) : [];
    const resolvedLang = lang || 'en';
    const applyE2LearningToCPA = applyE2Raw === '1' || applyE2Raw?.toLowerCase() === 'true';
    const applyCPAInhibitionToE2 = applyCPARaw === '1' || applyCPARaw?.toLowerCase() === 'true';
    const dataHash = computeDataHash({
      events: parsedEvents,
      weight: parsedWeight,
      labResults: parsedLabResults,
      lang: resolvedLang,
      calibrationModel,
      applyE2LearningToCPA,
      applyCPAInhibitionToE2,
    });
    localStorage.setItem('hrt-data-hash', dataHash);

    return {
      events: parsedEvents,
      weight: parsedWeight,
      labResults: parsedLabResults,
      lang: resolvedLang,
      calibrationModel,
      applyE2LearningToCPA,
      applyCPAInhibitionToE2,
      lastModified: storedLastModified,
      dataHash,
    };
  }, []);

  const pushLocalDataToCloud = useCallback(async (localData: {
    events: any[];
    weight: number;
    labResults: any[];
    lang: string;
    calibrationModel?: string;
    applyE2LearningToCPA?: boolean;
    applyCPAInhibitionToE2?: boolean;
    lastModified: string;
  }) => {
    const response = await apiClient.updateUserData({
      data: localData,
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
        applyE2LearningToCPA: localData.applyE2LearningToCPA,
        applyCPAInhibitionToE2: localData.applyCPAInhibitionToE2,
      });
      setLastSyncTime(now);
      localStorage.setItem(LAST_SYNC_TIME_KEY, now.toISOString());
      localStorage.setItem('hrt-last-modified', localData.lastModified);
      localStorage.setItem('hrt-data-hash', dataHash);
      return true;
    }

    setSyncError(response.error || 'Failed to sync to cloud');
    return false;
  }, [hasSecurityPassword, securityPassword]);

  const shouldPullFromCloud = useCallback(() => {
    const lastPull = localStorage.getItem(LAST_PULL_TIME_KEY);
    if (!lastPull) {
      return true;
    }
    const lastPullTime = new Date(lastPull).getTime();
    return Date.now() - lastPullTime >= SYNC_INTERVAL;
  }, []);

  // Load last sync time from localStorage
  useEffect(() => {
    if (isAuthenticated) {
      const lastSync = localStorage.getItem(LAST_SYNC_TIME_KEY);
      if (lastSync) {
        setLastSyncTime(new Date(lastSync));
      }
    } else {
      setLastSyncTime(null);
    }
  }, [isAuthenticated]);

  // Auto sync to cloud
  const syncToCloud = useCallback(async () => {
    // CRITICAL FIX: Password checks BEFORE ref check (unconditional guard)
    // Don't sync if not authenticated
    if (!isAuthenticated || isLogoutInProgress()) {
      return;
    }

    // If user has security password but hasn't verified it yet, skip sync
    if (hasSecurityPassword && !isVerified) {
      return;
    }

    // CRITICAL FIX: If password verification failed, STOP syncing to prevent infinite retries!
    if (hasSecurityPassword && passwordVerificationFailed) {
      console.warn('Skipping sync: Password verification failed. User needs to enter correct password.');
      return;
    }

    // If user has security password but password is not available, skip sync
    if (hasSecurityPassword && !securityPassword) {
      return;
    }

    // Ref check AFTER password validation
    if (isSyncingRef.current) {
      return;
    }

    isSyncingRef.current = true;
    setIsSyncing(true);
    setSyncError(null);

    try {
      const localData = getLocalDataSnapshot();
      const lastModified = localData.lastModified || new Date().toISOString();
      await pushLocalDataToCloud({ ...localData, lastModified });
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Failed to sync to cloud');
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [
    isAuthenticated,
    hasSecurityPassword,
    isVerified,
    securityPassword,
    passwordVerificationFailed,
    getLocalDataSnapshot,
    pushLocalDataToCloud
  ]);

  // Poll cloud for updates
  const syncFromCloud = useCallback(async () => {
    // CRITICAL FIX: Password checks BEFORE ref check (unconditional guard)
    // Don't sync if not authenticated
    if (!isAuthenticated || isLogoutInProgress()) {
      return;
    }

    // If user has security password but hasn't verified it yet, skip sync
    if (hasSecurityPassword && !isVerified) {
      return;
    }

    // CRITICAL FIX: If password verification failed, STOP syncing to prevent infinite retries!
    if (hasSecurityPassword && passwordVerificationFailed) {
      console.warn('Skipping sync from cloud: Password verification failed. User needs to enter correct password.');
      return;
    }

    // If user has security password but password is not available, skip sync
    if (hasSecurityPassword && !securityPassword) {
      return;
    }

    // CRITICAL FIX: Set isSyncingRef for syncFromCloud too (was missing!)
    if (isSyncingRef.current) {
      return;
    }

    isSyncingRef.current = true;
    setIsSyncing(true);

    try {
      const response = await apiClient.getUserData({
        password: hasSecurityPassword ? securityPassword : undefined
      });

      if (response.success && response.data) {
        const cloudData = response.data.data;
        const localData = getLocalDataSnapshot();
        const now = new Date();

        const applyCloudToLocal = (data: typeof cloudData, fallbackTimestamp?: string) => {
          const resolvedLang = data?.lang || localData.lang;
          if (data?.events) {
            localStorage.setItem('hrt-events', JSON.stringify(data.events));
          }
          if (data?.weight !== undefined) {
            localStorage.setItem('hrt-weight', data.weight.toString());
          }
          if (data?.labResults) {
            localStorage.setItem('hrt-lab-results', JSON.stringify(data.labResults));
          }
          if (data?.lang) {
            localStorage.setItem('hrt-lang', data.lang);
          }
          if (data?.calibrationModel) {
            localStorage.setItem('hrt-calibration-model', data.calibrationModel);
          }
          if (data?.applyE2LearningToCPA !== undefined) {
            localStorage.setItem('hrt-apply-e2-learning-to-cpa', data.applyE2LearningToCPA ? '1' : '0');
          }
          if (data?.applyCPAInhibitionToE2 !== undefined) {
            localStorage.setItem('hrt-apply-cpa-inhibition-to-e2', data.applyCPAInhibitionToE2 ? '1' : '0');
          }
          if (data?.lastModified || fallbackTimestamp) {
            localStorage.setItem('hrt-last-modified', data?.lastModified || fallbackTimestamp || '');
          }
          const dataHash = computeDataHash({
            events: data?.events || [],
            weight: data?.weight ?? localData.weight,
            labResults: data?.labResults || [],
            lang: resolvedLang,
            calibrationModel: data?.calibrationModel || localData.calibrationModel,
            applyE2LearningToCPA: data?.applyE2LearningToCPA ?? localData.applyE2LearningToCPA,
            applyCPAInhibitionToE2: data?.applyCPAInhibitionToE2 ?? localData.applyCPAInhibitionToE2,
          });
          localStorage.setItem('hrt-data-hash', dataHash);

          // Trigger storage event to notify components
          window.dispatchEvent(new StorageEvent('storage', {
            key: 'hrt-data-synced',
            newValue: Date.now().toString()
          }));
        };

        if (cloudData) {
          const cloudLastModified = cloudData.lastModified;
          const localLastModified = localData.lastModified;
          const cloudHash = computeDataHash({
            events: cloudData.events || [],
            weight: cloudData.weight ?? localData.weight,
            labResults: cloudData.labResults || [],
            lang: cloudData.lang || localData.lang,
            calibrationModel: cloudData.calibrationModel || '',
            applyE2LearningToCPA: cloudData.applyE2LearningToCPA ?? localData.applyE2LearningToCPA,
            applyCPAInhibitionToE2: cloudData.applyCPAInhibitionToE2 ?? localData.applyCPAInhibitionToE2,
          });
          const localHash = localData.dataHash;

          if (cloudHash !== localHash) {
            if (cloudLastModified && localLastModified) {
              const cloudTime = new Date(cloudLastModified);
              const localTime = new Date(localLastModified);

              if (localTime > cloudTime) {
                await pushLocalDataToCloud(localData);
              } else {
                applyCloudToLocal(cloudData);
              }
            } else if (!cloudLastModified && localLastModified) {
              await pushLocalDataToCloud({ ...localData, lastModified: localLastModified });
            } else if (cloudLastModified && !localLastModified) {
              applyCloudToLocal(cloudData);
            } else {
              const fallbackTimestamp = new Date().toISOString();
              applyCloudToLocal(cloudData, fallbackTimestamp);
              await pushLocalDataToCloud({
                ...localData,
                ...cloudData,
                lastModified: fallbackTimestamp,
              });
            }
          }
        } else if (localData.lastModified) {
          await pushLocalDataToCloud({ ...localData, lastModified: localData.lastModified });
        }

        setLastSyncTime(now);
        localStorage.setItem(LAST_SYNC_TIME_KEY, now.toISOString());
        localStorage.setItem(LAST_PULL_TIME_KEY, now.toISOString());
      }
    } catch (error) {
      console.error('Poll sync error:', error);
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [
    isAuthenticated,
    hasSecurityPassword,
    isVerified,
    securityPassword,
    passwordVerificationFailed,
    getLocalDataSnapshot,
    pushLocalDataToCloud
  ]);

  // Smart initial sync: compare local and cloud data, sync the newer one
  const initialSmartSync = useCallback(async () => {
    // Same guards as other sync functions
    if (!isAuthenticated || isLogoutInProgress()) return;
    if (hasSecurityPassword && !isVerified) return;
    if (hasSecurityPassword && passwordVerificationFailed) return;
    if (hasSecurityPassword && !securityPassword) return;
    if (isSyncingRef.current) return;

    isSyncingRef.current = true;
    setIsSyncing(true);

    try {
      // Get cloud data
      const cloudResponse = await apiClient.getUserData({
        password: hasSecurityPassword ? securityPassword : undefined
      });

      const localLastModified = localStorage.getItem('hrt-last-modified');

      if (cloudResponse.success && cloudResponse.data?.data) {
        const cloudData = cloudResponse.data.data;
        const cloudLastModified = cloudData.lastModified;

        if (localLastModified && cloudLastModified) {
          const localTime = new Date(localLastModified);
          const cloudTime = new Date(cloudLastModified);

          if (localTime > cloudTime) {
            // Local is newer - push to cloud
            console.log('Local data is newer, pushing to cloud');
            await syncToCloud();
          } else if (cloudTime > localTime) {
            // Cloud is newer - pull from cloud
            console.log('Cloud data is newer, pulling from cloud');
            await syncFromCloud();
          } else {
            // Same timestamp - no sync needed
            console.log('Local and cloud data are in sync');
          }
        } else if (!localLastModified && cloudLastModified) {
          // No local data - pull from cloud
          console.log('No local data, pulling from cloud');
          await syncFromCloud();
        } else if (localLastModified && !cloudLastModified) {
          // No cloud data - push to cloud
          console.log('No cloud data, pushing to cloud');
          await syncToCloud();
        } else {
          // Neither has data - initialize with local data
          console.log('Initializing cloud with local data');
          await syncToCloud();
        }
      } else {
        // No cloud data exists yet - push local data
        console.log('No cloud data exists, pushing local data');
        await syncToCloud();
      }
    } catch (error) {
      console.error('Initial smart sync error:', error);
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [isAuthenticated, hasSecurityPassword, isVerified, securityPassword, passwordVerificationFailed, syncToCloud, syncFromCloud]);

  // Watch for localStorage changes and auto-sync
  useEffect(() => {
    if (!isAuthenticated || isLogoutInProgress()) return;

    const triggerSync = () => {
      syncToCloud();
    };

    const handleStorageChange = (e: StorageEvent) => {
      if (e.storageArea !== localStorage) {
        return;
      }
      const syncKeys = ['hrt-events', 'hrt-weight', 'hrt-lab-results', 'hrt-lang', 'hrt-calibration-model', 'hrt-apply-e2-learning-to-cpa', 'hrt-apply-cpa-inhibition-to-e2'];
      if (e.key && syncKeys.includes(e.key)) {
        triggerSync();
      }
    };

    const handleLocalUpdate = () => {
      triggerSync();
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('hrt-local-data-updated', handleLocalUpdate as EventListener);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('hrt-local-data-updated', handleLocalUpdate as EventListener);
    };
    // CRITICAL FIX: Include syncToCloud in dependencies to pick up new password state
    // This will restart the listener when password state changes
  }, [isAuthenticated, syncToCloud]);

  // Poll cloud every 3 seconds
  useEffect(() => {
    if (!isAuthenticated || isLogoutInProgress()) return;

    if (shouldPullFromCloud()) {
      // Initial smart sync when user logs in (only if we should pull)
      initialSmartSync();
    }

    pollIntervalRef.current = setInterval(() => {
      if (shouldPullFromCloud()) {
        syncFromCloud();
      }
    }, PULL_CHECK_INTERVAL);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
    // CRITICAL FIX: Include sync functions in dependencies to pick up new password state
    // This will restart the interval when password state changes (e.g., after verification)
    // When passwordVerificationFailed changes or password is entered, interval restarts with new closures
  }, [isAuthenticated, initialSmartSync, shouldPullFromCloud, syncFromCloud]);

  return (
    <CloudSyncContext.Provider
      value={{
        isSyncing,
        lastSyncTime,
        syncError,
      }}
    >
      {children}
    </CloudSyncContext.Provider>
  );
};

export const useCloudSync = () => {
  const context = useContext(CloudSyncContext);
  if (!context) {
    throw new Error('useCloudSync must be used within a CloudSyncProvider');
  }
  return context;
};

import { useGetActiveOrganization } from '@/features/organization/api/get-active-organization';
import { createContext, useCallback, useContext, useEffect } from 'react';

import { useGetMetaIntegration } from './get-meta-integration.hook';
import { useSyncMetaData } from './sync-meta-data.hook';

interface MetaSyncContextValue {
  isSyncing: boolean;
  lastSyncAt: string | null;
  error: Error | null;
  triggerSync: () => void;
}

const MetaSyncContext = createContext<MetaSyncContextValue | null>(null);

export const useMetaSync = (): MetaSyncContextValue => {
  const context = useContext(MetaSyncContext);
  if (!context) {
    throw new Error('useMetaSync must be used within MetaSyncProvider');
  }
  return context;
};

function hasSessionSynced(orgId: string): boolean {
  try {
    return sessionStorage.getItem(`meta-sync-${orgId}`) === 'true';
  } catch {
    return false;
  }
}

function markSessionSynced(orgId: string): void {
  try {
    sessionStorage.setItem(`meta-sync-${orgId}`, 'true');
  } catch {
    // ignore
  }
}

export function MetaSyncProvider({ children }: { children: React.ReactNode }) {
  const { data: activeOrg } = useGetActiveOrganization();
  const { isConnected, isLoading: isMetaLoading } = useGetMetaIntegration();

  const { syncMetaData, isSyncing, error } = useSyncMetaData({
    onSuccess: () => {
      // Sync is enqueued; mark the session so we don't re-trigger on every
      // navigation. The worker performs the actual sync in the background.
      if (activeOrg?.id) {
        markSessionSynced(activeOrg.id);
      }
    },
  });

  useEffect(() => {
    if (isMetaLoading || !isConnected || !activeOrg?.id) {
      return;
    }
    if (hasSessionSynced(activeOrg.id)) {
      return;
    }
    syncMetaData();
  }, [activeOrg?.id, isConnected, isMetaLoading, syncMetaData]);

  const triggerSync = useCallback(() => {
    if (isConnected && activeOrg?.id) {
      syncMetaData();
    }
  }, [isConnected, activeOrg?.id, syncMetaData]);

  const value: MetaSyncContextValue = {
    isSyncing,
    // lastSyncAt now comes from the Meta integration record (the sync runs
    // async on the worker and no longer returns a timestamp from the enqueue).
    lastSyncAt: null,
    error,
    triggerSync,
  };

  return (
    <MetaSyncContext.Provider value={value}>
      {children}
    </MetaSyncContext.Provider>
  );
}

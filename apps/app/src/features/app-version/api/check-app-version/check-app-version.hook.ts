import { apiClient } from '@borradh-workspace/api-client';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query-keys';

import type { AppVersionCheck } from '../../types';

/**
 * Read the marketing version of the running binary.
 *
 * `App.getInfo()` is native-only — on web it rejects, and there is no such
 * thing as an outdated web client anyway (the browser always loads the current
 * bundle), so the whole check is skipped there.
 */
const getNativeVersion = async (): Promise<{
  platform: 'ios' | 'android';
  version: string;
} | null> => {
  if (!Capacitor.isNativePlatform()) return null;

  const platform = Capacitor.getPlatform();
  if (platform !== 'ios' && platform !== 'android') return null;

  try {
    const info = await App.getInfo();
    return { platform, version: info.version };
  } catch {
    // Plugin unavailable (simulator without the native layer). Not knowing the
    // version is not grounds for blocking anyone.
    return null;
  }
};

export const useCheckAppVersion = () => {
  const query = useQuery({
    queryKey: queryKeys.appVersion.check(),
    queryFn: async (): Promise<AppVersionCheck | null> => {
      const native = await getNativeVersion();
      if (!native) return null;

      return apiClient.get<AppVersionCheck>(
        `app-version/check?platform=${native.platform}&version=${encodeURIComponent(native.version)}`
      );
    },
    // The answer changes when someone ships a release, not within a session.
    staleTime: 60 * 60 * 1000,
    // Never retry, and never surface a failure as a block. If the API is
    // unreachable, the user gets the app — see the fail-open note on the
    // backend service. Blocking on a network blip would be the worst possible
    // failure mode for a gate whose only escape hatch is the App Store.
    retry: false,
  });

  return {
    check: query.data ?? null,
    isLoading: query.isLoading,
  };
};

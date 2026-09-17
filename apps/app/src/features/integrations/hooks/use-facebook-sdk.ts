import { useRuntimeConfig } from '@borradh-workspace/runtime-config/client';
import { useEffect, useState } from 'react';

type FBSdk = {
  init: (params: {
    appId: string;
    autoLogAppEvents?: boolean;
    xfbml?: boolean;
    version: string;
  }) => void;
  login: (
    callback: (response: {
      authResponse?: { code?: string; accessToken?: string };
      status?: string;
    }) => void,
    params: Record<string, unknown>
  ) => void;
};

declare global {
  interface Window {
    fbAsyncInit?: () => void;
    FB?: FBSdk;
  }
}

const SDK_URL = 'https://connect.facebook.net/en_US/sdk.js';
const SDK_SCRIPT_ID = 'facebook-jssdk';
const GRAPH_API_VERSION = 'v21.0';

let loadPromise: Promise<FBSdk> | null = null;

const loadFacebookSdk = (appId: string): Promise<FBSdk> => {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<FBSdk>((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Facebook SDK cannot load outside the browser'));
      return;
    }

    if (window.FB) {
      window.FB.init({
        appId,
        autoLogAppEvents: true,
        xfbml: false,
        version: GRAPH_API_VERSION,
      });
      resolve(window.FB);
      return;
    }

    window.fbAsyncInit = () => {
      if (!window.FB) {
        reject(new Error('Facebook SDK loaded but FB global is unavailable'));
        return;
      }
      window.FB.init({
        appId,
        autoLogAppEvents: true,
        xfbml: false,
        version: GRAPH_API_VERSION,
      });
      resolve(window.FB);
    };

    if (document.getElementById(SDK_SCRIPT_ID)) return;

    const script = document.createElement('script');
    script.id = SDK_SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.src = SDK_URL;
    script.onerror = () => reject(new Error('Failed to load Facebook SDK'));
    document.body.appendChild(script);
  });

  return loadPromise;
};

/**
 * Loads and initializes the Facebook JS SDK once per page lifecycle. Shared
 * by all Meta "Connect X" buttons (WhatsApp today, Instagram and Facebook
 * when migrated).
 *
 * Returns the FB global once ready. `isReady` is true after init completes.
 */
export const useFacebookSdk = () => {
  const [fb, setFb] = useState<FBSdk | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const { metaAppId } = useRuntimeConfig();
  const appId = metaAppId;

  useEffect(() => {
    if (!appId) {
      setError(new Error('metaAppId is not configured'));
      return;
    }
    let cancelled = false;
    loadFacebookSdk(appId)
      .then((sdk) => {
        if (!cancelled) setFb(sdk);
      })
      .catch((err) => {
        if (!cancelled) setError(err as Error);
      });
    return () => {
      cancelled = true;
    };
  }, [appId]);

  return {
    fb,
    isReady: fb !== null,
    error,
  };
};

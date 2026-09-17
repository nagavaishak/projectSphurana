import { App, type URLOpenListenerEvent } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

import { router } from '@/router';

const APP_HOSTS = new Set(['app.borradh.io']);

function navigateFromUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return;
  }

  if (parsed.protocol === 'https:' && !APP_HOSTS.has(parsed.host)) {
    return;
  }

  const target = `${parsed.pathname || '/'}${parsed.search}${parsed.hash}`;
  router.navigate({ to: target });
}

let installed = false;

export function installDeepLinkListener() {
  if (installed) return;
  if (!Capacitor.isNativePlatform()) return;
  installed = true;

  App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
    navigateFromUrl(event.url);
  });

  void App.getLaunchUrl().then((launch) => {
    if (launch?.url) navigateFromUrl(launch.url);
  });
}

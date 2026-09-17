import { Capacitor } from '@capacitor/core';

/** Default in `index.html` — keep pinch-zoom on mobile web. */
const WEB_VIEWPORT = 'width=device-width, initial-scale=1, viewport-fit=cover';

/**
 * Capacitor WKWebView: `maximum-scale=1` stops iOS from auto-zooming focused
 * inputs with font-size below 16px. Only applied in the native shell.
 */
const NATIVE_VIEWPORT =
  'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover';

function getViewportMeta(): HTMLMetaElement {
  const existing = document.querySelector<HTMLMetaElement>(
    'meta[name="viewport"]'
  );
  if (existing) return existing;

  const meta = document.createElement('meta');
  meta.name = 'viewport';
  document.head.appendChild(meta);
  return meta;
}

/** Patch viewport meta when running inside Capacitor (iOS/Android WebView). */
export function configureNativeViewport(): void {
  const meta = getViewportMeta();
  meta.content = Capacitor.isNativePlatform() ? NATIVE_VIEWPORT : WEB_VIEWPORT;
}

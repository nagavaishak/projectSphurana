import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { useEffect } from 'react';

const STATUS_BAR_LIGHT_BG = '#FFFFFF';
const STATUS_BAR_DARK_BG = '#0A0A0A';

async function syncStatusBarStyle(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const darkUi = document.documentElement.classList.contains('dark');
    // Style.Light = dark glyphs on light background; Style.Dark = light glyphs on dark.
    await StatusBar.setStyle({ style: darkUi ? Style.Dark : Style.Light });
    try {
      await StatusBar.setBackgroundColor({
        color: darkUi ? STATUS_BAR_DARK_BG : STATUS_BAR_LIGHT_BG,
      });
    } catch {
      // Android 15+ may ignore background when edge-to-edge is enforced.
    }
  } catch {
    // Web / simulator without plugin
  }
}

async function ensureStatusBarDoesNotOverlayWebView(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
  } catch {
    // Ignored on Android 15+ (API unsupported — window insets handled natively).
  }
}

/**
 * Native status bar icon contrast + theme sync. Safe-area padding on `body`
 * is avoided because Radix `fixed` portals ignore it and misalign overlays.
 */
export function NativeChromeSync() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    void ensureStatusBarDoesNotOverlayWebView();
    void syncStatusBarStyle();

    const el = document.documentElement;
    const observer = new MutationObserver(() => {
      void syncStatusBarStyle();
    });
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return null;
}

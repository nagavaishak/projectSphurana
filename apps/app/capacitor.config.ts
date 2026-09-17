import type { CapacitorConfig } from '@capacitor/cli';

// Live-reload / tunnel: **opt-in only** (`CAP_USE_DEV_SERVER=true` + `CAP_DEV_SERVER_URL`).
// Otherwise the WebView always loads the bundled SPA from `webDir` (dist) after `cap sync`.
// (Avoids accidentally baking a tunnel URL when `NODE_ENV` is unset during `cap sync`.)
const useDevServer =
  process.env.CAP_USE_DEV_SERVER === 'true' &&
  Boolean(process.env.CAP_DEV_SERVER_URL);
const devServerUrl = process.env.CAP_DEV_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'com.borradh.mobile',
  appName: 'Borradh',
  webDir: 'dist',
  ios: {
    // Edge-to-edge WebView; safe areas come from CSS (`viewport-fit=cover` +
    // `env(safe-area-inset-*)`). `automatic` / `always` inset the layout viewport
    // above the home indicator so `fixed bottom-0` tab bars float with a permanent gap.
    contentInset: 'never',
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    StatusBar: {
      style: 'LIGHT',
      overlaysWebView: false,
      backgroundColor: '#ffffff',
    },
    Intercom: {
      iosApiKey: 'ios_sdk-c3344bc222d36788aeafe46aa09e678ca9d48919',
      iosAppId: 'wbt3tijf',
      androidApiKey: 'android_sdk-8e20177a576f0f526b6aad68320a7afc47b8a446',
      androidAppId: 'wbt3tijf',
    },
    CapacitorUpdater: {
      appId: 'com.borradh.mobile',
      version: '0.0.0',
      autoUpdate: true,
      // Opt-in channel binding for the E2E APK (CAP_DEFAULT_CHANNEL=pr-<N>).
      //
      // Normal binaries leave this undefined and ride the channel assigned in
      // the Capgo dashboard. mobile-e2e sets it so the test APK pulls the
      // bundle that same run just uploaded, which is what makes the emulator
      // suite exercise the OTA'd bytes instead of the copy baked into the APK.
      //
      // `defaultChannel` (not a runtime `setChannel`) is the documented way to
      // do this at app INITIALIZATION — setChannel is for user-driven opt-in
      // and, per the debug card's own message, needs a full app restart to
      // take effect, which is not something a boot-time test can rely on.
      //
      // `directUpdate: 'always'` rides along, and only on the E2E build.
      // The plugin's DEFAULT (directUpdate: false) is "download at start, set
      // when backgrounded" — it downloads the bundle, then defers the install
      // to the next foreground->background transition. CI observed exactly
      // that: "Latest bundle already exists and download is NOT required.
      // Update will occur next time app moves to background." Driving that
      // transition from adb proved unreliable (a HOME keyevent did not make
      // the plugin install, and force-stopping afterwards races it).
      //
      // 'always' installs "after app kill or app resume", so a plain restart
      // applies the bundle deterministically.
      //
      // This DOES diverge from production, which keeps the background-install
      // default. Accepted: the gate's job is to prove the bundle downloads,
      // unpacks and boots — properties of the BUNDLE. Which lifecycle event
      // triggers the swap is plugin behaviour, not something this bundle can
      // regress.
      ...(process.env.CAP_DEFAULT_CHANNEL
        ? {
            defaultChannel: process.env.CAP_DEFAULT_CHANNEL,
            directUpdate: 'always' as const,
          }
        : {}),
    },
  },
  server:
    useDevServer && devServerUrl
      ? {
          url: devServerUrl,
          cleartext: false,
          androidScheme: 'https',
        }
      : {
          androidScheme: 'https',
        },
};

export default config;

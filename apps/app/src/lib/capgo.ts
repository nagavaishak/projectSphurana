import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';

import { logError } from '@/lib/log-error';

/**
 * Capgo OTA helpers for dev binaries.
 *
 * Production / staging binaries ride the channel baked into `capacitor.config.ts`
 * (or set once via `setChannel`). The helpers below let a dev/debug menu
 * switch between channels (`pr-<N>`, `staging`, `production`) at runtime so
 * testers can pull in a specific PR's JS bundle.
 *
 * No-ops on web — Capgo only runs in native runtimes.
 */

// Read from runtime config (set by RuntimeConfigProvider). Module-level read
// is safe because the debug-menu UI only mounts after the provider resolves.
const isProductionBuild = (): boolean =>
  (typeof window !== 'undefined' && window.__CONFIG__
    ? (window.__CONFIG__ as { appEnv?: string }).appEnv
    : undefined) === 'production';

export interface CapgoStatus {
  currentChannel: string | null;
  currentVersion: string | null;
  /** Capgo's per-device identifier — paste this into the dashboard to find the device. */
  deviceId: string | null;
  isNative: boolean;
  /** True on production-env builds, where `switchCapgoChannel` is disabled. */
  isProductionBuild: boolean;
}

export async function getCapgoStatus(): Promise<CapgoStatus> {
  const productionBuild = isProductionBuild();
  if (!Capacitor.isNativePlatform()) {
    return {
      currentChannel: null,
      currentVersion: null,
      deviceId: null,
      isNative: false,
      isProductionBuild: productionBuild,
    };
  }
  // Each call is caught independently — a device with no channel assigned
  // makes `getChannel` reject, but `getDeviceId` should still resolve.
  const [currentChannel, currentVersion, deviceId] = await Promise.all([
    CapacitorUpdater.getChannel()
      .then((r) => r.channel ?? null)
      .catch(() => null),
    CapacitorUpdater.current()
      .then((r) => r.bundle?.version ?? null)
      .catch(() => null),
    CapacitorUpdater.getDeviceId()
      .then((r) => r.deviceId ?? null)
      .catch(() => null),
  ]);
  return {
    currentChannel,
    currentVersion,
    deviceId,
    isNative: true,
    isProductionBuild: productionBuild,
  };
}

/**
 * Tag this device with a searchable ID (the signed-in user's email) so it can
 * be found in the Capgo dashboard's device list instead of by raw UUID.
 * No-op on web; failures are non-fatal.
 */
export async function setCapgoCustomId(customId: string): Promise<void> {
  if (!Capacitor.isNativePlatform() || !customId) return;
  try {
    await CapacitorUpdater.setCustomId({ customId });
  } catch {
    // Non-fatal: the device just stays anonymous in the Capgo dashboard.
  }
}

/**
 * Switch the device to a Capgo channel and force an immediate update check.
 * Refuses to run on production builds (debug-menu use only).
 */
export async function switchCapgoChannel(channel: string): Promise<void> {
  if (isProductionBuild()) {
    throw new Error('switchCapgoChannel is disabled in production builds');
  }
  if (!Capacitor.isNativePlatform()) {
    throw new Error('switchCapgoChannel is a native-only operation');
  }
  await CapacitorUpdater.setChannel({ channel, triggerAutoUpdate: true });
}

/**
 * Reset to the default channel baked into capacitor.config.ts.
 */
export async function resetCapgoChannel(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await CapacitorUpdater.unsetChannel({ triggerAutoUpdate: true });
}

/**
 * Emit an OTA lifecycle event on a stable, OURS-only prefix.
 *
 * The CI gate (apps/app/scripts/maestro-android.sh) used to detect download
 * success/failure by grepping Capgo's own log strings — "Download succeeded",
 * "Download failed", "Cannot download". Those are undocumented, unversioned
 * plugin internals, and `adb logcat` is the WHOLE DEVICE log, so the match was
 * neither stable nor scoped: a refusal pattern once aborted the gate while
 * every Capgo line was healthy, and the matching line was never identified.
 *
 * `[capgo-event]` is emitted only by this app, only from these listeners. A
 * plugin upgrade that rewords its logs cannot silently change what the gate
 * sees, and nothing else on the device can trip it.
 */
const emitOtaEvent = (event: string, detail: Record<string, unknown>): void => {
  const pairs = Object.entries(detail)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ');
  console.log(`[capgo-event] ${event} ${pairs}`);
};

/**
 * Report OTA delivery failures.
 *
 * A failed OTA is SILENT by design: the plugin falls back to the JS baked into
 * the binary and the app boots normally. Nothing crashes, nothing 500s, and
 * the user simply keeps running an old bundle — potentially against an API
 * that has already moved on. Without these listeners a device can sit on stale
 * JS indefinitely and the only signal is a support ticket.
 *
 * CI proves delivery works for ONE emulator on one channel
 * (apps/app/scripts/maestro-android.sh). This is the production counterpart:
 * it tells you what fraction of real devices actually took the bundle you
 * promoted.
 *
 * `logError` fans out to Sentry and PostHog. These are reported as errors, not
 * breadcrumbs, because "the update did not land" is exactly the condition that
 * needs to page someone after a promotion.
 */
export function installCapgoFailureReporting(): void {
  if (!Capacitor.isNativePlatform()) return;

  // Success. Not an error — but the CI gate waits on it, and in production it
  // is the counterpart that makes "downloaded but never applied" visible as a
  // gap rather than an absence of signal.
  void CapacitorUpdater.addListener('downloadComplete', ({ bundle }) => {
    emitOtaEvent('downloadComplete', {
      version: bundle.version,
      id: bundle.id,
    });
  });

  // Download never completed — network, storage, or a bad artifact.
  void CapacitorUpdater.addListener('downloadFailed', ({ version }) => {
    emitOtaEvent('downloadFailed', { version });
    logError(
      'capgo.downloadFailed',
      new Error('Capgo bundle download failed'),
      {
        feature: 'mobile-ota',
        tags: { bundleVersion: version },
      }
    );
  });

  // Downloaded but refused to become active; Capgo rolls back to the previous
  // bundle. Usually a bundle that crashes before notifyAppReady().
  void CapacitorUpdater.addListener('updateFailed', ({ bundle }) => {
    emitOtaEvent('updateFailed', { version: bundle.version, id: bundle.id });
    logError('capgo.updateFailed', new Error('Capgo bundle failed to apply'), {
      feature: 'mobile-ota',
      tags: { bundleVersion: bundle.version, bundleId: bundle.id },
    });
  });

  // The device asked to join a channel that does not permit self-assignment.
  // This is a CONFIGURATION fault, not a device fault: every device on that
  // channel is silently stuck on its baked bundle until someone flips
  // `--self-assign` on the channel.
  void CapacitorUpdater.addListener(
    'channelPrivate',
    ({ channel, message }) => {
      emitOtaEvent('channelPrivate', { channel });
      logError(
        'capgo.channelPrivate',
        new Error(`Capgo channel "${channel}" refused self-assignment`),
        { feature: 'mobile-ota', tags: { channel }, extra: { message } }
      );
    }
  );
}

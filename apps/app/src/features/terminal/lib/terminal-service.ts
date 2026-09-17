/**
 * Stripe Terminal / Tap to Pay service wrapper.
 *
 * Wraps `@capacitor-community/stripe-terminal` behind a native-only, lazily
 * loaded facade so that:
 *   - the **web** bundle never imports the native plugin (dynamic `import()`
 *     gated on `Capacitor.isNativePlatform()`), and calling any method on web
 *     rejects cleanly instead of crashing;
 *   - on capable devices we use the on-device **Tap to Pay** reader
 *     (local-mobile discovery), and in development we use Stripe's
 *     **simulated reader** so no physical hardware or Apple entitlement is
 *     required to exercise the flow.
 *
 * Connection tokens are fetched from our backend (`POST /terminal/connection-token`,
 * agent A3) via `apiClient` — using the plugin's `RequestedConnectionToken`
 * listener rather than its built-in `tokenProviderEndpoint` fetch, so the call
 * carries the app's auth/session headers.
 *
 * Backend contract: `docs/fresha-clone-contracts.md` §7.B.
 */

import { apiClient } from '@borradh-workspace/api-client';
import { Capacitor } from '@capacitor/core';

import { logError } from '@/lib/log-error';

import {
  type CollectPaymentOptions,
  TerminalError,
  type TerminalPaymentPhase,
} from './terminal-types';

// Loaded lazily; typed via `import type` so no runtime dependency leaks into
// the web bundle.
type TerminalModule = typeof import('@capacitor-community/stripe-terminal');
type StripeTerminal = TerminalModule['StripeTerminal'];

const DEFAULT_MERCHANT_NAME = 'Borradh';

/** True only in a native iOS/Android WebView (Tap to Pay is impossible on web). */
export function isTapToPaySupported(): boolean {
  if (!Capacitor.isNativePlatform()) return false;
  const platform = Capacitor.getPlatform();
  return platform === 'ios' || platform === 'android';
}

/**
 * Whether we should drive the flow through the **simulated** reader rather than
 * real Tap to Pay hardware. Dev builds always simulate (no entitlement needed);
 * production builds use the real on-device reader.
 *
 * `VITE_TAP_TO_PAY_SIMULATE=true` forces the simulated reader even in a
 * production-mode bundle (`import.meta.env.DEV === false`). This exists purely
 * for the mobile-E2E lane: the CI debug APK is a `vite build` (DEV is false), so
 * without this override the built app would demand a **real** Tap to Pay reader,
 * which no emulator can provide. The flag is baked in on-disk only by the CI
 * `build-apk` job (`.github/workflows/mobile-e2e.yml`); it is NEVER set in the
 * committed `apps/app/.env.production`, so real Play Store / TestFlight builds
 * keep `usesSimulatedReader() === false` and use the on-device reader.
 */
export function usesSimulatedReader(): boolean {
  return (
    import.meta.env.DEV || import.meta.env.VITE_TAP_TO_PAY_SIMULATE === 'true'
  );
}

let modulePromise: Promise<TerminalModule> | null = null;

/** Dynamically import the native plugin. Rejects on web. */
async function loadModule(): Promise<TerminalModule> {
  if (!isTapToPaySupported()) {
    throw new TerminalError(
      'Tap to Pay is only available in the Borradh mobile app.'
    );
  }
  if (!modulePromise) {
    modulePromise = import('@capacitor-community/stripe-terminal');
  }
  return modulePromise;
}

// --- Session lifecycle ------------------------------------------------------

let initialized = false;
let initPromise: Promise<void> | null = null;
let tokenListenerHandle: { remove: () => Promise<void> } | null = null;

/**
 * Register the connection-token provider and initialize the SDK. Idempotent —
 * repeated calls reuse the in-flight/settled promise for the session.
 */
async function ensureInitialized(plugin: StripeTerminal): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const { TerminalEventsEnum } = await loadModule();

    // The SDK asks for a connection token whenever it needs one; proxy the
    // request to our authenticated backend and hand the secret back.
    tokenListenerHandle = await plugin.addListener(
      TerminalEventsEnum.RequestedConnectionToken,
      async () => {
        try {
          const { secret } = await apiClient.post<{ secret: string }>(
            'terminal/connection-token'
          );
          await plugin.setConnectionToken({ token: secret });
        } catch (error) {
          logError('terminal.connectionToken', error, { feature: 'terminal' });
          // Surface an empty token so the SDK fails fast rather than hanging.
          await plugin.setConnectionToken({ token: '' });
        }
      }
    );

    await plugin.initialize({ isTest: usesSimulatedReader() });
    initialized = true;
  })();

  try {
    await initPromise;
  } catch (error) {
    // Allow a later retry if init failed.
    initPromise = null;
    throw error;
  }
}

/**
 * Ensure a reader is connected. Uses the simulated reader in development and
 * the on-device Tap to Pay reader in production. No-op if already connected.
 */
async function ensureConnected(
  plugin: StripeTerminal,
  opts: { locationId?: string; merchantDisplayName?: string }
): Promise<void> {
  const { TerminalConnectTypes, SimulatedCardType } = await loadModule();

  const { reader: existing } = await plugin.getConnectedReader();
  if (existing) return;

  const simulated = usesSimulatedReader();

  if (simulated) {
    // Deterministic test card for the simulated reader.
    await plugin.setSimulatorConfiguration({
      simulatedCard: SimulatedCardType.Visa,
    });
  }

  const { readers } = await plugin.discoverReaders({
    type: simulated
      ? TerminalConnectTypes.Simulated
      : TerminalConnectTypes.TapToPay,
    ...(opts.locationId ? { locationId: opts.locationId } : {}),
  });

  const reader = readers[0];
  if (!reader) {
    throw new TerminalError(
      simulated
        ? 'No simulated reader was returned by Stripe Terminal.'
        : 'No Tap to Pay reader available on this device. Confirm the device supports Tap to Pay and the Apple entitlement is granted.'
    );
  }

  await plugin.connectReader({
    reader,
    merchantDisplayName: opts.merchantDisplayName ?? DEFAULT_MERCHANT_NAME,
    autoReconnectOnUnexpectedDisconnect: true,
  });
}

/**
 * Collect and confirm an in-person payment for the given PaymentIntent client
 * secret. Resolves once the intent is confirmed; rejects with a
 * {@link TerminalError} (carrying Stripe `code`/`declineCode` when available)
 * on failure or cancellation.
 */
export async function collectTerminalPayment(
  options: CollectPaymentOptions
): Promise<void> {
  const { StripeTerminal, TerminalEventsEnum } = await loadModule();

  const setPhase = (phase: TerminalPaymentPhase) => options.onPhase?.(phase);

  setPhase('initializing');
  await ensureInitialized(StripeTerminal);

  setPhase('discovering');
  // ensureConnected covers both discovery and connection; report connecting
  // once discovery has kicked off.
  const connectPromise = ensureConnected(StripeTerminal, {
    locationId: options.locationId,
    merchantDisplayName: options.merchantDisplayName,
  });
  setPhase('connecting');
  await connectPromise;

  // Capture the first failure emitted during collect/confirm so we can attach
  // Stripe's decline metadata to the thrown error.
  let failure: TerminalError | null = null;
  const failedHandle = await StripeTerminal.addListener(
    TerminalEventsEnum.Failed,
    (info) => {
      failure = new TerminalError(info.message, {
        code: info.code,
        declineCode: info.declineCode,
      });
    }
  );

  try {
    setPhase('waiting_for_card');
    await StripeTerminal.collectPaymentMethod({
      paymentIntent: options.clientSecret,
    });

    setPhase('processing');
    await StripeTerminal.confirmPaymentIntent();

    setPhase('succeeded');
  } catch (error) {
    const terminalError =
      failure ??
      (error instanceof TerminalError
        ? error
        : new TerminalError(
            error instanceof Error ? error.message : 'Payment failed.'
          ));
    setPhase('failed');
    throw terminalError;
  } finally {
    await failedHandle.remove();
  }
}

/**
 * Cancel an in-progress `collectPaymentMethod`. Safe to call when nothing is in
 * flight (no-op / swallowed).
 */
export async function cancelTerminalPayment(): Promise<void> {
  if (!isTapToPaySupported() || !initialized) return;
  try {
    const { StripeTerminal } = await loadModule();
    await StripeTerminal.cancelCollectPaymentMethod();
  } catch (error) {
    logError('terminal.cancel', error, { feature: 'terminal' });
  }
}

/**
 * Tear down the reader connection and listeners. Call when leaving the POS
 * surface. Best-effort — errors are logged, not thrown.
 */
export async function disconnectTerminal(): Promise<void> {
  if (!isTapToPaySupported() || !initialized) return;
  try {
    const { StripeTerminal } = await loadModule();
    const { reader } = await StripeTerminal.getConnectedReader();
    if (reader) await StripeTerminal.disconnectReader();
  } catch (error) {
    logError('terminal.disconnect', error, { feature: 'terminal' });
  } finally {
    if (tokenListenerHandle) {
      await tokenListenerHandle.remove().catch(() => undefined);
      tokenListenerHandle = null;
    }
    initialized = false;
    initPromise = null;
  }
}

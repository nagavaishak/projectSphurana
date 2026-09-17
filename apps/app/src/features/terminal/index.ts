/**
 * Stripe Terminal feature.
 *
 * Capacitor mobile Tap to Pay: the `TapToPayButton` UI, the `useTapToPay`
 * hook, and platform-capability helpers. The native plugin is loaded lazily
 * inside `terminal-service`, so importing from here is safe on the web bundle.
 * The `api/` hooks provide the Terminal connection token the SDK needs.
 *
 * Backend contract: `docs/fresha-clone-contracts.md` §7.B.
 * Device setup / entitlement: `docs/fresha-tap-to-pay.md`.
 */

export * from './api';
export * from './components';
export { useTapToPay, type UseTapToPayResult } from './hooks/use-tap-to-pay';
export {
  cancelTerminalPayment,
  collectTerminalPayment,
  disconnectTerminal,
  isTapToPaySupported,
  usesSimulatedReader,
} from './lib/terminal-service';
export {
  type CollectPaymentOptions,
  TerminalError,
  type TerminalPaymentPhase,
  terminalPhaseLabels,
} from './lib/terminal-types';

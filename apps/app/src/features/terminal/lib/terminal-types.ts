/**
 * Shared types for the Stripe Terminal / Tap to Pay feature.
 *
 * Kept free of any `@capacitor-community/stripe-terminal` imports so this
 * module (and anything that only needs the types) stays in the web bundle
 * without pulling in the native plugin. The plugin is loaded lazily, native
 * only, from `terminal-service.ts`.
 */

/**
 * Coarse-grained state of an in-flight Tap to Pay charge. Drives the progress
 * UI. The ordering roughly follows the collection lifecycle:
 * `initializing → discovering → connecting → waiting_for_card → processing`.
 */
export type TerminalPaymentPhase =
  | 'idle'
  | 'initializing'
  | 'discovering'
  | 'connecting'
  | 'waiting_for_card'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'canceled';

/** Human-readable copy for each phase, safe to render directly in the UI. */
export const terminalPhaseLabels: Record<TerminalPaymentPhase, string> = {
  idle: 'Ready',
  initializing: 'Preparing reader…',
  discovering: 'Looking for a reader…',
  connecting: 'Connecting…',
  waiting_for_card: 'Hold the card or phone near the top of the device',
  processing: 'Processing payment…',
  succeeded: 'Payment approved',
  failed: 'Payment failed',
  canceled: 'Payment canceled',
};

export interface CollectPaymentOptions {
  /**
   * The PaymentIntent **client secret** returned by the backend for a
   * `card_terminal` tender (`terminalClientSecret` on the add-sale-payment
   * response). The native SDK retrieves the PaymentIntent from this secret.
   */
  clientSecret: string;
  /**
   * Stripe Terminal Location id (`tml_…`) to discover Tap to Pay readers at.
   * Required for real Tap to Pay discovery on iOS; ignored for the simulated
   * reader used in development.
   */
  locationId?: string;
  /** Merchant name shown on the Tap to Pay sheet (iOS). Defaults to "Borradh". */
  merchantDisplayName?: string;
  /** Progress callback invoked as the charge moves through its phases. */
  onPhase?: (phase: TerminalPaymentPhase) => void;
}

/** Error thrown by the terminal service; carries Stripe decline metadata when present. */
export class TerminalError extends Error {
  code?: string;
  declineCode?: string;

  constructor(message: string, opts?: { code?: string; declineCode?: string }) {
    super(message);
    this.name = 'TerminalError';
    this.code = opts?.code;
    this.declineCode = opts?.declineCode;
  }
}

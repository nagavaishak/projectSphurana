/**
 * React hook exposing the Tap to Pay flow to components.
 *
 * Thin state wrapper around `terminal-service`: tracks the current
 * {@link TerminalPaymentPhase} and whether a charge is in flight, and exposes
 * `isAvailable` (native + capable platform) so callers can hide the entry point
 * on web.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  cancelTerminalPayment,
  collectTerminalPayment,
  isTapToPaySupported,
  usesSimulatedReader,
} from '../lib/terminal-service';
import {
  type CollectPaymentOptions,
  TerminalError,
  type TerminalPaymentPhase,
} from '../lib/terminal-types';

export interface UseTapToPayResult {
  /** Native + capable platform. Actual reader capability is confirmed at connect time. */
  isAvailable: boolean;
  /** True when running against Stripe's simulated reader (dev builds). */
  isSimulated: boolean;
  /** Current lifecycle phase of the charge. */
  phase: TerminalPaymentPhase;
  /** Convenience flag: a charge is currently in progress. */
  isCollecting: boolean;
  /** Last error, if the most recent attempt failed. */
  error: TerminalError | null;
  /**
   * Collect + confirm a payment for a PaymentIntent client secret. Resolves on
   * success, rejects (and sets `error`) on failure/cancellation.
   */
  collectPayment: (
    options: Omit<CollectPaymentOptions, 'onPhase'>
  ) => Promise<void>;
  /** Cancel an in-flight collection. */
  cancel: () => Promise<void>;
  /** Reset phase/error back to idle (e.g. after dismissing a result). */
  reset: () => void;
}

export function useTapToPay(): UseTapToPayResult {
  const [phase, setPhase] = useState<TerminalPaymentPhase>('idle');
  const [error, setError] = useState<TerminalError | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const safeSetPhase = useCallback((next: TerminalPaymentPhase) => {
    if (mounted.current) setPhase(next);
  }, []);

  const collectPayment = useCallback(
    async (options: Omit<CollectPaymentOptions, 'onPhase'>) => {
      setError(null);
      try {
        await collectTerminalPayment({ ...options, onPhase: safeSetPhase });
      } catch (err) {
        const terminalError =
          err instanceof TerminalError
            ? err
            : new TerminalError(
                err instanceof Error ? err.message : 'Payment failed.'
              );
        if (mounted.current) setError(terminalError);
        throw terminalError;
      }
    },
    [safeSetPhase]
  );

  const cancel = useCallback(async () => {
    await cancelTerminalPayment();
    safeSetPhase('canceled');
  }, [safeSetPhase]);

  const reset = useCallback(() => {
    setPhase('idle');
    setError(null);
  }, []);

  const isCollecting =
    phase !== 'idle' &&
    phase !== 'succeeded' &&
    phase !== 'failed' &&
    phase !== 'canceled';

  return {
    isAvailable: isTapToPaySupported(),
    isSimulated: usesSimulatedReader(),
    phase,
    isCollecting,
    error,
    collectPayment,
    cancel,
    reset,
  };
}

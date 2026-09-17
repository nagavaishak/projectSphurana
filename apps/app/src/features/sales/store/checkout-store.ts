import { create } from 'zustand';

/** Everything needed to boot a checkout: an existing sale, or the seeds to
 * create one (appointment / walk-in / pre-selected client). */
export interface CheckoutParams {
  saleId?: string;
  appointmentId?: string;
  appointmentName?: string;
  leadId?: string;
  /** Quick-payment mode: prompt for a free-text amount first, then jump the
   * flow straight to the tip step (skips the cart). */
  quickPayment?: boolean;
  /** Open the checkout with the gift-card selection grid already showing (the
   * "Sell gift card" entry point from the gift cards page). */
  sellGiftCard?: boolean;
}

interface CheckoutStore {
  open: boolean;
  params: CheckoutParams;
  /**
   * Quick-payment amount-entry phase: a standalone keypad is shown WITHOUT the
   * checkout sheet. Only after an amount is entered does the sheet open (at the
   * tip step). Keeps the sheet from sliding out before "Continue".
   */
  quickPaymentEntry: boolean;
  /** Open the checkout sheet, optionally seeded with a sale/appointment/lead. */
  openCheckout: (params?: CheckoutParams) => void;
  closeCheckout: () => void;
  /** Begin quick payment: show the amount keypad only (sheet stays closed). */
  startQuickPayment: () => void;
  /** Abandon quick-payment amount entry. */
  cancelQuickPayment: () => void;
}

/**
 * Global checkout state. The wide checkout Sheet is mounted once in the
 * dashboard shell; any entry point (calendar appointment, sales list, daily
 * summary, gift cards) opens it through this store instead of navigating to a
 * route.
 */
export const useCheckoutStore = create<CheckoutStore>((set) => ({
  open: false,
  params: {},
  quickPaymentEntry: false,
  openCheckout: (params = {}) =>
    set({ open: true, params, quickPaymentEntry: false }),
  closeCheckout: () =>
    set({ open: false, params: {}, quickPaymentEntry: false }),
  startQuickPayment: () =>
    set({ quickPaymentEntry: true, open: false, params: {} }),
  cancelQuickPayment: () => set({ quickPaymentEntry: false }),
}));

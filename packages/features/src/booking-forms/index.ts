export * from './models/index.js';
export * from './services/index.js';

// The single answer to "what does this booking cost online?", plus the
// transitional legacy-field adapters. Exported because Claire quotes from the
// SAME resolver the booking charges from — that is the whole point of it.
export {
  DEPOSIT_ROUNDING_CENTS,
  MIN_CHARGEABLE_CENTS,
  canPrepayInFull,
  hasPercentBase,
  resolveBookingPayment,
  roundDepositUp,
  serviceDepositCents,
  type BookingPaymentDefaults,
  type BookingPaymentService,
  type ResolvedBookingPayment,
} from './shared/resolve-booking-payment.js';
export {
  toBookingPaymentDefaults,
  toBookingPaymentService,
} from './shared/booking-payment-adapters.js';

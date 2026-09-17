/**
 * Cart / config helpers for the multi-service booking wizard.
 *
 * Ported from `apps/app/src/routes/book/-components/booking-cart.ts`. Two
 * imports could not come along and are replaced in kind, not in spirit:
 *  - `resolveBookingPayment` → `./resolve-booking-payment` (a verbatim copy).
 *  - `formatServicePrice` → `@/lib/service-price` (the existing inlined mirror).
 *  - `TZDate` → nothing: this module no longer builds zoned Dates at all;
 *    formatting happens in `./wizard-time`, which takes the zone directly.
 *
 * The public booking config carries a structured price per service
 * (`priceType` + `priceCents`), the org's display `currency` ({ code, symbol }),
 * and each service's customer-chosen `variants`. Display is ALWAYS derived from
 * these via `formatServicePrice` — there is no freeform price string any more,
 * and the currency symbol comes from the config, never guessed from a "£" in a
 * price string.
 */

import { formatServicePrice } from '@/lib/service-price';

import { resolveBookingPayment } from './resolve-booking-payment';
import type {
  BookingPaymentDefaults,
  BookingPaymentService,
  GeneralBookingConfig,
  ResolvedBookingPayment,
  ServicePriceType,
} from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The per-service half of the resolver's input. Price lives on `WizardService`
 * itself, so only the policy fields are carried here.
 */
export type ServicePaymentConfig = Omit<
  BookingPaymentService,
  'priceType' | 'priceCents'
>;

export interface WizardVariant {
  id: string;
  name: string;
  /** Chosen-variant price in cents; null → priced on consultation. */
  priceCents: number | null;
  /** Overrides the service duration when set. */
  durationMinutes: number | null;
}

export interface WizardService {
  id: string;
  name: string;
  /** Structured price shape (fixed | from | free | poa). */
  priceType: ServicePriceType;
  /** Machine-readable anchor price in cents — the running total's only input. */
  priceCents: number | null;
  appointmentDuration: number | null;
  description: string | null;
  /** Category key (e.g. "treatment", "nails") — drives the category chips. */
  category: string | null;
  /**
   * This service's own payment configuration. A null `paymentPolicy` inherits
   * the org's `paymentDefaults` — it does NOT mean "pay in clinic".
   */
  payment: ServicePaymentConfig;
  /** Customer-chosen pricing options. A service WITH variants forces a pick. */
  variants: WizardVariant[];
}

export interface WizardCurrency {
  code: string;
  symbol: string;
}

export interface WizardPractitioner {
  id: string;
  name: string;
  photo: string | null;
  title: string | null;
  /** Service IDs this practitioner can perform (from practitioner_service). */
  serviceIds: string[];
}

export interface WizardConfig {
  organizationName: string;
  organizationSlug: string;
  organizationLogo: string | null;
  /** Venue address shown in the cart panel header (optional). */
  organizationAddress: string | null;
  /** The org's display currency — every `priceCents` is in it. */
  currency: WizardCurrency;
  /** IANA timezone for rendering slot times; null → browser-local fallback. */
  timezone: string | null;
  /** Cancellation-policy inputs (optional; drive the Confirm-step copy). */
  reschedulingNoticeRequiredHours: number | null;
  noShowOrLateCancelFeeCents: number | null;
  /** Org-level payment defaults a service with no policy of its own inherits. */
  paymentDefaults: BookingPaymentDefaults;
  services: WizardService[];
  /** Bookable practitioners; when non-empty the wizard shows a Professional step. */
  practitioners: WizardPractitioner[];
}

/** One cart line: a chosen service, optionally narrowed to a variant. */
export interface CartSelection {
  serviceId: string;
  /** The chosen variant id, or null for a service with no variants. */
  variantId: string | null;
}

export interface CartTotal {
  /** Exact total in cents, or null when at least one line has no price. */
  totalCents: number | null;
  /** True only when EVERY selected line carries a price. */
  isExact: boolean;
  /** Sum of the KNOWN lines — the "from £X" figure. Null when none are priced. */
  fromCents: number | null;
}

// ---------------------------------------------------------------------------
// Config normalisation
// ---------------------------------------------------------------------------

function readNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function readString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Every default here is the take-nothing one, on purpose.
 *
 * The API and this app do not deploy together, so the page can briefly run
 * against a config that predates `paymentDefaults`. Degrading to "nothing due
 * online" under-promises: the server still resolves the real amount and the
 * confirmation step hands the customer to Stripe. Degrading the other way is
 * what shipped a booking that said "Pay deposit & book" and then charged
 * nothing.
 */
function readPaymentDefaults(v: unknown): BookingPaymentDefaults {
  const raw = (v ?? {}) as Record<string, unknown>;
  return {
    defaultPaymentPolicy:
      raw.defaultPaymentPolicy === 'deposit' ||
      raw.defaultPaymentPolicy === 'full'
        ? raw.defaultPaymentPolicy
        : 'in_clinic',
    defaultDepositBasis:
      raw.defaultDepositBasis === 'percent' ? 'percent' : 'fixed',
    defaultDepositAmountCents: readNumber(raw.defaultDepositAmountCents),
    defaultDepositPercent: readNumber(raw.defaultDepositPercent),
    depositAggregation:
      raw.depositAggregation === 'largest' ? 'largest' : 'sum',
  };
}

/** Same take-nothing bias as `readPaymentDefaults`; null = inherit the org. */
function readServicePayment(v: unknown): ServicePaymentConfig {
  const raw = (v ?? {}) as Record<string, unknown>;
  return {
    paymentPolicy:
      raw.paymentPolicy === 'deposit' ||
      raw.paymentPolicy === 'full' ||
      raw.paymentPolicy === 'in_clinic'
        ? raw.paymentPolicy
        : null,
    depositBasis:
      raw.depositBasis === 'percent' || raw.depositBasis === 'fixed'
        ? raw.depositBasis
        : null,
    depositAmountCents: readNumber(raw.depositAmountCents),
    depositPercent: readNumber(raw.depositPercent),
  };
}

/** Normalise the raw API config into the wizard's shape. */
export function toWizardConfig(config: GeneralBookingConfig): WizardConfig {
  const raw = config as unknown as Record<string, unknown>;

  const practitionersRaw = Array.isArray(config.practitioners)
    ? config.practitioners
    : [];

  return {
    organizationName: config.organizationName,
    organizationSlug: config.organizationSlug,
    organizationLogo: config.organizationLogo,
    organizationAddress: readString(raw.organizationAddress),
    currency: {
      code: config.currency?.code ?? 'EUR',
      symbol: config.currency?.symbol ?? '€',
    },
    timezone: readString(config.timezone),
    reschedulingNoticeRequiredHours: readNumber(
      config.reschedulingNoticeRequiredHours
    ),
    noShowOrLateCancelFeeCents: readNumber(config.noShowOrLateCancelFeeCents),
    paymentDefaults: readPaymentDefaults(raw.paymentDefaults),
    services: (config.services ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      priceType: s.priceType,
      priceCents: s.priceCents,
      appointmentDuration: s.appointmentDuration,
      description: s.description,
      category: readString(s.category),
      payment: readServicePayment((s as { payment?: unknown }).payment),
      variants: (s.variants ?? []).map((v) => ({
        id: v.id,
        name: v.name,
        priceCents: v.priceCents,
        durationMinutes: v.durationMinutes,
      })),
    })),
    practitioners: practitionersRaw.map((p) => ({
      id: String(p.id ?? ''),
      name: String(p.name ?? ''),
      photo: readString(p.photo),
      title: readString(p.title),
      serviceIds: Array.isArray((p as { serviceIds?: unknown }).serviceIds)
        ? ((p as { serviceIds: unknown[] }).serviceIds.filter(
            (id): id is string => typeof id === 'string'
          ) as string[])
        : [],
    })),
  };
}

// ---------------------------------------------------------------------------
// Price display (always via formatServicePrice)
// ---------------------------------------------------------------------------

/** The headline price for a service row, e.g. "€50" / "From €35" / "Free". */
export function serviceHeadlinePrice(
  service: Pick<WizardService, 'priceType' | 'priceCents' | 'variants'>,
  symbol: string
): string {
  return formatServicePrice({
    priceType: service.priceType,
    priceCents: service.priceCents,
    currencySymbol: symbol,
    hasVariants: service.variants.length > 0,
  });
}

/** A single variant's price, e.g. "€35" (or "Price on consultation" if unpriced). */
export function variantPrice(variant: WizardVariant, symbol: string): string {
  return formatServicePrice({
    priceType: 'fixed',
    priceCents: variant.priceCents,
    currencySymbol: symbol,
  });
}

/** The price of a chosen cart line (variant price when picked, else service). */
export function lineHeadlinePrice(
  service: WizardService,
  variant: WizardVariant | null,
  symbol: string
): string {
  if (variant) return variantPrice(variant, symbol);
  return serviceHeadlinePrice(service, symbol);
}

// ---------------------------------------------------------------------------
// Cart line resolution
// ---------------------------------------------------------------------------

export interface ResolvedCartLine {
  serviceId: string;
  variantId: string | null;
  /** "Service" or "Service · Variant". */
  name: string;
  variantName: string | null;
  priceCents: number | null;
  priceType: ServicePriceType;
  durationMinutes: number;
  hasVariants: boolean;
}

const findVariant = (
  service: WizardService,
  variantId: string | null
): WizardVariant | null =>
  variantId ? (service.variants.find((v) => v.id === variantId) ?? null) : null;

/** Resolve a cart selection against the config into a display+price line. */
export function resolveCartLine(
  config: WizardConfig,
  selection: CartSelection
): ResolvedCartLine | null {
  const service = config.services.find((s) => s.id === selection.serviceId);
  if (!service) return null;
  const variant = findVariant(service, selection.variantId);
  return {
    serviceId: service.id,
    variantId: variant?.id ?? null,
    name: service.name,
    variantName: variant?.name ?? null,
    priceCents: variant ? variant.priceCents : service.priceCents,
    priceType: variant ? 'fixed' : service.priceType,
    durationMinutes:
      variant?.durationMinutes ?? service.appointmentDuration ?? 30,
    hasVariants: service.variants.length > 0,
  };
}

export function resolveCart(
  config: WizardConfig,
  cart: readonly CartSelection[]
): ResolvedCartLine[] {
  return cart
    .map((selection) => resolveCartLine(config, selection))
    .filter((line): line is ResolvedCartLine => line !== null);
}

// ---------------------------------------------------------------------------
// Running total (client-side replica of features' computeCartTotal)
// ---------------------------------------------------------------------------

/**
 * Sum the cart's prices. Exact only when every line has a `priceCents`;
 * otherwise the total is unknowable ("from £Y", where Y sums the known lines).
 */
export function computeCartTotal(
  items: ReadonlyArray<{ priceCents: number | null }>
): CartTotal {
  if (items.length === 0) {
    return { totalCents: 0, isExact: true, fromCents: 0 };
  }
  const known = items.filter((i) => i.priceCents != null);
  const sum = known.reduce((acc, i) => acc + (i.priceCents ?? 0), 0);
  const allKnown = known.length === items.length;
  return allKnown
    ? { totalCents: sum, isExact: true, fromCents: sum }
    : {
        totalCents: null,
        isExact: false,
        fromCents: known.length ? sum : null,
      };
}

// ---------------------------------------------------------------------------
// What's due online
// ---------------------------------------------------------------------------

/**
 * What to CALL the amount due, per the resolver's own `reason`.
 *
 * One function for the button, the cart summary line and the confirmation
 * screen, because they are three places to describe one charge and they were
 * already drifting: the summary said "Deposit due today" under any amount, so a
 * `full` prepay would render "Pay & book" directly above "Deposit due today".
 *
 * `mixed` is part prepay, part deposit. It is neither, so it says neither.
 */
export function paymentDueLabels(reason: ResolvedBookingPayment['reason']): {
  cta: string;
  summary: string;
} {
  switch (reason) {
    case 'deposit':
      return { cta: 'Pay deposit & book', summary: 'Deposit due today' };
    case 'full':
    case 'mixed':
      return { cta: 'Pay & book', summary: 'Due today' };
    default:
      return { cta: 'Confirm', summary: 'Due today' };
  }
}

/**
 * What this cart costs online, via `resolveBookingPayment` — the SAME function
 * submit-general-booking runs to decide what Stripe is asked for.
 */
export function cartPaymentDue(
  config: Pick<WizardConfig, 'services' | 'paymentDefaults'>,
  cart: readonly CartSelection[]
): ResolvedBookingPayment {
  // Distinct services, in cart order. A service added twice is one booked
  // service, matching how the server resolves the cart before charging.
  const bookedServiceIds = [...new Set(cart.map((c) => c.serviceId))];

  const services = bookedServiceIds.flatMap<BookingPaymentService>((id) => {
    const svc = config.services.find((s) => s.id === id);
    if (!svc) return [];
    return [
      {
        priceType: svc.priceType,
        priceCents: svc.priceCents,
        ...svc.payment,
      },
    ];
  });

  return resolveBookingPayment(services, config.paymentDefaults);
}

// ---------------------------------------------------------------------------
// Money / duration formatting
// ---------------------------------------------------------------------------

/** Format a minor-unit amount as e.g. "£20" or "€25.50". */
export function formatMoney(cents: number, symbol: string): string {
  const major = cents / 100;
  const value = Number.isInteger(major) ? String(major) : major.toFixed(2);
  return `${symbol}${value}`;
}

/** Render a cart total per the Fresha rule: exact "£X" or "from £Y" or "—". */
export function formatCartTotal(total: CartTotal, symbol: string): string {
  if (total.isExact && total.totalCents != null) {
    return formatMoney(total.totalCents, symbol);
  }
  if (total.fromCents != null) {
    return `from ${formatMoney(total.fromCents, symbol)}`;
  }
  return '—';
}

/** Human duration, e.g. 15 → "15 mins", 90 → "1 hour 30 mins". */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0 mins';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(hours === 1 ? '1 hour' : `${hours} hours`);
  if (mins > 0) parts.push(`${mins} mins`);
  return parts.join(' ');
}

/** A service's duration, defaulting to 30 mins when the catalog omits it. */
export function serviceDuration(service: {
  appointmentDuration: number | null;
}): number {
  return service.appointmentDuration ?? 30;
}

// ---------------------------------------------------------------------------
// Cancellation-policy copy
// ---------------------------------------------------------------------------

/**
 * Fresha's "Cancellation policy" body text. No fee → free anytime; a fee →
 * free up to the notice window, then the fee applies. Null fee means the org
 * charges nothing (NOT €0.00).
 */
export function cancellationPolicyText(
  config: Pick<
    WizardConfig,
    'reschedulingNoticeRequiredHours' | 'noShowOrLateCancelFeeCents'
  >,
  symbol: string
): string {
  const fee = config.noShowOrLateCancelFeeCents;
  if (fee == null || fee <= 0) {
    return 'Cancel for free anytime.';
  }
  const hours = config.reschedulingNoticeRequiredHours ?? 24;
  return `Free cancellation up to ${hours}h before. Cancel or reschedule after that and a ${formatMoney(
    fee,
    symbol
  )} fee applies.`;
}

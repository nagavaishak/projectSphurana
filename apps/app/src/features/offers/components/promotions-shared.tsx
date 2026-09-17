/**
 * Formatting helpers + status pill for the promotions list.
 *
 * "Scheduled" status is derived (active + validFrom > now); the backend does
 * not store it as a separate enum value.
 */

import type { Offer, OfferState } from '@borradh-workspace/api-client/types';

export type OfferListItem = Offer & {
  serviceIds: string[];
  locationIds: string[];
};

/** Derived status used by the Status pill — scheduled isn't a stored state. */
export type DerivedStatus = OfferState | 'scheduled';

export function deriveStatus(offer: OfferListItem): DerivedStatus {
  if (offer.state !== 'active') return offer.state;
  if (offer.validFrom && new Date(offer.validFrom) > new Date()) {
    return 'scheduled';
  }
  if (offer.validUntil && new Date(offer.validUntil) < new Date()) {
    return 'expired';
  }
  return 'active';
}

export function StatusPill({ status }: { status: DerivedStatus }) {
  const palette: Record<DerivedStatus, string> = {
    active:
      'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300',
    scheduled:
      'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300',
    expired: 'bg-muted text-muted-foreground border-border',
    paused: 'bg-amber-50 text-amber-700 border-amber-200',
    draft: 'bg-muted text-muted-foreground border-border',
  };
  const label: Record<DerivedStatus, string> = {
    active: 'Active',
    scheduled: 'Scheduled',
    expired: 'Expired',
    paused: 'Paused',
    draft: 'Draft',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${palette[status]}`}
    >
      <span
        className="size-1.5 rounded-full bg-current opacity-70"
        aria-hidden
      />
      {label[status]}
    </span>
  );
}

// Serialize<T> distributes oddly over `null`, so nullable integer columns
// land here as `number | string | null`. Coerce with Number() before doing
// arithmetic.
export function num(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

export function formatDiscount(offer: OfferListItem): string {
  switch (offer.discountType) {
    case 'percentage': {
      const v = num(offer.discountPercent);
      return v != null ? `${v}%` : '—';
    }
    case 'fixed_amount': {
      const cents = num(offer.discountAmountCents);
      return cents != null ? `€${(cents / 100).toFixed(2)}` : '—';
    }
    case 'fixed_price': {
      const offered = num(offer.offerPriceCents);
      const original = num(offer.originalPriceCents);
      if (offered != null && original != null) {
        const saved = (original - offered) / 100;
        return `€${saved.toFixed(2)} off`;
      }
      return offered != null ? `€${(offered / 100).toFixed(2)}` : '—';
    }
    case 'buy_x_get_y': {
      const buy = num(offer.buyQuantity);
      const get = num(offer.getQuantity);
      return buy && get ? `Buy ${buy}, Get ${get}` : '—';
    }
    default:
      return '—';
  }
}

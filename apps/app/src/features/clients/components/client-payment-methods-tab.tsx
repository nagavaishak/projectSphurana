import { format } from 'date-fns';
import { CreditCard, Gift, Lock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { GiftCard } from '@borradh-workspace/api-client/types';
import { useClientGiftCards, useClientSavedCards } from '../api';
import { formatMoney } from '../lib/format-money';

/**
 * Gift cards have no status column — state is derived from the ledger
 * (balance 0 = redeemed, expiry in the past = expired). See contract §1.2.4.
 */
function giftCardState(card: GiftCard): {
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
} {
  const expired =
    card.expiresAt && new Date(card.expiresAt).getTime() < Date.now();
  if (expired) return { label: 'Expired', variant: 'destructive' };
  if (card.balanceCents <= 0) return { label: 'Redeemed', variant: 'outline' };
  return { label: 'Active', variant: 'default' };
}

function GiftCardItem({ card }: { card: GiftCard }) {
  const state = giftCardState(card);
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Gift className="size-5 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-medium">{card.code}</p>
          <p className="text-xs text-muted-foreground">
            {card.expiresAt
              ? `Expires ${format(new Date(card.expiresAt), 'd MMM yyyy')}`
              : 'No expiry'}
          </p>
        </div>
      </div>
      <div className="text-right">
        <p className="font-semibold">
          {formatMoney(card.balanceCents, card.currency)}
        </p>
        <div className="mt-1 flex items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground">
            of {formatMoney(card.initialAmountCents, card.currency)}
          </span>
          <Badge variant={state.variant} className="text-xs">
            {state.label}
          </Badge>
        </div>
      </div>
    </div>
  );
}

function GiftCardsSection({ leadId }: { leadId: string }) {
  const { giftCards, isLoading, isError } = useClientGiftCards(leadId);

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">Gift cards</h3>
      {isLoading && (
        <div className="space-y-2">
          {[0, 1].map((n) => (
            <Skeleton key={n} className="h-16 w-full" />
          ))}
        </div>
      )}
      {isError && (
        <p className="text-sm text-muted-foreground">
          Failed to load gift cards.
        </p>
      )}
      {!isLoading && !isError && giftCards.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No gift cards owned by this client.
        </div>
      )}
      {!isLoading && !isError && giftCards.length > 0 && (
        <div className="space-y-2">
          {giftCards.map((card) => (
            <GiftCardItem key={card.id} card={card} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Saved cards (Stripe SetupIntent) — coming soon. The SetupIntent backend does
 * not exist yet, so this renders a designed empty state instead of inventing an
 * endpoint. The hook (`useClientSavedCards`) is already wired, so when the
 * backend lands the empty state auto-populates with no structural change.
 */
function SavedCardsSection({ leadId }: { leadId: string }) {
  const { cards, isComingSoon } = useClientSavedCards(leadId);

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">Saved cards</h3>
      {isComingSoon || cards.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-muted">
            <Lock className="size-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">Saved cards coming soon</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Let clients securely store a card on file for faster checkout and
            no-show protection. This will light up once card-on-file is enabled
            for your account.
          </p>
          <Badge variant="outline" className="mt-1 text-xs">
            Coming soon
          </Badge>
        </div>
      ) : (
        <div className="space-y-2">
          {cards.map((card) => (
            <div
              key={card.id}
              className="flex items-center justify-between gap-4 rounded-lg border p-4"
            >
              <div className="flex items-center gap-3">
                <CreditCard className="size-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium capitalize">
                    {card.brand} ···· {card.last4}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Expires {card.expMonth}/{card.expYear}
                  </p>
                </div>
              </div>
              {card.isDefault && (
                <Badge variant="secondary" className="text-xs">
                  Default
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function ClientPaymentMethodsTab({ leadId }: { leadId: string }) {
  return (
    <div className="space-y-8">
      <GiftCardsSection leadId={leadId} />
      <SavedCardsSection leadId={leadId} />
    </div>
  );
}

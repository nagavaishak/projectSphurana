import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { WhatsAppAccount } from '@/features/integrations/types';
import { Clock, RefreshCw } from 'lucide-react';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Returns the smallest number of days until any WhatsApp account's token
 * expires, or null if no account is expiring within the warning window.
 *
 * Only considers accounts whose token is still valid but under the 7-day
 * threshold. Already-expired / `needs_reconnect` accounts are handled by
 * the shared `reconnectItems` banner in `integrations-grid.tsx` so we
 * don't double-show them here.
 */
function getSoonestExpiringDays(accounts: WhatsAppAccount[]): number | null {
  let soonest = Number.POSITIVE_INFINITY;
  for (const account of accounts) {
    if (account.tokenStatus === 'needs_reconnect') continue;
    if (!account.tokenExpiresAt) continue;
    const msLeft = new Date(account.tokenExpiresAt).getTime() - Date.now();
    if (msLeft <= 0) continue; // already expired — handled elsewhere
    if (msLeft >= SEVEN_DAYS_MS) continue;
    const days = Math.max(1, Math.ceil(msLeft / MS_PER_DAY));
    if (days < soonest) soonest = days;
  }
  return Number.isFinite(soonest) ? soonest : null;
}

interface WhatsAppHealthBannerProps {
  accounts: WhatsAppAccount[];
  onReconnect: () => void;
}

/**
 * "Expires soon" warning banner for WhatsApp accounts within 7 days of
 * token expiry. Hidden when all accounts are healthy, already expired,
 * or no accounts exist.
 *
 * Fully-expired accounts are surfaced by the shared reconnect banner in
 * `integrations-grid.tsx` alongside Meta / Instagram — this component
 * covers only the pre-expiry warning window so the user gets a heads-up
 * before sending actually breaks.
 *
 * Introduced by ENG-168; moved here from the (orphaned) team-settings
 * `WhatsAppIntegration` component as part of ENG-182 so the banner
 * actually renders on the live integrations page.
 */
export function WhatsAppHealthBanner({
  accounts,
  onReconnect,
}: WhatsAppHealthBannerProps) {
  const daysLeft = getSoonestExpiringDays(accounts);
  if (daysLeft === null) return null;

  return (
    <Alert className="mb-4">
      <Clock className="size-4" />
      <AlertTitle>
        {`WhatsApp connection expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <span>
          Reconnect WhatsApp soon to avoid an interruption in messaging.
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={onReconnect}
          className="self-start"
        >
          <RefreshCw className="mr-2 size-4" />
          Reconnect WhatsApp
        </Button>
      </AlertDescription>
    </Alert>
  );
}

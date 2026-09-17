import { Badge } from '@/components/ui/badge';
import { formatMoney } from '@/features/sales';
import { cn } from '@/lib/utils';

import {
  type DepositStatus,
  depositStatusLabels,
} from '@borradh-workspace/api-client/types';

/** The trimmed deposit shape carried on appointment read models / event metadata. */
export interface DepositSummary {
  status: DepositStatus;
  amountCents: number;
  currency: string;
  paidAt: string | null;
}

/** Read a deposit summary off an arbitrary metadata bag (IEvent.metadata). */
export function readDepositFromMetadata(
  metadata: Record<string, unknown> | undefined | null
): DepositSummary | null {
  const raw = metadata?.deposit;
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<DepositSummary>;
  if (typeof d.status !== 'string' || typeof d.amountCents !== 'number') {
    return null;
  }
  return {
    status: d.status as DepositStatus,
    amountCents: d.amountCents,
    currency: typeof d.currency === 'string' ? d.currency : 'eur',
    paidAt: typeof d.paidAt === 'string' ? d.paidAt : null,
  };
}

const toneClasses: Record<DepositStatus, string> = {
  paid: 'border-transparent bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  pending:
    'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  expired: 'border-transparent bg-muted text-muted-foreground',
  cancelled:
    'border-transparent bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  refunded: 'border-transparent bg-muted text-muted-foreground',
};

/**
 * A badge for an appointment's deposit state, e.g. "Deposit paid" / "Deposit
 * pending". Colour matches the deposit status. Renders nothing when there is no
 * deposit.
 */
export function DepositBadge({
  deposit,
  className,
}: {
  deposit: DepositSummary | null;
  className?: string;
}) {
  if (!deposit) return null;
  return (
    <Badge className={cn('shrink-0', toneClasses[deposit.status], className)}>
      Deposit {depositStatusLabels[deposit.status].toLowerCase()}
    </Badge>
  );
}

/**
 * A "Deposit paid · €X" line for the appointment detail body. Renders the amount
 * with a status-appropriate verb. Returns null when there is no deposit.
 */
export function DepositDetailRow({
  deposit,
}: { deposit: DepositSummary | null }) {
  if (!deposit) return null;
  const amount = formatMoney(deposit.amountCents, deposit.currency);
  const label =
    deposit.status === 'paid'
      ? 'Deposit paid'
      : deposit.status === 'pending'
        ? 'Deposit due'
        : `Deposit ${depositStatusLabels[deposit.status].toLowerCase()}`;
  return (
    <div className="flex items-center justify-between rounded-lg border bg-card p-3">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold">{amount}</span>
    </div>
  );
}

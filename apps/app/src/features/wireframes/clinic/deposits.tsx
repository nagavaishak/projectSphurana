'use client';

/**
 * §10 — the deposits console.
 *
 * This replaces the hardcoded “Coming Soon” empty state at
 * `/dashboard/l/$locationId/deposits`, whose copy promises Stripe deposits are
 * on the way. They are not: `apps/api/src/deposits` is finished, deposits are
 * being taken today, and the one screen an owner would use to see the money is
 * a placeholder telling them the feature does not exist yet.
 *
 * ## The ledger is the screen
 *
 * The first draft showed everything at once: a note banner, a five-card metric
 * strip, the no-show approval queue, a tab row, a seven-column table and a
 * totals footer — six things asking to be read first. An owner opens this page
 * to find one payment on a card statement, and the table was the smallest
 * thing on it.
 *
 * So the ledger is the whole page, and the two other jobs this console does
 * are separate states rather than blocks stacked above it: the no-show
 * approval queue (which is its own list, not a banner) and the charge dialog.
 *
 * Static fixtures. Nothing here queries or charges anything.
 */

import { BanknoteIcon, CreditCardIcon, ShieldAlertIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ListPage } from '@/components/app/list-page';
import type { ListColumn } from '@/components/app/list-page';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

import { WfFrame, WfPoint } from '../wf-frame';
import {
  CHARGE_QUICK_AMOUNTS,
  CLIENT,
  DEPOSIT_ROWS,
  NO_SHOW_QUEUE,
  type WfDepositRow,
  type WfDepositStatus,
  type WfNoShowRow,
} from './mock';

/* ------------------------------------------------------------ status -- */

/**
 * `forfeited` is the status PR #848 appended, and the only one here that is
 * money an owner CHOSE to keep rather than money that moved. It gets its own
 * colour for that reason — reading it as another flavour of “paid” is how a
 * forfeit stops being a decision.
 */
const STATUS_STYLE: Record<
  WfDepositStatus,
  { label: string; className: string }
> = {
  paid: {
    label: 'Paid',
    className: 'text-green-700 dark:text-green-400',
  },
  captured: {
    label: 'Card held',
    className: 'text-muted-foreground',
  },
  pending: {
    label: 'Awaiting payment',
    className: 'text-amber-700 dark:text-amber-400',
  },
  refunded: {
    label: 'Refunded',
    className: 'text-blue-700 dark:text-blue-400',
  },
  forfeited: {
    label: 'Forfeited',
    className: 'text-purple-700 dark:text-purple-400',
  },
  failed: {
    label: 'Failed',
    className: 'text-destructive',
  },
};

/* -------------------------------------------------------------- tabs -- */

type DepositTab = 'all' | 'outstanding' | 'returned';

/**
 * Three tabs, not five.
 *
 * “Deposits”, “Refunds”, “Outstanding” and “Failed” split one question —
 * where is my money — across four places, and two of them (failed, awaiting
 * payment) are the same answer: nobody has paid yet. What an owner filters
 * for is money still owed, and money that went back.
 */
const TABS: { id: DepositTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'outstanding', label: 'Outstanding' },
  { id: 'returned', label: 'Returned' },
];

function matchesTab(row: WfDepositRow, tab: DepositTab): boolean {
  if (tab === 'all') {
    return true;
  }
  if (tab === 'outstanding') {
    return row.status === 'pending' || row.status === 'failed';
  }
  // A forfeit files under "returned" because it answers the same question an
  // owner is asking — what happened to money I had already taken — even though
  // the money never left.
  return row.status === 'refunded' || row.status === 'forfeited';
}

/* -------------------------------------------------------- the console -- */

const STATES = [
  { id: 'ledger', label: 'Ledger' },
  { id: 'approvals', label: 'No-show approvals' },
  { id: 'charge', label: 'Charge card' },
];

export function WfDeposits() {
  const [state, setState] = useState('ledger');

  return (
    <WfFrame
      activeState={state}
      location="Money › Deposits"
      name="Deposits console"
      notes={
        <>
          <WfPoint title="The ledger is one list, not five screens">
            Refunds and forfeits are the same money moving the other way, and an
            owner reconciling a card statement is looking for one payment, not
            deciding which page it lives on. The tabs went from five to three
            because “failed” and “awaiting payment” are one answer — nobody has
            paid yet.
          </WfPoint>
          <WfPoint title="The approval queue is a list, not a banner">
            §10.4 makes keeping a forfeited deposit a decision an owner takes.
            The first draft pinned it above the ledger as a permanent strip,
            where it competes with the table on every visit including the ones
            where it is empty. It is its own view, reached from the ledger, with
            a count on the way in.
          </WfPoint>
          <WfPoint title="Marking a no-show and keeping the money are two acts">
            A staff member marking a no-show on the calendar records an
            ATTENDANCE fact. Keeping the deposit belongs to whoever has to
            answer the phone call about it. Before PR #848 one click did both,
            silently and with no undo.
          </WfPoint>
          <WfPoint title="The history line is why it is a queue">
            “3rd no-show in 12 months” and “rang ahead — running late” want
            opposite answers, and neither is knowable from the booking alone.
          </WfPoint>
          <WfPoint title="The charge dialog picks the amount for you">
            A receptionist knows the reason; the arithmetic — treatment price
            minus the deposit already taken — is what they get wrong under
            pressure, and it is the one number Stripe will not question. Each
            chip sets the amount AND the reason, so the reason stays queryable
            at the end of the quarter instead of being typed fresh as “nsf”.
          </WfPoint>
          <WfPoint title="No late-cancellation fee anywhere">
            PR #848 dropped <code>no_show_or_late_cancel_fee_cents</code>. It
            was display-only and never on a charge path; no screen should
            mention it.
          </WfPoint>
        </>
      }
      onState={setState}
      states={STATES}
    >
      {state === 'approvals' ? (
        <NoShowApprovals onBack={() => setState('ledger')} />
      ) : (
        <Ledger
          chargeOpen={state === 'charge'}
          onCharge={() => setState('charge')}
          onCloseCharge={() => setState('ledger')}
          onOpenApprovals={() => setState('approvals')}
        />
      )}
    </WfFrame>
  );
}

/* ------------------------------------------------------------ ledger -- */

function Ledger({
  chargeOpen,
  onCharge,
  onCloseCharge,
  onOpenApprovals,
}: {
  chargeOpen: boolean;
  onCharge: () => void;
  onCloseCharge: () => void;
  onOpenApprovals: () => void;
}) {
  const [tab, setTab] = useState<DepositTab>('all');
  const [search, setSearch] = useState('');

  // Filtering is the caller's job — `ListPage` renders exactly the rows it is
  // handed and never silently narrows them.
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return DEPOSIT_ROWS.filter(
      (row) =>
        matchesTab(row, tab) &&
        (term === '' ||
          row.patient.toLowerCase().includes(term) ||
          row.treatment.toLowerCase().includes(term))
    );
  }, [search, tab]);

  const columns: ListColumn<WfDepositRow>[] = [
    {
      id: 'patient',
      header: 'Patient',
      mobile: 'primary',
      cell: (row) => row.patient,
    },
    {
      id: 'treatment',
      header: 'Treatment',
      // The phone drops the status column, so it rides the secondary line
      // instead: a money row whose status you cannot see is worse than one you
      // have to scroll.
      mobile: 'secondary',
      cell: (row) => (
        <span>
          {row.treatment}
          <span className="sm:hidden"> · {STATUS_STYLE[row.status].label}</span>
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      // Status is a word in its own colour rather than a pill. Ten pills down
      // a column is a decorated table; the colour alone carries it, and the
      // amount beside it is what the eye is scanning for anyway.
      cell: (row) => (
        <span className={cn('font-medium', STATUS_STYLE[row.status].className)}>
          {STATUS_STYLE[row.status].label}
        </span>
      ),
    },
    {
      id: 'when',
      header: 'Appointment',
      cell: (row) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {row.appointment}
        </span>
      ),
    },
    {
      id: 'amount',
      header: 'Amount',
      align: 'right',
      mobile: 'trailing',
      cell: (row) => (
        <span
          className={cn(
            'tabular-nums',
            row.kind === 'refund' && 'text-muted-foreground'
          )}
        >
          {row.kind === 'refund' ? `−${row.amount}` : row.amount}
        </span>
      ),
    },
  ];

  return (
    <>
      <ListPage<WfDepositRow>
        config={{
          title: 'Deposits',
          description:
            'Every deposit, refund, forfeit and charge for Harley Aesthetics.',
          rows,
          rowKey: (row) => row.id,
          columns,
          search,
          onSearchChange: setSearch,
          searchPlaceholder: 'Search by patient or treatment',
          primaryAction: {
            label: 'Charge card',
            mobileLabel: 'Charge',
            onClick: onCharge,
          },
          filters: (
            <div className="flex flex-wrap items-center gap-3">
              <Tabs
                onValueChange={(value) => setTab(value as DepositTab)}
                value={tab}
              >
                <TabsList>
                  {TABS.map((item) => (
                    <TabsTrigger key={item.id} value={item.id}>
                      {item.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              {/* The queue announces itself with a count and gets out of the
                  way. A permanent strip above the ledger is furniture on every
                  visit, including the ones where there is nothing to decide. */}
              <Button
                className="ml-auto"
                onClick={onOpenApprovals}
                size="sm"
                type="button"
                variant="outline"
              >
                <ShieldAlertIcon />
                {NO_SHOW_QUEUE.length} no-shows to decide
              </Button>
            </div>
          ),
          empty: {
            icon: BanknoteIcon,
            title: 'Nothing under this filter',
            description:
              'Deposits are configured per service under the service menu.',
          },
        }}
      />

      <ChargeCardDialog onOpenChange={onCloseCharge} open={chargeOpen} />
    </>
  );
}

/* ------------------------------------------------- no-show approvals -- */

function NoShowApprovals({ onBack }: { onBack: () => void }) {
  const [pending, setPending] = useState<WfNoShowRow | null>(null);

  const columns: ListColumn<WfNoShowRow>[] = [
    {
      id: 'patient',
      header: 'Patient',
      mobile: 'primary',
      cell: (row) => row.patient,
    },
    {
      id: 'history',
      header: 'History',
      mobile: 'secondary',
      // The line that makes this a queue rather than a switch.
      cell: (row) => (
        <span className="text-muted-foreground">{row.history}</span>
      ),
    },
    {
      id: 'marked',
      header: 'Marked',
      cell: (row) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {row.markedBy} · {row.markedAt}
        </span>
      ),
    },
    {
      id: 'amount',
      header: 'Deposit',
      align: 'right',
      mobile: 'trailing',
      cell: (row) => <span className="tabular-nums">{row.amount}</span>,
    },
  ];

  return (
    <>
      <ListPage<WfNoShowRow>
        config={{
          title: 'No-shows to decide',
          description:
            'Marked by staff on the calendar. Nothing is kept until someone here says so.',
          rows: NO_SHOW_QUEUE,
          rowKey: (row) => row.id,
          columns,
          // Releasing is the reversible one, so it is the quiet button; keeping
          // the money opens a confirmation that names the amount out loud.
          rowActions: (row) => (
            <div className="flex justify-end gap-2">
              <Button size="sm" type="button" variant="ghost">
                Release
              </Button>
              <Button
                onClick={() => setPending(row)}
                size="sm"
                type="button"
                variant="outline"
              >
                Keep deposit
              </Button>
            </div>
          ),
          primaryAction: {
            label: 'Back to ledger',
            mobileLabel: 'Ledger',
            onClick: onBack,
          },
          empty: {
            icon: ShieldAlertIcon,
            title: 'Nothing to decide',
            description: 'No-shows marked on the calendar arrive here.',
          },
        }}
      />

      <ForfeitDialog onOpenChange={() => setPending(null)} row={pending} />
    </>
  );
}

/* ------------------------------------------------------- §10.3 charge -- */

function ChargeCardDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const [quick, setQuick] = useState(CHARGE_QUICK_AMOUNTS[0]);
  const [amount, setAmount] = useState(CHARGE_QUICK_AMOUNTS[0].amount);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Charge card on file</DialogTitle>
          <DialogDescription>{CLIENT.name} · Visa ···4242</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* One chip sets both the amount and the reason. Two separate rows —
              amounts, then reasons — let a receptionist charge a no-show fee
              filed as "balance due", and the quarterly no-show total is exactly
              the number an owner asks for. */}
          <div className="space-y-2">
            {CHARGE_QUICK_AMOUNTS.map((item) => (
              <button
                className={cn(
                  'w-full rounded-lg border px-3 py-2 text-left transition-colors hover:bg-accent',
                  quick.id === item.id && 'border-primary ring-1 ring-primary'
                )}
                key={item.id}
                onClick={() => {
                  setQuick(item);
                  setAmount(item.amount);
                }}
                type="button"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-sm">{item.label}</span>
                  <span className="font-semibold tabular-nums">
                    £{item.amount}
                  </span>
                </span>
                <span className="block text-muted-foreground text-xs">
                  {item.sub}
                </span>
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="wf-charge-amount">Or another amount</Label>
            <div className="relative">
              <span className="-translate-y-1/2 absolute top-1/2 left-3 text-muted-foreground text-sm">
                £
              </span>
              <Input
                className="pl-6 tabular-nums"
                id="wf-charge-amount"
                inputMode="decimal"
                onChange={(event) => setAmount(event.target.value)}
                value={amount}
              />
            </div>
          </div>

          <p className="text-muted-foreground text-sm">
            {CLIENT.name} is charged <strong>£{amount}</strong> for{' '}
            <strong>{quick.label.toLowerCase()}</strong> and receives a Stripe
            receipt immediately. A decline shows its reason here and offers a
            payment link instead.
          </p>
        </div>

        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button type="button">
            <CreditCardIcon />
            Charge £{amount}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------ §10.4 forfeit -- */

/**
 * The staff-side confirmation PR #848 requires, verbatim in shape: it names the
 * amount. It appears ONLY where a forfeit would genuinely happen — a paid
 * deposit on an org with `deposit_forfeit_on_no_show` on.
 */
function ForfeitDialog({
  onOpenChange,
  row,
}: {
  onOpenChange: (open: boolean) => void;
  row: WfNoShowRow | null;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={row !== null}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Keep {row?.amount ?? '£0.00'} and mark this a no-show?
          </DialogTitle>
          <DialogDescription>
            {row?.patient} · {row?.treatment} · {row?.appointment}
          </DialogDescription>
        </DialogHeader>

        <p className="text-muted-foreground text-sm">
          {row?.history}, marked by {row?.markedBy}. Releasing instead refunds
          the deposit through Stripe and still records the no-show — attendance
          and money are separate facts.
        </p>

        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Release the deposit
          </Button>
          <Button type="button">Keep {row?.amount ?? '£0.00'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

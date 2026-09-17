'use client';

/**
 * The account sub-pages behind the hub links — §23.7.
 *
 * Three surfaces, presented as tabs because on a phone they are three
 * destinations one tap apart and a patient bounces between them: "what did I
 * pay", "what do I still owe you a form for", "how much is left on that
 * voucher".
 *
 * PURCHASE HISTORY IS ONE LIST. Deposits, treatment payments, course purchases,
 * voucher purchases and shop orders are five different tables and one question.
 * Nobody thinks of a £20 deposit, a £900 course and a jar of moisturiser as
 * three separate histories, and splitting them is exactly how "where's my
 * receipt" becomes a phone call. Pending and failed rows belong here too — a
 * declined deposit is something the patient can fix themselves, once they can
 * see it.
 *
 * FORMS USE THE FIVE-VALUE VOCABULARY EXACTLY: Not sent · Sent · Opened ·
 * Completed · Expired. Sent and Opened stay separate on purpose — a form that
 * arrived and was abandoned is a different problem from one that never
 * arrived, and the clinic chases them differently.
 */

import {
  CheckIcon,
  ClockIcon,
  DownloadIcon,
  FileTextIcon,
  GiftIcon,
  MailIcon,
  ReceiptIcon,
  RotateCcwIcon,
  SendIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

import {
  FORM_REASONS,
  FORM_RECORDS,
  PURCHASE_LEDGER,
  VOUCHERS_BOUGHT,
  VOUCHERS_BOUGHT_EXTRA,
  VOUCHERS_RECEIVED,
  VOUCHER_DELIVERY,
  type WfFormRecord,
  type WfLedgerEntry,
  type WfVoucherBalance,
} from './mock';
import { WfNote, WfPortalShell } from './wf-shell';

type Section = 'purchases' | 'forms' | 'vouchers';

const SECTIONS: [Section, string, typeof ReceiptIcon][] = [
  ['purchases', 'Purchases', ReceiptIcon],
  ['forms', 'Forms', FileTextIcon],
  ['vouchers', 'Vouchers', GiftIcon],
];

export function AccountSubPages() {
  const [section, setSection] = useState<Section>('purchases');

  return (
    <WfPortalShell backLabel="My account">
      <WfNote>
        Static page. Purchase history, the form status vocabulary and voucher
        balances are all new — the live portal has documents and bookings only.
        No receipt, PDF or voucher code here is real.
      </WfNote>

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-6 sm:px-6 md:py-8">
        {/*
          A real tablist rather than three routes, because on a phone the whole
          point is switching between them without losing your place.
        */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {SECTIONS.map(([value, label, Icon]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={section === value ? 'default' : 'outline'}
              onClick={() => setSection(value)}
            >
              <Icon className="size-4" />
              {label}
            </Button>
          ))}
        </div>

        {section === 'purchases' ? <PurchaseHistory /> : null}
        {section === 'forms' ? <FormsAndConsent /> : null}
        {section === 'vouchers' ? <GiftVouchers /> : null}
      </main>
    </WfPortalShell>
  );
}

/* ------------------------------------------------------------ purchases -- */

function PurchaseHistory() {
  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="font-bold text-2xl">Purchase history</h1>
        <p className="text-muted-foreground text-sm">
          {/* One list, newest first, whatever kind of money it was. */}
          Everything you've paid us — deposits, treatments, courses, vouchers
          and shop orders.
        </p>
      </header>

      <Card>
        <CardContent className="divide-y p-0">
          {PURCHASE_LEDGER.map((entry) => (
            <LedgerRow key={entry.id} entry={entry} />
          ))}
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">
        Refunds show against the original payment rather than as a separate
        line, so the amount you actually paid is never ambiguous.
      </p>
    </section>
  );
}

function LedgerRow({ entry }: { entry: WfLedgerEntry }) {
  return (
    <div className="space-y-2 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium">{entry.title}</p>
          <p className="text-muted-foreground text-sm">
            {entry.dateLabel} · {entry.methodLabel}
          </p>
        </div>
        <span
          className={cn(
            'shrink-0 font-semibold tabular-nums',
            entry.status === 'refunded' && 'text-muted-foreground line-through',
            entry.status === 'failed' && 'text-muted-foreground'
          )}
        >
          {entry.amountLabel}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{entry.kind}</Badge>
        <StatusBadge entry={entry} />
        {entry.hasReceipt ? (
          <button
            type="button"
            className="ml-auto font-medium text-primary text-sm hover:underline"
          >
            Receipt
          </button>
        ) : null}
      </div>

      {entry.refundLabel ? (
        <p className="text-muted-foreground text-sm">{entry.refundLabel}</p>
      ) : null}

      {/* A failed payment is the one row the patient can act on. */}
      {entry.status === 'failed' ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted p-3">
          <p className="min-w-0 flex-1 text-sm">
            Your card was declined, so this deposit wasn't taken.
          </p>
          <Button size="sm">Try another card</Button>
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({ entry }: { entry: WfLedgerEntry }) {
  if (entry.status === 'refunded') {
    return (
      <Badge variant="secondary">
        <RotateCcwIcon className="size-3" />
        Refunded
      </Badge>
    );
  }
  if (entry.status === 'pending') {
    return (
      <Badge variant="outline" className="text-amber-700">
        <ClockIcon className="size-3" />
        Pending
      </Badge>
    );
  }
  if (entry.status === 'failed') {
    return (
      <Badge variant="outline" className="text-destructive">
        <XIcon className="size-3" />
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-green-700">
      <CheckIcon className="size-3" />
      Paid
    </Badge>
  );
}

/* ---------------------------------------------------------------- forms -- */

function FormsAndConsent() {
  const outstanding = FORM_RECORDS.filter(
    (record) => record.status !== 'Completed'
  ).length;

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="font-bold text-2xl">Forms &amp; consent</h1>
        <p className="text-muted-foreground text-sm">
          {outstanding} still need something from you. Completed ones stay here
          so you can read back what you agreed to.
        </p>
      </header>

      <Card>
        <CardContent className="divide-y p-0">
          {FORM_RECORDS.map((record) => (
            <FormRow key={record.id} record={record} />
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

function FormRow({ record }: { record: WfFormRecord }) {
  /* Only a completed form has nothing left to do. Everything else — including
     "Not sent" — is a state the patient can be helped out of from this row. */
  const needsAction = record.status !== 'Completed';

  return (
    <div className="space-y-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{record.name}</p>
          <p className="text-muted-foreground text-sm">{record.meta}</p>
        </div>
        <FormStatusBadge status={record.status} />
      </div>

      {/* Why it matters, not just what it is called. */}
      <p className="text-muted-foreground text-sm">{FORM_REASONS[record.id]}</p>

      <div className="flex flex-wrap gap-2 pt-1">
        {record.hasPdf ? (
          <Button variant="outline" size="sm">
            <DownloadIcon className="size-3.5" />
            View PDF
          </Button>
        ) : null}
        {needsAction ? (
          <Button size="sm">
            {record.status === 'Not sent' ? 'Send it to me' : null}
            {record.status === 'Expired' ? 'Renew it' : null}
            {record.status === 'Sent' || record.status === 'Opened'
              ? 'Complete it'
              : null}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function FormStatusBadge({ status }: { status: WfFormRecord['status'] }) {
  /* The five values, rendered verbatim — the vocabulary is shared with the
     clinic side, and inventing a sixth here would desynchronise them. */
  if (status === 'Completed') {
    return (
      <Badge variant="outline" className="shrink-0 text-green-700">
        <CheckIcon className="size-3" />
        Completed
      </Badge>
    );
  }
  if (status === 'Expired') {
    return (
      <Badge variant="outline" className="shrink-0 text-destructive">
        <TriangleAlertIcon className="size-3" />
        Expired
      </Badge>
    );
  }
  if (status === 'Opened') {
    return (
      <Badge variant="outline" className="shrink-0 text-amber-700">
        Opened
      </Badge>
    );
  }
  if (status === 'Sent') {
    return (
      <Badge variant="secondary" className="shrink-0">
        Sent
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="shrink-0">
      Not sent
    </Badge>
  );
}

/* ------------------------------------------------------------- vouchers -- */

function GiftVouchers() {
  const [tab, setTab] = useState<'bought' | 'received'>('bought');
  const bought = [...VOUCHERS_BOUGHT, ...VOUCHERS_BOUGHT_EXTRA];
  const vouchers = tab === 'bought' ? bought : VOUCHERS_RECEIVED;

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="font-bold text-2xl">Gift vouchers</h1>
        <p className="text-muted-foreground text-sm">
          Vouchers are redeemed at the clinic desk, so what you need from this
          page is the code and the balance.
        </p>
      </header>

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={tab === 'bought' ? 'default' : 'outline'}
          onClick={() => setTab('bought')}
        >
          I bought ({bought.length})
        </Button>
        <Button
          type="button"
          size="sm"
          variant={tab === 'received' ? 'default' : 'outline'}
          onClick={() => setTab('received')}
        >
          I received ({VOUCHERS_RECEIVED.length})
        </Button>
      </div>

      <ul className="space-y-4">
        {vouchers.map((voucher) => (
          <li key={voucher.id}>
            <VoucherCard voucher={voucher} isBought={tab === 'bought'} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function VoucherCard({
  voucher,
  isBought,
}: {
  voucher: WfVoucherBalance;
  isBought: boolean;
}) {
  const delivery = VOUCHER_DELIVERY.find((item) => item.id === voucher.id);
  const partlySpent = voucher.remainingPercent < 100;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-semibold text-lg tabular-nums">
              {voucher.remainingLabel}
            </p>
            {/*
              A partly-redeemed voucher is the state people query. Showing the
              original beside the remaining answers "where did the rest go"
              before it becomes a phone call.
            */}
            <p className="text-muted-foreground text-sm">
              {partlySpent
                ? `${voucher.remainingLabel} left of ${voucher.originalLabel}`
                : `${voucher.originalLabel} voucher`}
            </p>
          </div>
          <Badge variant="secondary" className="shrink-0">
            {voucher.counterpartyLabel}
          </Badge>
        </div>

        {partlySpent ? (
          <progress
            className="block h-1.5 w-full overflow-hidden rounded-full bg-muted [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
            value={voucher.remainingPercent}
            max={100}
            aria-label={`${voucher.remainingLabel} of ${voucher.originalLabel} remaining`}
          />
        ) : null}

        <div className="rounded-lg border bg-muted/40 p-3">
          <p className="text-muted-foreground text-xs">Voucher code</p>
          <p className="font-mono font-semibold tracking-wider">
            {voucher.code}
          </p>
        </div>

        <p className="text-muted-foreground text-sm">{voucher.expiresLabel}</p>

        {isBought && delivery ? (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                {delivery.state === 'delivered' ? (
                  <CheckIcon className="mt-0.5 size-4 shrink-0 text-green-600" />
                ) : (
                  <ClockIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
                )}
                <div className="min-w-0">
                  <p className="font-medium text-sm">{delivery.channelLabel}</p>
                  <p className="text-muted-foreground text-sm">
                    {delivery.statusLabel}
                  </p>
                </div>
              </div>
              {/*
                Resend, always — the commonest voucher problem is that it went
                to a typo'd address or a spam folder, and the buyer is the only
                person who can fix it.
              */}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm">
                  <SendIcon className="size-3.5" />
                  {delivery.state === 'scheduled' ? 'Send it now' : 'Resend it'}
                </Button>
                <Button variant="ghost" size="sm">
                  <MailIcon className="size-3.5" />
                  Send to a different address
                </Button>
              </div>
            </div>
          </>
        ) : null}

        {!isBought ? (
          <p className="text-muted-foreground text-xs">
            Show this code at reception. It can be used across several visits
            until the balance runs out.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

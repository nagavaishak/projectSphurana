'use client';

/**
 * The five non-overview panels of the appointment view, drawn at the fidelity
 * they will ship at.
 *
 * ## Read this before wiring anything
 *
 * The five tabs do NOT have the same standing, and the difference is the whole
 * point of this file. Checked against `packages/database/src/schema`:
 *
 *   Payments   REAL. `sale_item.appointment_id` and `appointment_deposit`
 *              both exist. Needs an appointment-scoped read, nothing more.
 *   Consent    REAL. `consent_form_submission.appointment_id` and
 *              `intake_submission.appointment_id` both exist and are indexed.
 *   Notes      THIN. `appointment.description` is ONE free-text column. The
 *              thread drawn here — many notes, each with an author and a time —
 *              has no table. It is a new one, or it is a textarea.
 *   Activity   TABLE EXISTS, NO WRITES. `audit_log` is live and written for
 *              ten entity types, but `appointment` is not among them. The work
 *              is a write at each mutation site, not a migration. Until then
 *              the rows are derived from timestamp COLUMNS.
 *   Clinical   NEEDS NEW TABLES. `appointment_service` holds line items —
 *              name, duration, price, practitioner — and that is all. There is
 *              no treatment record: no product, no batch number, no dose, no
 *              site, no aftercare. See `appointment-view-medications.ts` for
 *              how close `product` already is to being the catalogue half.
 *
 * The fixtures below are marked `FIXTURE` and are here so the layout can be
 * judged. Nothing in this file queries.
 *
 * ## Why Clinical is the one that matters
 *
 * For an injectable, the batch number is not a nice-to-have — it is the
 * traceability record. When a product is recalled the clinic must produce every
 * patient who received that lot, and the regulator does not accept "it was in
 * the practitioner's notebook". That is why the batch field is drawn as a
 * first-class column and not buried in free text, and why it is the strongest
 * argument for giving treatments a table of their own.
 */

import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClockIcon,
  CreditCardIcon,
  FileTextIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';

import { cn } from '@/lib/utils';

/* ------------------------------------------------------------- primitives -- */

/** A titled block. Sections stack; the shell supplies the page padding. */
export function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-medium">{title}</h2>
          {description ? (
            <p className="text-muted-foreground text-sm">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-background">
      {children}
    </div>
  );
}

/**
 * Says what is missing and WHY it cannot simply be queried. A panel that only
 * said "coming soon" sent the reader to the backlog to find out whether the
 * work was a query or a migration.
 */
export function NeedsTable({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-muted-foreground text-sm">
      {children}
    </p>
  );
}

/* --------------------------------------------------------------- payments -- */

// FIXTURE — shape follows `sale_item` and `appointment_deposit`.
const LINES = [
  { id: 'l1', label: 'Anti-wrinkle treatment — 3 areas', amount: '€320.00' },
  { id: 'l2', label: 'Numbing cream', amount: '€8.00' },
];

/**
 * Pay-in-clinic is the DEFAULT here, not the fallback.
 *
 * Measured across the production customer base: 106 of 116 organisations are
 * set to take payment in the clinic and only 9 take deposits. An earlier draft
 * of this panel led with "deposit paid / balance due", which is the shape of
 * the minority case — it made the common appointment look like it was halfway
 * through a payment plan.
 *
 * So the panel answers "what is owed, and has it been paid" first, and shows
 * the deposit only when there is one.
 */
export function PaymentsPanel({ deposit }: { deposit?: boolean }) {
  return (
    <div className="space-y-8">
      <Panel title="Charges">
        <Card>
          <div className="divide-y">
            {LINES.map((l) => (
              <div
                key={l.id}
                className="flex items-baseline justify-between gap-6 px-5 py-3.5 text-sm"
              >
                <span className="min-w-0">{l.label}</span>
                <span className="shrink-0 tabular-nums">{l.amount}</span>
              </div>
            ))}
          </div>
          <div className="space-y-2 border-t bg-muted/30 px-5 py-4 text-sm">
            <Total label="Total" value="€328.00" />
            {deposit ? (
              <>
                <Total label="Deposit paid — 24 Feb" value="−€50.00" muted />
                <div className="border-t pt-2">
                  <Total label="Due in clinic" value="€278.00" strong />
                </div>
              </>
            ) : (
              <div className="border-t pt-2">
                <Total label="Due in clinic" value="€328.00" strong />
              </div>
            )}
          </div>
        </Card>
      </Panel>

      <Panel
        title="Payment"
        action={
          <Button size="sm">
            <CreditCardIcon className="size-3.5" />
            Take payment
          </Button>
        }
      >
        <Card>
          <div className="divide-y">
            {deposit ? (
              <PaymentRow
                status="paid"
                label="Deposit · card"
                meta="24 Feb 2026, 09:12 · Stripe"
                amount="€50.00"
              />
            ) : null}
            <PaymentRow
              status="due"
              label={deposit ? 'Balance' : 'Full amount'}
              meta="Payable in clinic, after treatment"
              amount={deposit ? '€278.00' : '€328.00'}
            />
          </div>
        </Card>
      </Panel>

      <p className="text-muted-foreground text-sm">
        Both sources exist — <code>appointment_deposit</code> and{' '}
        <code>sale_item.appointment_id</code>. Note the link is on the LINE
        ITEM, not the sale: one sale can settle several appointments, so this
        reads items filtered by appointment rather than a sale by id.
      </p>
    </div>
  );
}

function Total({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-6',
        muted && 'text-muted-foreground',
        strong && 'font-medium'
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function PaymentRow({
  status,
  label,
  meta,
  amount,
}: {
  status: 'paid' | 'due';
  label: string;
  meta: string;
  amount: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-3.5">
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full',
          status === 'paid'
            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            : 'bg-muted text-muted-foreground'
        )}
      >
        {status === 'paid' ? (
          <CheckCircle2Icon className="size-4" />
        ) : (
          <ClockIcon className="size-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm">{label}</p>
        <p className="text-muted-foreground text-xs">{meta}</p>
      </div>
      <span className="shrink-0 text-sm tabular-nums">{amount}</span>
    </div>
  );
}

/* ---------------------------------------------------------------- consent -- */

// FIXTURE — shape follows `consent_form_submission` / `intake_submission`.
const FORMS = [
  {
    id: 'f1',
    name: 'Botulinum toxin consent',
    kind: 'Consent',
    state: 'signed' as const,
    meta: 'Signed by Niamh Murphy · 2 March 2026, 14:02',
  },
  {
    id: 'f2',
    name: 'Medical history',
    kind: 'Intake',
    state: 'signed' as const,
    meta: 'Completed 28 February 2026',
  },
  {
    id: 'f3',
    name: 'Photography consent',
    kind: 'Consent',
    state: 'outstanding' as const,
    meta: 'Sent 28 February · reminder sent 1 March',
  },
];

export function ConsentPanel() {
  const outstanding = FORMS.filter((f) => f.state === 'outstanding').length;

  return (
    <div className="space-y-8">
      {/* The blocking fact goes above the list. A receptionist checking
          whether treatment can start should not have to read three rows. */}
      {outstanding > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <AlertTriangleIcon className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="min-w-0 flex-1 text-sm">
            {outstanding} form still outstanding for this appointment.
          </p>
          <Button size="sm" variant="outline">
            Send reminder
          </Button>
        </div>
      ) : null}

      <Panel
        title="Forms for this appointment"
        action={
          <Button size="sm" variant="outline">
            Send a form
          </Button>
        }
      >
        <Card>
          <div className="divide-y">
            {FORMS.map((f) => (
              <div key={f.id} className="flex items-center gap-3 px-5 py-3.5">
                <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{f.name}</p>
                  <p className="text-muted-foreground text-xs">{f.meta}</p>
                </div>
                <Badge
                  variant={f.state === 'signed' ? 'secondary' : 'outline'}
                  className={cn(
                    'shrink-0',
                    f.state === 'outstanding' &&
                      'border-amber-500/40 text-amber-700 dark:text-amber-400'
                  )}
                >
                  {f.state === 'signed' ? 'Signed' : 'Outstanding'}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      </Panel>

      <p className="text-muted-foreground text-sm">
        Both sources exist and are indexed by appointment —{' '}
        <code>consent_form_submission</code> and <code>intake_submission</code>.
        The two are drawn as one list because the person checking wants to know
        what is outstanding, not which table it came from.
      </p>
    </div>
  );
}

/* --------------------------------------------------------------- activity -- */

/**
 * Reconstructed from timestamp COLUMNS on the appointment, because
 * `audit_log` — which exists and is live for ten entity types — is not written
 * for appointments yet. That is a write at each mutation site, not a
 * migration.
 *
 * Dates are derived from the appointment being viewed rather than hardcoded:
 * a panel whose fixture says "2 March" on an appointment dated 2 September
 * reads as a bug in the product, not as sample data.
 */
export function ActivityPanel({ start }: { start: Date }) {
  const rel = (mins: number) => new Date(start.getTime() - mins * 60_000);
  const at = (d: Date) => `${format(d, 'd MMMM')}, ${format(d, 'HH:mm')}`;

  const rows = [
    { id: 'a1', at: at(rel(-40)), label: 'Marked completed' },
    { id: 'a2', at: at(rel(60)), label: 'Reminder sent — 1 hour' },
    { id: 'a3', at: at(rel(24 * 60)), label: 'Reminder sent — 24 hours' },
    { id: 'a4', at: at(rel(7 * 24 * 60)), label: 'Deposit paid' },
    { id: 'a5', at: at(rel(7 * 24 * 60 + 4)), label: 'Booked online' },
  ];

  return (
    <div className="space-y-8">
      <Panel title="Activity">
        <Card>
          <div className="divide-y">
            {rows.map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-5 py-3.5"
              >
                <span className="w-44 shrink-0 text-muted-foreground text-sm tabular-nums">
                  {a.at}
                </span>
                <span className="min-w-0 flex-1 text-sm">{a.label}</span>
              </div>
            ))}
          </div>
        </Card>
      </Panel>

      <NeedsTable>
        <strong className="font-medium text-foreground">
          The table exists; the writes do not.
        </strong>{' '}
        <code>audit_log</code> is live and already written for ten entity types
        — lead, organization, practitioner, offer and others — but{' '}
        <code>appointment</code> is not one of them. So this is not a new table,
        it is a write at each appointment mutation site. Until those land, the
        rows above are derived from timestamp columns, and reschedules,
        cancellations and “who changed this” cannot be shown.
      </NeedsTable>
    </div>
  );
}

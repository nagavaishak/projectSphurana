'use client';

/**
 * §6.1's appointment side panel — 400px, over the grid.
 *
 * ## Why it is drawn over the calendar
 *
 * The first version rendered the panel as a standing card on an otherwise
 * empty page, beside a column of rationale cards explaining it. A panel is
 * never that: it is a thing that appears in front of something else, and half
 * of judging one is judging what it covers and what it leaves visible. So the
 * calendar is behind it, dimmed, with the appointment it belongs to still
 * showing in its column.
 *
 * ## Why it is shorter
 *
 * It previously carried a six-badge row, a status stepper, a no-show button, a
 * notes textarea, consent, payment, four actions and a five-entry audit log —
 * every fact about the appointment, in one scroll. The panel now answers the
 * question the click asked: where is this appointment up to, is the money
 * settled, and what do I do next. Treatment notes moved out entirely; they are
 * the consultation surface's job, and a free textarea here invites a clinical
 * note written outside the record that signs it.
 */

import {
  CheckIcon,
  ExternalLinkIcon,
  MessageCircleIcon,
  XIcon,
} from 'lucide-react';
import { useState } from 'react';

import { DashboardPage } from '@/components/app/dashboard-page';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { WfFrame, WfPoint } from '../wf-frame';
import { WfDayGrid } from './calendar-day';
import { ACTIVITY_LOG } from './mock';

const STATES = [
  { id: 'appointment', label: 'Appointment' },
  { id: 'cancellation', label: 'Cancellation requested' },
];

const STEPS = [
  { id: 'booked', label: 'Booked', at: '6 Mar' },
  { id: 'arrived', label: 'Arrived', at: '08:56' },
  { id: 'in_progress', label: 'In progress', at: '09:04' },
  { id: 'completed', label: 'Completed', at: null },
] as const;

type StepId = (typeof STEPS)[number]['id'];

export function WfCalendarSidePanel() {
  const [state, setState] = useState('appointment');
  const cancelling = state === 'cancellation';

  return (
    <WfFrame
      activeState={state}
      location="Calendar › appointment panel"
      name="Appointment panel"
      notes={
        <>
          <WfPoint title="Arrived and In progress are the point">
            Today the calendar records intentions. Without an arrival timestamp
            nobody can answer “is the 09:00 running late?”, which is the most-
            asked question at a clinic reception desk.
          </WfPoint>
          <WfPoint title="No-show is a branch, not step five">
            It ends the appointment and can keep the patient’s money. Sitting it
            in the stepper line would put it one mis-click from “Completed”, so
            it is a separate control and it opens the forfeit confirmation in
            the deposits console.
          </WfPoint>
          <WfPoint title="The cancellation request needed inventing">
            §11.2 gives the patient a way to ask and nobody a way to answer, so
            the slot's state is undefined in the meantime. Accept releases the
            slot and runs the forfeit decision; decline keeps the booking and
            notifies the patient. It replaces the stepper rather than sitting
            above it — the appointment's status is meaningless while its
            cancellation is unresolved.
          </WfPoint>
          <WfPoint title="The forfeit warning names the amount">
            Per PR #848 the staff-side confirmation says the number and appears
            only when a forfeit would genuinely happen. A dialog that fires
            every time, mostly to say nothing will happen, is one people learn
            to dismiss unread.
          </WfPoint>
          <WfPoint title="Treatment notes are not here">
            The first draft put a notes textarea in the panel. Clinical notes
            are append-only and belong to the consultation that signs them; a
            box on the calendar is a note written outside that record.
          </WfPoint>
        </>
      }
      onState={setState}
      states={STATES}
    >
      <DashboardPage
        description="14 booked · £2,995 expected · 2 awaiting deposit · 31% of the day still free"
        title="Saturday 14 March"
      >
        <WfDayGrid selectedId={cancelling ? 'b6' : 'b1'} />
      </DashboardPage>

      {/* The panel overlays everything, including the sidebar — it is modal in
          attention if not in DOM, and dimming only the grid would leave the
          navigation looking live while it is not. */}
      <div className="fixed inset-0 z-40 bg-foreground/30" />
      <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[400px] flex-col overflow-y-auto border-l bg-background shadow-xl">
        <div className="flex items-start justify-between gap-2 border-b p-4">
          <div className="min-w-0">
            <p className="font-semibold text-lg">
              {cancelling ? 'Fiona Gallagher' : 'Nadia Osei'}
            </p>
            <p className="text-muted-foreground text-sm">
              {cancelling
                ? 'Tear trough filler · Today 14:00–15:30'
                : 'Anti-wrinkle — 3 areas · Today 09:00–09:45'}
            </p>
            <p className="text-muted-foreground text-sm">Dr. Aoife Byrne</p>
          </div>
          <Button size="icon" type="button" variant="ghost">
            <XIcon />
            <span className="sr-only">Close panel</span>
          </Button>
        </div>

        {cancelling ? <CancellationDecision /> : <StatusStepper />}

        {/* Money, in one line and one action. The balance is the only figure a
            receptionist reads off this panel out loud. */}
        <div className="border-b p-4">
          <p className="text-muted-foreground text-xs">Payment</p>
          <p className="mt-1 text-sm">
            {cancelling
              ? '£450 total · £100 deposit paid'
              : '£280 total · £50 deposit paid'}
          </p>
          <p className="font-medium text-amber-700 text-sm dark:text-amber-400">
            {cancelling ? '£350 balance due' : '£230 balance due at checkout'}
          </p>
          <Button className="mt-3 w-full" size="sm" type="button">
            Take payment
          </Button>
        </div>

        <div className="border-b p-4">
          <p className="text-muted-foreground text-xs">Consent</p>
          <p className="mt-1 text-sm">
            Botulinum toxin consent signed 13 Mar
            <br />
            <span className="text-muted-foreground">
              Medical history due for renewal
            </span>
          </p>
          <Button className="mt-2 px-0" size="sm" type="button" variant="link">
            Resend both
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-2 border-b p-4">
          <Button size="sm" type="button" variant="outline">
            Reschedule
          </Button>
          <Button size="sm" type="button" variant="outline">
            <MessageCircleIcon />
            Message
          </Button>
          <Button size="sm" type="button" variant="outline">
            Record
            <ExternalLinkIcon />
          </Button>
        </div>

        {/* Three entries, not five. The panel is a place to act; the full audit
            trail lives on the client record, where reading it is the task. */}
        <div className="p-4">
          <p className="mb-2 text-muted-foreground text-xs">Activity</p>
          <ul className="space-y-2">
            {ACTIVITY_LOG.slice(0, 3).map((entry) => (
              <li className="flex gap-2 text-sm" key={entry.id}>
                <span className="w-20 shrink-0 text-muted-foreground text-xs tabular-nums">
                  {entry.when}
                </span>
                <span className="min-w-0">
                  {entry.what}
                  <span className="text-muted-foreground"> · {entry.who}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </WfFrame>
  );
}

function StatusStepper() {
  const [step, setStep] = useState<StepId>('in_progress');
  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="border-b p-4">
      <div className="flex items-center">
        {STEPS.map((s, index) => {
          const done = index <= stepIndex;
          return (
            <div className="flex flex-1 items-center" key={s.id}>
              <button
                className="flex min-w-0 flex-col items-center gap-1"
                onClick={() => setStep(s.id)}
                type="button"
              >
                <span
                  className={cn(
                    'flex size-7 items-center justify-center rounded-full border text-xs',
                    done
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-dashed text-muted-foreground'
                  )}
                >
                  {done ? <CheckIcon className="size-3.5" /> : index + 1}
                </span>
                <span
                  className={cn(
                    'text-[11px]',
                    done ? 'font-medium' : 'text-muted-foreground'
                  )}
                >
                  {s.label}
                </span>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {done ? (s.at ?? '—') : ''}
                </span>
              </button>
              {index < STEPS.length - 1 && (
                <span
                  className={cn(
                    'mb-6 h-px flex-1',
                    index < stepIndex ? 'bg-primary' : 'bg-border'
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      <Button className="mt-3 w-full" size="sm" type="button" variant="ghost">
        Mark as no-show
      </Button>
    </div>
  );
}

function CancellationDecision() {
  return (
    <div className="border-b bg-amber-50 p-4 dark:bg-amber-950/30">
      <p className="font-medium text-amber-900 text-sm dark:text-amber-200">
        Cancellation requested
      </p>
      <p className="mt-1 text-amber-900/80 text-sm dark:text-amber-200/80">
        Replied CANCEL to the reminder at 07:41 — five hours out, inside the 24h
        deadline. Accepting forfeits the £100 deposit.
      </p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" type="button" variant="destructive">
          Accept &amp; release slot
        </Button>
        <Button size="sm" type="button" variant="outline">
          Decline &amp; keep booking
        </Button>
      </div>
    </div>
  );
}

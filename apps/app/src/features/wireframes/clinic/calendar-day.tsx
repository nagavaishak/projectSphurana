'use client';

/**
 * §6.1 day view — the clinic's home screen.
 *
 * ## Why this is quieter than the first attempt
 *
 * The first version treated the page as a place to EXPLAIN the block anatomy:
 * a note banner, five metric cards, then a six-card "block anatomy" display
 * showing specimen blocks at three heights side by side. The grid — the only
 * thing anyone actually opens this screen for — was the third thing down the
 * page and about a third of its height.
 *
 * The grid is the screen. The anatomy is still demonstrated, but by the day
 * itself: the fixtures deliberately contain a 15-minute block, a 90-minute
 * block, an overlap pair, a walk-in and a cancellation request, so every rule
 * is visible in situ. What the rules ARE is in the notes drawer, where reading
 * about a design belongs.
 *
 * The five-card summary strip collapsed into the description line. An owner
 * opening the calendar wants the day's shape in one glance before its detail —
 * that is a sentence, not five cards competing with the grid beneath them.
 */

import {
  CalendarPlusIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleIcon,
  CreditCardIcon,
  PoundSterlingIcon,
  UsersIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { DashboardPage } from '@/components/app/dashboard-page';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { WfFrame, WfPoint } from '../wf-frame';
import {
  DAY_BLOCKS,
  GRID_END_MIN,
  GRID_START_MIN,
  HOUR_MARKS,
  PRACTITIONERS,
  PX_PER_MIN,
  type WfBlock,
  minutesToLabel,
} from './mock';

const GRID_HEIGHT = (GRID_END_MIN - GRID_START_MIN) * PX_PER_MIN;

/**
 * The confirmation border — the one signal never omitted, because
 * "unconfirmed" has to be legible from across the room at 9am.
 *
 * Colour on a 4px LEFT BORDER rather than the block fill: a grid where every
 * block is a different saturated colour reads as decoration, and the eye stops
 * picking anything out of it.
 */
const CONFIRMATION_BORDER: Record<WfBlock['confirmation'], string> = {
  confirmed: 'border-l-green-600',
  // Both unconfirmed states read grey. The difference between them is whether
  // there is anything to DO, and that belongs in the side panel, not in a
  // second grey nobody can tell apart at arm's length.
  unconfirmed: 'border-l-muted-foreground/50',
  awaiting_reply: 'border-l-muted-foreground/50',
  cancellation: 'border-l-amber-500',
};

const CONFIRMATION_LABEL: Record<WfBlock['confirmation'], string> = {
  confirmed: 'Confirmed',
  unconfirmed: 'Booked online — reminder not sent yet',
  awaiting_reply: 'Reminder sent, no reply',
  cancellation: 'Cancellation requested',
};

function BlockIcons({ block, dense }: { block: WfBlock; dense: boolean }) {
  // Built as a list rather than three conditional branches so §6.1's "at most
  // three" cap is enforced by construction rather than by counting.
  const icons: { key: string; node: ReactNode; dot: string }[] = [];

  if (block.deposit !== 'none') {
    icons.push({
      key: 'deposit',
      dot: block.deposit === 'paid' ? 'bg-green-600' : 'bg-amber-500',
      node: (
        <PoundSterlingIcon
          className={cn(
            'size-3',
            block.deposit === 'paid'
              ? 'text-green-600'
              : 'text-amber-600 dark:text-amber-400'
          )}
          // Hollow-vs-filled is the spec's distinction; at 12px a stroke-width
          // change reads more reliably than a fill swap.
          strokeWidth={block.deposit === 'paid' ? 3 : 1.75}
        />
      ),
    });
  }

  if (block.consent !== 'none') {
    icons.push({
      key: 'consent',
      dot: block.consent === 'complete' ? 'bg-green-600' : 'bg-destructive',
      node:
        block.consent === 'complete' ? (
          <CheckIcon className="size-3 text-green-600" strokeWidth={3} />
        ) : (
          <CircleIcon className="size-2.5 fill-destructive text-destructive" />
        ),
    });
  }

  if (block.cardOnFile) {
    icons.push({
      key: 'card',
      dot: 'bg-muted-foreground',
      node: <CreditCardIcon className="size-3 text-muted-foreground" />,
    });
  }

  if (icons.length === 0) {
    return null;
  }

  // Under 30px there is no room for glyphs, so they collapse to a dot cluster
  // that still says "something is outstanding".
  if (dense) {
    return (
      <span
        className="flex items-center gap-0.5"
        title="Deposit · consent · card"
      >
        {icons.map((icon) => (
          <span
            className={cn('size-1.5 rounded-full', icon.dot)}
            key={icon.key}
          />
        ))}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1">
      {icons.map((icon) => (
        <span key={icon.key}>{icon.node}</span>
      ))}
    </span>
  );
}

function AppointmentBlock({
  block,
  selected,
  onSelect,
}: {
  block: WfBlock;
  selected: boolean;
  onSelect?: (id: string) => void;
}) {
  const height = block.durationMin * PX_PER_MIN;
  const top = (block.startMin - GRID_START_MIN) * PX_PER_MIN;

  // The text ladder. Three rungs chosen by HEIGHT rather than duration: the
  // same 30 minutes is a different number of pixels at a different zoom, and
  // the truncation has to follow the pixels.
  const tier = height >= 60 ? 'full' : height >= 30 ? 'medium' : 'dense';

  return (
    <button
      className={cn(
        'absolute overflow-hidden rounded-md border border-l-4 bg-card px-1.5 py-1 text-left shadow-sm transition-shadow hover:shadow-md',
        CONFIRMATION_BORDER[block.confirmation],
        // §6.4 — a walk-in was never booked, so its border is dashed. Colour
        // still carries confirmation; dashing is an orthogonal signal.
        block.walkIn && '[border-left-style:dashed]',
        selected && 'ring-2 ring-primary'
      )}
      onClick={() => onSelect?.(block.id)}
      style={{
        top,
        height,
        // Overlapping bookings split the column. `lane` is pre-computed in the
        // fixtures; a real build derives it from a sweep over the day.
        left: block.lane === 1 ? '50%' : 0,
        width: block.lane === undefined ? '100%' : '50%',
      }}
      title={`${block.patient} · ${CONFIRMATION_LABEL[block.confirmation]}`}
      type="button"
    >
      <div className="flex items-start justify-between gap-1">
        <p
          className={cn(
            'min-w-0 flex-1 truncate font-medium',
            tier === 'dense' ? 'text-[11px] leading-tight' : 'text-xs'
          )}
        >
          {block.patient}
        </p>
        <BlockIcons block={block} dense={tier === 'dense'} />
      </div>

      {tier !== 'dense' && (
        <p className="truncate text-[11px] text-muted-foreground leading-tight">
          {block.treatment}
        </p>
      )}

      {tier === 'full' && (
        <p className="truncate text-[11px] text-muted-foreground leading-tight">
          {minutesToLabel(block.startMin)}–
          {minutesToLabel(block.startMin + block.durationMin)} · {block.price}
        </p>
      )}
    </button>
  );
}

/**
 * The grid on its own, so the side-panel and walk-in wireframes can show their
 * sheet OVER the real calendar rather than beside a description of it. Those
 * pages previously drew their panel as a standing card on an empty page, which
 * is the one thing a panel never is.
 */
export function WfDayGrid({
  selectedId,
  onSelect,
}: {
  selectedId?: string;
  onSelect?: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <div className="min-w-[720px]">
        <div className="flex border-b">
          <div className="w-14 shrink-0 border-r" />
          {PRACTITIONERS.map((practitioner) => (
            <div
              className="flex flex-1 items-center gap-2 border-r px-3 py-2.5 last:border-r-0"
              key={practitioner.id}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-xs">
                {practitioner.initials}
              </span>
              <p className="min-w-0 truncate font-medium text-sm">
                {practitioner.name}
              </p>
              {/* Overlap lives on the header: at 50% width a badge on the
                  blocks themselves is unreadable. */}
              {practitioner.overlaps > 0 && (
                <span className="ml-auto shrink-0 text-amber-600 text-xs dark:text-amber-400">
                  {practitioner.overlaps} overlap
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="flex">
          <div
            className="relative w-14 shrink-0 border-r"
            style={{ height: GRID_HEIGHT }}
          >
            {HOUR_MARKS.map((mark) => (
              <span
                className="-translate-y-1/2 absolute right-2 text-[11px] text-muted-foreground tabular-nums"
                key={mark}
                style={{ top: (mark - GRID_START_MIN) * PX_PER_MIN }}
              >
                {minutesToLabel(mark)}
              </span>
            ))}
          </div>

          {PRACTITIONERS.map((practitioner) => (
            <div
              className="relative flex-1 border-r last:border-r-0"
              key={practitioner.id}
              style={{ height: GRID_HEIGHT }}
            >
              {HOUR_MARKS.map((mark) => (
                <div
                  className="absolute inset-x-0 border-border/60 border-t"
                  key={mark}
                  style={{ top: (mark - GRID_START_MIN) * PX_PER_MIN }}
                />
              ))}

              {/* Outside working hours — greyed rather than hidden, because the
                  column has to stay time-aligned with its neighbours. */}
              {practitioner.worksFrom > GRID_START_MIN && (
                <div
                  className="absolute inset-x-0 top-0 bg-muted/40"
                  style={{
                    height:
                      (practitioner.worksFrom - GRID_START_MIN) * PX_PER_MIN,
                  }}
                />
              )}
              {practitioner.worksTo < GRID_END_MIN && (
                <div
                  className="absolute inset-x-0 bottom-0 bg-muted/40"
                  style={{
                    height: (GRID_END_MIN - practitioner.worksTo) * PX_PER_MIN,
                  }}
                />
              )}

              {practitioner.breaks.map((slot) => (
                <div
                  className="absolute inset-x-0 bg-muted/60"
                  key={slot.label}
                  style={{
                    top: (slot.from - GRID_START_MIN) * PX_PER_MIN,
                    height: (slot.to - slot.from) * PX_PER_MIN,
                  }}
                  title={slot.label}
                />
              ))}

              {DAY_BLOCKS.filter(
                (block) => block.practitionerId === practitioner.id
              ).map((block) => (
                <AppointmentBlock
                  block={block}
                  key={block.id}
                  onSelect={onSelect}
                  selected={selectedId === block.id}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function WfCalendarDay() {
  const [selected, setSelected] = useState('b1');

  return (
    <WfFrame
      location="Calendar › Day"
      name="Calendar — day"
      notes={
        <>
          <WfPoint title="Every block rule is a subtraction">
            Confirmation is a 4px left border — green confirmed, grey awaiting
            the patient, amber cancellation requested. Deposit, consent and card
            glyphs are <strong>omitted when the answer is “no”</strong>, which
            is the common case for all three. A block that always carries three
            icons has taught the eye to ignore all three.
          </WfPoint>
          <WfPoint title="The text ladder follows pixels, not minutes">
            ≥60px shows name, treatment and time; 30–60px drops the time line;
            under 30px is the name alone and the glyphs collapse to a dot
            cluster. See 12:15 Bilal Ahmed and 13:00 Leo Fitzpatrick.
          </WfPoint>
          <WfPoint title="Staff bookings start confirmed">
            The original spec had grey mean “not yet confirmed by reminder
            reply”, which rendered a receptionist’s own booking — the most
            certain in the diary — as doubtful. Only self-serve online bookings
            start grey.
          </WfPoint>
          <WfPoint title="The day summary is one line, not five cards">
            An owner wants the day’s shape before its detail, and that is a
            sentence. Five metric cards above the grid pushed the only thing on
            this page anyone opens it for below the fold.
          </WfPoint>
          <WfPoint title="Overlaps split the column">
            Two 11:00 bookings on Aoife render at 50% width with the count on
            the column header, because a badge on a half-width block is
            unreadable. Walk-ins carry a dashed border — see 12:00 Róisín.
          </WfPoint>
          <WfPoint title="Prerequisite">
            Arrived and In progress do not exist in the product yet. Without an
            arrival timestamp nobody can answer “is the 09:00 running late?”,
            which is the most-asked question at a clinic desk.
          </WfPoint>
        </>
      }
    >
      <DashboardPage
        actions={
          <>
            <Button size="sm" type="button" variant="outline">
              <UsersIcon />
              Walk-in
            </Button>
            <Button size="sm" type="button">
              <CalendarPlusIcon />
              New booking
            </Button>
          </>
        }
        description="14 booked · £2,995 expected · 2 awaiting deposit · 31% of the day still free"
        title="Saturday 14 March"
        toolbar={
          <div className="flex items-center gap-2">
            <Button size="icon" type="button" variant="outline">
              <ChevronLeftIcon />
              <span className="sr-only">Previous day</span>
            </Button>
            <Button size="icon" type="button" variant="outline">
              <ChevronRightIcon />
              <span className="sr-only">Next day</span>
            </Button>
            <Button size="sm" type="button" variant="outline">
              Today
            </Button>
            <span className="ml-auto flex items-center rounded-lg border p-0.5">
              {(['Day', 'Week'] as const).map((option) => (
                <button
                  className={cn(
                    'rounded-md px-3 py-1 font-medium text-sm transition-colors',
                    option === 'Day'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  key={option}
                  type="button"
                >
                  {option}
                </button>
              ))}
            </span>
          </div>
        }
      >
        <WfDayGrid onSelect={setSelected} selectedId={selected} />
      </DashboardPage>
    </WfFrame>
  );
}

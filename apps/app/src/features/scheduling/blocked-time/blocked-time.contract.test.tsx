import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from '@/test/render';
import type { UserEvent } from '@testing-library/user-event';
import { expect, vi } from 'vitest';

/**
 * FORM CONTRACT: `POST /blocked-time` — create blocked time.
 *
 * Two surfaces build this body: the desktop {@link BlockedTimeDialog} and the
 * mobile funnel's {@link MobileBlockedTimeForm}. Both compose the SAME shared
 * fields (`blocked-time-fields.tsx`) and pass their values to the SAME builder
 * (`buildCreateBlockedTimePayload`).
 *
 * Historic drift this pins down:
 *  • desktop built the instant from DEVICE-local time and sent the DEVICE
 *    timezone; mobile used the org's. Both now use the org's.
 *  • mobile hard-sent `blockedTimeTypeId: null`, so a type preset — and with it
 *    the `paid` flag — was unreachable on a phone. Property 2 now proves the
 *    control is on screen on BOTH surfaces.
 *  • mobile's canned RRULEs carried no UNTIL/COUNT → infinite series.
 *
 * Most fields are `derived`: the date + times fold into `startDate`/`endDate`
 * instants, and the whole recurrence block serializes into one RRULE.
 */

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as never;
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

const get = vi.fn();
const post = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { BlockedTimeDialog } from '../components/blocked-time-dialog';

import { blockedTimeForm } from './blocked-time-form';
import { MobileBlockedTimeForm } from './mobile-blocked-time-form';

const TYPE = {
  id: 'bt-type-1',
  name: 'Lunch',
  durationMinutes: 45,
  paid: true,
};
const PRACTITIONER = { id: 'prac-1', name: 'Sam' };
const TIME_ZONE = 'Europe/Dublin';

/** The calendar slot both surfaces are opened from. */
const INITIAL = {
  startDate: new Date(2026, 2, 2), // 2 Mar 2026
  startTime: { hour: 9, minute: 0 },
};

/**
 * The clock is pinned so the popover calendars open on March 2026 — the month
 * the sample dates live in. Only `Date` is faked; user-event's timers are real.
 */
const NOW = new Date('2026-03-02T09:00:00.000Z');

/** The day both surfaces pick out of the calendar (= the `date` sample). */
const SAMPLE_DAY = '2026-03-05';

const routeGet = (url: string) => {
  if (url.startsWith('blocked-time-types')) return Promise.resolve([TYPE]);
  if (url.startsWith('practitioners')) {
    return Promise.resolve({ items: [PRACTITIONER], total: 1 });
  }
  if (url.startsWith('organization/active')) {
    return Promise.resolve({ id: 'org-1', timezone: TIME_ZONE });
  }
  return Promise.resolve({ items: [], total: 0 });
};

// ---------------------------------------------------------------- custom fills
// Type / date / times / practitioners are reached through DIFFERENT controls on
// the two surfaces (a <Select> vs a pill, a labelled DatePicker vs an icon row),
// so each surface declares its own fill. Both must land on a real control — a
// surface that renders none fails PROPERTY 2, which is exactly how mobile lost
// the type preset (and with it `paid`) before.

const onScreen = (label: string): HTMLElement | null =>
  screen.queryByLabelText(new RegExp(`^\\s*${label}\\s*$`, 'i'));

/** Pick a day out of whichever popover calendar is currently open. */
const pickDay = async (user: UserEvent, isoDay: string) => {
  await screen.findByRole('grid');
  const day = document.querySelector<HTMLButtonElement>(
    `[data-day="${isoDay}"] button`
  );
  if (!day) throw new Error(`no calendar day ${isoDay} on screen`);
  await user.click(day);
};

/** Desktop TimeSelect: a Radix <Select> of 5-minute options ("10:00am"). */
const pickTime = async (user: UserEvent, label: string, option: RegExp) => {
  await user.click(onScreen(label) as HTMLElement);
  const listbox = await screen.findByRole('listbox');
  await user.click(within(listbox).getByRole('option', { name: option }));
};

/** Mobile time row: an icon row opening a popover list of 15-minute options. */
const pickTimeRow = async (user: UserEvent, row: RegExp, option: RegExp) => {
  await user.click(screen.getByRole('button', { name: row }));
  await user.click(await screen.findByRole('button', { name: option }));
};

/** Overwrite a numeric input's whole value (see `customInterval` below). */
const setNumber = (label: string, value: string) => {
  const input = onScreen(label);
  if (!input) throw new Error(`no control labelled "${label}" is rendered`);
  fireEvent.change(input, { target: { value } });
};

const openEndsOption = async (user: UserEvent, option: RegExp) => {
  await user.click(onScreen('Ends') as HTMLElement);
  await user.click(await screen.findByRole('option', { name: option }));
};

/** Desktop: Radix selects, a labelled DatePicker and a popover multi-select. */
const desktopFills = {
  typeId: async (user: UserEvent) => {
    await user.click(onScreen('Type') as HTMLElement);
    await user.click(await screen.findByRole('option', { name: 'Lunch' }));
  },
  date: async (user: UserEvent) => {
    await user.click(onScreen('Date') as HTMLElement);
    await pickDay(user, SAMPLE_DAY);
  },
  startTime: async (user: UserEvent) =>
    pickTime(user, 'Start time', /^10:00am$/i),
  endTime: async (user: UserEvent) => pickTime(user, 'End time', /^11:30am$/i),
  practitionerIds: async (user: UserEvent) => {
    await user.click(onScreen('Team members') as HTMLElement);
    await user.click(
      await screen.findByRole('checkbox', { name: PRACTITIONER.name })
    );
  },
};

/** Mobile: selection pills and icon rows that open a popover list. */
const mobileFills = {
  typeId: async (user: UserEvent) => {
    // The pills land once the blocked-time-types query resolves.
    await user.click(await screen.findByRole('button', { name: 'Lunch' }));
  },
  date: async (user: UserEvent) => {
    await user.click(screen.getByRole('button', { name: /^date\b/i }));
    await pickDay(user, SAMPLE_DAY);
  },
  startTime: async (user: UserEvent) =>
    pickTimeRow(user, /^start\b/i, /^10:00 AM/i),
  endTime: async (user: UserEvent) =>
    pickTimeRow(user, /^end\b/i, /^11:30 AM/i),
  practitionerIds: async (user: UserEvent) => {
    await user.click(
      await screen.findByRole('button', { name: PRACTITIONER.name })
    );
  },
};

runFormContract({
  operation: 'POST blocked-time',
  description: 'Create blocked time',
  form: blockedTimeForm,

  // Reached through the SAME control on both surfaces.
  fills: {
    // Overwrite, the way a browser does when you select the contents and type.
    // `clear()`-then-`type()` cannot: the field rejects an empty value (it maps
    // '' to `undefined`, which react-hook-form ignores), so the input snaps back
    // to its old number and the keystroke APPENDS to it — 1 + "2" = 12.
    customInterval: async () => setNumber('Every', '2'),

    /** Monday. The weekday toggles are aria-pressed buttons, not a labelled group. */
    customWeekdays: async (user) => {
      await user.click(screen.getByRole('button', { name: 'M' }));
    },

    /**
     * `endsAfterCount` and `endsOnDate` are mutually exclusive on screen — the
     * "Ends" select decides which one is rendered. The form (and the builder)
     * keep both, so both must be proven reachable: flip to "After occurrences",
     * fill it, then flip back to the "On date" branch the payload is built from.
     */
    endsAfterCount: async (user) => {
      await openEndsOption(user, /^after occurrences$/i);
      setNumber('Occurrences', '3');
      await openEndsOption(user, /^on date$/i);
    },

    endsOnDate: async (user) => {
      await user.click(onScreen('End date') as HTMLElement);
      await pickDay(user, '2026-03-26');
    },
  },

  surfaces: [
    {
      name: 'desktop blocked-time-dialog',
      fills: desktopFills,
      run: async (ctx) => {
        renderWithProviders(
          <BlockedTimeDialog open onOpenChange={() => {}} initial={INITIAL} />
        );
        await screen.findByRole('heading', { name: /add blocked time/i });

        await ctx.fillRest();
        await ctx.user.click(screen.getByRole('button', { name: /^save$/i }));
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
    {
      name: 'mobile blocked-time funnel',
      fills: mobileFills,
      run: async (ctx) => {
        renderWithProviders(
          <>
            <MobileBlockedTimeForm
              formId="mobile-block"
              initial={INITIAL}
              onSaved={() => {}}
            />
            <button type="submit" form="mobile-block">
              Save
            </button>
          </>
        );
        await screen.findByLabelText('Title');

        await ctx.fillRest();
        await ctx.user.click(screen.getByRole('button', { name: /^save$/i }));
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
  ],

  reset: () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    post.mockReset();
    post.mockResolvedValue({ id: 'bt-1' });
    get.mockReset();
    get.mockImplementation((url: string) => routeGet(url));
  },

  readBody: () => {
    const call = post.mock.calls.find((c) => c[0] === 'blocked-time');
    if (!call) throw new Error('no POST blocked-time call captured');
    return call[1] as Record<string, unknown>;
  },

  /**
   * The derived half of the body, spelled out:
   *   typeId 'bt-type-1'         → blockedTimeTypeId + the preset's `paid`
   *   date + startTime/endTime   → the UTC instants for 10:00 / 11:30 in Dublin
   *   frequency … endsAfterCount → one RRULE (every 2nd week, Mondays, until
   *                                26 Mar 2026 — `endsAfterCount` is filled but
   *                                the "On date" branch wins, so no COUNT)
   */
  expectedBody: () =>
    expectedFromFields(blockedTimeForm.fields, {
      blockedTimeTypeId: TYPE.id,
      paid: true,
      startDate: new Date('2026-03-05T10:00:00.000Z'),
      endDate: new Date('2026-03-05T11:30:00.000Z'),
      allDay: false,
      timezone: TIME_ZONE,
      rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;UNTIL=20260326T235900Z',
      recurrenceEndDate: new Date('2026-03-26T23:59:00.000Z'),
    }),
});

import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import type { UserEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

/**
 * FORM CONTRACT: `PUT /appointments/:id` — update / reschedule an appointment.
 *
 * The endpoint is a PATCH, and its six surfaces own DIFFERENT SLICES of the
 * booking — that is the point of them, not drift:
 *
 *  - the desktop {@link EditEventDialog} (which is also where a calendar
 *    drag/resize lands, via the same `config.onUpdateEvent`) and the
 *    {@link MobileBookingDetailSheet} own the edit panel: staff, title, date,
 *    start time, duration, notes. Both compose the shared `appointmentEditForm`
 *    + `applyAppointmentEdit`, so they cannot build that slice differently.
 *  - quick-actions patches ONE key at a time: a note, a reschedule, a no-show.
 *  - the status stepper patches the status, and nothing else.
 *
 * So each surface declares what it `owns`; the harness holds the two lines that
 * matter — no field may fall off EVERY surface, and where two surfaces own the
 * same field they must send it the same way.
 *
 * `title` is the only field that reaches the wire under its own name. Everything
 * else is derived, including the practitioner, which fans out into BOTH the
 * owning user FK (`assignedToId`) and `practitionerId` — the id-crossing bug.
 */

// jsdom shims for Radix Select / Popover / DropdownMenu.
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

// vaul's drag physics read layout jsdom can't provide. Stub the Drawer to a
// minimal `open`-gated passthrough — the sheet's real form stays real.
vi.mock('vaul', async () => {
  const React = await import('react');
  const Ctx = React.createContext<{
    open: boolean;
    setOpen: (v: boolean) => void;
  }>({ open: false, setOpen: () => {} });
  const Root = ({
    children,
    open,
    onOpenChange,
  }: {
    children: React.ReactNode;
    open?: boolean;
    onOpenChange?: (v: boolean) => void;
  }) => (
    <Ctx.Provider value={{ open: !!open, setOpen: (v) => onOpenChange?.(v) }}>
      {children}
    </Ctx.Provider>
  );
  const Trigger = ({ children }: { children: React.ReactNode }) => {
    const { setOpen } = React.useContext(Ctx);
    return (
      // biome-ignore lint/a11y/useKeyWithClickEvents: test-only stub
      <div onClick={() => setOpen(true)}>{children}</div>
    );
  };
  const Portal = ({ children }: { children: React.ReactNode }) => {
    const { open } = React.useContext(Ctx);
    return open ? <>{children}</> : null;
  };
  const Pass = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Drawer: {
      Root,
      Trigger,
      Portal,
      Overlay: Pass,
      Content: Pass,
      Title: Pass,
    },
  };
});

const get = vi.fn();
const put = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    put: (...args: unknown[]) => put(...args),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  // Branch-scoped hrefs are read from the pathname (plan §4). These surfaces
  // live under `/dashboard/l/:locationId/calendar`, so the mock reports a
  // pathname from there — `useBranchRoutes()` throws outside a branch, and
  // rightly so: a component that builds branch links without one is a bug.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({
      location: { pathname: '/dashboard/l/test-location/calendar/new' },
    }),
}));

import { EditEventDialog } from '@/components/calendar/components/dialogs/edit-event-dialog';
import type { IEvent } from '@/components/calendar/interfaces';
import { AppointmentsProvider } from '@/routes/_authed/dashboard/l/$locationId/calendar/-components/appointments-provider';
import { MobileBookingDetailSheet } from '@/routes/_authed/dashboard/l/$locationId/calendar/-components/mobile/mobile-booking-detail-sheet';

import { AppointmentQuickActions } from './components/appointment-quick-actions';
import { AppointmentStatusProgression } from './components/appointment-status-progression';

import { updateIntentFromCalendarEvent } from './api/update-appointment/update-appointment.from-event';
import { buildUpdateAppointmentPayload } from './api/update-appointment/update-appointment.payload';
import { appointmentEditForm } from './edit';

/** The two practitioners the calendar knows about. Rita is the reassignment. */
const SAM = { id: 'prac-7', name: 'Sam', userId: 'user-42', color: 'green' };
const RITA = { id: 'prac-9', name: 'Rita', userId: 'user-99', color: 'purple' };

/** The saved booking every surface edits. 30 min — one of the duration options. */
const EVENT: IEvent = {
  id: 'appt-1',
  title: 'Haircut',
  description: 'trim',
  startDate: '2026-03-02T09:00:00.000Z',
  endDate: '2026-03-02T09:30:00.000Z',
  color: 'blue',
  user: { id: 'user-42', name: 'Sam', picturePath: null },
  metadata: { practitionerId: 'prac-7', status: 'booked' },
};

/** What the samples move it to: 5 Mar 2026, 11:00, 90 min, reassigned to Rita. */
const PICKED_DAY = /March 5th, 2026/;

function routeGet(url: string) {
  if (typeof url !== 'string') return Promise.resolve({ items: [], total: 0 });
  if (url.startsWith('practitioners')) {
    return Promise.resolve({ items: [SAM, RITA], total: 2 });
  }
  // The provider's supporting lists — bare arrays, not paginated envelopes.
  if (
    url.startsWith('shifts') ||
    url.startsWith('blocked-time') ||
    url.startsWith('organizations/') ||
    url.includes('/members')
  ) {
    return Promise.resolve([]);
  }
  if (url.startsWith('organization/active')) {
    // No `timezone` on the org → business timezone falls back to UTC.
    return Promise.resolve({ id: 'org-1' });
  }
  if (url.startsWith('appointments/')) {
    return Promise.resolve({ id: 'appt-1', description: 'trim' });
  }
  return Promise.resolve({ items: [], total: 0 });
}

const reset = () => {
  put.mockReset();
  put.mockResolvedValue({ id: 'appt-1' });
  get.mockReset();
  get.mockImplementation((url: string) => routeGet(url));
};

const readBody = () => {
  const call = put.mock.calls.find((c) => c[0] === 'appointments/appt-1');
  if (!call) throw new Error('no PUT appointments/appt-1 call captured');
  return call[1] as Record<string, unknown>;
};

/** The calendar context every edit surface reads (users, timeZone, onUpdateEvent). */
const withCalendar = (ui: React.ReactNode) =>
  renderWithProviders(<AppointmentsProvider>{ui}</AppointmentsProvider>);

const save = async (user: UserEvent) => {
  await user.click(screen.getByRole('button', { name: /^save$/i }));
  await waitFor(() => expect(put).toHaveBeenCalled());
};

// =============================================================================
// ONE endpoint, six surfaces, disjoint slices.
// =============================================================================

/** The six edit-panel fields — the slice the two edit surfaces own. */
const EDIT_FIELDS = [
  'assignedPractitionerId',
  'title',
  'date',
  'startTime',
  'duration',
  'notes',
] as const;

/**
 * What each surface's PATCH must contain, beyond the plain samples of the fields
 * it owns. Everything but `title` is derived: date + startTime + duration fold
 * into the instants, notes become `description`, and the picked practitioner
 * fans out into BOTH the owning user FK (`assignedToId`) and `practitionerId` —
 * never crossed. `color` and `status` ride along from the event on an edit.
 */
const EDIT_DERIVED = {
  description: 'Moved at the client’s request.',
  startDate: '2026-03-05T11:00:00.000Z',
  endDate: '2026-03-05T12:30:00.000Z',
  color: 'blue',
  assignedToId: RITA.userId,
  practitionerId: RITA.id,
  status: 'booked',
};

/** The quick-action reschedule preserves the booking's own 30-minute length. */
const RESCHEDULE_DERIVED = {
  startDate: '2026-03-05T11:00:00.000Z',
  endDate: '2026-03-05T11:30:00.000Z',
};

const DERIVED: Record<string, Record<string, unknown>> = {
  'calendar edit-event-dialog (the drag/resize path)': EDIT_DERIVED,
  'mobile booking-detail sheet': EDIT_DERIVED,
  'quick-actions (add a note)': {
    description: 'Moved at the client’s request.',
  },
  'quick-actions (reschedule)': RESCHEDULE_DERIVED,
  'quick-actions (no-show)': {},
  'status-progression stepper': {},
};

const quickActions = () =>
  renderWithProviders(
    <AppointmentQuickActions
      appointmentId="appt-1"
      status="booked"
      startDate={EVENT.startDate}
      endDate={EVENT.endDate}
    />
  );

const openQuickAction = async (user: UserEvent, item: RegExp) => {
  await user.click(screen.getByRole('button', { name: /quick actions/i }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
};

runFormContract({
  operation: 'PUT appointments/:id',
  description: 'Update / reschedule appointment',
  form: appointmentEditForm,

  fills: {
    // Every date control on this endpoint is the shadcn DatePicker: a popover
    // calendar, no input to type into.
    date: async (user) => {
      await user.click(screen.getByLabelText(appointmentEditForm.labels.date));
      await user.click(await screen.findByRole('button', { name: PICKED_DAY }));
    },
    // The status selector: a single Select of every front-desk state.
    status: async (user) => {
      await user.click(screen.getByRole('combobox'));
      await user.click(await screen.findByRole('option', { name: 'No Show' }));
    },
  },

  surfaces: [
    {
      // The dialog IS the drag/resize path: a drag hands the same mutated event
      // to the same `config.onUpdateEvent`. (The drag itself needs a real
      // pointer, so its one contribution — event → intent — is pinned by the
      // builder specs below.)
      name: 'calendar edit-event-dialog (the drag/resize path)',
      owns: [...EDIT_FIELDS],
      run: async (ctx) => {
        withCalendar(
          <EditEventDialog event={EVENT}>
            <button type="button">Edit</button>
          </EditEventDialog>
        );
        await ctx.user.click(
          await screen.findByRole('button', { name: 'Edit' })
        );
        await screen.findByRole('heading', { name: /edit appointment/i });
        await ctx.fillRest();
        await save(ctx.user);
      },
    },
    {
      name: 'mobile booking-detail sheet',
      owns: [...EDIT_FIELDS],
      run: async (ctx) => {
        withCalendar(
          <MobileBookingDetailSheet event={EVENT}>
            <button type="button">Open</button>
          </MobileBookingDetailSheet>
        );
        await ctx.user.click(
          await screen.findByRole('button', { name: 'Open' })
        );
        await screen.findByLabelText(appointmentEditForm.labels.title);
        await ctx.fillRest();
        await save(ctx.user);
      },
    },
    {
      // A note-only PATCH. Its textarea is labelled "Note" (this dialog is about
      // one note), so it reaches `notes` through its own control.
      name: 'quick-actions (add a note)',
      owns: ['notes'],
      fills: {
        notes: async (user) => {
          const box = screen.getByLabelText('Note');
          await user.clear(box);
          await user.type(box, 'Moved at the client’s request.');
        },
      },
      run: async (ctx) => {
        quickActions();
        await openQuickAction(ctx.user, /add a note/i);
        await ctx.fillRest();
        await ctx.user.click(
          screen.getByRole('button', { name: /^save note$/i })
        );
        await waitFor(() => expect(put).toHaveBeenCalled());
      },
    },
    {
      // A start/end-only PATCH: the duration is preserved, so this surface owns
      // the date and the time but not the length.
      name: 'quick-actions (reschedule)',
      owns: ['date', 'startTime'],
      run: async (ctx) => {
        quickActions();
        await openQuickAction(ctx.user, /^reschedule$/i);
        await ctx.fillRest();
        await ctx.user.click(
          screen.getByRole('button', { name: /^reschedule$/i })
        );
        await waitFor(() => expect(put).toHaveBeenCalled());
      },
    },
    {
      // A status-only PATCH, reached from the menu rather than the stepper.
      name: 'quick-actions (no-show)',
      owns: ['status'],
      fills: {
        status: async (user) => {
          await openQuickAction(user, /^no-show$/i);
        },
      },
      run: async (ctx) => {
        quickActions();
        await ctx.fillRest();
        await waitFor(() => expect(put).toHaveBeenCalled());
      },
    },
    {
      // The same status-only PATCH from the stepper the side-panel and the
      // mobile sheet both embed.
      name: 'status-progression stepper',
      owns: ['status'],
      run: async (ctx) => {
        renderWithProviders(
          <AppointmentStatusProgression
            appointmentId="appt-1"
            status="booked"
            onLocalChange={() => {}}
          />
        );
        await ctx.fillRest();
        await waitFor(() => expect(put).toHaveBeenCalled());
      },
    },
  ],

  reset,
  readBody,

  /**
   * A PATCH: each surface sends ONLY the slice it owns. `title` is the one field
   * that reaches the wire under its own name; the rest arrives through DERIVED.
   */
  expectedBody: (surface) =>
    expectedFromFields(appointmentEditForm.fields, DERIVED[surface.name], {
      only: surface.owns,
    }),
});

// =============================================================================
// The shared builder's own rules — PATCH semantics and the branded ids.
// Ported from the retired payload-parity spec. A calendar DRAG cannot be driven
// in jsdom, so its one contribution (the mutated event → intent) is pinned here.
// =============================================================================

describe('buildUpdateAppointmentPayload (shared core)', () => {
  const DRAGGED = {
    id: 'appt-1',
    title: 'Haircut',
    description: 'trim',
    startDate: '2026-03-02T09:00:00.000Z',
    endDate: '2026-03-02T09:30:00.000Z',
    color: 'blue',
    user: { id: 'user-42' },
    metadata: { practitionerId: 'prac-7', status: 'booked' },
  };

  it('routes the user id and practitioner id to their OWN branded fields (id-crossing fix)', () => {
    const body = buildUpdateAppointmentPayload(
      updateIntentFromCalendarEvent(DRAGGED)
    );

    // The historical bug wrote a practitioner id into assignedToId (a user FK).
    expect(body.assignedToId).toBe('user-42');
    expect(body.practitionerId).toBe('prac-7');
    expect(body.assignedToId).not.toBe('prac-7');
    expect(body.practitionerId).not.toBe('user-42');
  });

  it('reschedule emits the same startDate/endDate from the drag path and the quick-actions path', () => {
    const newStart = '2026-03-02T11:00:00.000Z';
    const newEnd = '2026-03-02T11:30:00.000Z';

    // Drag/resize (and the edit surfaces) go through the from-event helper.
    const calendarBody = buildUpdateAppointmentPayload(
      updateIntentFromCalendarEvent({
        ...DRAGGED,
        startDate: newStart,
        endDate: newEnd,
      })
    );

    // Quick-actions builds its reschedule intent directly, same builder.
    const quickActionsBody = buildUpdateAppointmentPayload({
      id: DRAGGED.id,
      startDate: newStart,
      endDate: newEnd,
    });

    expect(calendarBody.startDate).toBe(newStart);
    expect(calendarBody.endDate).toBe(newEnd);
    expect(quickActionsBody.startDate).toBe(calendarBody.startDate);
    expect(quickActionsBody.endDate).toBe(calendarBody.endDate);
  });

  it('carries reschedule-email intent through unchanged', () => {
    const body = buildUpdateAppointmentPayload(
      updateIntentFromCalendarEvent(
        { ...DRAGGED },
        { sendRescheduleEmail: true, rescheduleMessage: 'moved you to 11am' }
      )
    );
    expect(body.sendRescheduleEmail).toBe(true);
    expect(body.rescheduleMessage).toBe('moved you to 11am');
  });

  it('emits only the keys a surface set (PATCH semantics)', () => {
    // A note-only update (quick-actions "add a note") must not touch anything else.
    const noteBody = buildUpdateAppointmentPayload({
      id: DRAGGED.id,
      description: 'call before arriving',
    });
    expect(Object.keys(noteBody)).toEqual(['description']);

    // A status-only update likewise.
    const statusBody = buildUpdateAppointmentPayload({
      id: DRAGGED.id,
      status: 'no_show',
    });
    expect(Object.keys(statusBody)).toEqual(['status']);
  });

  it('distinguishes clear (null) from leave-untouched (omitted)', () => {
    const cleared = buildUpdateAppointmentPayload({
      id: DRAGGED.id,
      description: null,
    });
    expect(cleared).toHaveProperty('description', null);

    const untouched = buildUpdateAppointmentPayload({ id: DRAGGED.id });
    expect(untouched).not.toHaveProperty('description');
  });
});

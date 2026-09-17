import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import type { UserEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

/**
 * FORM CONTRACT: `POST /appointments` — create appointment.
 *
 * Three surfaces build this body: the desktop {@link AddAppointmentDialog}, the
 * mobile calendar/new route funnel (select client → select service → details),
 * and the mobile add-booking drawer funnel. All three compose the ONE shared
 * core (`appointmentCreateForm` + `buildCreateAppointmentPayload`), so a surface
 * cannot re-fork and hand-build a payload again.
 *
 * Historic drift this pins down:
 *  • mobile snapped the duration to one of 6 buckets → a 20-min service became
 *    15 min. The end time must be start + the service's EXACT duration.
 *  • mobile asked for a typed title; desktop auto-titled from the service.
 *  • mobile exposed a colour picker defaulting to 'blue'; desktop derived the
 *    colour from the practitioner.
 *  • the mobile route flow dropped `practitionerId` entirely.
 *  • the desktop dialog rendered NO control for `date` / `startTime` /
 *    `practitionerId` while all three stayed in the schema and in the payload —
 *    the exact dropped-field shape property 2 exists to catch. Restored.
 */

// jsdom shims for Radix Select / Popover.
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
// minimal `open`-gated passthrough — the funnel's step logic and the shared
// create fields stay real; only the drag/animation shell is replaced.
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

const navigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
  // Branch-scoped hrefs are read from the pathname (plan §4). These surfaces
  // live under `/dashboard/l/:locationId/calendar`, so the mock reports a
  // pathname from there — `useBranchRoutes()` throws outside a branch, and
  // rightly so: a component that builds branch links without one is a bug.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({
      location: { pathname: '/dashboard/l/test-location/calendar/new' },
    }),
}));

vi.mock('@/features/mobile-dashboard-header', () => ({
  useMobileDashboardHeaderContent: () => undefined,
}));

import { AddAppointmentDialog } from '@/routes/_authed/dashboard/l/$locationId/calendar/-components/add-appointment-dialog';
import type { AppointmentCreateSearch } from '@/routes/_authed/dashboard/l/$locationId/calendar/-components/appointment-create-search';
import { AppointmentMobileCreateDetails } from '@/routes/_authed/dashboard/l/$locationId/calendar/-components/appointment-mobile-create-details';
import { AppointmentMobileSelectClient } from '@/routes/_authed/dashboard/l/$locationId/calendar/-components/appointment-mobile-select-client';
import { AppointmentMobileSelectService } from '@/routes/_authed/dashboard/l/$locationId/calendar/-components/appointment-mobile-select-service';
import { MobileAddBookingFlow } from '@/routes/_authed/dashboard/l/$locationId/calendar/-components/mobile/mobile-add-booking-flow';

import {
  appointmentCreateForm,
  buildCreateAppointmentPayload,
  resolveAppointmentDurationMinutes,
} from './create';

/** A 20-minute service: not one of the 6 duration buckets mobile used to snap to. */
const SERVICE = {
  id: 'svc-1',
  name: 'Balayage',
  appointmentDuration: 20,
  isActive: true,
};
const PRACTITIONER = { id: 'prac-1', name: 'Sam', color: 'green' };
const LEAD = {
  id: 'lead-1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: null,
};
const LEAD_NAME = 'Ada Lovelace';

/** The clicked slot, expressed the way each surface receives it. */
const SLOT_DATE = new Date(2026, 2, 2); // 2 Mar 2026, local calendar day
const SLOT_TIME = { hour: 9, minute: 15 };

/** What the samples move the booking to: 5 Mar 2026, 09:30 (business tz = UTC). */
const PICKED_DAY = /March 5th, 2026/;
const PICKED_START = new Date('2026-03-05T09:30:00.000Z');
const PICKED_END = new Date(PICKED_START.getTime() + 20 * 60 * 1000);

function routeGet(url: string) {
  if (typeof url !== 'string') return Promise.resolve({ items: [], total: 0 });
  if (url.startsWith('organization-services')) {
    return Promise.resolve({ items: [SERVICE], total: 1 });
  }
  if (url.startsWith('practitioners')) {
    return Promise.resolve({ items: [PRACTITIONER], total: 1 });
  }
  if (url.startsWith('service-categories')) {
    return Promise.resolve([]);
  }
  if (url.startsWith('leads')) {
    return Promise.resolve({ items: [LEAD], total: 1, limit: 50, offset: 0 });
  }
  if (url.startsWith('organization/active')) {
    // No `timezone` on the org → the business timezone falls back to UTC,
    // which every surface must use identically.
    return Promise.resolve({ id: 'org-1' });
  }
  return Promise.resolve({ items: [], total: 0 });
}

/** The last `search` the funnel navigated with — our stand-in for the router. */
const lastSearch = (): AppointmentCreateSearch => {
  const call = navigate.mock.calls.at(-1)?.[0] as
    | { search?: AppointmentCreateSearch }
    | undefined;
  if (!call?.search) throw new Error('funnel step did not navigate');
  return call.search;
};

const submit = async (user: UserEvent) => {
  await user.click(
    screen.getByRole('button', { name: /^create appointment$/i })
  );
  await waitFor(() => expect(post).toHaveBeenCalled());
};

/**
 * MOBILE shapes — shared by both funnels, which compose the same pickers: the
 * client and the service are full-screen list steps, the team member is a row of
 * pills (or a step of its own in the drawer), and the date/time are iOS-style
 * popover rows rather than inputs. Each still locates a real control, and still
 * throws when it is gone — that is property 2, just through a different door.
 */
const MOBILE_FILLS = {
  leadId: async (user: UserEvent) => {
    await user.click(await screen.findByText(LEAD_NAME));
  },
  serviceId: async (user: UserEvent) => {
    await user.click(
      await screen.findByRole('button', { name: new RegExp(SERVICE.name) })
    );
  },
  practitionerId: async (user: UserEvent) => {
    await user.click(
      await screen.findByRole('button', { name: new RegExp(PRACTITIONER.name) })
    );
  },
  date: async (user: UserEvent) => {
    await user.click(
      screen.getByRole('button', {
        name: new RegExp(`^${appointmentCreateForm.labels.date}`),
      })
    );
    await user.click(await screen.findByRole('button', { name: PICKED_DAY }));
  },
  startTime: async (user: UserEvent) => {
    await user.click(
      screen.getByRole('button', {
        name: new RegExp(`^${appointmentCreateForm.labels.startTime}`, 'i'),
      })
    );
    await user.click(await screen.findByRole('button', { name: '9:30 AM' }));
  },
};

runFormContract({
  operation: 'POST appointments',
  description: 'Create appointment',
  form: appointmentCreateForm,

  /**
   * DESKTOP shapes. The service / team member Selects, the time input and the
   * notes textarea are driven by the generic drivers off their declared labels;
   * only the two bespoke pickers need a recipe. The mobile funnels reach the
   * same fields through their own controls, so they carry surface-level fills.
   */
  fills: {
    // The LeadPicker: a combobox that opens a cmdk list of clients.
    leadId: async (user) => {
      await user.click(
        screen.getByRole('combobox', { name: /select client/i })
      );
      await user.click(await screen.findByText(LEAD_NAME));
    },
    // The shadcn DatePicker: a popover calendar, no input to type into.
    date: async (user) => {
      await user.click(
        screen.getByLabelText(appointmentCreateForm.labels.date)
      );
      await user.click(await screen.findByRole('button', { name: PICKED_DAY }));
    },
  },

  surfaces: [
    {
      name: 'desktop add-appointment-dialog',
      run: async (ctx) => {
        renderWithProviders(
          <AddAppointmentDialog
            open
            onOpenChange={() => {}}
            startDate={SLOT_DATE}
            startTime={SLOT_TIME}
          />
        );
        await screen.findByRole('heading', { name: /create appointment/i });
        await ctx.fillRest();
        await submit(ctx.user);
      },
    },
    {
      name: 'mobile calendar/new funnel',
      fills: MOBILE_FILLS,
      run: async (ctx) => {
        const search: AppointmentCreateSearch = {
          date: '2026-03-02',
          hour: SLOT_TIME.hour,
          minute: SLOT_TIME.minute,
        };

        // Step 1 — select client.
        const step1 = renderWithProviders(
          <AppointmentMobileSelectClient search={search} />
        );
        await ctx.fill('leadId');
        step1.unmount();

        // Step 2 — select service.
        const step2 = renderWithProviders(
          <AppointmentMobileSelectService search={lastSearch()} />
        );
        await ctx.fill('serviceId');
        step2.unmount();

        // Step 3 — the details screen (team member, date, time, notes).
        renderWithProviders(
          <AppointmentMobileCreateDetails search={lastSearch()} />
        );
        await screen.findByRole('heading', { name: 'Create Appointment' });
        await ctx.fillRest();
        await submit(ctx.user);
      },
    },
    {
      name: 'mobile add-booking drawer',
      fills: MOBILE_FILLS,
      run: async (ctx) => {
        renderWithProviders(
          <MobileAddBookingFlow startDate={SLOT_DATE} startTime={SLOT_TIME}>
            <button type="button">Open</button>
          </MobileAddBookingFlow>
        );
        await ctx.user.click(screen.getByRole('button', { name: 'Open' }));

        await screen.findByText('Select Client');
        await ctx.fill('leadId');

        await screen.findByText('Select Service');
        await ctx.fill('serviceId');

        // The slot fixed no column, so the funnel ASKS for the practitioner.
        await screen.findByText('Select Team Member');
        await ctx.fill('practitionerId');

        await screen.findByRole('heading', { name: 'Create Appointment' });
        await ctx.fillRest();
        await submit(ctx.user);
      },
    },
  ],

  reset: () => {
    post.mockReset();
    post.mockResolvedValue({ id: 'appt-1' });
    get.mockReset();
    get.mockImplementation((url: string) => routeGet(url));
    navigate.mockReset();
  },

  readBody: () => {
    const call = post.mock.calls.find((c) => c[0] === 'appointments');
    if (!call) throw new Error('no POST appointments call captured');
    return call[1] as Record<string, unknown>;
  },

  /**
   * Derived from the field samples, plus the four keys the builder computes:
   * the title from the chosen service, the colour from the assigned
   * practitioner, and the start/end instants from date + startTime + the
   * service's EXACT duration (20 min — never snapped to a bucket).
   */
  expectedBody: () =>
    expectedFromFields(appointmentCreateForm.fields, {
      title: SERVICE.name,
      description: 'Allergic to latex',
      color: PRACTITIONER.color,
      startDate: PICKED_START,
      endDate: PICKED_END,
    }),
});

/**
 * The shared builder's own rules, driven directly — the parts of the payload no
 * surface can influence (bucket-free durations, the business timezone, the
 * unassigned case). Ported from the retired payload-parity spec.
 */
describe('buildCreateAppointmentPayload (shared core)', () => {
  const context = {
    services: [
      { id: 'a', name: 'A', appointmentDuration: 20 },
      { id: 'b', name: 'B', appointmentDuration: 75 },
      { id: 'c', name: 'C', appointmentDuration: 180 },
      { id: 'd', name: 'D', appointmentDuration: null },
    ],
    practitioners: [{ id: 'p1', name: 'P1', color: 'purple' }],
    timeZone: 'UTC',
  };

  const values = {
    leadId: 'lead-1',
    serviceId: 'a',
    practitionerId: 'p1',
    date: '2026-03-02',
    startTime: '09:15',
    notes: '',
  };

  it.each([
    ['a', 20],
    ['b', 75],
    ['c', 180],
    // No configured duration and no org default → the shared 30-minute
    // fallback, the SAME one the public booking page resolves to. This used to
    // be a private 60 here against a private 30 there, so the identical
    // service was a 60-minute staff block and a 30-minute customer slot
    // (ENG-793).
    ['d', 30],
  ])('uses the service duration exactly (%s → %i min)', (serviceId, mins) => {
    const payload = buildCreateAppointmentPayload(
      { ...values, serviceId },
      context
    );
    expect(payload.endDate.getTime() - payload.startDate.getTime()).toBe(
      mins * 60 * 1000
    );
  });

  it("falls back to the ORGANIZATION's default duration before the global one", () => {
    const payload = buildCreateAppointmentPayload(
      { ...values, serviceId: 'd' },
      { ...context, defaultAppointmentDuration: 45 }
    );
    expect(payload.endDate.getTime() - payload.startDate.getTime()).toBe(
      45 * 60 * 1000
    );
  });

  it('prefers the service duration over the organization default', () => {
    const payload = buildCreateAppointmentPayload(
      { ...values, serviceId: 'b' },
      { ...context, defaultAppointmentDuration: 45 }
    );
    expect(payload.endDate.getTime() - payload.startDate.getTime()).toBe(
      75 * 60 * 1000
    );
  });

  it('resolves the start instant in the BUSINESS timezone, not the device one', () => {
    const utc = buildCreateAppointmentPayload(values, context);
    const dublin = buildCreateAppointmentPayload(values, {
      ...context,
      timeZone: 'Europe/Dublin',
    });

    expect(utc.startDate.toISOString()).toBe('2026-03-02T09:15:00.000Z');
    // Dublin is UTC+0 in March (pre-DST) — same instant, proving the wall-clock
    // is interpreted in the org's zone rather than the machine's.
    expect(dublin.startDate.toISOString()).toBe('2026-03-02T09:15:00.000Z');

    const newYork = buildCreateAppointmentPayload(values, {
      ...context,
      timeZone: 'America/New_York',
    });
    expect(newYork.startDate.toISOString()).toBe('2026-03-02T14:15:00.000Z');
  });

  it('omits practitionerId (and falls back to the default tint) when unassigned', () => {
    const payload = buildCreateAppointmentPayload(
      { ...values, practitionerId: 'none' },
      context
    );
    expect('practitionerId' in payload).toBe(false);
    expect(payload.color).toBe('blue');
  });

  it('never snaps a duration to a bucket', () => {
    for (const minutes of [20, 75, 180]) {
      expect(
        resolveAppointmentDurationMinutes({
          id: 'x',
          name: 'X',
          appointmentDuration: minutes,
        })
      ).toBe(minutes);
    }
  });
});

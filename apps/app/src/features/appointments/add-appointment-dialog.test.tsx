import { renderWithProviders, screen, waitFor } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Component tests for the new-appointment FORM (calendar header "Create
 * Appointment"), ported from the calendar E2E which only proves the dialog
 * opens. Here we own the FORM behaviour: it renders the client/service/notes
 * fields, blocks submit with inline validation when required fields are empty,
 * and — on a valid submit — sends the EXACT create payload through the mocked
 * apiClient. Persistence itself is proven by a separate integration test.
 *
 * Two child inputs are hard to drive faithfully in jsdom, so we replace them
 * with deterministic stubs — neither is the unit under test here:
 *  • LeadPicker (radix Popover + cmdk) → a button that sets a fixed lead id.
 *  • ui/select (radix Select) → a native <select> so we can pick a service.
 * useCalendar is stubbed to a fixed timezone (the dialog only reads `timeZone`).
 */

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

const toastError = vi.fn();
const toastSuccess = vi.fn();
// `warning` is the warn-don't-block channel: a staff booking that clashed with
// a room SUCCEEDED, so it must never come through `error`.
const toastWarning = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
  },
}));

// The dialog only reads `timeZone` off the calendar context.
vi.mock('@/components/calendar/contexts/calendar-context', () => ({
  useCalendar: () => ({ timeZone: 'UTC' }),
  // The dialog reads the calendar's selected location to filter rooms by site.
  // `null` is the standalone case this file renders: no calendar, so no
  // location, so no `locationId` in the payload — which is what the
  // exact-payload assertions above depend on.
  useOptionalCalendar: () => null,
}));

// Deterministic stub: expose a button that selects a fixed lead id.
vi.mock('@/components/app/lead-picker', () => ({
  LeadPicker: ({
    value,
    onValueChange,
  }: {
    value?: string;
    onValueChange: (leadId: string, lead: unknown) => void;
  }) => (
    <button
      type="button"
      data-testid="pick-lead"
      onClick={() => onValueChange('lead-1', null)}
    >
      {value || 'no-lead'}
    </button>
  ),
}));

// Native-select stub so the service field is drivable without radix pointer
// plumbing. Mirrors the Select/Trigger/Content/Item/Value surface the dialog
// uses; SelectItem → <option>, everything else renders through. The dialog
// renders TWO Selects (service, then team member) — both come through this
// stub, so `serviceSelect()` takes the first of them.
/**
 * Radix Select → a native `<select>`, so userEvent can drive it in jsdom.
 *
 * The trigger's `id` and `aria-label` are lifted onto the native element:
 * without them every stubbed Select in the dialog is anonymous and
 * indistinguishable, and a test can only reach one by index — which silently
 * points at a different control the moment a field is added.
 */
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');

  const triggerPropsOf = (children: React.ReactNode) => {
    let found: { id?: string; 'aria-label'?: string } = {};
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as Record<string, unknown>;
      if (
        typeof props.id === 'string' ||
        typeof props['aria-label'] === 'string'
      ) {
        found = {
          id: props.id as string | undefined,
          'aria-label': props['aria-label'] as string | undefined,
        };
      }
    });
    return found;
  };

  return {
    Select: ({
      value,
      onValueChange,
      disabled,
      children,
    }: {
      value?: string;
      onValueChange: (v: string) => void;
      disabled?: boolean;
      children?: React.ReactNode;
    }) => (
      <select
        data-testid="service-select"
        value={value}
        disabled={disabled}
        onChange={(e) => onValueChange(e.target.value)}
        {...triggerPropsOf(children)}
      >
        <option value="" />
        {children}
      </select>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children?: React.ReactNode }) => (
      <>{children}</>
    ),
    SelectItem: ({
      value,
      children,
    }: {
      value: string;
      children?: React.ReactNode;
    }) => <option value={value}>{children}</option>,
  };
});

import { AddAppointmentDialog } from '@/routes/_authed/dashboard/l/$locationId/calendar/-components/add-appointment-dialog';

/** The service Select — the first of the dialog's two stubbed Selects. */
const serviceSelect = async (): Promise<HTMLElement> =>
  (await screen.findAllByTestId('service-select'))[0] as HTMLElement;

// apiClient.get is URL-routed: services (for the Select) and practitioners
// (for the tint color). Default empty; individual tests seed a service.
function routeGet(url: string) {
  if (typeof url === 'string' && url.startsWith('organization-services')) {
    return Promise.resolve({
      items: [
        {
          id: 'svc-1',
          name: 'Haircut',
          appointmentDuration: 30,
          isActive: true,
        },
      ],
      total: 1,
    });
  }
  if (typeof url === 'string' && url.startsWith('practitioners')) {
    return Promise.resolve({ items: [], total: 0 });
  }
  return Promise.resolve({ items: [], total: 0 });
}

describe('AddAppointmentDialog (form)', () => {
  beforeEach(() => {
    get.mockImplementation((url: string) => routeGet(url));
    post.mockResolvedValue({ id: 'appt-1' });
  });

  it('renders the create heading, client, service and notes fields', async () => {
    renderWithProviders(<AddAppointmentDialog open onOpenChange={() => {}} />);

    expect(
      await screen.findByRole('heading', { name: /create appointment/i })
    ).toBeVisible();
    expect(screen.getByText('Client')).toBeVisible();
    expect(screen.getByText('Service')).toBeVisible();
    expect(screen.getByLabelText('Notes')).toBeVisible();
  });

  it('blocks submit and shows inline errors when client + service are empty', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <AddAppointmentDialog open onOpenChange={onOpenChange} />
    );

    await screen.findByRole('heading', { name: /create appointment/i });
    await user.click(
      screen.getByRole('button', { name: /create appointment/i })
    );

    expect(await screen.findByText('Client is required')).toBeVisible();
    expect(screen.getByText('Service is required')).toBeVisible();
    // Nothing persisted, dialog stays open.
    expect(post).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('sends the exact create payload for a valid submit and closes on success', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <AddAppointmentDialog open onOpenChange={onOpenChange} />
    );

    await screen.findByRole('heading', { name: /create appointment/i });
    // Pick a client + service.
    await user.click(screen.getByTestId('pick-lead'));
    await user.selectOptions(await serviceSelect(), 'svc-1');
    await user.type(
      screen.getByLabelText('Notes'),
      'Prefers short back and sides'
    );

    await user.click(
      screen.getByRole('button', { name: /create appointment/i })
    );

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, payload] = post.mock.calls[0];
    expect(url).toBe('appointments');
    expect(payload).toMatchObject({
      title: 'Haircut', // taken from the chosen service
      description: 'Prefers short back and sides',
      color: 'blue', // no practitioner column → default tint
      leadId: 'lead-1',
      serviceId: 'svc-1',
    });
    expect(payload.startDate).toBeInstanceOf(Date);
    expect(payload.endDate).toBeInstanceOf(Date);
    // 30-minute service duration is honoured.
    expect(payload.endDate.getTime() - payload.startDate.getTime()).toBe(
      30 * 60 * 1000
    );
    // No practitionerId prop → key omitted entirely.
    expect('practitionerId' in payload).toBe(false);

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('includes practitionerId when the slot fixes a column', async () => {
    get.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.startsWith('practitioners')) {
        return Promise.resolve({
          items: [{ id: 'prac-1', name: 'Sam', color: 'green' }],
          total: 1,
        });
      }
      return routeGet(url);
    });
    const user = userEvent.setup();
    renderWithProviders(
      <AddAppointmentDialog
        open
        onOpenChange={() => {}}
        practitionerId="prac-1"
      />
    );

    await screen.findByRole('heading', { name: /create appointment/i });
    await user.click(screen.getByTestId('pick-lead'));
    await user.selectOptions(await serviceSelect(), 'svc-1');
    await user.click(
      screen.getByRole('button', { name: /create appointment/i })
    );

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [, payload] = post.mock.calls[0];
    expect(payload.practitionerId).toBe('prac-1');
    expect(payload.color).toBe('green'); // practitioner's tint
  });

  // Regression: the single-day view does not remount its slot dialogs when the
  // date changes — `selectedDate` updates and the same instances re-render.
  // `useForm` reads `defaultValues` only at mount, so the form kept the date it
  // first mounted with and created the appointment for THAT day instead of the
  // one clicked. Silent, because the date field showed the stale value too.
  // The multi-day views were unaffected: each day is its own column, so those
  // dialogs mount already holding the right date.
  it('uses the latest slot date when reopened after the date changed', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    // Dates are built from LOCAL components, not a `...T00:00:00Z` literal: the
    // component formats the slot date with `format(day, 'yyyy-MM-dd')` in local
    // time, so a UTC-midnight Date rolls back a day on any behind-UTC machine
    // (the real calendar passes local dates too). Keeps this assertion
    // timezone-safe — it previously only passed on UTC/ahead-of-UTC runners.
    // Mounted on one date, closed.
    const { rerender } = renderWithProviders(
      <AddAppointmentDialog
        open={false}
        onOpenChange={onOpenChange}
        startDate={new Date(2026, 6, 20)}
        startTime={{ hour: 9, minute: 0 }}
      />
    );

    // The single-day view navigates two days on: same instance, new props.
    rerender(
      <AddAppointmentDialog
        open
        onOpenChange={onOpenChange}
        startDate={new Date(2026, 6, 22)}
        startTime={{ hour: 9, minute: 0 }}
      />
    );

    await screen.findByRole('heading', { name: /create appointment/i });
    await user.click(screen.getByTestId('pick-lead'));
    await user.selectOptions(await serviceSelect(), 'svc-1');
    await user.click(
      screen.getByRole('button', { name: /create appointment/i })
    );

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [, payload] = post.mock.calls[0];
    // Must be the date it was reopened on, not the one it mounted with.
    expect(new Date(payload.startDate as string).toISOString()).toContain(
      '2026-07-22'
    );
  });

  it('surfaces a server error via toast and keeps the dialog open', async () => {
    post.mockRejectedValueOnce(new Error('Booking clash'));
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <AddAppointmentDialog open onOpenChange={onOpenChange} />
    );

    await screen.findByRole('heading', { name: /create appointment/i });
    await user.click(screen.getByTestId('pick-lead'));
    await user.selectOptions(await serviceSelect(), 'svc-1');
    await user.click(
      screen.getByRole('button', { name: /create appointment/i })
    );

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Booking clash')
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('disables the submit button while the create is in flight', async () => {
    // A create that never resolves keeps the mutation pending.
    post.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderWithProviders(<AddAppointmentDialog open onOpenChange={() => {}} />);

    await screen.findByRole('heading', { name: /create appointment/i });
    await user.click(screen.getByTestId('pick-lead'));
    await user.selectOptions(await serviceSelect(), 'svc-1');
    await user.click(
      screen.getByRole('button', { name: /create appointment/i })
    );

    // Button flips to the pending label and is disabled.
    const pending = await screen.findByRole('button', { name: /creating/i });
    expect(pending).toBeDisabled();
  });

  // ── ENG-816: an open form is never reset underneath the user ─────────────
  //
  // The re-seed effect was `[open, defaultValues, form]`, and `defaultValues`
  // is a `useMemo` over the `startDate`/`startTime`/`practitionerId` props —
  // so ANY parent re-render that produced a fresh object identity reset the
  // open form and discarded whatever had been typed. By hand: editing Start
  // time a second time snapped it back to the previous value with no
  // explanation. The effect now fires on the false→true transition only.
  //
  // The re-render below passes an EQUAL-BUT-NEW `startTime` object, which is
  // exactly what an ordinary parent render does.
  it('keeps typed input when the parent re-renders while open', async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(
      <AddAppointmentDialog
        open
        onOpenChange={() => {}}
        startTime={{ hour: 9, minute: 0 }}
      />
    );

    const notes = await screen.findByLabelText(/notes/i);
    await user.type(notes, 'bring the consent form');
    expect(notes).toHaveValue('bring the consent form');

    rerender(
      <AddAppointmentDialog
        open
        onOpenChange={() => {}}
        startTime={{ hour: 9, minute: 0 }}
      />
    );

    expect(await screen.findByLabelText(/notes/i)).toHaveValue(
      'bring the consent form'
    );
  });
});

/**
 * ROOMS & EQUIPMENT on the create dialog.
 *
 * Rooms are a brand-new capability and EVERY existing clinic has zero resource
 * categories, so the first test here is the one that matters most: for such an
 * org the dialog must render byte-identically to what it rendered before this
 * feature landed. The remaining cases only run once the org is configured.
 */
describe('AddAppointmentDialog (rooms & equipment)', () => {
  /** 05 Mar 2026, 14:00 UTC → a fixed window the allocation fixtures overlap. */
  const SLOT_DATE = new Date(2026, 2, 5);
  const SLOT_TIME = { hour: 14, minute: 0 };

  const CATEGORY = {
    id: 'cat-1',
    name: 'Room',
    kind: 'room',
    resourceCount: 2,
    isActive: true,
  };
  const ROOMS = [
    {
      id: 'res-1',
      name: 'Room 1',
      categoryId: 'cat-1',
      isActive: true,
      capacity: 1,
    },
    {
      id: 'res-2',
      name: 'Room 2',
      categoryId: 'cat-1',
      isActive: true,
      capacity: 1,
    },
  ];
  /** Room 1 is held 14:00–14:45 by someone else, so the auto pick is Room 2. */
  const ALLOCATIONS = [
    {
      id: 'alloc-1',
      appointmentId: 'appt-other',
      resourceId: 'res-1',
      resourceName: 'Room 1',
      resourceColor: null,
      categoryId: 'cat-1',
      startDate: '2026-03-05T14:00:00.000Z',
      endDate: '2026-03-05T14:45:00.000Z',
      turnaroundMinutes: 0,
      source: 'auto',
      allowOverlap: false,
    },
  ];

  /** apiClient.get with rooms configured. `mode` drives org-defaults. */
  const routeGetWithRooms =
    (mode: 'auto' | 'manual' = 'auto') =>
    (url: string) => {
      if (typeof url === 'string') {
        // Order matters — the bare `resources` prefix would swallow all three.
        if (url.startsWith('resources/categories')) {
          return Promise.resolve([CATEGORY]);
        }
        if (url.startsWith('resources/requirements')) {
          return Promise.resolve({
            serviceId: 'svc-1',
            turnaroundMinutes: 0,
            requirements: [
              {
                categoryId: 'cat-1',
                categoryName: 'Room',
                categoryKind: 'room',
                eligibleResourceIds: [],
              },
            ],
          });
        }
        if (url.startsWith('resources/allocations')) {
          return Promise.resolve(ALLOCATIONS);
        }
        if (url.startsWith('resources')) return Promise.resolve(ROOMS);
        if (url.startsWith('org-defaults')) {
          return Promise.resolve({
            organizationId: 'org-1',
            resourceAssignmentMode: mode,
            overrides: {},
          });
        }
      }
      return routeGet(url);
    };

  const openWithService = async (user: ReturnType<typeof userEvent.setup>) => {
    await screen.findByRole('heading', { name: /create appointment/i });
    await user.click(screen.getByTestId('pick-lead'));
    await user.selectOptions(await serviceSelect(), 'svc-1');
  };

  beforeEach(() => {
    post.mockResolvedValue({ id: 'appt-1' });
  });

  // THE REGRESSION GUARD. Every clinic on the platform today is this org.
  it('renders nothing resource-related for an org with no resources', async () => {
    get.mockImplementation((url: string) => routeGet(url));
    const user = userEvent.setup();
    renderWithProviders(
      <AddAppointmentDialog
        open
        onOpenChange={() => {}}
        startDate={SLOT_DATE}
        startTime={SLOT_TIME}
      />
    );

    await openWithService(user);

    // No section, no dropdown, no manual-mode hint — nothing at all.
    expect(screen.queryByText(/rooms & equipment/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: /choose room/i })
    ).not.toBeInTheDocument();

    // And the payload is untouched: no `resourceIds` key at all.
    await user.click(
      screen.getByRole('button', { name: /create appointment/i })
    );
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect('resourceIds' in post.mock.calls[0][1]).toBe(false);
  });

  /**
   * UNASSIGNED IS THE DEFAULT, and it means it.
   *
   * The section used to open pre-filled with the room the allocator WOULD
   * pick, labelled "(auto)". That reads as a decision already made about a
   * booking the operator has not finished, and it pre-selected a value nobody
   * chose. The dropdown starts on "Unassigned"; leaving it there sends no
   * `resourceIds` at all and the server allocates, exactly as before.
   */
  it('defaults every category to Unassigned and sends no resourceIds', async () => {
    get.mockImplementation(routeGetWithRooms('auto'));
    const user = userEvent.setup();
    renderWithProviders(
      <AddAppointmentDialog
        open
        onOpenChange={() => {}}
        startDate={SLOT_DATE}
        startTime={SLOT_TIME}
      />
    );

    await openWithService(user);

    // The service REQUIRES a room, so the section opens itself — the choice is
    // part of this booking rather than a refinement of it. The summary still
    // reports the state, for when it is collapsed.
    const section = await screen.findByRole('button', {
      name: /rooms & equipment/i,
    });
    expect(section).toHaveTextContent('Unassigned');

    const roomSelect = await screen.findByRole('combobox', {
      name: 'Choose room',
    });
    expect(roomSelect).toHaveValue('__unassigned__');

    await user.click(
      screen.getByRole('button', { name: /create appointment/i })
    );
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect('resourceIds' in post.mock.calls[0][1]).toBe(false);
  });

  /**
   * OVERBOOKING IS ALLOWED, AND WARNED ABOUT FIRST.
   *
   * Room 1 is held 14:00–14:45 by someone else and this booking is at 14:00.
   * Picking it must not be refused — the front desk can see the room — but the
   * clash has to be on screen before submit, and the payload has to carry the
   * flag that stops the server refusing what they were just told would work.
   */
  it('warns inline when the chosen room is busy, and still books it', async () => {
    get.mockImplementation(routeGetWithRooms('auto'));
    const user = userEvent.setup();
    renderWithProviders(
      <AddAppointmentDialog
        open
        onOpenChange={() => {}}
        startDate={SLOT_DATE}
        startTime={SLOT_TIME}
      />
    );

    await openWithService(user);

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Choose room' }),
      'res-1'
    );

    // Named window, not a bare "unavailable" — it is what the operator checks
    // the diary against.
    expect(await screen.findByText(/already booked/i)).toHaveTextContent(
      /14:00.*14:45/
    );

    await user.click(
      screen.getByRole('button', { name: /create appointment/i })
    );
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1]).toMatchObject({
      resourceIds: ['res-1'],
      allowResourceOverbook: true,
    });
  });

  // The mirror: a FREE room carries no warning and no override. Without this,
  // the test above would pass just as well if the flag were hardcoded true.
  it('sends no override when the chosen room is free', async () => {
    get.mockImplementation(routeGetWithRooms('auto'));
    const user = userEvent.setup();
    renderWithProviders(
      <AddAppointmentDialog
        open
        onOpenChange={() => {}}
        startDate={SLOT_DATE}
        startTime={SLOT_TIME}
      />
    );

    await openWithService(user);

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Choose room' }),
      'res-2'
    );
    expect(screen.queryByText(/already booked/i)).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /create appointment/i })
    );
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1].resourceIds).toEqual(['res-2']);
    expect('allowResourceOverbook' in post.mock.calls[0][1]).toBe(false);
  });

  it('sends the chosen room, and books without one in manual mode', async () => {
    get.mockImplementation(routeGetWithRooms('manual'));
    const user = userEvent.setup();
    renderWithProviders(
      <AddAppointmentDialog
        open
        onOpenChange={() => {}}
        startDate={SLOT_DATE}
        startTime={SLOT_TIME}
      />
    );

    await openWithService(user);

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Choose room' }),
      'res-2'
    );

    await user.click(
      screen.getByRole('button', { name: /create appointment/i })
    );
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1].resourceIds).toEqual(['res-2']);
  });

  it('warns without blocking when the server booked into a clashing room', async () => {
    get.mockImplementation(routeGetWithRooms('auto'));
    post.mockResolvedValue({
      id: 'appt-1',
      resources: [{ categoryId: 'cat-1', resourceId: 'res-2' }],
      resourceWarnings: [
        {
          categoryId: 'cat-1',
          categoryName: 'Room',
          resourceId: 'res-2',
          resourceName: 'Room 2',
          conflictingAppointmentTitle: 'Hydrafacial — Aoife',
          conflictStart: '2026-03-05T14:00:00.000Z',
          conflictEnd: '2026-03-05T14:45:00.000Z',
        },
      ],
    });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <AddAppointmentDialog
        open
        onOpenChange={onOpenChange}
        startDate={SLOT_DATE}
        startTime={SLOT_TIME}
      />
    );

    await openWithService(user);
    await user.click(
      screen.getByRole('button', { name: /create appointment/i })
    );

    await waitFor(() => expect(toastWarning).toHaveBeenCalled());
    expect(toastWarning.mock.calls[0][0]).toBe(
      'Room 2 is already booked 14:00–14:45 for "Hydrafacial — Aoife". Booked anyway.'
    );
    // Warn, don't block: it is not an error, and the booking went through.
    expect(toastError).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalled();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    // The repair is offered, not just the bad news.
    expect(toastWarning.mock.calls[0][1].action.label).toBe('Change room');
  });

  // The `null` resource is the case that would otherwise print "null is
  // already booked": a required category holding no usable resource at all.
  it('changes the copy entirely when no resource could be named', async () => {
    get.mockImplementation(routeGetWithRooms('auto'));
    post.mockResolvedValue({
      id: 'appt-1',
      resources: [],
      resourceWarnings: [
        {
          categoryId: 'cat-1',
          categoryName: 'Room',
          resourceId: null,
          resourceName: null,
          conflictingAppointmentTitle: null,
          conflictStart: null,
          conflictEnd: null,
        },
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(
      <AddAppointmentDialog
        open
        onOpenChange={() => {}}
        startDate={SLOT_DATE}
        startTime={SLOT_TIME}
      />
    );

    await openWithService(user);
    await user.click(
      screen.getByRole('button', { name: /create appointment/i })
    );

    await waitFor(() => expect(toastWarning).toHaveBeenCalled());
    expect(toastWarning.mock.calls[0][0]).toBe(
      'No room is available for this time. Booked anyway.'
    );
    expect(toastWarning.mock.calls[0][0]).not.toContain('null');
  });
});

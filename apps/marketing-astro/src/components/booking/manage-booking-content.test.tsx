// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from './test-render';

/**
 * Component tests for the patient-facing manage-booking page.
 *
 * Ported from `apps/app/src/routes/book/-components/manage-booking-content.test.tsx`.
 *
 * This is the surface an anonymous stranger sees after clicking the link in
 * their confirmation email, so the behaviour that matters is what it TELLS them
 * before they act, and what it sends when they do:
 *
 *  • The fee warning must appear BEFORE they commit, not after.
 *  • "No fee configured" must read as "free", never as "€0.00".
 *  • A terminal booking must offer no buttons to press.
 *  • A dead link must be a calm explanation, not an error page.
 *  • Cancel must post the exact payload, and the reason must reach the clinic.
 *
 * The date-time picker (a heavy child with its own slot fetching) is stubbed —
 * it is not the unit under test; the reschedule PAYLOAD is.
 */

const get = vi.fn();
const post = vi.fn();

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Stand in for the real picker: one button that confirms a fixed slot, so we
// can assert the payload the page sends without driving a calendar in jsdom.
const PICKED_SLOT = '2026-04-02T09:00:00.000Z';
vi.mock('./general-datetime-picker', () => ({
  GeneralDateTimePicker: ({
    onConfirm,
  }: {
    onConfirm: (slot: { startTime: string }) => void;
  }) => (
    <button type="button" onClick={() => onConfirm({ startTime: PICKED_SLOT })}>
      pick-slot
    </button>
  ),
}));

const { ManageBookingContent } = await import('./manage-booking-content');

const booking = (overrides?: Record<string, unknown>) => ({
  appointmentId: 'appt-1',
  title: 'Lip Filler',
  startDate: '2026-04-01T10:00:00.000Z',
  endDate: '2026-04-01T10:30:00.000Z',
  status: 'booked',
  isActionable: true,
  serviceName: 'Lip Filler',
  practitionerName: 'Dr Ana',
  serviceId: 'svc-1',
  practitionerId: 'prac-1',
  durationMinutes: 30,
  organization: {
    name: 'Glow Aesthetics',
    slug: 'glow',
    logo: null,
    timezone: 'Europe/Dublin',
  },
  policy: {
    noticeRequiredHours: 24,
    isWithinFreeWindow: true,
    lateFeeCents: null,
  },
  ...overrides,
});

const renderPage = () =>
  renderWithProviders(
    <ManageBookingContent organizationSlug="glow" token="tok-123" />
  );

const click = (el: Element) => fireEvent.click(el);

describe('ManageBookingContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    post.mockResolvedValue({ appointmentId: 'appt-1' });
  });

  it('shows the booking the patient is holding', async () => {
    get.mockResolvedValue(booking());

    renderPage();

    expect(await screen.findByText('Lip Filler')).toBeTruthy();
    expect(screen.getByText('Dr Ana')).toBeTruthy();
    expect(screen.getByText(/Glow Aesthetics/)).toBeTruthy();
  });

  it('renders the time in the ORG timezone, not the browser one', async () => {
    // 10:00 UTC is 11:00 in Dublin in April (IST, UTC+1). A patient opening the
    // email abroad must still see the clinic's clock — otherwise the email says
    // one time and the page says another, and they turn up an hour out.
    get.mockResolvedValue(booking());

    renderPage();

    expect(await screen.findByText(/11:00/)).toBeTruthy();
  });

  it('warns about the fee BEFORE the patient commits', async () => {
    get.mockResolvedValueOnce(
      booking({
        policy: {
          noticeRequiredHours: 24,
          isWithinFreeWindow: false,
          lateFeeCents: 2500,
        },
      })
    );

    renderPage();

    // On the page itself, not hidden behind the confirm dialog.
    expect(await screen.findByText(/€25\.00/)).toBeTruthy();
    expect(screen.getByText(/within 24 hours/i)).toBeTruthy();
  });

  it('says "free", never "€0.00", when the org charges no fee', async () => {
    get.mockResolvedValueOnce(
      booking({
        policy: {
          noticeRequiredHours: 24,
          isWithinFreeWindow: true,
          lateFeeCents: null,
        },
      })
    );

    renderPage();

    click(await screen.findByRole('button', { name: /cancel booking/i }));

    expect(await screen.findByText(/free of charge/i)).toBeTruthy();
    expect(screen.queryByText(/€0\.00/)).toBeNull();
  });

  it('cancels with the reason the patient gave', async () => {
    get.mockResolvedValue(booking());

    renderPage();

    click(await screen.findByRole('button', { name: /cancel booking/i }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(screen.getByPlaceholderText(/let the clinic know why/i), {
      target: { value: 'Feeling unwell' },
    });
    click(within(dialog).getByRole('button', { name: /^cancel booking$/i }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        'public/booking/glow/manage/tok-123/cancel',
        { reason: 'Feeling unwell' }
      );
    });
  });

  it('sends the picked slot when rescheduling', async () => {
    get.mockResolvedValue(booking());

    renderPage();

    click(await screen.findByRole('button', { name: /reschedule/i }));
    click(await screen.findByRole('button', { name: 'pick-slot' }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        'public/booking/glow/manage/tok-123/reschedule',
        { startDate: PICKED_SLOT }
      );
    });
  });

  it('offers NO actions on a terminal booking', async () => {
    get.mockResolvedValueOnce(
      booking({ status: 'cancelled', isActionable: false })
    );

    renderPage();

    expect(await screen.findByText(/can no longer be changed/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /reschedule/i })).toBeNull();
    expect(
      screen.queryByRole('button', { name: /cancel booking/i })
    ).toBeNull();
  });

  it('explains a dead link calmly instead of showing an error page', async () => {
    // Expired links are the STEADY STATE for old emails, not an incident.
    get.mockRejectedValue(new Error('Not found'));

    renderPage();

    expect(await screen.findByText(/no longer valid/i)).toBeTruthy();
  });

  it('cannot reschedule a booking with no service — offers a human instead', async () => {
    get.mockResolvedValue(booking({ serviceId: null }));

    renderPage();

    expect(await screen.findByText(/contact the clinic/i)).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: /reschedule/i,
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });
});

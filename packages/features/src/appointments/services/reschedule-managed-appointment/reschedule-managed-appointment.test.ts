import { createMockDatabase } from '@borradh-workspace/testing';
import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import * as getGeneralBookingSlotsModule from '../../../booking-forms/services/get-general-booking-slots/get-general-booking-slots.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import { hashManageToken } from '../../shared/manage-token.js';
import * as sendRescheduleEmailModule from '../send-reschedule-email/send-reschedule-email.service.js';
import { rescheduleManagedAppointment } from './reschedule-managed-appointment.service.js';

// Gate 1 is "is this a slot we're actually offering?" — we stub the slots
// service so each test can decide what the booking page WOULD offer, then assert
// the reschedule respects it.
//
// Restored `vi.spyOn`, NOT `vi.mock`: under `isolate: false` all files in a
// worker share one module graph, so a hoisted bare-factory mock leaks outward
// (deleting the exports it omits for every later file — here it would gut the
// whole booking-forms slot service) AND silently misses whenever an earlier
// file already imported the real module. A run-time spy is immune to both.
let getGeneralBookingSlots: MockInstance;
let sendRescheduleEmail: MockInstance;

const RAW_TOKEN = 'raw-token-abc';

/**
 * Every fixture time derives from ONE instant captured at module load.
 *
 * `hoursFromNow` used to call `Date.now()` per invocation, so `startDate:
 * hoursFromNow(48)` and `endDate: hoursFromNow(48.5)` were anchored to two
 * different instants. Whenever those two lines straddled a millisecond — which
 * a loaded CI runner does and a warm local machine usually does not — the
 * booking's duration came out as 1800002ms and the "duration is preserved"
 * assertion failed by 2ms. Pinning the base makes the offsets exact.
 */
const NOW = Date.now();
const NEW_START = new Date(NOW + 72 * 60 * 60 * 1000);

const org = {
  id: 'org-1',
  slug: 'glow',
  deletedAt: null,
  customerReschedulingEnabled: true,
  reschedulingNoticeRequiredHours: 24,
  noShowOrLateCancelFeeCents: null,
};

const hoursFromNow = (h: number) => new Date(NOW + h * 60 * 60 * 1000);

describe('rescheduleManagedAppointment', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  const seedResolvable = (overrides?: {
    status?: string;
    serviceId?: string | null;
  }) => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
    mockDb.query.appointmentManageToken.findFirst.mockResolvedValueOnce({
      id: 'tok-1',
      organizationId: 'org-1',
      appointmentId: 'appt-1',
      tokenHash: hashManageToken(RAW_TOKEN),
      expiresAt: hoursFromNow(200),
    });
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt-1',
      organizationId: 'org-1',
      status: overrides?.status ?? 'booked',
      serviceId:
        overrides?.serviceId === undefined ? 'svc-1' : overrides.serviceId,
      practitionerId: 'prac-1',
      // 30-minute booking.
      startDate: hoursFromNow(48),
      endDate: hoursFromNow(48.5),
    });
  };

  const offers = (...slots: Date[]) => {
    getGeneralBookingSlots.mockResolvedValueOnce({
      success: true,
      data: {
        slots: slots.map((s) => ({
          startTime: s,
          endTime: new Date(s.getTime() + 30 * 60 * 1000),
        })),
      },
    } as never);
  };

  const input = {
    organizationSlug: 'glow',
    token: RAW_TOKEN,
    startDate: NEW_START,
  };

  beforeEach(() => {
    mockDb = createMockDatabase();
    vi.clearAllMocks();
    // Matches the old bare `vi.fn()`: no default return, every test that needs
    // slots drives it via `offers(...)`.
    getGeneralBookingSlots = vi
      .spyOn(getGeneralBookingSlotsModule, 'getGeneralBookingSlots')
      .mockReturnValue(undefined as never);
    sendRescheduleEmail = vi
      .spyOn(sendRescheduleEmailModule, 'sendRescheduleEmail')
      .mockResolvedValue({ success: true } as never);
  });

  afterEach(() => {
    getGeneralBookingSlots.mockRestore();
    sendRescheduleEmail.mockRestore();
  });

  it('moves the booking to an offered slot', async () => {
    seedResolvable();
    offers(NEW_START);
    mockDb.returning.mockResolvedValueOnce([{ id: 'appt-1' }]);

    const result = await rescheduleManagedAppointment(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startDate).toEqual(NEW_START);
      // Duration is PRESERVED from the booking, not re-derived from the service
      // (which the clinic may have edited since).
      expect(
        result.data.endDate.getTime() - result.data.startDate.getTime()
      ).toBe(30 * 60 * 1000);
    }
  });

  it('REFUSES a time the booking page is not offering', async () => {
    // The client can post any timestamp it likes. Gate 1 is what stops a
    // patient moving their appointment to 3am.
    seedResolvable();
    offers(hoursFromNow(100)); // some other time, not NEW_START

    const result = await rescheduleManagedAppointment(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('translates the overlap constraint into CONFLICT — the slot was just taken', async () => {
    // Gate 1 races: two patients can both be offered the slot and both accept.
    // The exclusion constraint is what actually decides.
    seedResolvable();
    offers(NEW_START);
    mockDb.returning.mockRejectedValueOnce(
      new Error(
        'conflicting key value violates exclusion constraint "appointment_no_overlap"'
      )
    );

    const result = await rescheduleManagedAppointment(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
      expect(result.error.message).toMatch(/just taken|pick another/i);
    }
  });

  it('returns CONFLICT (not 500) when the practitioner no longer performs the service', async () => {
    // Caught by the integration spec: reschedule pins the booking's
    // practitioner, and if the clinic has since unassigned them from that
    // service the slots lookup returns NOT_FOUND. Blanket-mapping that to
    // INTERNAL_ERROR put a 500 in the patient's face for an ordinary state of
    // the world.
    seedResolvable();
    getGeneralBookingSlots.mockResolvedValueOnce({
      success: false,
      error: {
        code: ErrorCodes.NOT_FOUND,
        message: 'Practitioner not found or not available for this service',
      },
    } as never);

    const result = await rescheduleManagedAppointment(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
      expect(result.error.message).toMatch(/contact the clinic/i);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('still surfaces a genuine fault as INTERNAL_ERROR, not "pick another time"', async () => {
    // A DB outage must not be dressed up as a slot conflict — that would tell
    // the patient to keep retrying a broken system.
    seedResolvable();
    getGeneralBookingSlots.mockResolvedValueOnce({
      success: false,
      error: { code: ErrorCodes.INTERNAL_ERROR, message: 'DB down' },
    } as never);

    const result = await rescheduleManagedAppointment(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('returns CONFLICT for a terminal booking', async () => {
    seedResolvable({ status: 'cancelled' });

    const result = await rescheduleManagedAppointment(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    // Must not even bother checking slots for a dead booking.
    expect(getGeneralBookingSlots).not.toHaveBeenCalled();
  });

  it('rejects a time in the past', async () => {
    seedResolvable();

    const result = await rescheduleManagedAppointment(mockDb as never, {
      ...input,
      startDate: hoursFromNow(-2),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('refuses to reschedule a booking with no service rather than skipping gate 1', async () => {
    // Without a service we cannot derive the offered slots. Silently proceeding
    // would mean NO availability check at all.
    seedResolvable({ serviceId: null });

    const result = await rescheduleManagedAppointment(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('still reports success when the reschedule email fails', async () => {
    seedResolvable();
    offers(NEW_START);
    mockDb.returning.mockResolvedValueOnce([{ id: 'appt-1' }]);
    sendRescheduleEmail.mockRejectedValueOnce(new Error('SMTP down'));

    const result = await rescheduleManagedAppointment(mockDb as never, input);

    expect(result.success).toBe(true);
  });

  it('tells the reschedule email the OLD time so the patient sees what changed', async () => {
    seedResolvable();
    offers(NEW_START);
    mockDb.returning.mockResolvedValueOnce([{ id: 'appt-1' }]);

    await rescheduleManagedAppointment(mockDb as never, input);

    expect(sendRescheduleEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        appointmentId: 'appt-1',
        oldStartDate: expect.any(Date),
        oldEndDate: expect.any(Date),
      })
    );
  });

  /**
   * The gap this path had: it consulted NO org policy at all.
   *
   * The portal enforced `customerReschedulingEnabled`; the manage link in
   * every confirmation email did not — so a clinic that switched online
   * rescheduling off was still being rescheduled on by anyone holding one.
   */
  it('refuses when the clinic has switched online rescheduling off, and never writes', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      ...org,
      customerReschedulingEnabled: false,
    });
    mockDb.query.appointmentManageToken.findFirst.mockResolvedValueOnce({
      id: 'tok-1',
      organizationId: 'org-1',
      appointmentId: 'appt-1',
      tokenHash: hashManageToken(RAW_TOKEN),
      expiresAt: hoursFromNow(200),
    });
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt-1',
      organizationId: 'org-1',
      status: 'booked',
      serviceId: 'svc-1',
      practitionerId: 'prac-1',
      startDate: hoursFromNow(48),
      endDate: hoursFromNow(48.5),
    });

    const result = await rescheduleManagedAppointment(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(result.error.message).toBe(
        "This clinic doesn't allow online rescheduling."
      );
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});

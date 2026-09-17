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
import { ErrorCodes } from '../../../shared/index.js';
// Spy the SOURCE module, not the `../shared` barrel: the barrel's re-exports are
// live getters under Vite SSR and cannot be redefined. Restored spies also keep
// this file from leaking onto the shared module graph (`isolate: false`).
import * as computeSlotsModule from '../shared/compute-available-slots.js';
import { getGeneralBookingSlots } from './get-general-booking-slots.service.js';

describe('getGeneralBookingSlots', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;
  let computePractitionerSlots: MockInstance;

  beforeEach(() => {
    // Create fresh mock database each test to avoid once-value leakage
    mockDb = createMockDatabase();

    computePractitionerSlots = vi
      .spyOn(computeSlotsModule, 'computePractitionerSlots')
      .mockResolvedValue({
        byPractitioner: [],
        merged: [{ startTime: new Date(), endTime: new Date() }],
      } as never);
  });

  afterEach(() => {
    computePractitionerSlots.mockRestore();
  });

  const startDate = new Date('2026-04-01T00:00:00Z');
  const endDate = new Date('2026-04-07T23:59:59Z');

  const validInput = {
    organizationSlug: 'test-salon',
    serviceId: 'svc-1',
    startDate,
    endDate,
  };

  it('returns VALIDATION_ERROR for empty slug', async () => {
    const result = await getGeneralBookingSlots(mockDb as never, {
      ...validInput,
      organizationSlug: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for empty service ID', async () => {
    const result = await getGeneralBookingSlots(mockDb as never, {
      ...validInput,
      serviceId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for date range exceeding 30 days', async () => {
    const result = await getGeneralBookingSlots(mockDb as never, {
      ...validInput,
      startDate: new Date('2026-04-01T00:00:00Z'),
      endDate: new Date('2026-05-15T00:00:00Z'),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(result.error.message).toContain('30 days');
    }
  });

  it('returns NOT_FOUND when organization does not exist', async () => {
    const result = await getGeneralBookingSlots(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(result.error.message).toBe('Organization not found');
    }
  });

  it('returns NOT_FOUND when service does not exist', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      slug: 'test-salon',
      businessHours: null,
    });

    const result = await getGeneralBookingSlots(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(result.error.message).toBe('Service not found');
    }
  });

  it('returns NOT_FOUND when requested practitioner not found', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      slug: 'test-salon',
      businessHours: null,
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc-1',
      organizationId: 'org-1',
      isActive: true,
      appointmentDuration: 30,
    });

    const result = await getGeneralBookingSlots(mockDb as never, {
      ...validInput,
      practitionerId: 'non-existent',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(result.error.message).toContain('Practitioner not found');
    }
  });

  it('returns no slots when the org has NO practitioners', async () => {
    // There is no org-business-hours fallback: availability is expressed only
    // through a practitioner's shifts, so an org with nobody has none. (Orgs
    // get a practitioner on create — this is the genuinely unconfigured case.)
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      slug: 'test-salon',
      businessHours: { 4: { from: 540, to: 1020 } },
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc-1',
      organizationId: 'org-1',
      isActive: true,
      appointmentDuration: 30,
    });
    // No service links AND no practitioners in the org at all.
    mockDb.query.practitioner.findMany.mockResolvedValueOnce([]);

    const result = await getGeneralBookingSlots(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slots).toEqual([]);
    }
    expect(computePractitionerSlots).not.toHaveBeenCalled();
  });

  it("uses the org's practitioners when the service has no links, so shifts still apply", async () => {
    // Regression: a solo owner marked a day as not working (a shift day-off
    // override), but the booking page kept offering that day. The service they
    // were booking had no practitioner_service rows, so this fell through to
    // computeLegacySlots — which derives working time from organization
    // .businessHours and never reads the `shift` table. The day off could not
    // possibly be honoured. An unlinked service must still resolve against the
    // org's real practitioners.
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      slug: 'test-salon',
      businessHours: { 4: { from: 540, to: 1020 } },
      timezone: 'Europe/Dublin',
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc-1',
      organizationId: 'org-1',
      isActive: true,
      appointmentDuration: 30,
    });
    // No practitioner_service rows, but the org does have an active practitioner.
    mockDb.query.practitioner.findMany.mockResolvedValueOnce([
      {
        id: 'prac-1',
        name: 'Solo Owner',
        photo: null,
        title: null,
        calendarAccountId: null,
        workingHours: null,
        locations: [],
      },
    ]);

    const result = await getGeneralBookingSlots(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(computePractitionerSlots).toHaveBeenCalled();
    const practitionersArg = computePractitionerSlots.mock.calls[0][1] as {
      id: string;
    }[];
    expect(practitionersArg.map((p) => p.id)).toEqual(['prac-1']);
  });

  // ── ENG-793: one duration ladder, service → org default → 30 ─────────────
  //
  // This endpoint used to own a private `DEFAULT_SLOT_DURATION = 30` while the
  // staff calendar owned a private 60, so a service with no configured length
  // was a 30-minute slot to a customer and a 60-minute block to the clinic.
  describe('slot length for a service with no configured duration', () => {
    const seedOrgAndService = (
      defaultAppointmentDuration: number | null,
      appointmentDuration: number | null
    ) => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-1',
        slug: 'test-salon',
        businessHours: null,
        timezone: 'Europe/Dublin',
        defaultAppointmentDuration,
      });
      mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
        id: 'svc-1',
        organizationId: 'org-1',
        isActive: true,
        appointmentDuration,
      });
      mockDb.query.practitioner.findMany.mockResolvedValueOnce([
        {
          id: 'prac-1',
          name: 'Solo Owner',
          photo: null,
          title: null,
          calendarAccountId: null,
          workingHours: null,
          locations: [],
        },
      ]);
    };

    /** The `slotDuration` positional arg `computePractitionerSlots` got. */
    const askedDuration = () =>
      computePractitionerSlots.mock.calls[0][7] as number;

    it("uses the ORGANIZATION's default when the service has none", async () => {
      seedOrgAndService(45, null);

      const result = await getGeneralBookingSlots(mockDb as never, validInput);

      expect(result.success).toBe(true);
      expect(askedDuration()).toBe(45);
    });

    it('prefers the service duration over the organization default', async () => {
      seedOrgAndService(45, 20);

      const result = await getGeneralBookingSlots(mockDb as never, validInput);

      expect(result.success).toBe(true);
      expect(askedDuration()).toBe(20);
    });

    it('falls back to 30 when neither is configured', async () => {
      seedOrgAndService(null, null);

      const result = await getGeneralBookingSlots(mockDb as never, validInput);

      expect(result.success).toBe(true);
      expect(askedDuration()).toBe(30);
    });
  });

  it('excludes a practitioner who has switched off Calendar bookings', async () => {
    // `accepts_bookings` was written by the team-member editor and read by
    // nobody — switching it off changed nothing on the public booking page.
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      slug: 'test-salon',
      businessHours: null,
      timezone: 'Europe/Dublin',
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc-1',
      organizationId: 'org-1',
      isActive: true,
      appointmentDuration: 30,
    });
    // Linked to the service, active, NOT deleted — but not taking bookings.
    mockDb.query.practitionerService.findMany.mockResolvedValueOnce([
      {
        practitioner: {
          id: 'prac-1',
          name: 'Solo Owner',
          photo: null,
          title: null,
          calendarAccountId: null,
          organizationId: 'org-1',
          isActive: true,
          acceptsBookings: false,
          deletedAt: null,
          workingHours: null,
          locations: [],
        },
      },
    ]);
    // The org-level fallback must not resurrect them either.
    mockDb.query.practitioner.findMany.mockResolvedValueOnce([]);

    const result = await getGeneralBookingSlots(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slots).toEqual([]);
    }
    expect(computePractitionerSlots).not.toHaveBeenCalled();
  });

  it('degrades to empty slots (not a 500) when slot computation throws (ENG-368)', async () => {
    // E.g. an org with no calendar configured / a transient downstream failure.
    // The public booking widget must show "no availability", never error out.
    computePractitionerSlots.mockRejectedValueOnce(
      new Error('No primary calendar configured')
    );
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      slug: 'test-salon',
      businessHours: null,
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc-1',
      organizationId: 'org-1',
      isActive: true,
      appointmentDuration: 30,
    });

    const result = await getGeneralBookingSlots(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slots).toEqual([]);
    }
  });
});

import { sendEmail } from '@borradh-workspace/email';
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
import * as createDepositRequestModule from '../../appointments/services/create-deposit-request/create-deposit-request.service.js';
import * as notifyPractitionerBookingModule from '../../appointments/services/notify-practitioner-booking/notify-practitioner-booking.service.js';
import * as resolveAvailabilityModule from '../../scheduling/services/resolve-availability/resolve-availability.service.js';
import { getGeneralBookingConfig } from './get-general-booking-config/get-general-booking-config.service.js';
import { getGeneralBookingSlots } from './get-general-booking-slots/get-general-booking-slots.service.js';
// Spy the SOURCE module, not the `./shared` barrel: the barrel's re-exports are
// live getters under Vite SSR and cannot be redefined.
import * as computeSlotsModule from './shared/compute-available-slots.js';
import { submitGeneralBooking } from './submit-general-booking/submit-general-booking.service.js';

/**
 * THE REGRESSION BAR FOR BRANCH-AWARE PUBLIC BOOKING.
 *
 * `config`, `slots` and `submit` grew an optional `locationSlug`. Almost every
 * organisation in production has exactly ONE branch, and for them the branch
 * is not a choice — naming it and not naming it are the same request, and must
 * produce the same bytes. That is what these tests assert, and it is a
 * stronger claim than "nothing crashed": each endpoint is run TWICE against an
 * identically-seeded single-branch org — once with `locationSlug`, once
 * without — and the two outputs are compared with `toEqual`.
 *
 * They also pin the arguments handed DOWNSTREAM (`computePractitionerSlots`,
 * `resolveAvailability`), because a difference there is a difference the
 * response would only show once real shifts existed.
 *
 * The multi-branch cases live beside them so the parity claim cannot be
 * satisfied by the trivial implementation that ignores `locationSlug` entirely.
 */
describe('single-branch parity: locationSlug present vs absent', () => {
  const ONLY_BRANCH = {
    id: 'loc-only',
    slug: 'main-street',
    country: 'ie',
    openingHours: null,
  };

  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
  });

  // ── config ────────────────────────────────────────────────────────────────

  describe('getGeneralBookingConfig', () => {
    function seedSingleBranchOrg() {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-1',
        name: 'One Branch Salon',
        slug: 'one-branch',
        logo: null,
        timezone: 'Europe/Dublin',
      });
      // resolveBookingLocation — the same row whether it was found by slug or
      // by the default ordering, because there is only one.
      mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(
        ONLY_BRANCH
      );
      mockDb.query.organizationService.findMany.mockResolvedValueOnce([
        { id: 'svc-1', name: 'Haircut', appointmentDuration: 30 },
      ]);
      mockDb.query.practitioner.findMany.mockResolvedValueOnce([
        { id: 'prac-1', name: 'Solo Owner', photo: null, title: null },
      ]);
      mockDb.query.practitionerService.findMany.mockResolvedValueOnce([
        { practitionerId: 'prac-1', serviceId: 'svc-1' },
      ]);
    }

    it('returns the same config with and without the branch slug', async () => {
      seedSingleBranchOrg();
      const withSlug = await getGeneralBookingConfig(mockDb as never, {
        organizationSlug: 'one-branch',
        locationSlug: ONLY_BRANCH.slug,
      });

      mockDb = createMockDatabase();
      seedSingleBranchOrg();
      const withoutSlug = await getGeneralBookingConfig(mockDb as never, {
        organizationSlug: 'one-branch',
      });

      expect(withSlug.success).toBe(true);
      expect(withSlug).toEqual(withoutSlug);
    });

    it('404s a slug that names no branch of this org', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-1',
        name: 'One Branch Salon',
        slug: 'one-branch',
      });
      // resolveBookingLocation finds nothing for that slug.
      mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(null);

      const result = await getGeneralBookingConfig(mockDb as never, {
        organizationSlug: 'one-branch',
        locationSlug: 'not-a-branch',
      });

      // Serving another branch's catalogue at an address the customer did not
      // pick is the failure mode this refuses.
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe('Location not found');
      }
    });
  });

  // ── slots ─────────────────────────────────────────────────────────────────

  describe('getGeneralBookingSlots', () => {
    let computePractitionerSlots: MockInstance;

    beforeEach(() => {
      computePractitionerSlots = vi
        .spyOn(computeSlotsModule, 'computePractitionerSlots')
        .mockResolvedValue({ byPractitioner: [], merged: [] } as never);
    });

    afterEach(() => {
      computePractitionerSlots.mockRestore();
    });

    const window = {
      startDate: new Date('2026-04-01T00:00:00Z'),
      endDate: new Date('2026-04-07T23:59:59Z'),
    };

    function seedSingleBranchOrg() {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-1',
        slug: 'one-branch',
        businessHours: null,
        timezone: 'Europe/Dublin',
      });
      mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
        id: 'svc-1',
        organizationId: 'org-1',
        isActive: true,
        appointmentDuration: 30,
      });
      mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(
        ONLY_BRANCH
      );
      mockDb.query.practitionerService.findMany.mockResolvedValueOnce([
        {
          practitioner: {
            id: 'prac-1',
            organizationId: 'org-1',
            isActive: true,
            deletedAt: null,
            acceptsBookings: true,
            name: 'Solo Owner',
            photo: null,
            title: null,
            calendarAccountId: null,
            workingHours: null,
            locations: [
              { locationId: ONLY_BRANCH.id, workingHours: { 1: [] } },
            ],
          },
        },
      ]);
    }

    it('computes the same slots, from the same arguments, either way', async () => {
      seedSingleBranchOrg();
      const withSlug = await getGeneralBookingSlots(mockDb as never, {
        organizationSlug: 'one-branch',
        serviceId: 'svc-1',
        locationSlug: ONLY_BRANCH.slug,
        ...window,
      });
      const argsWithSlug = computePractitionerSlots.mock.calls[0];

      mockDb = createMockDatabase();
      computePractitionerSlots.mockClear();
      seedSingleBranchOrg();
      const withoutSlug = await getGeneralBookingSlots(mockDb as never, {
        organizationSlug: 'one-branch',
        serviceId: 'svc-1',
        ...window,
      });
      const argsWithoutSlug = computePractitionerSlots.mock.calls[0];

      expect(withSlug.success).toBe(true);
      expect(withSlug).toEqual(withoutSlug);
      // Everything from the practitioner list to the branch id — the inputs a
      // real shift table would be resolved against.
      expect(argsWithSlug.slice(1)).toEqual(argsWithoutSlug.slice(1));
      // …and it IS the single branch, not `undefined`: the argument the
      // resolver has always filtered shifts by and never received.
      expect(argsWithSlug[10]).toBe(ONLY_BRANCH.id);
    });

    it('takes the working hours of the branch being booked, not an arbitrary join row', async () => {
      // `locations[0]` — whichever `practitioner_location` row the DB returned
      // first — used to decide this, so a Cork booking could be shaped by
      // Dublin's per-branch hours.
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-1',
        slug: 'two-branch',
        businessHours: null,
        timezone: 'Europe/Dublin',
      });
      mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
        id: 'svc-1',
        organizationId: 'org-1',
        isActive: true,
        appointmentDuration: 30,
      });
      mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
        id: 'loc-cork',
        slug: 'cork',
        country: 'ie',
        openingHours: { 2: { from: 600, to: 1200 } },
      });
      const CORK_HOURS = { 2: [{ from: 600, to: 1200 }] };
      mockDb.query.practitionerService.findMany.mockResolvedValueOnce([
        {
          practitioner: {
            id: 'prac-1',
            organizationId: 'org-1',
            isActive: true,
            deletedAt: null,
            acceptsBookings: true,
            name: 'Travelling Stylist',
            photo: null,
            title: null,
            calendarAccountId: null,
            workingHours: null,
            locations: [
              // Dublin first — the row the old code would have taken.
              { locationId: 'loc-dublin', workingHours: { 1: [] } },
              { locationId: 'loc-cork', workingHours: CORK_HOURS },
            ],
          },
        },
      ]);

      await getGeneralBookingSlots(mockDb as never, {
        organizationSlug: 'two-branch',
        serviceId: 'svc-1',
        locationSlug: 'cork',
        ...window,
      });

      const [, practitioners, , , , , , , , locationHours, locationId] =
        computePractitionerSlots.mock.calls[0] as [
          unknown,
          { locationWorkingHours: unknown }[],
          ...unknown[],
        ];
      expect(practitioners[0].locationWorkingHours).toEqual(CORK_HOURS);
      // Cork's own opening hours and Cork's id — not the primary branch's,
      // which is what `eq(isPrimary, true)` handed every branch before.
      expect(locationHours).toEqual({
        openingHours: { 2: { from: 600, to: 1200 } },
        exceptions: [],
      });
      expect(locationId).toBe('loc-cork');
    });
  });

  // ── submit ────────────────────────────────────────────────────────────────

  describe('submitGeneralBooking', () => {
    let mockCreateDepositRequest: MockInstance;
    let mockNotifyPractitionerBooking: MockInstance;
    let mockResolveAvailability: MockInstance;

    const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 30 * 60 * 1000);

    beforeEach(() => {
      vi.mocked(sendEmail).mockResolvedValue(undefined);
      mockCreateDepositRequest = vi
        .spyOn(createDepositRequestModule, 'createDepositRequest')
        .mockResolvedValue(undefined as never);
      mockNotifyPractitionerBooking = vi
        .spyOn(notifyPractitionerBookingModule, 'notifyPractitionerBooking')
        .mockResolvedValue(undefined as never);
      mockResolveAvailability = vi
        .spyOn(resolveAvailabilityModule, 'resolveAvailability')
        .mockImplementation((async (
          _db: unknown,
          input: { practitionerIds: string[]; from: Date; to: Date }
        ) =>
          input.practitionerIds.map((practitionerId) => ({
            practitionerId,
            working: [{ start: input.from, end: input.to }],
            busy: [],
          }))) as never);
    });

    afterEach(() => {
      mockCreateDepositRequest.mockRestore();
      mockNotifyPractitionerBooking.mockRestore();
      mockResolveAvailability.mockRestore();
    });

    function seedSingleBranchOrg() {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-1',
        slug: 'one-branch',
        name: 'One Branch Salon',
        timezone: 'Europe/Dublin',
        defaultPaymentPolicy: 'in_clinic',
      });
      mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
        id: 'svc-1',
        organizationId: 'org-1',
        isActive: true,
        appointmentDuration: 30,
        name: 'Haircut',
      });
      mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(
        ONLY_BRANCH
      );
      mockDb.query.practitionerService.findMany.mockResolvedValueOnce([]);
      mockDb.query.practitioner.findMany.mockResolvedValueOnce([
        {
          id: 'prac-1',
          organizationId: 'org-1',
          isActive: true,
          name: 'Owner',
        },
      ]);
      mockDb.query.member.findFirst.mockResolvedValueOnce({
        userId: 'user-owner',
        organizationId: 'org-1',
        role: 'owner',
      });
      mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
      mockDb.returning
        .mockResolvedValueOnce([{ id: 'lead-1' }])
        .mockResolvedValueOnce([{ id: 'appt-1' }]);
    }

    /** The `location_id` the appointment INSERT actually carried. */
    function stampedLocationId() {
      const values = mockDb.values.mock.calls
        .map((call) => call[0])
        .find(
          (value): value is Record<string, unknown> =>
            typeof value === 'object' &&
            value !== null &&
            'locationId' in (value as Record<string, unknown>)
        );
      return values?.locationId;
    }

    const input = {
      organizationSlug: 'one-branch',
      serviceId: 'svc-1',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      appointmentStartTime: start,
      appointmentEndTime: end,
    };

    it('books identically, and onto the same branch, either way', async () => {
      seedSingleBranchOrg();
      const withSlug = await submitGeneralBooking(mockDb as never, {
        ...input,
        locationSlug: ONLY_BRANCH.slug,
      });
      const branchWithSlug = stampedLocationId();
      const availArgsWithSlug = mockResolveAvailability.mock.calls[0]?.[1];

      mockDb = createMockDatabase();
      mockResolveAvailability.mockClear();
      seedSingleBranchOrg();
      const withoutSlug = await submitGeneralBooking(mockDb as never, input);
      const branchWithoutSlug = stampedLocationId();
      const availArgsWithoutSlug = mockResolveAvailability.mock.calls[0]?.[1];

      expect(withSlug.success).toBe(true);
      expect(withSlug).toEqual(withoutSlug);
      expect(branchWithSlug).toBe(ONLY_BRANCH.id);
      expect(branchWithoutSlug).toBe(ONLY_BRANCH.id);
      // The write gate asked the resolver the same question both times, and
      // named the branch — the argument nobody used to pass.
      expect(availArgsWithSlug).toEqual(availArgsWithoutSlug);
      expect(availArgsWithSlug.locationId).toBe(ONLY_BRANCH.id);
    });

    it('stamps the PASSED branch, not the default one', async () => {
      // The bug: a customer who chose Cork on Cork's own page had their
      // appointment written onto Dublin's diary, because this resolved the
      // default branch and ignored what they picked.
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-1',
        slug: 'two-branch',
        name: 'Two Branch Salon',
        timezone: 'Europe/Dublin',
        defaultPaymentPolicy: 'in_clinic',
      });
      mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
        id: 'svc-1',
        organizationId: 'org-1',
        isActive: true,
        appointmentDuration: 30,
        name: 'Haircut',
      });
      // Cork — NOT the primary branch the old code would have resolved.
      mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
        id: 'loc-cork',
        slug: 'cork',
        country: 'ie',
        openingHours: null,
      });
      mockDb.query.practitionerService.findMany.mockResolvedValueOnce([]);
      mockDb.query.practitioner.findMany.mockResolvedValueOnce([
        {
          id: 'prac-1',
          organizationId: 'org-1',
          isActive: true,
          name: 'Owner',
        },
      ]);
      mockDb.query.member.findFirst.mockResolvedValueOnce({
        userId: 'user-owner',
        organizationId: 'org-1',
        role: 'owner',
      });
      mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
      mockDb.returning
        .mockResolvedValueOnce([{ id: 'lead-1' }])
        .mockResolvedValueOnce([{ id: 'appt-1' }]);

      const result = await submitGeneralBooking(mockDb as never, {
        ...input,
        organizationSlug: 'two-branch',
        locationSlug: 'cork',
      });

      expect(result.success).toBe(true);
      expect(stampedLocationId()).toBe('loc-cork');
      expect(mockResolveAvailability.mock.calls[0][1].locationId).toBe(
        'loc-cork'
      );
    });

    it('404s a slug that names no branch of this org, rather than booking the default', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-1',
        slug: 'one-branch',
        name: 'One Branch Salon',
        timezone: 'Europe/Dublin',
      });
      mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
        id: 'svc-1',
        organizationId: 'org-1',
        isActive: true,
        appointmentDuration: 30,
        name: 'Haircut',
      });
      mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(null);

      const result = await submitGeneralBooking(mockDb as never, {
        ...input,
        locationSlug: 'not-a-branch',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe('Location not found');
      }
      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });
});

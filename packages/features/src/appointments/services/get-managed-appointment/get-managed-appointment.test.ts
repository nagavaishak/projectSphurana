import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { hashManageToken } from '../../shared/manage-token.js';
import { getManagedAppointment } from './get-managed-appointment.service.js';

const RAW_TOKEN = 'raw-token-abc';

const org = {
  id: 'org-1',
  slug: 'glow',
  name: 'Glow Aesthetics',
  logo: 'https://cdn/logo.png',
  timezone: 'Europe/Dublin',
  deletedAt: null,
  reschedulingNoticeRequiredHours: 24,
  noShowOrLateCancelFeeCents: 2500,
};

const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000);

describe('getManagedAppointment', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  const seed = (overrides?: {
    status?: string;
    startDate?: Date;
    locationId?: string | null;
    locationCount?: number;
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
      title: 'Lip Filler',
      status: overrides?.status ?? 'booked',
      serviceId: 'svc-1',
      practitionerId: 'prac-1',
      locationId: overrides?.locationId ?? null,
      startDate: overrides?.startDate ?? hoursFromNow(48),
      endDate: new Date(
        (overrides?.startDate ?? hoursFromNow(48)).getTime() + 45 * 60 * 1000
      ),
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc-1',
      name: 'Lip Filler',
    });
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      id: 'prac-1',
      name: 'Dr Ana',
    });
    // `getBookingLocationById` is a no-op for a NULL locationId, so this only
    // fires when the seed names a branch.
    if (overrides?.locationId) {
      mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
        id: overrides.locationId,
        slug: 'cork',
        name: 'Cork',
        country: 'ie',
        openingHours: null,
        addressLine1: '12 Oliver Plunkett St',
        addressLine2: null,
        city: 'Cork',
        county: 'Co. Cork',
        postalCode: 'T12 XY34',
      });
    }
    // The org's branch COUNT — `select().from().where()`. The chainable mock
    // returns `this`, which is not iterable, so the terminal `where` has to
    // resolve to rows for this one call.
    mockDb.where.mockResolvedValueOnce([
      { value: overrides?.locationCount ?? 1 },
    ]);
  };

  const input = { organizationSlug: 'glow', token: RAW_TOKEN };

  beforeEach(() => {
    mockDb = createMockDatabase();
  });

  it('returns what the patient needs to decide', async () => {
    seed();

    const result = await getManagedAppointment(mockDb as never, input);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.serviceName).toBe('Lip Filler');
    expect(result.data.practitionerName).toBe('Dr Ana');
    expect(result.data.organization.timezone).toBe('Europe/Dublin');
    expect(result.data.isActionable).toBe(true);
    // The BOOKED duration, derived from the appointment, not the service.
    expect(result.data.durationMinutes).toBe(45);
  });

  it('does NOT leak the lead record or internal fields to an anonymous holder', async () => {
    // The token proves "I hold this booking's link", not "I am this client".
    seed();

    const result = await getManagedAppointment(mockDb as never, input);

    expect(result.success).toBe(true);
    if (!result.success) return;

    const keys = Object.keys(result.data);
    expect(keys).not.toContain('leadId');
    expect(keys).not.toContain('lead');
    expect(keys).not.toContain('description');
    expect(keys).not.toContain('assignedToId');
    expect(keys).not.toContain('organizationId');
  });

  it('marks a terminal booking as not actionable', async () => {
    seed({ status: 'cancelled' });

    const result = await getManagedAppointment(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isActionable).toBe(false);
      expect(result.data.status).toBe('cancelled');
    }
  });

  it('surfaces the free window when there is plenty of notice', async () => {
    seed({ startDate: hoursFromNow(72) });

    const result = await getManagedAppointment(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.policy.isWithinFreeWindow).toBe(true);
    }
  });

  it('surfaces the fee when the booking is imminent', async () => {
    seed({ startDate: hoursFromNow(2) });

    const result = await getManagedAppointment(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.policy.isWithinFreeWindow).toBe(false);
      expect(result.data.policy.lateFeeCents).toBe(2500);
    }
  });

  it('returns NOT_FOUND for a dead link', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
    mockDb.query.appointmentManageToken.findFirst.mockResolvedValueOnce(
      undefined
    );

    const result = await getManagedAppointment(mockDb as never, {
      organizationSlug: 'glow',
      token: 'bogus',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('tells the patient which BRANCH they are booked into', async () => {
    seed({ locationId: 'loc-cork', locationCount: 3 });

    const result = await getManagedAppointment(mockDb as never, input);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.location).toEqual({
      id: 'loc-cork',
      name: 'Cork',
      slug: 'cork',
      addressLines: ['12 Oliver Plunkett St', 'Cork', 'Co. Cork', 'T12 XY34'],
    });
  });

  it('shows NO branch rather than the primary one when the booking names none', async () => {
    // Every pre-backfill row. Showing the primary branch's address here is how
    // a Cork patient gets sent to Dublin — no address is the safe degradation.
    seed({ locationId: null, locationCount: 3 });

    const result = await getManagedAppointment(mockDb as never, input);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.location).toBeNull();
    expect(mockDb.query.organizationLocation.findFirst).not.toHaveBeenCalled();
  });

  it('still allows reschedule for a multi-branch booking whose branch has no slug', async () => {
    // THE CASE THAT INVERTED. The slots endpoint used to address a branch BY
    // SLUG only, so a slug-less branch could not be named and withholding the
    // button was the only safe answer. It now accepts `slug ?? id`, so this
    // branch IS nameable and the patient keeps the button.
    //
    // Worth stating what that fixed: `slug` is nullable and the backfill has
    // not run, so this was not a rare case — EVERY multi-branch clinic's
    // patients were told to phone in.
    seed({ locationId: 'loc-cork', locationCount: 3 });
    mockDb.query.organizationLocation.findFirst.mockReset();
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
      id: 'loc-cork',
      slug: null,
      name: 'Cork',
      country: 'ie',
      openingHours: null,
      addressLine1: '12 Oliver Plunkett St',
      addressLine2: null,
      city: 'Cork',
      county: 'Co. Cork',
      postalCode: 'T12 XY34',
    });

    const result = await getManagedAppointment(mockDb as never, input);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.canRescheduleOnline).toBe(true);
    // The address still shows — the patient can still find the place.
    expect(result.data.location?.name).toBe('Cork');
    // And the portal has an id to put in the URL even with no slug.
    expect(result.data.location?.id).toBe('loc-cork');
  });

  it('still withholds reschedule for a multi-branch booking with NO branch at all', async () => {
    // The case that SURVIVES. Every pre-backfill appointment has
    // `location_id = NULL`; there is nothing to put in the URL, and omitting
    // the segment resolves the org's default branch — so the portal would show
    // one branch's diary and book into it without the patient choosing.
    seed({ locationId: null, locationCount: 3 });

    const result = await getManagedAppointment(mockDb as never, input);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.canRescheduleOnline).toBe(false);
  });

  it('still allows reschedule for a single-branch org with no slug', async () => {
    // One branch means the branchless call is unambiguous, so nothing is lost.
    seed({ locationId: null, locationCount: 1 });

    const result = await getManagedAppointment(mockDb as never, input);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.canRescheduleOnline).toBe(true);
  });
});

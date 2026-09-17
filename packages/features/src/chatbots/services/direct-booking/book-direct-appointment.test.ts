import type { DbConnection } from '@borradh-workspace/database';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import * as createAppointmentModule from '../../../appointments/services/create-appointment/create-appointment.service.js';
import * as resolveAvailabilityModule from '../../../scheduling/services/resolve-availability/resolve-availability.service.js';
// Same rule for the resource gate: keep the real `hasFreeResourcesFor` (pure)
// and stub only `loadResourceGateContext`, the DB-backed half.
import * as resourceGateModule from '../../../scheduling/services/resolve-resource-availability/filter-slots-by-resources.js';
import type { ResourceGateContext } from '../../../scheduling/services/resolve-resource-availability/index.js';
import { bookDirectAppointment } from './book-direct-appointment.js';

// Restored `vi.spyOn`s, NOT `vi.mock`. Under `isolate: false` the worker shares
// one module graph, so a hoisted `vi.mock` of an internal module leaks its bare
// factory into every later file AND silently misses whenever an earlier file
// already imported the real module. Both spies target the SOURCE module the
// symbol is defined in — the `index.js` barrel re-exports are live getters that
// `vi.spyOn` cannot redefine.
//
// resolveAvailability is only reached when a practitionerId is supplied; the
// stub keeps the happy/slot-taken paths (which omit practitionerId) off it.
let mockCreateAppointment: MockInstance;
let mockResolveAvailability: MockInstance;
let mockLoadResourceGateContext: MockInstance;

const mockDb = {
  query: {
    conversation: { findFirst: vi.fn() },
    lead: { findFirst: vi.fn() },
    member: { findFirst: vi.fn() },
    // findMany backs the pre-release snapshot of the lead's live holds, which
    // the booking restores if createAppointment then fails.
    appointment: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    organization: { findFirst: vi.fn() },
    organizationLocation: { findFirst: vi.fn() },
    practitioner: { findFirst: vi.fn() },
  },
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
};

const baseInput = {
  conversationId: 'conv-1',
  organizationId: 'org-1',
  slotIsoStart: '2026-06-15T14:00:00.000Z',
  slotIsoEnd: '2026-06-15T14:30:00.000Z',
  customerName: 'Jane Doe',
};

describe('bookDirectAppointment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAppointment = vi
      .spyOn(createAppointmentModule, 'createAppointment')
      .mockResolvedValue(undefined as never);
    mockResolveAvailability = vi
      .spyOn(resolveAvailabilityModule, 'resolveAvailability')
      .mockResolvedValue([] as never);
    mockLoadResourceGateContext = vi
      .spyOn(resourceGateModule, 'loadResourceGateContext')
      // Default: no service in the cart has a requirement — the state every
      // existing org is in.
      .mockResolvedValue(null);
  });

  afterEach(() => {
    mockCreateAppointment.mockRestore();
    mockResolveAvailability.mockRestore();
    mockLoadResourceGateContext.mockRestore();
  });

  it('books the appointment on the happy path', async () => {
    // isSlotAvailable → no conflicting appointment.
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(null);
    // findOrCreateLead → load conversation, then no existing lead, then insert.
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      externalUserId: 'ext-user-1',
      platform: 'facebook_messenger',
    });
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([{ id: 'lead-1' }]);
    // getDefaultAssignedUser → org member.
    mockDb.query.member.findFirst.mockResolvedValueOnce({ userId: 'user-1' });

    mockCreateAppointment.mockResolvedValueOnce({
      success: true,
      data: { id: 'apt-1' },
    } as never);

    const result = await bookDirectAppointment(
      mockDb as unknown as DbConnection,
      baseInput
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.success).toBe(true);
    expect(result.data.slotTaken).toBeUndefined();
    expect(result.data.appointmentId).toBe('apt-1');
    expect(result.data.confirmationCode).toMatch(/^APT-[A-Z0-9]{6}$/);
    expect(result.data.confirmationMessage).toContain(
      result.data.confirmationCode
    );

    // Created as a HOLD, not a booking: Claire has taken no payment and the
    // customer may simply stop replying, so the slot must release itself.
    expect(mockCreateAppointment).toHaveBeenCalledTimes(1);
    const createArg = mockCreateAppointment.mock.calls[0][1];
    expect(createArg).toMatchObject({
      organizationId: 'org-1',
      leadId: 'lead-1',
      assignedToId: 'user-1',
      status: 'held',
      source: 'booking_form',
    });
    // …carrying a clock. Before this these rows stayed `booked` forever and
    // blocked the slot indefinitely when the conversation went quiet.
    expect(createArg.holdExpiresAt).toBeInstanceOf(Date);
    expect(createArg.holdExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('returns slotTaken when the slot already has an overlapping appointment', async () => {
    // isSlotAvailable → a conflicting appointment exists.
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'existing-apt',
    });

    const result = await bookDirectAppointment(
      mockDb as unknown as DbConnection,
      baseInput
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.success).toBe(false);
    expect(result.data.slotTaken).toBe(true);
    expect(result.data.appointmentId).toBe('');
    // Must not have attempted to create the appointment.
    expect(mockCreateAppointment).not.toHaveBeenCalled();
  });

  it('returns slotTaken when createAppointment reports a CONFLICT', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(null);
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      externalUserId: 'ext-user-1',
      platform: 'whatsapp',
    });
    mockDb.query.lead.findFirst.mockResolvedValueOnce({ id: 'lead-9' });
    mockDb.query.member.findFirst.mockResolvedValueOnce({ userId: 'user-1' });

    mockCreateAppointment.mockResolvedValueOnce({
      success: false,
      error: { code: 'CONFLICT', message: 'overlap' },
    } as never);

    const result = await bookDirectAppointment(
      mockDb as unknown as DbConnection,
      baseInput
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.success).toBe(false);
    expect(result.data.slotTaken).toBe(true);
  });

  // The old hold is given up BEFORE the new one is attempted, so a booking
  // that then fails would leave the customer holding nothing at all — their
  // original slot cancelled and the new one refused.
  it('restores the previous hold when the booking fails', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(null);
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      externalUserId: 'ext-user-1',
      platform: 'whatsapp',
    });
    mockDb.query.lead.findFirst.mockResolvedValueOnce({ id: 'lead-9' });
    mockDb.query.member.findFirst.mockResolvedValueOnce({ userId: 'user-1' });

    // releaseLeadHolds reports what it cancelled, carrying each row's ORIGINAL
    // clock — that is what makes the release undoable.
    const priorExpiry = new Date('2026-06-15T12:00:00.000Z');
    mockDb.query.appointment.findMany.mockResolvedValueOnce([
      { id: 'appt-prior', holdExpiresAt: priorExpiry },
    ]);
    // …the release's UPDATE … RETURNING, then the restore's.
    mockDb.returning
      .mockResolvedValueOnce([{ id: 'appt-prior' }])
      .mockResolvedValueOnce([{ id: 'appt-prior' }]);

    mockCreateAppointment.mockResolvedValueOnce({
      success: false,
      error: { code: 'CONFLICT', message: 'overlap' },
    } as never);

    await bookDirectAppointment(mockDb as unknown as DbConnection, baseInput);

    // Put back as a live hold, with the ORIGINAL clock rather than a fresh one:
    // a new window would silently extend the reservation past what the
    // customer was told.
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'held',
        holdExpiresAt: priorExpiry,
      })
    );
  });

  it('returns VALIDATION_ERROR for missing required fields', async () => {
    const result = await bookDirectAppointment(
      mockDb as unknown as DbConnection,
      { ...baseInput, customerName: '' }
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });
  // Regression: the confirmation formatters called toLocale*String with no
  // timeZone, so they rendered in the SERVER's zone. A slot stored at
  // 09:30 UTC for a UTC clinic was confirmed to the customer as "11:30 AM" on
  // a UTC+2 host — a written confirmation two hours after the real
  // appointment. Verified against a real booking before the fix.
  it('renders the confirmation time in the ORG timezone, not the server zone', async () => {
    mockDb.query.organization.findFirst.mockResolvedValue({ timezone: 'UTC' });
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(null);
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      externalUserId: 'ext-user-1',
      platform: 'facebook_messenger',
    });
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([{ id: 'lead-1' }]);
    mockDb.query.member.findFirst.mockResolvedValueOnce({ userId: 'user-1' });
    mockCreateAppointment.mockResolvedValueOnce({
      success: true,
      data: { id: 'apt-tz' },
    } as never);

    const result = await bookDirectAppointment(
      mockDb as unknown as DbConnection,
      {
        ...baseInput,
        slotIsoStart: '2026-07-20T09:30:00.000Z',
        slotIsoEnd: '2026-07-20T10:00:00.000Z',
      }
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    // 09:30 UTC for a UTC org must read back as 9:30 AM on any host.
    expect(result.data.confirmationMessage).toContain('9:30 AM');
    expect(result.data.confirmationMessage).toContain('Monday, July 20');
  });

  it('renders the confirmation in a non-UTC org timezone', async () => {
    mockDb.query.organization.findFirst.mockResolvedValue({
      timezone: 'America/New_York',
    });
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(null);
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      externalUserId: 'ext-user-1',
      platform: 'facebook_messenger',
    });
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([{ id: 'lead-2' }]);
    mockDb.query.member.findFirst.mockResolvedValueOnce({ userId: 'user-1' });
    mockCreateAppointment.mockResolvedValueOnce({
      success: true,
      data: { id: 'apt-tz2' },
    } as never);

    const result = await bookDirectAppointment(
      mockDb as unknown as DbConnection,
      {
        ...baseInput,
        slotIsoStart: '2026-07-20T14:00:00.000Z',
        slotIsoEnd: '2026-07-20T14:30:00.000Z',
      }
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    // 14:00 UTC = 10:00 EDT.
    expect(result.data.confirmationMessage).toContain('10:00 AM');
  });
  // ---------------------------------------------------------------------------
  // Resource gate (treatment rooms / equipment).
  //
  // The OFFER is gated upstream (offerBookingSlots → checkAvailability). These
  // guard the CONFIRM: minutes of conversation pass between "how about 2pm?"
  // and "yes please", and the clinic's only laser can be taken by the front
  // desk in that window. Allocation itself stays with createAppointment — this
  // path never writes appointment_resource rows.
  // ---------------------------------------------------------------------------
  describe('resource gate', () => {
    /** One "rooms" category holding one always-open resource, busy as given. */
    function roomContext(
      busy: { start: Date; end: Date }[] = [],
      extra: Partial<ResourceGateContext> = {}
    ): ResourceGateContext {
      return {
        resourcesByCategory: new Map([['cat-rooms', ['room-1']]]),
        availabilityByResource: new Map([
          [
            'room-1',
            {
              resourceId: 'room-1',
              capacity: 1,
              working: [{ start: new Date(0), end: new Date(8.64e15) }],
              busy,
            },
          ],
        ]),
        requirements: [
          {
            serviceId: 'svc-1',
            categoryId: 'cat-rooms',
            eligibleResourceIds: [],
          },
        ],
        turnaroundMinutes: 0,
        ...extra,
      };
    }

    const withService = { ...baseInput, serviceId: 'svc-1' };

    /** Mocks the reads a successful booking makes, in order. */
    function mockHappyPathReads() {
      mockDb.query.appointment.findFirst.mockResolvedValueOnce(null);
      mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
        id: 'loc-1',
      });
      mockDb.query.conversation.findFirst.mockResolvedValueOnce({
        externalUserId: 'ext-user-1',
        platform: 'facebook_messenger',
      });
      mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
      mockDb.returning.mockResolvedValueOnce([{ id: 'lead-1' }]);
      mockDb.query.member.findFirst.mockResolvedValueOnce({ userId: 'user-1' });
      mockCreateAppointment.mockResolvedValueOnce({
        success: true,
        data: { id: 'apt-res' },
      } as never);
    }

    it('books exactly as before when no service has requirements', async () => {
      // THE rollout-safety guard. Every existing org is in this state: the
      // loader finds no requirement row, returns null, and the confirm takes
      // exactly the pre-resources path.
      mockHappyPathReads();

      const result = await bookDirectAppointment(
        mockDb as unknown as DbConnection,
        withService
      );

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.success).toBe(true);
      expect(result.data.slotTaken).toBeUndefined();
      expect(mockCreateAppointment).toHaveBeenCalledTimes(1);
    });

    it('does not even look for requirements when there is no service', async () => {
      // No serviceId = no cart = nothing that could require a room.
      mockHappyPathReads();

      await bookDirectAppointment(mockDb as unknown as DbConnection, baseInput);

      expect(mockLoadResourceGateContext).not.toHaveBeenCalled();
    });

    it('books when the only eligible room is free', async () => {
      mockHappyPathReads();
      mockLoadResourceGateContext.mockResolvedValueOnce(roomContext([]));

      const result = await bookDirectAppointment(
        mockDb as unknown as DbConnection,
        withService
      );

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.success).toBe(true);
      expect(mockCreateAppointment).toHaveBeenCalledTimes(1);
    });

    it('reports slotTaken when the only eligible room went in the meantime', async () => {
      mockHappyPathReads();
      // The practitioner is still free — appointment.findFirst returned null —
      // but the room was taken between the offer and the confirm.
      mockLoadResourceGateContext.mockResolvedValueOnce(
        roomContext([
          {
            start: new Date('2026-06-15T14:00:00.000Z'),
            end: new Date('2026-06-15T14:30:00.000Z'),
          },
        ])
      );

      const result = await bookDirectAppointment(
        mockDb as unknown as DbConnection,
        withService
      );

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.success).toBe(false);
      expect(result.data.slotTaken).toBe(true);
      expect(mockCreateAppointment).not.toHaveBeenCalled();
    });

    it('reports slotTaken when ONE of two required categories cannot be satisfied', async () => {
      mockHappyPathReads();
      const base = roomContext([]);
      mockLoadResourceGateContext.mockResolvedValueOnce({
        ...base,
        resourcesByCategory: new Map([
          ...base.resourcesByCategory,
          ['cat-lasers', ['laser-1']],
        ]),
        availabilityByResource: new Map([
          ...base.availabilityByResource,
          [
            'laser-1',
            { resourceId: 'laser-1', capacity: 1, working: [], busy: [] },
          ],
        ]),
        requirements: [
          ...base.requirements,
          {
            serviceId: 'svc-1',
            categoryId: 'cat-lasers',
            eligibleResourceIds: [],
          },
        ],
      } satisfies ResourceGateContext);

      const result = await bookDirectAppointment(
        mockDb as unknown as DbConnection,
        withService
      );

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.slotTaken).toBe(true);
      expect(mockCreateAppointment).not.toHaveBeenCalled();
    });

    it('loads the gate context ONCE per confirm, and never for an already-taken slot', async () => {
      // Pins the N+1 rule from the other end: one context load per request, and
      // none at all when the practitioner check has already failed.
      mockHappyPathReads();
      mockLoadResourceGateContext.mockResolvedValueOnce(roomContext([]));
      await bookDirectAppointment(
        mockDb as unknown as DbConnection,
        withService
      );
      expect(mockLoadResourceGateContext).toHaveBeenCalledTimes(1);

      mockLoadResourceGateContext.mockClear();
      // A conflicting appointment: the practitioner gate fails first, so the
      // resource lookup must not run at all.
      mockDb.query.appointment.findFirst.mockResolvedValueOnce({
        id: 'existing-apt',
      });
      await bookDirectAppointment(
        mockDb as unknown as DbConnection,
        withService
      );
      expect(mockLoadResourceGateContext).not.toHaveBeenCalled();
    });

    it('passes the cart, the org time zone and the location through', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        timezone: 'Europe/Dublin',
      });
      mockHappyPathReads();
      mockLoadResourceGateContext.mockResolvedValueOnce(null);

      await bookDirectAppointment(
        mockDb as unknown as DbConnection,
        withService
      );

      expect(mockLoadResourceGateContext).toHaveBeenCalledWith(mockDb, {
        organizationId: 'org-1',
        serviceIds: ['svc-1'],
        from: new Date('2026-06-15T14:00:00.000Z'),
        to: new Date('2026-06-15T14:30:00.000Z'),
        // Never assumed UTC — resource working hours are wall-clock.
        timeZone: 'Europe/Dublin',
        // The same primary location the OFFER considered, so confirm-time can
        // never be laxer than what was quoted.
        locationId: 'loc-1',
      });
    });

    it('fails OPEN when the resource check itself errors', async () => {
      // A transient read failure must not turn a legitimate confirmation into
      // "that slot was just taken" — same convention as the practitioner
      // availability re-check. Only a definitive "no free resource" blocks.
      mockHappyPathReads();
      mockLoadResourceGateContext.mockRejectedValueOnce(new Error('db down'));

      const result = await bookDirectAppointment(
        mockDb as unknown as DbConnection,
        withService
      );

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.success).toBe(true);
      expect(mockCreateAppointment).toHaveBeenCalledTimes(1);
    });

    it('hands the service to createAppointment so it can allocate the room', async () => {
      // This flow used to drop serviceId entirely. Without it createAppointment
      // has no cart, allocates nothing, and the gate above would keep
      // re-passing because the room is never actually held.
      mockHappyPathReads();
      mockLoadResourceGateContext.mockResolvedValueOnce(roomContext([]));

      await bookDirectAppointment(
        mockDb as unknown as DbConnection,
        withService
      );

      expect(mockCreateAppointment.mock.calls[0][1]).toMatchObject({
        serviceId: 'svc-1',
      });
    });
  });
});

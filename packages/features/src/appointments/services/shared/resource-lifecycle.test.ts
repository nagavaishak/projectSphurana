import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFeatureOn } from '@borradh-workspace/observability';
import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import * as syncToCalendarModule from '../../../calendar/services/sync-to-calendar/sync-to-calendar.service.js';
import * as appointmentQueueModule from '../../queue/appointment-queue.js';
import { checkExpiredDeposits } from '../check-expired-deposits/check-expired-deposits.service.js';
import { deleteAppointment } from '../delete-appointment/delete-appointment.service.js';
import { expireAppointmentDeposit } from '../expire-appointment-deposit/expire-appointment-deposit.service.js';
import { expireAppointmentHolds } from '../expire-appointment-holds/expire-appointment-holds.service.js';
import { handleDepositWebhook } from '../handle-deposit-webhook/handle-deposit-webhook.service.js';
import { releaseLeadHolds } from '../release-lead-holds/release-lead-holds.service.js';
import { updateAppointment } from '../update-appointment/update-appointment.service.js';
import * as allocateModule from './allocate-appointment-resources.js';
import * as releaseModule from './release-appointment-resources.js';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LIFECYCLE INVARIANT UNDER TEST
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `appointment_resource` rows exist ONLY while their appointment is active —
 * that is what lets `resolveResourceAvailability` skip a join back to
 * `appointment.status`. Miss a release and the appointment vanishes from the
 * calendar while its room stays held against every future booking, forever,
 * with nothing in the system that will ever revisit it.
 *
 * Two layers here: behavioural tests per lifecycle path, and a static sweep
 * that fails if a NEW terminal-status write is ever added without one.
 */

let releaseSpy: MockInstance;
let reallocateSpy: MockInstance;
let enqueueCalendarSyncSpy: MockInstance;
let syncToCalendarSpy: MockInstance;

const OK_RELEASE = { success: true, data: { releasedCount: 1 } } as never;

describe('appointment resource lifecycle', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    for (const method of [
      mockDb.select,
      mockDb.from,
      mockDb.where,
      mockDb.update,
      mockDb.set,
      mockDb.limit,
      mockDb.for,
    ]) {
      method.mockReset().mockReturnThis();
    }
    mockDb.returning.mockReset().mockResolvedValue([]);
    vi.mocked(isFeatureOn).mockResolvedValue(true);

    releaseSpy = vi
      .spyOn(releaseModule, 'releaseAppointmentResources')
      .mockResolvedValue(OK_RELEASE);
    reallocateSpy = vi
      .spyOn(allocateModule, 'reallocateAppointmentResources')
      .mockResolvedValue({ allocated: [], warnings: [] });
    enqueueCalendarSyncSpy = vi
      .spyOn(appointmentQueueModule, 'enqueueCalendarSync')
      .mockResolvedValue(undefined as never);
    syncToCalendarSpy = vi
      .spyOn(syncToCalendarModule, 'syncToCalendar')
      .mockResolvedValue({ success: true, data: { synced: false } } as never);
  });

  afterEach(() => {
    releaseSpy.mockRestore();
    reallocateSpy.mockRestore();
    enqueueCalendarSyncSpy.mockRestore();
    syncToCalendarSpy.mockRestore();
  });

  it('soft-deleting an appointment releases its rooms (nothing cascades)', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_1',
      title: 'Botox',
      organizationId: 'org_1',
    });

    const result = await deleteAppointment(mockDb as never, {
      id: 'appt_1',
      organizationId: 'org_1',
    });

    expect(result.success).toBe(true);
    expect(releaseSpy).toHaveBeenCalledWith(expect.anything(), {
      appointmentId: 'appt_1',
      organizationId: 'org_1',
    });
  });

  it('cancelling via updateAppointment releases its rooms', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_1',
      title: 'Botox',
      status: 'booked',
      source: 'manual',
      organizationId: 'org_1',
      startDate: new Date('2026-03-02T10:00:00Z'),
      endDate: new Date('2026-03-02T11:00:00Z'),
      assignedToId: 'user_1',
      practitionerId: null,
      serviceId: 'svc_1',
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'appt_1' }]);

    const result = await updateAppointment(mockDb as never, {
      id: 'appt_1',
      organizationId: 'org_1',
      status: 'cancelled',
    });

    expect(result.success).toBe(true);
    expect(releaseSpy).toHaveBeenCalledWith(expect.anything(), {
      appointmentId: 'appt_1',
      organizationId: 'org_1',
    });
    expect(reallocateSpy).not.toHaveBeenCalled();
  });

  it('a no-show releases its rooms too — derived from activeAppointmentStatuses', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_1',
      title: 'Botox',
      status: 'booked',
      source: 'manual',
      organizationId: 'org_1',
      startDate: new Date('2026-03-02T10:00:00Z'),
      endDate: new Date('2026-03-02T11:00:00Z'),
      assignedToId: 'user_1',
      practitionerId: null,
      serviceId: 'svc_1',
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'appt_1' }]);

    await updateAppointment(mockDb as never, {
      id: 'appt_1',
      organizationId: 'org_1',
      status: 'no_show',
    });

    expect(releaseSpy).toHaveBeenCalled();
  });

  it('moving an active appointment re-allocates instead of releasing', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_1',
      title: 'Botox',
      status: 'booked',
      source: 'manual',
      organizationId: 'org_1',
      startDate: new Date('2026-03-02T10:00:00Z'),
      endDate: new Date('2026-03-02T11:00:00Z'),
      assignedToId: 'user_1',
      practitionerId: null,
      serviceId: 'svc_1',
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'appt_1' }]);

    await updateAppointment(mockDb as never, {
      id: 'appt_1',
      organizationId: 'org_1',
      startDate: new Date('2026-03-02T14:00:00Z'),
      endDate: new Date('2026-03-02T15:00:00Z'),
    });

    // `reallocateAppointmentResources` owns the release/re-hold pair, so the
    // old range cannot be left behind and the move cannot conflict with itself.
    expect(reallocateSpy).toHaveBeenCalledWith(expect.anything(), {
      appointmentId: 'appt_1',
      organizationId: 'org_1',
    });
  });

  it('an expired hold releases its rooms', async () => {
    mockDb.query.appointment.findMany.mockResolvedValueOnce([
      { id: 'appt_1', organizationId: 'org_1' },
    ]);
    mockDb.returning.mockResolvedValueOnce([{ id: 'appt_1' }]);

    await expireAppointmentHolds(mockDb as never, {});

    expect(releaseSpy).toHaveBeenCalledWith(expect.anything(), {
      appointmentId: 'appt_1',
      organizationId: 'org_1',
    });
  });

  it('releasing a lead’s holds releases their rooms', async () => {
    mockDb.query.appointment.findMany.mockResolvedValueOnce([
      { id: 'appt_1', holdExpiresAt: new Date() },
    ]);
    mockDb.returning.mockResolvedValueOnce([{ id: 'appt_1' }]);

    await releaseLeadHolds(mockDb as never, {
      organizationId: 'org_1',
      leadId: 'lead_1',
    });

    expect(releaseSpy).toHaveBeenCalledWith(expect.anything(), {
      appointmentId: 'appt_1',
      organizationId: 'org_1',
    });
  });

  it('deposit expiry releases its rooms, inside the same transaction', async () => {
    mockDb.limit.mockResolvedValueOnce([
      {
        id: 'dep_1',
        status: 'pending',
        appointmentId: 'appt_1',
        organizationId: 'org_1',
      },
    ]);

    await expireAppointmentDeposit(mockDb as never, { depositId: 'dep_1' });

    expect(releaseSpy).toHaveBeenCalledWith(expect.anything(), {
      appointmentId: 'appt_1',
      organizationId: 'org_1',
    });
  });

  it('the deposit sweep releases the rooms of every appointment it cancels', async () => {
    mockDb.query.appointmentDeposit.findMany.mockResolvedValueOnce([
      { id: 'dep_1', appointmentId: 'appt_1', organizationId: 'org_1' },
    ]);

    await checkExpiredDeposits(mockDb as never, {});

    expect(releaseSpy).toHaveBeenCalledWith(expect.anything(), {
      appointmentId: 'appt_1',
      organizationId: 'org_1',
    });
  });

  it('a Stripe checkout.session.expired webhook releases its rooms', async () => {
    mockDb.limit.mockResolvedValueOnce([
      {
        id: 'dep_1',
        status: 'pending',
        appointmentId: 'appt_1',
        organizationId: 'org_1',
      },
    ]);

    await handleDepositWebhook(mockDb as never, {
      eventType: 'checkout.session.expired',
      checkoutSessionId: 'cs_1',
    });

    expect(releaseSpy).toHaveBeenCalledWith(expect.anything(), {
      appointmentId: 'appt_1',
      organizationId: 'org_1',
    });
  });

  /**
   * The exhaustive half. Behavioural tests only cover the transitions that
   * exist today; this fails the moment someone adds a NEW one without wiring a
   * release — which is the failure mode that is otherwise invisible until a
   * clinic notices it "can't book Tuesdays any more".
   */
  it('every service that ends an appointment references a release', () => {
    const servicesDir = join(dirname(fileURLToPath(import.meta.url)), '..');
    const offenders: string[] = [];
    const checked: string[] = [];

    for (const entry of readdirSync(servicesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'shared') continue;

      for (const file of readdirSync(join(servicesDir, entry.name))) {
        if (!file.endsWith('.service.ts')) continue;
        const source = readFileSync(
          join(servicesDir, entry.name, file),
          'utf8'
        );

        const endsAnAppointment =
          (source.includes('.update(appointment)') &&
            (source.includes("status: 'cancelled'") ||
              source.includes("status: 'no_show'"))) ||
          source.includes('.set({ deletedAt');
        if (!endsAnAppointment) continue;
        checked.push(`${entry.name}/${file}`);

        const releases =
          source.includes('releaseAppointmentResources') ||
          source.includes('reallocateAppointmentResources');
        if (!releases) offenders.push(`${entry.name}/${file}`);
      }
    }

    expect(offenders).toEqual([]);
    // …and the sweep really swept. An empty `offenders` because the detector
    // stopped matching anything would be a green test guarding nothing.
    expect(checked).toContain(
      'cancel-managed-appointment/cancel-managed-appointment.service.ts'
    );
    expect(checked).toContain(
      'delete-appointment/delete-appointment.service.ts'
    );
    expect(checked.length).toBeGreaterThanOrEqual(6);
  });
});

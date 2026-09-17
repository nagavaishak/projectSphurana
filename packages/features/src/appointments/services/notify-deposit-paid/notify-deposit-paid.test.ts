import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import * as sendPushModule from '../../../notifications/services/send-push-notification/send-push-notification.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import { notifyDepositPaid } from './notify-deposit-paid.service.js';

// A restored `vi.spyOn`, NOT `vi.mock`. Under `isolate:false` the worker shares
// one module graph, so a hoisted `vi.mock` of an internal module leaks its
// factory onto every later file AND silently MISSES whenever an earlier file
// already imported the real module — which send-push-notification.test.ts does.
// The spy is installed at run time, so it intercepts regardless of load order,
// and `mockRestore` keeps it from leaking into any later file.
let mockSendPush: MockInstance;

describe('notifyDepositPaid', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockSendPush = vi
      .spyOn(sendPushModule, 'sendPushNotification')
      .mockResolvedValue({
        success: true,
        data: { sent: 1, failed: 0 },
      } as never);
  });

  afterEach(() => {
    // Restore only THIS handle (not vi.restoreAllMocks, which would restore
    // other files' spies on the shared graph) — per the maintenance rule.
    mockSendPush.mockRestore();
  });

  function seedHappyPath() {
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce({
      id: 'dep_1',
      appointmentId: 'appt_1',
      organizationId: 'org_1',
      amountCents: 2500,
      currency: 'gbp',
    });
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_1',
      leadId: 'lead_1',
      serviceId: 'svc_1',
      practitionerId: null,
      title: 'Botox: John Doe',
      startDate: new Date('2026-07-01T10:00:00Z'),
    });
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      firstName: 'John',
      lastName: 'Doe',
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      name: 'Botox',
    });
    mockDb.query.member.findFirst.mockResolvedValueOnce({
      userId: 'user_owner',
    });
  }

  it('returns VALIDATION_ERROR for missing depositId', async () => {
    const result = await notifyDepositPaid(mockDb as never, {
      depositId: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it('pushes a "deposit paid" notification to the org owner', async () => {
    seedHappyPath();
    mockSendPush.mockResolvedValueOnce({ success: true } as never);

    const result = await notifyDepositPaid(mockDb as never, {
      depositId: 'dep_1',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.notified).toBe(true);

    expect(mockSendPush).toHaveBeenCalledTimes(1);
    const [, pushInput] = mockSendPush.mock.calls[0];
    expect(pushInput.userId).toBe('user_owner');
    expect(pushInput.title).toBe('Deposit paid');
    expect(pushInput.body).toContain('John Doe');
    expect(pushInput.body).toContain('Botox');
    expect(pushInput.body).toContain('£25 deposit paid');
  });

  it('returns notified=false when push delivery fails', async () => {
    // Regression: sendPushNotification returns a Result rather than throwing,
    // so a failed delivery used to sail past the try/catch and still report
    // notified=true — which is how a total push outage looked like success.
    seedHappyPath();
    mockSendPush.mockResolvedValueOnce({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Push delivery failed' },
    } as never);

    const result = await notifyDepositPaid(mockDb as never, {
      depositId: 'dep_1',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.notified).toBe(false);
    expect(mockSendPush).toHaveBeenCalledTimes(1);
  });

  it('returns notified=false when the deposit is missing', async () => {
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(null);

    const result = await notifyDepositPaid(mockDb as never, {
      depositId: 'missing',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.notified).toBe(false);
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it('returns notified=false when there are no clinic users', async () => {
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce({
      id: 'dep_1',
      appointmentId: 'appt_1',
      organizationId: 'org_1',
      amountCents: 2500,
      currency: 'gbp',
    });
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'appt_1',
      leadId: null,
      serviceId: null,
      practitionerId: null,
      title: 'Botox',
      startDate: new Date('2026-07-01T10:00:00Z'),
    });
    mockDb.query.member.findFirst.mockResolvedValueOnce(null);

    const result = await notifyDepositPaid(mockDb as never, {
      depositId: 'dep_1',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.notified).toBe(false);
    expect(mockSendPush).not.toHaveBeenCalled();
  });
});

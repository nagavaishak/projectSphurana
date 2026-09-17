import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type MockInstance, vi } from 'vitest';
import * as checkAvailabilityModule from '../../../calendar/services/check-availability/check-availability.service.js';
import { evaluateReschedulePolicy } from './evaluate-reschedule-policy.service.js';

// No file-local factory mock of the observability module — the canonical
// `__mocks__/observability.ts` already makes `trackedResult` a passthrough and
// `logError`/`createLogger` inert `vi.fn()`s. A file-local factory mock of the
// aliased observability barrel would persist on the shared worker module graph
// under `isolate: false` and leak into every later test file. Nothing here
// asserts on `logError`.

// A restored `vi.spyOn`, NOT `vi.mock`. Under `isolate: false` the worker shares
// one module graph, so a hoisted `vi.mock` of an internal module both leaks
// outward and silently MISSES when an earlier file already imported the real
// module. Spy the SOURCE module (`check-availability.service.js`) — the barrel
// `index.js` re-export is a live getter and cannot be redefined.
let mockCheckAvailability: MockInstance;

const mockDb = {
  query: {
    organization: { findFirst: vi.fn() },
    conversation: { findFirst: vi.fn() },
    lead: { findFirst: vi.fn() },
    appointment: { findFirst: vi.fn() },
  },
};

describe('evaluateReschedulePolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckAvailability = vi
      .spyOn(checkAvailabilityModule, 'checkAvailability')
      .mockResolvedValue({
        success: true,
        data: {
          slots: [
            { displayTime: '10:00 AM', date: '2026-04-20' },
            { displayTime: '11:00 AM', date: '2026-04-20' },
            { displayTime: '2:00 PM', date: '2026-04-20' },
          ],
          message: 'Available slots',
        },
      } as never);
  });

  afterEach(() => {
    mockCheckAvailability.mockRestore();
  });

  it('returns no_contact_info when metadata has no phone or name', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      primaryCalendarType: 'borradh',
      reschedulingNoticeRequiredHours: 24,
      noShowOrLateCancelFeeCents: null,
    });
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      metadata: {},
    });

    const result = await evaluateReschedulePolicy(mockDb as never, {
      organizationId: 'org-1',
      conversationId: 'conv-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.eligible).toBe(false);
      expect(result.data.reason).toBe('no_contact_info');
    }
  });

  it('returns no_lead_found when no matching lead exists', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      primaryCalendarType: 'borradh',
      reschedulingNoticeRequiredHours: 24,
      noShowOrLateCancelFeeCents: null,
    });
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      metadata: { phone: '+353123456789' },
    });
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

    const result = await evaluateReschedulePolicy(mockDb as never, {
      organizationId: 'org-1',
      conversationId: 'conv-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.eligible).toBe(false);
      expect(result.data.reason).toBe('no_lead_found');
    }
  });

  it('returns no_upcoming_appointment when lead has no future appointments', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      primaryCalendarType: 'borradh',
      reschedulingNoticeRequiredHours: 24,
      noShowOrLateCancelFeeCents: null,
    });
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      metadata: { phone: '+353123456789' },
    });
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead-1',
      firstName: 'Jane',
      lastName: 'Doe',
    });
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(null);

    const result = await evaluateReschedulePolicy(mockDb as never, {
      organizationId: 'org-1',
      conversationId: 'conv-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.eligible).toBe(false);
      expect(result.data.reason).toBe('no_upcoming_appointment');
    }
  });

  it('returns external_provider when calendar is not Borradh-managed', async () => {
    const futureDate = new Date(Date.now() + 48 * 60 * 60 * 1000);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      primaryCalendarType: 'fresha',
      reschedulingNoticeRequiredHours: 24,
      noShowOrLateCancelFeeCents: null,
    });
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      metadata: { phone: '+353123456789' },
    });
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead-1',
      firstName: 'Jane',
      lastName: 'Doe',
    });
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'apt-1',
      title: 'Facial Treatment',
      startDate: futureDate,
      endDate: new Date(futureDate.getTime() + 30 * 60 * 1000),
    });

    const result = await evaluateReschedulePolicy(mockDb as never, {
      organizationId: 'org-1',
      conversationId: 'conv-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.eligible).toBe(false);
      expect(result.data.reason).toBe('external_provider');
      expect(result.data.appointmentId).toBe('apt-1');
    }
  });

  it('returns inside_notice_window when appointment is too soon', async () => {
    const soonDate = new Date(Date.now() + 12 * 60 * 60 * 1000);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      primaryCalendarType: 'borradh',
      reschedulingNoticeRequiredHours: 24,
      noShowOrLateCancelFeeCents: 2500,
    });
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      metadata: { phone: '+353123456789' },
    });
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead-1',
      firstName: 'Jane',
      lastName: 'Doe',
    });
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'apt-1',
      title: 'Consultation',
      startDate: soonDate,
      endDate: new Date(soonDate.getTime() + 30 * 60 * 1000),
    });

    const result = await evaluateReschedulePolicy(mockDb as never, {
      organizationId: 'org-1',
      conversationId: 'conv-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.eligible).toBe(false);
      expect(result.data.reason).toBe('inside_notice_window');
      expect(result.data.noticeRequiredHours).toBe(24);
      expect(result.data.noShowFeeCents).toBe(2500);
      expect(result.data.contextMessage).toContain('24 hours notice');
      expect(result.data.contextMessage).toContain('£25.00');
    }
  });

  it('returns eligible with slots when outside notice window', async () => {
    const farDate = new Date(Date.now() + 72 * 60 * 60 * 1000);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      primaryCalendarType: 'borradh',
      reschedulingNoticeRequiredHours: 24,
      noShowOrLateCancelFeeCents: null,
    });
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      metadata: { phone: '+353123456789' },
    });
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead-1',
      firstName: 'Jane',
      lastName: 'Doe',
    });
    mockDb.query.appointment.findFirst.mockResolvedValueOnce({
      id: 'apt-1',
      title: 'Skin Consultation',
      startDate: farDate,
      endDate: new Date(farDate.getTime() + 30 * 60 * 1000),
    });

    const result = await evaluateReschedulePolicy(mockDb as never, {
      organizationId: 'org-1',
      conversationId: 'conv-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.eligible).toBe(true);
      expect(result.data.reason).toBe('eligible');
      expect(result.data.appointmentId).toBe('apt-1');
      expect(result.data.availableSlots).toHaveLength(3);
    }
  });

  it('returns VALIDATION_ERROR for empty input', async () => {
    const result = await evaluateReschedulePolicy(mockDb as never, {
      organizationId: '',
      conversationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

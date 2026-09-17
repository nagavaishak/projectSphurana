import { AppointmentReminderEmail, sendEmail } from '@borradh-workspace/email';
import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendAppointmentReminders } from './send-reminders.service.js';

const mockSendEmail = vi.mocked(sendEmail);

describe('sendAppointmentReminders', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockSendEmail.mockResolvedValue({ messageId: 'msg_123' });
  });

  const now = new Date();

  const makeAppointment = (hoursFromNow: number, overrides = {}) => ({
    id: `appt_${hoursFromNow}h`,
    title: 'Consultation',
    startDate: new Date(now.getTime() + hoursFromNow * 60 * 60 * 1000),
    endDate: new Date(now.getTime() + (hoursFromNow + 1) * 60 * 60 * 1000),
    leadId: 'lead_123',
    organizationId: 'org_123',
    status: 'booked',
    reminderSentAt24h: null,
    reminderSentAt1h: null,
    ...overrides,
  });

  const mockLead = {
    id: 'lead_123',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
  };

  const mockOrg = {
    name: 'Test Company',
  };

  it('should send 24-hour reminders', async () => {
    // findMany: 1st call for 24h window, 2nd call for 1h window
    mockDb.query.appointment.findMany
      .mockResolvedValueOnce([makeAppointment(24)])
      .mockResolvedValueOnce([]);

    mockDb.query.lead.findFirst.mockResolvedValue(mockLead);
    mockDb.query.organization.findFirst.mockResolvedValue(mockOrg);

    const result = await sendAppointmentReminders(mockDb as never, {});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sent24h).toBe(1);
      expect(result.data.sent1h).toBe(0);
    }

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'john@example.com',
        subject: expect.stringContaining('tomorrow'),
        template: AppointmentReminderEmail,
      })
    );
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should send 1-hour reminders', async () => {
    mockDb.query.appointment.findMany
      .mockResolvedValueOnce([]) // 24h window: empty
      .mockResolvedValueOnce([makeAppointment(1)]); // 1h window

    mockDb.query.lead.findFirst.mockResolvedValue(mockLead);
    mockDb.query.organization.findFirst.mockResolvedValue(mockOrg);

    const result = await sendAppointmentReminders(mockDb as never, {});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sent24h).toBe(0);
      expect(result.data.sent1h).toBe(1);
    }

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'john@example.com',
        subject: expect.stringContaining('1 hour'),
        template: AppointmentReminderEmail,
      })
    );
  });

  it('should skip leads without email', async () => {
    const leadNoEmail = { ...mockLead, email: null };

    mockDb.query.appointment.findMany
      .mockResolvedValueOnce([makeAppointment(24)])
      .mockResolvedValueOnce([]);

    mockDb.query.lead.findFirst.mockResolvedValue(leadNoEmail);

    const result = await sendAppointmentReminders(mockDb as never, {});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sent24h).toBe(0);
    }
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('should handle email send failures gracefully', async () => {
    mockDb.query.appointment.findMany
      .mockResolvedValueOnce([makeAppointment(24)])
      .mockResolvedValueOnce([]);

    mockDb.query.lead.findFirst.mockResolvedValue(mockLead);
    mockDb.query.organization.findFirst.mockResolvedValue(mockOrg);
    mockSendEmail.mockRejectedValue(new Error('Email service down'));

    const result = await sendAppointmentReminders(mockDb as never, {});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sent24h).toBe(0);
    }
  });

  it('should not blanket-fail when the 24h window query throws (ENG-281)', async () => {
    // 24h window query throws (e.g. transient DB blip); 1h window still runs.
    mockDb.query.appointment.findMany
      .mockRejectedValueOnce(new Error('Failed query: connection timeout'))
      .mockResolvedValueOnce([makeAppointment(1)]);

    mockDb.query.lead.findFirst.mockResolvedValue(mockLead);
    mockDb.query.organization.findFirst.mockResolvedValue(mockOrg);

    const result = await sendAppointmentReminders(mockDb as never, {});

    // Result stays a success with partial counts — no INTERNAL_ERROR mask.
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sent24h).toBe(0);
      expect(result.data.sent1h).toBe(1);
    }
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it('should return zero counts when no appointments need reminders', async () => {
    mockDb.query.appointment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await sendAppointmentReminders(mockDb as never, {});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sent24h).toBe(0);
      expect(result.data.sent1h).toBe(0);
    }
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  // These are the tests that were missing. Every case above asserts that an
  // email was SENT; none asserted what TIME it said. So a formatter silently
  // rendering in the SERVER's zone (UTC on Fly) passed the entire suite while
  // telling a Dublin client 13:00 for a 14:00 appointment.
  //
  // In production the bug was masked for manually-created appointments — the
  // calendar was writing UTC too, so the two errors cancelled and the email
  // happened to show the time staff had typed. Correcting the stored instants
  // on 2026-08-12 unmasked it.
  describe('renders the time in the BUSINESS timezone, not the server one', () => {
    // A fixed instant, so these do not depend on when the suite runs.
    // 13:00Z in July is 14:00 in Dublin (IST) and 06:00 in Los Angeles (PDT).
    const INSTANT = new Date('2026-07-15T13:00:00Z');

    const propsFor = async (timezone: string, startDate = INSTANT) => {
      mockDb.query.appointment.findMany
        .mockResolvedValueOnce([makeAppointment(24, { startDate })])
        .mockResolvedValueOnce([]);
      mockDb.query.lead.findFirst.mockResolvedValue(mockLead);
      mockDb.query.organization.findFirst.mockResolvedValue({
        name: 'Test Company',
        timezone,
      });

      await sendAppointmentReminders(mockDb as never, {});
      return mockSendEmail.mock.calls[0][0].props as {
        formattedTime: string;
        formattedDate: string;
      };
    };

    it('renders a Dublin appointment at 02:00 PM, not 01:00 PM', async () => {
      expect((await propsFor('Europe/Dublin')).formattedTime).toBe('02:00 PM');
    });

    it('renders the same instant at 06:00 AM for a Los Angeles org', async () => {
      expect((await propsFor('America/Los_Angeles')).formattedTime).toBe(
        '06:00 AM'
      );
    });

    // Near midnight the zone decides the DAY, not just the clock face — a UTC
    // fallback would put a Californian evening appointment on tomorrow's date.
    it('uses the business zone to decide the calendar day', async () => {
      const props = await propsFor(
        'America/Los_Angeles',
        // 03:00Z on the 16th is still 20:00 on the 15th in California.
        new Date('2026-07-16T03:00:00Z')
      );
      expect(props.formattedDate).toContain('July 15');
      expect(props.formattedTime).toBe('08:00 PM');
    });
  });
});

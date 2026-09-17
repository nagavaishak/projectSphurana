import {
  GoogleCalendarService,
  decryptCredentials,
} from '@borradh-workspace/integrations';
import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { syncToCalendar } from './sync-to-calendar.service.js';

// Canonical integration-service mocks return a stable shared instance whose
// methods are auto-vivified vi.fn()s.
const calendarServiceInstance = new (
  GoogleCalendarService as never as new () => {
    createEvent: ReturnType<typeof vi.fn>;
    updateEvent: ReturnType<typeof vi.fn>;
    deleteEvent: ReturnType<typeof vi.fn>;
  }
)();
const mockCreateEvent = vi.mocked(calendarServiceInstance.createEvent);
const mockUpdateEvent = vi.mocked(calendarServiceInstance.updateEvent);
const mockDeleteEvent = vi.mocked(calendarServiceInstance.deleteEvent);
const mockDecryptCredentials = vi.mocked(decryptCredentials);

describe('syncToCalendar', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockDecryptCredentials.mockReturnValue({
      accessToken: 'mock_access_token',
      refreshToken: 'mock_refresh_token',
      expiresIn: 3600,
    });
  });

  const mockAppointment = {
    id: 'appt_123',
    title: 'Consultation',
    description: 'Initial meeting',
    startDate: new Date('2024-03-15T10:00:00Z'),
    endDate: new Date('2024-03-15T11:00:00Z'),
    leadId: 'lead_123',
    calendarAccountId: 'cal_123',
    externalCalendarEventId: null,
    organizationId: 'org_123',
  };

  const mockCalAccount = {
    id: 'cal_123',
    calendarId: 'primary',
    isActive: true,
    encryptedCredentials: 'encrypted_data',
    tokenExpiresAt: new Date('2099-01-01'),
  };

  const mockLead = {
    id: 'lead_123',
    firstName: 'John',
    lastName: 'Doe',
  };

  it('should create a calendar event on action create', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(mockAppointment);
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(
      mockCalAccount
    );
    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockCreateEvent.mockResolvedValueOnce({ id: 'gcal_event_123' });

    const result = await syncToCalendar(mockDb as never, {
      appointmentId: 'appt_123',
      organizationId: 'org_123',
      action: 'create',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.synced).toBe(true);
      expect(result.data.externalEventId).toBe('gcal_event_123');
    }
    expect(mockCreateEvent).toHaveBeenCalled();
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should update a calendar event when externalCalendarEventId exists', async () => {
    const apptWithExternalId = {
      ...mockAppointment,
      externalCalendarEventId: 'gcal_event_123',
    };

    mockDb.query.appointment.findFirst.mockResolvedValueOnce(
      apptWithExternalId
    );
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(
      mockCalAccount
    );
    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockUpdateEvent.mockResolvedValueOnce({});

    const result = await syncToCalendar(mockDb as never, {
      appointmentId: 'appt_123',
      organizationId: 'org_123',
      action: 'update',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.synced).toBe(true);
      expect(result.data.externalEventId).toBe('gcal_event_123');
    }
    expect(mockUpdateEvent).toHaveBeenCalledWith(
      'primary',
      'gcal_event_123',
      expect.any(Object)
    );
  });

  it('should delete a calendar event when externalCalendarEventId exists', async () => {
    const apptWithExternalId = {
      ...mockAppointment,
      externalCalendarEventId: 'gcal_event_123',
    };

    mockDb.query.appointment.findFirst.mockResolvedValueOnce(
      apptWithExternalId
    );
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(
      mockCalAccount
    );
    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockDeleteEvent.mockResolvedValueOnce(undefined);

    const result = await syncToCalendar(mockDb as never, {
      appointmentId: 'appt_123',
      organizationId: 'org_123',
      action: 'delete',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.synced).toBe(true);
    }
    expect(mockDeleteEvent).toHaveBeenCalledWith('primary', 'gcal_event_123');
  });

  it('should return synced: false when no calendar account is available', async () => {
    const apptNoCalendar = {
      ...mockAppointment,
      calendarAccountId: null,
    };

    mockDb.query.appointment.findFirst.mockResolvedValueOnce(apptNoCalendar);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      primaryCalendarAccountId: null,
    });

    const result = await syncToCalendar(mockDb as never, {
      appointmentId: 'appt_123',
      organizationId: 'org_123',
      action: 'create',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.synced).toBe(false);
    }
  });

  it('should return synced: false when calendar account is inactive', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(mockAppointment);
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce({
      ...mockCalAccount,
      isActive: false,
    });

    const result = await syncToCalendar(mockDb as never, {
      appointmentId: 'appt_123',
      organizationId: 'org_123',
      action: 'create',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.synced).toBe(false);
    }
  });

  it('should return NOT_FOUND when appointment does not exist', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(null);

    const result = await syncToCalendar(mockDb as never, {
      appointmentId: 'appt_nonexistent',
      organizationId: 'org_123',
      action: 'create',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('should return INTERNAL_ERROR on Google Calendar API error', async () => {
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(mockAppointment);
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(
      mockCalAccount
    );
    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockCreateEvent.mockRejectedValueOnce(
      new Error('Google Calendar API error')
    );

    const result = await syncToCalendar(mockDb as never, {
      appointmentId: 'appt_123',
      organizationId: 'org_123',
      action: 'create',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});

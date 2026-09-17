import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { bookAppointment } from './book-appointment.service.js';

// Mock external dependencies

const mockDb = {
  query: {
    organization: {
      findFirst: vi.fn(),
    },
    calendarAccount: {
      findFirst: vi.fn(),
    },
    bookingAccount: {
      findFirst: vi.fn(),
    },
    lead: {
      findFirst: vi.fn(),
    },
  },
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(),
};

describe('bookAppointment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validInput = {
    organizationId: 'org-123',
    leadId: 'lead-123',
    assignedToId: 'user-123',
    date: '2024-01-15',
    time: '14:30',
    serviceType: 'Haircut',
    customerName: 'John Doe',
    customerPhone: '+1234567890',
  };

  describe('validation', () => {
    it('returns VALIDATION_ERROR for missing organizationId', async () => {
      const result = await bookAppointment(mockDb as never, {
        ...validInput,
        organizationId: '',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });

    it('returns VALIDATION_ERROR for missing leadId', async () => {
      const result = await bookAppointment(mockDb as never, {
        ...validInput,
        leadId: '',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });

    it('returns VALIDATION_ERROR for missing assignedToId', async () => {
      const result = await bookAppointment(mockDb as never, {
        ...validInput,
        assignedToId: '',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });

    it('returns VALIDATION_ERROR for invalid date format', async () => {
      const result = await bookAppointment(mockDb as never, {
        ...validInput,
        date: '15-01-2024', // Wrong format
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });

    it('returns VALIDATION_ERROR for invalid time format', async () => {
      const result = await bookAppointment(mockDb as never, {
        ...validInput,
        time: '2:30PM', // Wrong format
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });

    it('returns VALIDATION_ERROR for invalid duration (too short)', async () => {
      const result = await bookAppointment(mockDb as never, {
        ...validInput,
        duration: 5, // Min is 15
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });

    it('returns VALIDATION_ERROR for invalid duration (too long)', async () => {
      const result = await bookAppointment(mockDb as never, {
        ...validInput,
        duration: 500, // Max is 480
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });

    it('returns VALIDATION_ERROR for missing serviceType', async () => {
      const result = await bookAppointment(mockDb as never, {
        ...validInput,
        serviceType: '',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });

    it('returns VALIDATION_ERROR for missing customerName', async () => {
      const result = await bookAppointment(mockDb as never, {
        ...validInput,
        customerName: '',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });

    it('returns VALIDATION_ERROR for missing customerPhone', async () => {
      const result = await bookAppointment(mockDb as never, {
        ...validInput,
        customerPhone: '',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });

    it('returns VALIDATION_ERROR for invalid customerEmail', async () => {
      const result = await bookAppointment(mockDb as never, {
        ...validInput,
        customerEmail: 'not-an-email',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });
  });

  describe('organization lookup', () => {
    it('returns NOT_FOUND when organization does not exist', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce(null);

      const result = await bookAppointment(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(result.error.message).toContain('Organization not found');
      }
    });

    it('returns VALIDATION_ERROR when no primary calendar is configured', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: null,
        primaryCalendarAccountId: null,
      });

      const result = await bookAppointment(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(result.error.message).toContain(
          'No primary calendar configured'
        );
      }
    });

    it('returns VALIDATION_ERROR when primary calendar type is set but account ID is missing', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: 'google_calendar',
        primaryCalendarAccountId: null,
      });

      const result = await bookAppointment(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });
  });

  describe('provider routing', () => {
    it('returns INTERNAL_ERROR for unsupported provider (phorest)', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: 'phorest',
        primaryCalendarAccountId: 'account-123',
      });

      const result = await bookAppointment(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
        expect(result.error.message).toContain('phorest');
      }
    });

    it('returns INTERNAL_ERROR for unsupported provider (fresha)', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: 'fresha',
        primaryCalendarAccountId: 'account-123',
      });

      const result = await bookAppointment(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
        expect(result.error.message).toContain('fresha');
      }
    });

    it('returns VALIDATION_ERROR for unknown provider', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: 'unknown_provider',
        primaryCalendarAccountId: 'account-123',
      });

      const result = await bookAppointment(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(result.error.message).toContain('Unknown calendar provider');
      }
    });
  });

  describe('Google Calendar - account not found', () => {
    it('returns NOT_FOUND when calendar account does not exist', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: 'google_calendar',
        primaryCalendarAccountId: 'cal-123',
      });
      mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(null);

      const result = await bookAppointment(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(result.error.message).toContain('Calendar account not found');
      }
    });

    it('returns VALIDATION_ERROR when calendar account is not active', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: 'google_calendar',
        primaryCalendarAccountId: 'cal-123',
      });
      mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce({
        id: 'cal-123',
        isActive: false,
      });

      const result = await bookAppointment(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(result.error.message).toContain('not active');
      }
    });

    it('returns NOT_FOUND when lead does not exist (Google Calendar)', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: 'google_calendar',
        primaryCalendarAccountId: 'cal-123',
      });
      mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce({
        id: 'cal-123',
        isActive: true,
      });
      mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

      const result = await bookAppointment(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(result.error.message).toContain('Lead not found');
      }
    });
  });

  describe('Calendly - account not found', () => {
    it('returns NOT_FOUND when booking account does not exist', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: 'calendly',
        primaryCalendarAccountId: 'booking-123',
      });
      mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce(null);

      const result = await bookAppointment(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(result.error.message).toContain('Calendly account not found');
      }
    });

    it('returns VALIDATION_ERROR when booking account is not active', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: 'calendly',
        primaryCalendarAccountId: 'booking-123',
      });
      mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce({
        id: 'booking-123',
        isActive: false,
      });

      const result = await bookAppointment(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(result.error.message).toContain('not active');
      }
    });

    it('returns NOT_FOUND when lead does not exist (Calendly)', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: 'calendly',
        primaryCalendarAccountId: 'booking-123',
      });
      mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce({
        id: 'booking-123',
        isActive: true,
      });
      mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

      const result = await bookAppointment(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(result.error.message).toContain('Lead not found');
      }
    });

    it('returns VALIDATION_ERROR when no default event type is configured', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: 'calendly',
        primaryCalendarAccountId: 'booking-123',
      });
      mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce({
        id: 'booking-123',
        isActive: true,
        config: null, // No config
      });
      mockDb.query.lead.findFirst.mockResolvedValueOnce({
        id: 'lead-123',
      });

      const result = await bookAppointment(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(result.error.message).toContain(
          'No default event type configured'
        );
      }
    });
  });

  describe('Timely - account not found', () => {
    it('returns NOT_FOUND when booking account does not exist', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: 'timely',
        primaryCalendarAccountId: 'booking-123',
      });
      mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce(null);

      const result = await bookAppointment(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(result.error.message).toContain('Timely account not found');
      }
    });

    it('returns VALIDATION_ERROR when Timely account ID is not configured', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: 'timely',
        primaryCalendarAccountId: 'booking-123',
      });
      mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce({
        id: 'booking-123',
        isActive: true,
        config: null, // No config
      });
      mockDb.query.lead.findFirst.mockResolvedValueOnce({
        id: 'lead-123',
      });

      const result = await bookAppointment(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(result.error.message).toContain('account ID not configured');
      }
    });

    it('returns VALIDATION_ERROR when no default project is configured for Timely', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: 'timely',
        primaryCalendarAccountId: 'booking-123',
      });
      mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce({
        id: 'booking-123',
        isActive: true,
        config: {
          timely: { accountId: 123 }, // Has account ID but no project ID
        },
      });
      mockDb.query.lead.findFirst.mockResolvedValueOnce({
        id: 'lead-123',
      });

      const result = await bookAppointment(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(result.error.message).toContain('No default project configured');
      }
    });
  });
});

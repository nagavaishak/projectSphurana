import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { getOrganizationCalendarSettings } from './get-organization-calendar-settings.service.js';

describe('getOrganizationCalendarSettings', () => {
  const mocks = {
    mockSelect: vi.fn(),
    mockFrom: vi.fn(),
    mockWhere: vi.fn(),
    mockLimit: vi.fn(),
  };

  const mockDb = { select: mocks.mockSelect } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockSelect.mockReturnValue({ from: mocks.mockFrom });
    mocks.mockFrom.mockReturnValue({ where: mocks.mockWhere });
    mocks.mockWhere.mockReturnValue({ limit: mocks.mockLimit });
  });

  // The calendar renders appointments in `timezone` AND converts a picked
  // wall-clock time back to an instant with it. When it does not reach the
  // client the frontend falls back to 'UTC', so a US-Pacific org's manual
  // 9:15am booking is stored as 09:15Z — seven hours off the booking-form
  // appointments created server-side. Selecting the column is the fix, so the
  // select shape is asserted, not just the pass-through.
  it('selects and returns the org timezone', async () => {
    mocks.mockLimit.mockResolvedValueOnce([
      { timezone: 'America/Los_Angeles', primaryCalendarType: null },
    ]);

    const result = await getOrganizationCalendarSettings(mockDb, 'org_123');

    expect(mocks.mockSelect).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: expect.anything() })
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timezone).toBe('America/Los_Angeles');
    }
  });

  it('falls back to UTC when the org has no timezone', async () => {
    mocks.mockLimit.mockResolvedValueOnce([{ timezone: null }]);

    const result = await getOrganizationCalendarSettings(mockDb, 'org_123');

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.timezone).toBe('UTC');
  });

  it('should return calendar settings when organization exists', async () => {
    mocks.mockLimit.mockResolvedValueOnce([
      {
        primaryCalendarType: 'google',
        defaultBookingLink: 'https://cal.com/org',
        customerReschedulingEnabled: false,
        customerCancellationsEnabled: false,
        cancellationNoticeRequiredHours: 24,
        chatbotSystemPrompt: 'Be helpful',
        chatbotSettings: { specialOffers: '10% off first visit' },
      },
    ]);

    const result = await getOrganizationCalendarSettings(mockDb, 'org_123');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.primaryCalendarType).toBe('google');
      expect(result.data.defaultBookingLink).toBe('https://cal.com/org');
      expect(result.data.customerReschedulingEnabled).toBe(false);
      expect(result.data.customerCancellationsEnabled).toBe(false);
      expect(result.data.cancellationNoticeRequiredHours).toBe(24);
      expect(result.data.chatbotSettings).toEqual({
        specialOffers: '10% off first visit',
      });
    }
  });

  it('should return null values when fields are undefined', async () => {
    mocks.mockLimit.mockResolvedValueOnce([
      {
        primaryCalendarType: undefined,
        defaultBookingLink: undefined,
        chatbotSystemPrompt: undefined,
        chatbotSettings: undefined,
      },
    ]);

    const result = await getOrganizationCalendarSettings(mockDb, 'org_123');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.primaryCalendarType).toBeNull();
      expect(result.data.defaultBookingLink).toBeNull();
      expect(result.data.chatbotSettings).toBeNull();
      // NOT NULL columns fall back to the DB defaults, not null.
      expect(result.data.customerReschedulingEnabled).toBe(true);
      expect(result.data.customerCancellationsEnabled).toBe(true);
      expect(result.data.cancellationNoticeRequiredHours).toBe(0);
    }
  });

  it('should return NOT_FOUND when organization does not exist', async () => {
    mocks.mockLimit.mockResolvedValueOnce([]);

    await expectResult(
      getOrganizationCalendarSettings(mockDb, 'org_nonexistent')
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      getOrganizationCalendarSettings(mockDb, '')
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});

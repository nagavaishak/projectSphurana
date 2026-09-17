import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { listPhoneNumbers } from './list-phone-numbers.service.js';

describe('listPhoneNumbers', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns phone numbers with plan usage info', async () => {
    const mockPhoneNumbers = [
      {
        id: 'pn-1',
        organizationId: 'org-1',
        number: '+353851234567',
        label: 'Main',
        provider: 'telnyx',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'pn-2',
        organizationId: 'org-1',
        number: '+353859999999',
        label: 'Marketing',
        provider: 'telnyx',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    // Use the Proxy-created table mocks
    mockDb.query.phoneNumber.findMany.mockResolvedValueOnce(mockPhoneNumbers);
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce({
      planId: 'pro',
    });

    const result = await listPhoneNumbers(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
      expect(result.data.maxAllowed).toBe(5); // pro plan
      expect(result.data.currentCount).toBe(2);
    }
  });

  it('defaults to free plan when no subscription exists', async () => {
    mockDb.query.phoneNumber.findMany.mockResolvedValueOnce([]);
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(null);

    const result = await listPhoneNumbers(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxAllowed).toBe(0); // free plan
      expect(result.data.currentCount).toBe(0);
    }
  });

  it('returns INTERNAL_ERROR on database failure', async () => {
    mockDb.query.phoneNumber.findMany.mockRejectedValueOnce(
      new Error('DB connection failed')
    );

    const result = await listPhoneNumbers(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});

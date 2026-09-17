import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { createCampaign } from './create-campaign.service.js';

describe('createCampaign', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    name: 'Spring intro offer',
    type: 'intro_offer' as const,
    channels: ['email', 'sms'] as const,
  };

  it('creates a draft campaign with valid input', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 'camp_1', ...validInput, status: 'draft' },
    ]);

    const result = await createCampaign(mockDb as never, { ...validInput });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('draft');
    }
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('requires at least one channel', async () => {
    const result = await createCampaign(mockDb as never, {
      ...validInput,
      channels: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});

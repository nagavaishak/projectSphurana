import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import { markWhatsappHistoryComplete } from './mark-whatsapp-history-complete.service.js';

const mockDb = {
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  returning: vi.fn(),
};

describe('markWhatsappHistoryComplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
  });

  it('stamps last_sync_at for the matching whatsapp account', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'wa-1' }]);

    const result = await markWhatsappHistoryComplete(mockDb as never, {
      phoneNumberId: 'phone-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stamped).toBe(true);
    }
    // set() was called with lastSyncAt: Date
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ lastSyncAt: expect.any(Date) })
    );
  });

  it('returns NOT_FOUND when no whatsapp account matches phone_number_id', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await markWhatsappHistoryComplete(mockDb as never, {
      phoneNumberId: 'unknown-phone',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns VALIDATION_ERROR for empty phoneNumberId', async () => {
    const result = await markWhatsappHistoryComplete(mockDb as never, {
      phoneNumberId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB connection failed'));

    const result = await markWhatsappHistoryComplete(mockDb as never, {
      phoneNumberId: 'phone-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});

import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import { updateMessageStatus } from './update-message-status.service.js';

const mockDb = {
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue([]),
};

const validInput = {
  externalMessageId: 'mid-123',
  status: 'delivered' as const,
  timestamp: 1700000000000,
};

describe('updateMessageStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValue([]);
  });

  it('updates status to delivered', async () => {
    const result = await updateMessageStatus(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updated).toBe(true);
    }
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveredAt: expect.any(Date),
      })
    );
  });

  it('updates status to sent', async () => {
    const result = await updateMessageStatus(mockDb as never, {
      ...validInput,
      status: 'sent',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updated).toBe(true);
    }
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        sentAt: expect.any(Date),
      })
    );
  });

  it('updates status to read', async () => {
    const result = await updateMessageStatus(mockDb as never, {
      ...validInput,
      status: 'read',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updated).toBe(true);
    }
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        readAt: expect.any(Date),
      })
    );
  });

  it('returns VALIDATION_ERROR for missing externalMessageId', async () => {
    const result = await updateMessageStatus(mockDb as never, {
      ...validInput,
      externalMessageId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for invalid status', async () => {
    const result = await updateMessageStatus(mockDb as never, {
      ...validInput,
      status: 'unknown' as never,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for missing timestamp', async () => {
    const result = await updateMessageStatus(
      mockDb as never,
      {
        externalMessageId: 'mid-123',
        status: 'sent',
      } as never
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockDb.where.mockRejectedValueOnce(new Error('DB connection failed'));

    const result = await updateMessageStatus(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('uses correct timestamp from input', async () => {
    const timestamp = 1700000000000;
    await updateMessageStatus(mockDb as never, {
      ...validInput,
      timestamp,
    });

    expect(mockDb.set).toHaveBeenCalledWith({
      deliveredAt: new Date(timestamp),
    });
  });
});

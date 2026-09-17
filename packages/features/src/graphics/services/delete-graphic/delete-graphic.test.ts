import {
  deleteObject,
  extractKeyFromCdnUrl,
  parseS3Url,
} from '@borradh-workspace/storage';
import { createMockDatabase, expectResult } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';

// `@borradh-workspace/storage` is a canonically aliased mock (vite.config.ts) —
// drive its `vi.fn()`s with `vi.mocked()` rather than a file-local `vi.mock`,
// which would leak under `isolate: false`.
const mockDeleteObject = vi.mocked(deleteObject);
const mockParseS3Url = vi.mocked(parseS3Url);
const mockExtractKeyFromCdnUrl = vi.mocked(extractKeyFromCdnUrl);

const { deleteGraphic } = await import('./delete-graphic.service.js');

describe('deleteGraphic', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // `.mockReset()` drops any queued `*Once` left by a prior test/sibling file,
    // then restore base impls.
    mockDeleteObject.mockReset();
    mockParseS3Url.mockReset();
    mockExtractKeyFromCdnUrl.mockReset();
    mockDeleteObject.mockResolvedValue(undefined);
    mockParseS3Url.mockReturnValue(null);
    mockExtractKeyFromCdnUrl.mockReturnValue(null);
  });

  const validInput = {
    id: 'graphic_123',
    organizationId: 'org_123',
  };

  it('should delete graphic and return success', async () => {
    const existingGraphic = {
      id: 'graphic_123',
      title: 'Test Graphic',
      status: 'draft',
      organizationId: 'org_123',
    };

    mockDb.query.graphic.findFirst.mockResolvedValueOnce(existingGraphic);
    // 1st where(): the "is any ad using this creative?" guard — none here.
    mockDb.where.mockResolvedValueOnce([]);
    mockDb.where.mockResolvedValueOnce([existingGraphic]);

    const result = await deleteGraphic(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
    }

    expect(mockDb.delete).toHaveBeenCalled();
  });

  /**
   * Deleting a graphic hard-deletes the row AND destroys its S3 objects, so an
   * ad still pointing at it is left with a dangling reference and media that
   * cannot be recovered. Four production ads ended up in that state.
   */
  it('refuses to delete a graphic an ad still uses, and deletes nothing', async () => {
    mockDb.query.graphic.findFirst.mockResolvedValueOnce({
      id: 'graphic_123',
      organizationId: 'org_123',
    });
    mockDb.where.mockResolvedValueOnce([
      { id: 'ad_1', name: 'Spring Offer' },
      { id: 'ad_2', name: 'Summer Offer' },
    ]);

    const result = await deleteGraphic(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
      // The message has to be actionable — it names the ads blocking the delete.
      expect(result.error.message).toContain('Spring Offer');
      expect(result.error.message).toContain('Summer Offer');
    }
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it('should return NOT_FOUND when graphic does not exist', async () => {
    mockDb.query.graphic.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      deleteGraphic(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('should return NOT_FOUND when graphic belongs to different organization', async () => {
    mockDb.query.graphic.findFirst.mockResolvedValueOnce(null);

    const inputWithDifferentOrg = {
      id: 'graphic_123',
      organizationId: 'different_org',
    };

    await expectResult(
      deleteGraphic(mockDb as never, inputWithDifferentOrg)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = {
      id: '',
      organizationId: 'org_123',
    };

    await expectResult(
      deleteGraphic(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.graphic.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      id: 'graphic_123',
      organizationId: '',
    };

    await expectResult(
      deleteGraphic(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.graphic.findFirst).not.toHaveBeenCalled();
  });

  it('should return INTERNAL_ERROR on database failure', async () => {
    const existingGraphic = {
      id: 'graphic_123',
      organizationId: 'org_123',
    };

    mockDb.query.graphic.findFirst.mockResolvedValueOnce(existingGraphic);
    mockDb.where.mockRejectedValueOnce(new Error('Database error'));

    const result = await deleteGraphic(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('should delete graphic regardless of status', async () => {
    const statuses = ['draft', 'rendering', 'ready', 'failed'];

    for (const status of statuses) {
      mockDb._resetMocks();
      vi.clearAllMocks();

      const existingGraphic = {
        id: 'graphic_123',
        status,
        organizationId: 'org_123',
      };

      mockDb.query.graphic.findFirst.mockResolvedValueOnce(existingGraphic);
      // 1st where(): the "is any ad using this creative?" guard — none here.
      mockDb.where.mockResolvedValueOnce([]);
      mockDb.where.mockResolvedValueOnce([existingGraphic]);

      const result = await deleteGraphic(mockDb as never, validInput);

      expect(result.success).toBe(true);
    }
  });

  it('should attempt S3 cleanup for graphic with outputs', async () => {
    const existingGraphic = {
      id: 'graphic_123',
      organizationId: 'org_123',
      outputs: [
        {
          url: 'https://bucket.s3.us-east-1.amazonaws.com/graphics/output1.png',
        },
        {
          url: 'https://bucket.s3.us-east-1.amazonaws.com/graphics/output2.png',
        },
      ],
      slides: null,
    };

    mockParseS3Url.mockReturnValue({
      bucket: 'bucket',
      key: 'graphics/output1.png',
    });

    mockDb.query.graphic.findFirst.mockResolvedValueOnce(existingGraphic);
    // 1st where(): the "is any ad using this creative?" guard — none here.
    mockDb.where.mockResolvedValueOnce([]);
    mockDb.where.mockResolvedValueOnce([existingGraphic]);

    const result = await deleteGraphic(mockDb as never, validInput);

    expect(result.success).toBe(true);

    // Wait for fire-and-forget to resolve
    await new Promise((r) => setTimeout(r, 50));

    expect(mockDeleteObject).toHaveBeenCalled();
  });

  it('should succeed even if S3 cleanup fails', async () => {
    const existingGraphic = {
      id: 'graphic_123',
      organizationId: 'org_123',
      outputs: [
        {
          url: 'https://bucket.s3.us-east-1.amazonaws.com/graphics/output1.png',
        },
      ],
      slides: null,
    };

    mockParseS3Url.mockReturnValue({
      bucket: 'bucket',
      key: 'graphics/output1.png',
    });
    mockDeleteObject.mockRejectedValue(new Error('S3 error'));

    mockDb.query.graphic.findFirst.mockResolvedValueOnce(existingGraphic);
    // 1st where(): the "is any ad using this creative?" guard — none here.
    mockDb.where.mockResolvedValueOnce([]);
    mockDb.where.mockResolvedValueOnce([existingGraphic]);

    const result = await deleteGraphic(mockDb as never, validInput);

    // Delete should still succeed even though S3 cleanup failed
    expect(result.success).toBe(true);
  });

  it('should try CDN URL extraction when S3 URL parsing fails', async () => {
    const existingGraphic = {
      id: 'graphic_123',
      organizationId: 'org_123',
      outputs: [{ url: 'https://cdn.example.com/graphics/output1.png' }],
      slides: null,
    };

    mockParseS3Url.mockReturnValue(null);
    mockExtractKeyFromCdnUrl.mockReturnValue('graphics/output1.png');

    mockDb.query.graphic.findFirst.mockResolvedValueOnce(existingGraphic);
    // 1st where(): the "is any ad using this creative?" guard — none here.
    mockDb.where.mockResolvedValueOnce([]);
    mockDb.where.mockResolvedValueOnce([existingGraphic]);

    const result = await deleteGraphic(mockDb as never, validInput);

    expect(result.success).toBe(true);

    // Wait for fire-and-forget to resolve
    await new Promise((r) => setTimeout(r, 50));

    expect(mockExtractKeyFromCdnUrl).toHaveBeenCalledWith(
      'https://cdn.example.com/graphics/output1.png'
    );
    expect(mockDeleteObject).toHaveBeenCalledWith({
      key: 'graphics/output1.png',
    });
  });
});

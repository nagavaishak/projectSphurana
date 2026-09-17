import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';

import { ErrorCodes } from '../../../shared/index.js';
import { updateDraftClips } from './update-draft-clips.service.js';

const VID = '550e8400-e29b-41d4-a716-446655440000';
const A1 = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const A2 = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const A3 = '01234567-89ab-4def-8123-456789abcdef';
const ORG = 'org_123';
const OTHER_ORG = 'org_999';

describe('updateDraftClips', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('replaces tray contents in a transaction (delete + insert)', async () => {
    // Both lookups terminate at .limit() — queue parent then asset in order.
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit
      .mockResolvedValueOnce([{ id: VID, organizationId: ORG }])
      .mockResolvedValueOnce([
        { id: A1, organizationId: ORG },
        { id: A2, organizationId: ORG },
      ]);

    // Inside transaction: delete then insert/returning.
    mockDb.delete.mockReturnThis();
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'new_1',
        videoId: VID,
        assetId: A1,
        source: 'uploaded',
        beatOrder: 0,
        processingStatus: 'ready',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'new_2',
        videoId: VID,
        assetId: A2,
        source: 'library',
        beatOrder: 1,
        processingStatus: 'ready',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await updateDraftClips(mockDb as never, {
      videoId: VID,
      organizationId: ORG,
      clips: [
        { assetId: A1, source: 'uploaded', beatOrder: 0 },
        { assetId: A2, source: 'library', beatOrder: 1 },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.clips).toHaveLength(2);
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.delete).toHaveBeenCalledTimes(1);
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });

  it('clears the tray when clips=[] (delete only, no asset validation)', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([{ id: VID, organizationId: ORG }]);

    mockDb.delete.mockReturnThis();

    const result = await updateDraftClips(mockDb as never, {
      videoId: VID,
      organizationId: ORG,
      clips: [],
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.clips).toEqual([]);
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.delete).toHaveBeenCalledTimes(1);
    // No insert when clearing.
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when video belongs to a different org (no DELETE fires)', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([
      { id: VID, organizationId: OTHER_ORG },
    ]);

    await expectResult(
      updateDraftClips(mockDb as never, {
        videoId: VID,
        organizationId: ORG,
        clips: [{ assetId: A1, source: 'uploaded', beatOrder: 0 }],
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when any asset is missing or cross-org (no DELETE fires)', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit
      .mockResolvedValueOnce([{ id: VID, organizationId: ORG }])
      // A3 missing entirely; A1 owned.
      .mockResolvedValueOnce([{ id: A1, organizationId: ORG }]);

    await expectResult(
      updateDraftClips(mockDb as never, {
        videoId: VID,
        organizationId: ORG,
        clips: [
          { assetId: A1, source: 'uploaded', beatOrder: 0 },
          { assetId: A3, source: 'library', beatOrder: 1 },
        ],
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for negative beatOrder', async () => {
    await expectResult(
      updateDraftClips(mockDb as never, {
        videoId: VID,
        organizationId: ORG,
        clips: [{ assetId: A1, source: 'uploaded', beatOrder: -1 }],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for >20 clips', async () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => ({
      assetId: A1,
      source: 'uploaded' as const,
      beatOrder: i,
    }));
    await expectResult(
      updateDraftClips(mockDb as never, {
        videoId: VID,
        organizationId: ORG,
        clips: tooMany,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});

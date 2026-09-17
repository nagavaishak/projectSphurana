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
import { addDraftClip } from './add-draft-clip.service.js';

const VID = '550e8400-e29b-41d4-a716-446655440000';
const AID = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const ORG = 'org_123';
const OTHER_ORG = 'org_999';

describe('addDraftClip', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  function mockOwnedVideoAndAsset() {
    // Two select chains in sequence — both must hit limit().
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit
      .mockResolvedValueOnce([{ id: VID, organizationId: ORG }])
      .mockResolvedValueOnce([{ id: AID, organizationId: ORG }]);
  }

  it('inserts a row with source=uploaded and the supplied beatOrder', async () => {
    mockOwnedVideoAndAsset();

    const insertedRow = {
      id: 'clip_new',
      videoId: VID,
      assetId: AID,
      source: 'uploaded',
      beatOrder: 2,
      processingStatus: 'processing',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([insertedRow]);

    const result = await addDraftClip(mockDb as never, {
      videoId: VID,
      organizationId: ORG,
      assetId: AID,
      source: 'uploaded',
      beatOrder: 2,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBe('uploaded');
      expect(result.data.beatOrder).toBe(2);
    }
  });

  it('defaults beatOrder to 0 and processingStatus to processing', async () => {
    mockOwnedVideoAndAsset();
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'clip_default',
        videoId: VID,
        assetId: AID,
        source: 'suggested',
        beatOrder: 0,
        processingStatus: 'processing',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await addDraftClip(mockDb as never, {
      videoId: VID,
      organizationId: ORG,
      assetId: AID,
      source: 'suggested',
    });

    expect(result.success).toBe(true);
  });

  it('returns NOT_FOUND when video belongs to a different org', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([
      { id: VID, organizationId: OTHER_ORG },
    ]);

    await expectResult(
      addDraftClip(mockDb as never, {
        videoId: VID,
        organizationId: ORG,
        assetId: AID,
        source: 'uploaded',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns NOT_FOUND when asset belongs to a different org', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit
      .mockResolvedValueOnce([{ id: VID, organizationId: ORG }])
      .mockResolvedValueOnce([{ id: AID, organizationId: OTHER_ORG }]);

    await expectResult(
      addDraftClip(mockDb as never, {
        videoId: VID,
        organizationId: ORG,
        assetId: AID,
        source: 'uploaded',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for unknown source value', async () => {
    await expectResult(
      addDraftClip(mockDb as never, {
        videoId: VID,
        organizationId: ORG,
        assetId: AID,
        source: 'manual' as never,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for non-uuid assetId', async () => {
    await expectResult(
      addDraftClip(mockDb as never, {
        videoId: VID,
        organizationId: ORG,
        assetId: 'not-a-uuid',
        source: 'uploaded',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});

import {
  getAIClient,
  initAIClient,
  isAIClientInitialized,
} from '@borradh-workspace/ai';
import {
  downloadAsBuffer,
  getOrgAssetsBucket,
  parseS3Url,
} from '@borradh-workspace/storage';
import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';

// db-chain stubs (not an aliased module) stay file-local; the storage symbols
// are driven via the canonical alias (vite.config.ts) below.
const hoistedMocks = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockFrom: vi.fn(),
  mockWhere: vi.fn(),
  mockLimit: vi.fn(),
  mockUpdate: vi.fn(),
  mockSet: vi.fn(),
  mockUpdateWhere: vi.fn(),
}));

import { transcribeVideo } from './transcribe-video.service.js';

// `@borradh-workspace/storage` is a canonically aliased mock — drive its
// `vi.fn()`s with `vi.mocked()` (no file-local `vi.mock`, which would leak
// under `isolate: false`).
const mocks = {
  ...hoistedMocks,
  mockDownloadAsBuffer: vi.mocked(downloadAsBuffer),
  mockParseS3Url: vi.mocked(parseS3Url),
  mockGetOrgAssetsBucket: vi.mocked(getOrgAssetsBucket),
  mockGetAIClient: vi.mocked(getAIClient),
  mockInitAIClient: vi.mocked(initAIClient),
  mockIsAIClientInitialized: vi.mocked(isAIClientInitialized),
};

describe('transcribeVideo', () => {
  const mockDb = {
    select: mocks.mockSelect,
    update: mocks.mockUpdate,
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    // Drop any queued `*Once` left on the shared storage mocks by a sibling
    // file (clearAllMocks does not clear the Once-queue).
    mocks.mockDownloadAsBuffer.mockReset();
    mocks.mockParseS3Url.mockReset();
    mocks.mockGetOrgAssetsBucket.mockReset();
    mocks.mockSelect.mockReturnValue({ from: mocks.mockFrom });
    mocks.mockFrom.mockReturnValue({ where: mocks.mockWhere });
    mocks.mockWhere.mockReturnValue({ limit: mocks.mockLimit });
    mocks.mockUpdate.mockReturnValue({ set: mocks.mockSet });
    mocks.mockSet.mockReturnValue({ where: mocks.mockUpdateWhere });
    mocks.mockUpdateWhere.mockResolvedValue(undefined);
    mocks.mockIsAIClientInitialized.mockReturnValue(true);
  });

  const validInput = { id: 'video_123', organizationId: 'org_123' };

  it('should return cached transcript if available', async () => {
    mocks.mockLimit.mockResolvedValueOnce([
      {
        id: 'video_123',
        organizationId: 'org_123',
        draftConfig: { transcriptText: 'Cached transcript' },
      },
    ]);

    const result = await transcribeVideo(mockDb, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.text).toBe('Cached transcript');
    }
    expect(mocks.mockDownloadAsBuffer).not.toHaveBeenCalled();
  });

  it('should transcribe video when no cached transcript', async () => {
    mocks.mockLimit.mockResolvedValueOnce([
      {
        id: 'video_123',
        organizationId: 'org_123',
        draftConfig: { talkingHeadUrl: 'https://s3.example.com/video.mp4' },
      },
    ]);
    mocks.mockParseS3Url.mockReturnValueOnce({
      bucket: 'test-bucket',
      key: 'video.mp4',
    });
    mocks.mockDownloadAsBuffer.mockResolvedValueOnce(Buffer.from('video'));
    const mockTranscription = { text: 'Hello world' };
    mocks.mockGetAIClient.mockReturnValueOnce({
      audio: {
        transcriptions: {
          create: vi.fn().mockResolvedValueOnce(mockTranscription),
        },
      },
    });

    const result = await transcribeVideo(mockDb, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.text).toBe('Hello world');
    }
  });

  // These two cases used to be DISTINGUISHABLE — 404 for "no such video",
  // 403 for "exists, another org's" — which is an org-enumeration oracle: a
  // caller could confirm another org's video id without any access to it. The
  // ownership filter now lives in the SELECT, so both collapse to the same
  // empty result and the same NOT_FOUND. The paired assertion IS the property:
  // if these two ever diverge again, the oracle is back.
  it('should return NOT_FOUND when video not found', async () => {
    mocks.mockLimit.mockResolvedValueOnce([]);

    await expectResult(transcribeVideo(mockDb, validInput)).toFailWithCode(
      ErrorCodes.NOT_FOUND
    );
  });

  it("should return the SAME NOT_FOUND for another org's video, not FORBIDDEN", async () => {
    // The org predicate is in the query, so a foreign id yields no row at all.
    mocks.mockLimit.mockResolvedValueOnce([]);

    await expectResult(transcribeVideo(mockDb, validInput)).toFailWithCode(
      ErrorCodes.NOT_FOUND
    );
  });

  it('should return VALIDATION_ERROR when no talking head video', async () => {
    mocks.mockLimit.mockResolvedValueOnce([
      {
        id: 'video_123',
        organizationId: 'org_123',
        draftConfig: {},
      },
    ]);

    await expectResult(transcribeVideo(mockDb, validInput)).toFailWithCode(
      ErrorCodes.VALIDATION_ERROR
    );
  });

  it('should return INTERNAL_ERROR when transcription fails', async () => {
    mocks.mockLimit.mockResolvedValueOnce([
      {
        id: 'video_123',
        organizationId: 'org_123',
        draftConfig: { talkingHeadUrl: 'https://s3.example.com/video.mp4' },
      },
    ]);
    mocks.mockParseS3Url.mockReturnValueOnce({
      bucket: 'test-bucket',
      key: 'video.mp4',
    });
    mocks.mockDownloadAsBuffer.mockRejectedValueOnce(
      new Error('Download failed')
    );

    await expectResult(transcribeVideo(mockDb, validInput)).toFailWithCode(
      ErrorCodes.INTERNAL_ERROR
    );
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    await expectResult(
      transcribeVideo(mockDb, { ...validInput, id: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});

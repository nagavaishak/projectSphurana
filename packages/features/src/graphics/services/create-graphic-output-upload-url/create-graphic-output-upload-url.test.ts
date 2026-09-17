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
import { createGraphicOutputUploadUrl } from './create-graphic-output-upload-url.service.js';
import type { CreateGraphicOutputUploadUrlStorageDeps } from './create-graphic-output-upload-url.service.js';

describe('createGraphicOutputUploadUrl', () => {
  const mockDb = createMockDatabase();

  let storage: CreateGraphicOutputUploadUrlStorageDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    storage = {
      getOrgAssetsBucket: vi.fn().mockReturnValue('org-assets-test'),
      getPresignedUploadUrl: vi
        .fn()
        .mockResolvedValue('https://s3.amazonaws.com/signed-url'),
    };
  });

  const validInput = {
    id: 'graphic_123',
    organizationId: 'org_123',
    slideId: 'slide_1',
    format: 'png' as const,
    width: 1080,
    height: 1080,
    contentLength: 500_000,
  };

  it('returns a signed upload URL + object key scoped to the org and graphic', async () => {
    mockDb.query.graphic.findFirst.mockResolvedValueOnce({
      id: 'graphic_123',
    });

    const result = await createGraphicOutputUploadUrl(
      mockDb as never,
      storage,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.uploadUrl).toBe('https://s3.amazonaws.com/signed-url');
      expect(result.data.bucket).toBe('org-assets-test');
      expect(result.data.contentType).toBe('image/png');
      expect(result.data.objectKey).toMatch(
        /^org_123\/graphics\/graphic_123\/slide_1-\d+-[0-9a-f]+\.png$/
      );
      // expiry should be in the future
      expect(new Date(result.data.expiresAt).getTime()).toBeGreaterThan(
        Date.now()
      );
    }
    expect(storage.getPresignedUploadUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'org-assets-test',
        contentType: 'image/png',
        expiresIn: 300,
      })
    );
  });

  it('returns NOT_FOUND when the graphic does not exist', async () => {
    mockDb.query.graphic.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      createGraphicOutputUploadUrl(mockDb as never, storage, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR when contentLength exceeds the cap', async () => {
    await expectResult(
      createGraphicOutputUploadUrl(mockDb as never, storage, {
        ...validInput,
        contentLength: 100 * 1024 * 1024, // 100 MB — over the 20 MB cap
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for unsupported format', async () => {
    await expectResult(
      createGraphicOutputUploadUrl(mockDb as never, storage, {
        ...validInput,
        // @ts-expect-error - testing runtime validation
        format: 'gif',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR when signing fails', async () => {
    mockDb.query.graphic.findFirst.mockResolvedValueOnce({
      id: 'graphic_123',
    });
    (
      storage.getPresignedUploadUrl as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error('KMS down'));

    await expectResult(
      createGraphicOutputUploadUrl(mockDb as never, storage, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});

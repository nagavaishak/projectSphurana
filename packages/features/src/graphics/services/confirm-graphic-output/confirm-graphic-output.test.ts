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
import { confirmGraphicOutput } from './confirm-graphic-output.service.js';
import type { ConfirmGraphicOutputStorageDeps } from './confirm-graphic-output.service.js';

describe('confirmGraphicOutput', () => {
  const mockDb = createMockDatabase();

  let storage: ConfirmGraphicOutputStorageDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    storage = {
      getOrgAssetsBucket: vi.fn().mockReturnValue('org-assets-test'),
      getPrivateCdnUrl: vi
        .fn()
        .mockImplementation((key: string) => `https://cdn.example.com/${key}`),
      isCdnEnabled: vi.fn().mockReturnValue(true),
    };
  });

  const validInput = {
    id: 'graphic_123',
    organizationId: 'org_123',
    objectKey: 'org_123/graphics/graphic_123/slide_1-123-abc.png',
    slideId: 'slide_1',
    slideOrder: 0,
    format: 'png' as const,
    width: 1080,
    height: 1080,
  };

  it('appends a new output to the graphic and returns it', async () => {
    mockDb.query.graphic.findFirst.mockResolvedValueOnce({
      id: 'graphic_123',
      outputs: null,
    });
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            {
              outputs: [
                {
                  objectKey: validInput.objectKey,
                  url: `https://cdn.example.com/${validInput.objectKey}`,
                  format: 'png',
                  width: 1080,
                  height: 1080,
                  slideId: 'slide_1',
                  slideOrder: 0,
                  aspectRatioId: 'canvas',
                  platform: 'web',
                  renderedBy: 'client',
                  renderedAt: new Date().toISOString(),
                },
              ],
            },
          ]),
        }),
      }),
    });

    const result = await confirmGraphicOutput(
      mockDb as never,
      storage,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.output.objectKey).toBe(validInput.objectKey);
      expect(result.data.output.url).toBe(
        `https://cdn.example.com/${validInput.objectKey}`
      );
      expect(result.data.output.renderedBy).toBe('client');
    }
  });

  it('uses the S3 virtual-hosted URL when CDN is not enabled', async () => {
    (storage.isCdnEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
    mockDb.query.graphic.findFirst.mockResolvedValueOnce({
      id: 'graphic_123',
      outputs: [],
    });
    const returning = vi.fn().mockResolvedValue([{ outputs: [] }]);
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ returning }),
      }),
    });

    const result = await confirmGraphicOutput(
      mockDb as never,
      storage,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.output.url).toBe(
        `https://org-assets-test.s3.amazonaws.com/${validInput.objectKey}`
      );
    }
  });

  it('returns VALIDATION_ERROR when objectKey does not match graphic prefix', async () => {
    await expectResult(
      confirmGraphicOutput(mockDb as never, storage, {
        ...validInput,
        objectKey: 'someone_else/graphics/evil/file.png',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns NOT_FOUND when the graphic does not exist', async () => {
    mockDb.query.graphic.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      confirmGraphicOutput(mockDb as never, storage, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns ALREADY_EXISTS when the same objectKey is confirmed twice', async () => {
    mockDb.query.graphic.findFirst.mockResolvedValueOnce({
      id: 'graphic_123',
      outputs: [{ objectKey: validInput.objectKey, url: 'x', format: 'png' }],
    });

    await expectResult(
      confirmGraphicOutput(mockDb as never, storage, validInput)
    ).toFailWithCode(ErrorCodes.ALREADY_EXISTS);
  });

  it('returns INTERNAL_ERROR when the DB update throws', async () => {
    mockDb.query.graphic.findFirst.mockResolvedValueOnce({
      id: 'graphic_123',
      outputs: [],
    });
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockRejectedValue(new Error('DB down')),
        }),
      }),
    });

    await expectResult(
      confirmGraphicOutput(mockDb as never, storage, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});

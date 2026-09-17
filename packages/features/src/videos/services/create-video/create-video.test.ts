import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';

// `selectRandomVariationForTemplate` is spied (not `vi.mock`'d) so the REAL
// templates barrel is restored after this file. Under `isolate: false` a
// file-local `vi.mock` of this internal barrel would persist on the shared
// worker graph and DELETE every export the factory omitted (`getVariationById`,
// `CONTENT_IDEA_TEMPLATES`, …) for every later test file. The spy handle is
// restored in `afterEach` — we restore it specifically rather than calling
// `vi.restoreAllMocks()`, which would also wipe the canonical boundary mocks.
import * as videoTemplates from '../../templates/index.js';
import { createVideo } from './create-video.service.js';

describe('createVideo', () => {
  const mockDb = createMockDatabase();
  let mockSelectRandom: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // Reset returning mock implementation to ensure clean state
    mockDb.returning.mockReset();
    mockDb.returning.mockResolvedValue([]);
    // Default: no variation, matching the previous factory's `null` default.
    mockSelectRandom = (
      vi.spyOn(
        videoTemplates,
        'selectRandomVariationForTemplate'
      ) as MockInstance
    ).mockReturnValue(null);
  });

  afterEach(() => {
    mockSelectRandom.mockRestore();
  });

  const validDraftConfig = {
    bRollClips: [],
    captions: {
      enabled: true,
      position: 'bottom' as const,
      fontFamily: 'Arial',
      fontSize: 24,
      textColor: '#FFFFFF',
      highlightColor: '#FFFF00',
      backgroundColor: '#000000',
      showBackground: true,
    },
    musicVolume: 0.5,
    outro: {
      businessName: 'Test Business',
      ctaText: 'Visit us today!',
      backgroundOpacity: 0.8,
      backgroundColor: '#000000',
      textColor: '#FFFFFF',
      durationSec: 5,
    },
    orientation: 'portrait' as const,
  };

  const validInput = {
    title: 'Test Video',
    templateId: 'template_123',
    draftConfig: validDraftConfig,
    organizationId: 'org_123',
    createdById: 'user_123',
  };

  it('should create video with valid input', async () => {
    const createdVideo = {
      id: 'video_123',
      ...validInput,
      status: 'draft',
      progress: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([createdVideo]);

    const result = await createVideo(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Test Video');
      expect(result.data.status).toBe('draft');
      expect(result.data.progress).toBe(0);
    }
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should create video with default status as draft', async () => {
    const createdVideo = {
      id: 'video_123',
      ...validInput,
      status: 'draft',
      progress: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([createdVideo]);

    const result = await createVideo(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('draft');
    }
  });

  it('should create video with talking head config', async () => {
    const inputWithTalkingHead = {
      ...validInput,
      draftConfig: {
        ...validDraftConfig,
        talkingHeadAssetId: 'asset_123',
        talkingHeadUrl: 'https://example.com/talking-head.mp4',
      },
    };

    const createdVideo = {
      id: 'video_123',
      ...inputWithTalkingHead,
      status: 'draft',
      progress: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([createdVideo]);

    const result = await createVideo(mockDb as never, inputWithTalkingHead);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.draftConfig.talkingHeadAssetId).toBe('asset_123');
    }
  });

  it('should create video without templateId', async () => {
    const inputWithoutTemplate = {
      title: 'Test Video',
      draftConfig: validDraftConfig,
      organizationId: 'org_123',
      createdById: 'user_123',
    };

    const createdVideo = {
      id: 'video_123',
      ...inputWithoutTemplate,
      status: 'draft',
      progress: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([createdVideo]);

    const result = await createVideo(mockDb as never, inputWithoutTemplate);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Test Video');
    }
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing title', async () => {
    const invalidInput = {
      templateId: 'template_123',
      draftConfig: validDraftConfig,
      organizationId: 'org_123',
      createdById: 'user_123',
    };

    await expectResult(
      createVideo(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      title: 'Test Video',
      templateId: 'template_123',
      draftConfig: validDraftConfig,
      createdById: 'user_123',
    };

    await expectResult(
      createVideo(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing createdById', async () => {
    const invalidInput = {
      title: 'Test Video',
      templateId: 'template_123',
      draftConfig: validDraftConfig,
      organizationId: 'org_123',
    };

    await expectResult(
      createVideo(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for invalid draftConfig', async () => {
    const invalidInput = {
      title: 'Test Video',
      templateId: 'template_123',
      draftConfig: {
        // Missing required fields: bRollClips, captions, outro, orientation, musicVolume
        hook: 'some hook',
      },
      organizationId: 'org_123',
      createdById: 'user_123',
    };

    await expectResult(
      createVideo(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return INTERNAL_ERROR on database insert failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await createVideo(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(result.error.message).toBe('Failed to create video');
    }
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for title exceeding 100 characters', async () => {
    const invalidInput = {
      ...validInput,
      title: 'A'.repeat(101),
    };

    await expectResult(
      createVideo(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should accept title with exactly 100 characters', async () => {
    const input = {
      ...validInput,
      title: 'A'.repeat(100),
    };

    const createdVideo = {
      id: 'video_123',
      ...input,
      status: 'draft',
      progress: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([createdVideo]);

    const result = await createVideo(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('A'.repeat(100));
    }
  });

  it('should auto-select variation when variationId not provided but templateId is', async () => {
    mockSelectRandom.mockReturnValueOnce({
      template: { id: 'template_123' },
      variation: { id: 'auto_variation_456' },
    });

    const inputWithTemplate = {
      title: 'Test Video',
      templateId: 'template_123',
      draftConfig: validDraftConfig,
      organizationId: 'org_123',
      createdById: 'user_123',
    };

    const createdVideo = {
      id: 'video_123',
      ...inputWithTemplate,
      variationId: 'auto_variation_456',
      status: 'draft',
      progress: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([createdVideo]);

    const result = await createVideo(mockDb as never, inputWithTemplate);

    expect(result.success).toBe(true);
    expect(mockSelectRandom).toHaveBeenCalledWith('template_123');
  });

  it('should proceed without variation when template has no variations', async () => {
    mockSelectRandom.mockReturnValueOnce(null);

    const inputNoVariation = {
      title: 'Test Video',
      templateId: 'template_no_variations',
      draftConfig: validDraftConfig,
      organizationId: 'org_123',
      createdById: 'user_123',
    };

    const createdVideo = {
      id: 'video_123',
      ...inputNoVariation,
      variationId: undefined,
      status: 'draft',
      progress: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([createdVideo]);

    const result = await createVideo(mockDb as never, inputNoVariation);

    expect(result.success).toBe(true);
    expect(mockSelectRandom).toHaveBeenCalledWith('template_no_variations');
  });
});

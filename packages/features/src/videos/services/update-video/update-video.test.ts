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
import { updateVideo } from './update-video.service.js';

describe('updateVideo', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // Reset returning mock implementation to ensure clean state
    mockDb.returning.mockReset();
    mockDb.returning.mockResolvedValue([]);
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
    id: 'video_123',
    title: 'Updated Title',
  };

  it('should update video with valid input', async () => {
    const updatedVideo = {
      id: 'video_123',
      title: 'Updated Title',
      status: 'draft',
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([updatedVideo]);

    const result = await updateVideo(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Updated Title');
    }
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should update multiple fields', async () => {
    const multiFieldInput = {
      id: 'video_123',
      title: 'New Title',
      draftConfig: {
        ...validDraftConfig,
        musicVolume: 0.8,
        captions: {
          ...validDraftConfig.captions,
          position: 'top' as const,
        },
      },
    };

    const updatedVideo = {
      id: 'video_123',
      ...multiFieldInput,
      status: 'draft',
      updatedAt: new Date(),
    };

    // First .limit() call: fetching existing draftConfig for deep merge
    mockDb.limit.mockResolvedValueOnce([{ draftConfig: validDraftConfig }]);
    // .returning() call: the actual update result
    mockDb.returning.mockResolvedValueOnce([updatedVideo]);

    const result = await updateVideo(mockDb as never, multiFieldInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('New Title');
      expect(result.data.draftConfig?.captions.position).toBe('top');
      expect(result.data.draftConfig?.musicVolume).toBe(0.8);
    }
  });

  it('should return current video when no changes provided', async () => {
    const currentVideo = {
      id: 'video_123',
      title: 'Original Title',
      status: 'draft',
    };

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValueOnce([currentVideo]);

    const result = await updateVideo(mockDb as never, { id: 'video_123' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Original Title');
    }
    // Should not call update if no changes
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should update status field', async () => {
    const updatedVideo = {
      id: 'video_123',
      status: 'ready',
      progress: 100,
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([updatedVideo]);

    const result = await updateVideo(mockDb as never, {
      id: 'video_123',
      status: 'ready',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('ready');
    }
  });

  it('should update progress field', async () => {
    const updatedVideo = {
      id: 'video_123',
      progress: 75,
      status: 'processing',
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([updatedVideo]);

    const result = await updateVideo(mockDb as never, {
      id: 'video_123',
      progress: 75,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.progress).toBe(75);
    }
  });

  it('should update blob URL and thumbnail', async () => {
    const updatedVideo = {
      id: 'video_123',
      blobUrl: 'https://example.com/video.mp4',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      status: 'ready',
      updatedAt: new Date(),
    };

    mockDb.returning.mockResolvedValueOnce([updatedVideo]);

    const result = await updateVideo(mockDb as never, {
      id: 'video_123',
      blobUrl: 'https://example.com/video.mp4',
      thumbnailUrl: 'https://example.com/thumb.jpg',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.blobUrl).toBe('https://example.com/video.mp4');
      expect(result.data.thumbnailUrl).toBe('https://example.com/thumb.jpg');
    }
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = {
      title: 'New Title',
    };

    await expectResult(
      updateVideo(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for invalid status', async () => {
    const invalidInput = {
      id: 'video_123',
      status: 'completed',
    };

    await expectResult(
      updateVideo(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.update).not.toHaveBeenCalled();
  });
});

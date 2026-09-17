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
import { updateVideoStage } from './update-video-stage.service.js';

describe('updateVideoStage', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockDb.returning.mockReset();
    mockDb.returning.mockResolvedValue([]);
  });

  const validInput = {
    videoId: 'video_123',
    stage: 'rendering' as const,
  };

  it('should update video processing stage', async () => {
    const updatedVideo = {
      id: 'video_123',
      status: 'processing',
      processingStage: 'rendering',
      stageStartedAt: new Date(),
    };
    mockDb.returning.mockResolvedValueOnce([updatedVideo]);

    const result = await updateVideoStage(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processingStage).toBe('rendering');
      expect(result.data.stageStartedAt).toBeDefined();
    }
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should update to downloading stage', async () => {
    const updatedVideo = {
      id: 'video_123',
      status: 'processing',
      processingStage: 'downloading',
      stageStartedAt: new Date(),
    };
    mockDb.returning.mockResolvedValueOnce([updatedVideo]);

    const result = await updateVideoStage(mockDb as never, {
      videoId: 'video_123',
      stage: 'downloading',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processingStage).toBe('downloading');
    }
  });

  it('should update to transcribing stage', async () => {
    const updatedVideo = {
      id: 'video_123',
      status: 'processing',
      processingStage: 'transcribing',
      stageStartedAt: new Date(),
    };
    mockDb.returning.mockResolvedValueOnce([updatedVideo]);

    const result = await updateVideoStage(mockDb as never, {
      videoId: 'video_123',
      stage: 'transcribing',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processingStage).toBe('transcribing');
    }
  });

  it('should update to building_captions stage', async () => {
    const updatedVideo = {
      id: 'video_123',
      status: 'processing',
      processingStage: 'building_captions',
      stageStartedAt: new Date(),
    };
    mockDb.returning.mockResolvedValueOnce([updatedVideo]);

    const result = await updateVideoStage(mockDb as never, {
      videoId: 'video_123',
      stage: 'building_captions',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processingStage).toBe('building_captions');
    }
  });

  it('should return NOT_FOUND when video does not exist', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      updateVideoStage(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR for missing videoId', async () => {
    await expectResult(
      updateVideoStage(mockDb as never, { stage: 'rendering' } as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty videoId', async () => {
    await expectResult(
      updateVideoStage(mockDb as never, {
        videoId: '',
        stage: 'rendering' as const,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid stage', async () => {
    await expectResult(
      updateVideoStage(
        mockDb as never,
        { videoId: 'video_123', stage: 'invalid_stage' } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing stage', async () => {
    await expectResult(
      updateVideoStage(mockDb as never, { videoId: 'video_123' } as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});

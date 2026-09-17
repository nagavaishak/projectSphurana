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
import { TrainingHubErrorCodes } from '../../models/index.js';
import { updateVideoProgress } from './update-video-progress.service.js';

describe('updateVideoProgress', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    userId: 'user_123',
    trainingVideoId: 'video_123',
    watchedSeconds: 60,
  };

  it('should create new progress record when none exists', async () => {
    const video = {
      id: 'video_123',
      title: 'Test Video',
      durationSeconds: 300,
      isPublished: true,
    };

    const createdProgress = {
      id: 'uvp_123',
      userId: 'user_123',
      trainingVideoId: 'video_123',
      watchedSeconds: 60,
      isCompleted: false,
    };

    mockDb.query.trainingVideo.findFirst.mockResolvedValueOnce(video);
    mockDb.query.userVideoProgress.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([createdProgress]);

    const result = await updateVideoProgress(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.watchedSeconds).toBe(60);
      expect(result.data.isCompleted).toBe(false);
    }
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should update existing progress with higher value', async () => {
    const video = {
      id: 'video_123',
      isPublished: true,
    };

    const existingProgress = {
      id: 'uvp_123',
      userId: 'user_123',
      trainingVideoId: 'video_123',
      watchedSeconds: 30,
      isCompleted: false,
    };

    const updatedProgress = {
      ...existingProgress,
      watchedSeconds: 60,
    };

    mockDb.query.trainingVideo.findFirst.mockResolvedValueOnce(video);
    mockDb.query.userVideoProgress.findFirst.mockResolvedValueOnce(
      existingProgress
    );
    mockDb.returning.mockResolvedValueOnce([updatedProgress]);

    const result = await updateVideoProgress(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.watchedSeconds).toBe(60);
    }
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should keep existing value when new value is lower', async () => {
    const video = {
      id: 'video_123',
      isPublished: true,
    };

    const existingProgress = {
      id: 'uvp_123',
      userId: 'user_123',
      trainingVideoId: 'video_123',
      watchedSeconds: 120, // Higher than input
      isCompleted: false,
    };

    const updatedProgress = {
      ...existingProgress,
      watchedSeconds: 120, // Keeps the higher value
    };

    mockDb.query.trainingVideo.findFirst.mockResolvedValueOnce(video);
    mockDb.query.userVideoProgress.findFirst.mockResolvedValueOnce(
      existingProgress
    );
    mockDb.returning.mockResolvedValueOnce([updatedProgress]);

    const result = await updateVideoProgress(mockDb as never, {
      ...validInput,
      watchedSeconds: 60, // Lower than existing
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.watchedSeconds).toBe(120); // Should keep existing higher value
    }
  });

  it('should not change isCompleted status', async () => {
    const video = {
      id: 'video_123',
      isPublished: true,
    };

    const createdProgress = {
      id: 'uvp_123',
      userId: 'user_123',
      trainingVideoId: 'video_123',
      watchedSeconds: 60,
      isCompleted: false, // Remains false
    };

    mockDb.query.trainingVideo.findFirst.mockResolvedValueOnce(video);
    mockDb.query.userVideoProgress.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([createdProgress]);

    const result = await updateVideoProgress(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isCompleted).toBe(false);
    }
  });

  it('should return VIDEO_NOT_FOUND when video does not exist', async () => {
    mockDb.query.trainingVideo.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      updateVideoProgress(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(TrainingHubErrorCodes.VIDEO_NOT_FOUND);
      expect(error.message).toBe('Training video not found');
    });

    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return VIDEO_NOT_FOUND for unpublished video', async () => {
    mockDb.query.trainingVideo.findFirst.mockResolvedValueOnce(null);

    const result = await updateVideoProgress(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(TrainingHubErrorCodes.VIDEO_NOT_FOUND);
    }
  });

  it('should return VALIDATION_ERROR for missing userId', async () => {
    const invalidInput = {
      trainingVideoId: 'video_123',
      watchedSeconds: 60,
    };

    await expectResult(
      updateVideoProgress(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing trainingVideoId', async () => {
    const invalidInput = {
      userId: 'user_123',
      watchedSeconds: 60,
    };

    await expectResult(
      updateVideoProgress(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing watchedSeconds', async () => {
    const invalidInput = {
      userId: 'user_123',
      trainingVideoId: 'video_123',
    };

    await expectResult(
      updateVideoProgress(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for negative watchedSeconds', async () => {
    const invalidInput = {
      ...validInput,
      watchedSeconds: -10,
    };

    await expectResult(
      updateVideoProgress(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});

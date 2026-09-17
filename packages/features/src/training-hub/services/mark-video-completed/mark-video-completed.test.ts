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
import { markVideoCompleted } from './mark-video-completed.service.js';

describe('markVideoCompleted', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    userId: 'user_123',
    trainingVideoId: 'video_123',
  };

  it('should create completed progress when no existing progress', async () => {
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
      watchedSeconds: 300,
      isCompleted: true,
      completedAt: new Date(),
    };

    mockDb.query.trainingVideo.findFirst.mockResolvedValueOnce(video);
    mockDb.query.userVideoProgress.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([createdProgress]);

    const result = await markVideoCompleted(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isCompleted).toBe(true);
      expect(result.data.watchedSeconds).toBe(300);
      expect(result.data.completedAt).toBeDefined();
    }
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should update existing progress to completed', async () => {
    const video = {
      id: 'video_123',
      title: 'Test Video',
      durationSeconds: 300,
      isPublished: true,
    };

    const existingProgress = {
      id: 'uvp_123',
      userId: 'user_123',
      trainingVideoId: 'video_123',
      watchedSeconds: 150,
      isCompleted: false,
    };

    const updatedProgress = {
      ...existingProgress,
      watchedSeconds: 300,
      isCompleted: true,
      completedAt: new Date(),
    };

    mockDb.query.trainingVideo.findFirst.mockResolvedValueOnce(video);
    mockDb.query.userVideoProgress.findFirst.mockResolvedValueOnce(
      existingProgress
    );
    mockDb.returning.mockResolvedValueOnce([updatedProgress]);

    const result = await markVideoCompleted(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isCompleted).toBe(true);
      expect(result.data.watchedSeconds).toBe(300);
    }
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should preserve existing completedAt when already set', async () => {
    const originalCompletedAt = new Date('2024-01-01');
    const video = {
      id: 'video_123',
      durationSeconds: 300,
      isPublished: true,
    };

    const existingProgress = {
      id: 'uvp_123',
      userId: 'user_123',
      trainingVideoId: 'video_123',
      watchedSeconds: 200,
      isCompleted: false,
      completedAt: originalCompletedAt,
    };

    const updatedProgress = {
      ...existingProgress,
      isCompleted: true,
      completedAt: originalCompletedAt, // Should preserve original
    };

    mockDb.query.trainingVideo.findFirst.mockResolvedValueOnce(video);
    mockDb.query.userVideoProgress.findFirst.mockResolvedValueOnce(
      existingProgress
    );
    mockDb.returning.mockResolvedValueOnce([updatedProgress]);

    const result = await markVideoCompleted(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.completedAt).toEqual(originalCompletedAt);
    }
  });

  it('should use video duration for watchedSeconds when available', async () => {
    const video = {
      id: 'video_123',
      durationSeconds: 600, // 10 minutes
      isPublished: true,
    };

    const createdProgress = {
      id: 'uvp_123',
      userId: 'user_123',
      trainingVideoId: 'video_123',
      watchedSeconds: 600,
      isCompleted: true,
      completedAt: new Date(),
    };

    mockDb.query.trainingVideo.findFirst.mockResolvedValueOnce(video);
    mockDb.query.userVideoProgress.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([createdProgress]);

    const result = await markVideoCompleted(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.watchedSeconds).toBe(600);
    }
  });

  it('should return VIDEO_NOT_FOUND when video does not exist', async () => {
    mockDb.query.trainingVideo.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      markVideoCompleted(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(TrainingHubErrorCodes.VIDEO_NOT_FOUND);
      expect(error.message).toBe('Training video not found');
    });

    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return VIDEO_NOT_FOUND for unpublished video', async () => {
    mockDb.query.trainingVideo.findFirst.mockResolvedValueOnce(null);

    const result = await markVideoCompleted(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(TrainingHubErrorCodes.VIDEO_NOT_FOUND);
    }
  });

  it('should return VALIDATION_ERROR for missing userId', async () => {
    const invalidInput = { trainingVideoId: 'video_123' };

    await expectResult(
      markVideoCompleted(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing trainingVideoId', async () => {
    const invalidInput = { userId: 'user_123' };

    await expectResult(
      markVideoCompleted(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});

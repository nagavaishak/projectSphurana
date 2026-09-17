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
import { getTrainingVideo } from './get-training-video.service.js';

describe('getTrainingVideo', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    userId: 'user_123',
    trainingVideoId: 'video_123',
  };

  it('should return training video with user progress', async () => {
    const video = {
      id: 'video_123',
      title: 'Getting Started',
      description: 'Introduction to the platform',
      category: 'getting-started',
      videoUrl: 'https://example.com/video.mp4',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      durationSeconds: 300,
      sortOrder: 1,
      isPublished: true,
    };

    const progress = {
      id: 'progress_123',
      userId: 'user_123',
      trainingVideoId: 'video_123',
      watchedSeconds: 150,
      isCompleted: false,
    };

    mockDb.query.trainingVideo.findFirst.mockResolvedValueOnce(video);
    mockDb.query.userVideoProgress.findFirst.mockResolvedValueOnce(progress);

    const result = await getTrainingVideo(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('video_123');
      expect(result.data.title).toBe('Getting Started');
      expect(result.data.progress).not.toBeNull();
      expect(result.data.progress?.watchedSeconds).toBe(150);
    }
  });

  it('should return video with null progress when user has not started', async () => {
    const video = {
      id: 'video_123',
      title: 'Getting Started',
      isPublished: true,
    };

    mockDb.query.trainingVideo.findFirst.mockResolvedValueOnce(video);
    mockDb.query.userVideoProgress.findFirst.mockResolvedValueOnce(null);

    const result = await getTrainingVideo(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('video_123');
      expect(result.data.progress).toBeNull();
    }
  });

  it('should return video with completed progress', async () => {
    const video = {
      id: 'video_123',
      title: 'Getting Started',
      isPublished: true,
      durationSeconds: 300,
    };

    const completedProgress = {
      id: 'progress_123',
      userId: 'user_123',
      trainingVideoId: 'video_123',
      watchedSeconds: 300,
      isCompleted: true,
      completedAt: new Date(),
    };

    mockDb.query.trainingVideo.findFirst.mockResolvedValueOnce(video);
    mockDb.query.userVideoProgress.findFirst.mockResolvedValueOnce(
      completedProgress
    );

    const result = await getTrainingVideo(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.progress?.isCompleted).toBe(true);
      expect(result.data.progress?.completedAt).toBeDefined();
    }
  });

  it('should return VIDEO_NOT_FOUND when video does not exist', async () => {
    mockDb.query.trainingVideo.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getTrainingVideo(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(TrainingHubErrorCodes.VIDEO_NOT_FOUND);
      expect(error.message).toBe('Training video not found');
    });
  });

  it('should return VIDEO_NOT_FOUND for unpublished video', async () => {
    // findFirst with isPublished filter returns null for unpublished
    mockDb.query.trainingVideo.findFirst.mockResolvedValueOnce(null);

    const result = await getTrainingVideo(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(TrainingHubErrorCodes.VIDEO_NOT_FOUND);
    }
  });

  it('should return VALIDATION_ERROR for missing userId', async () => {
    const invalidInput = { trainingVideoId: 'video_123' };

    await expectResult(
      getTrainingVideo(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing trainingVideoId', async () => {
    const invalidInput = { userId: 'user_123' };

    await expectResult(
      getTrainingVideo(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});

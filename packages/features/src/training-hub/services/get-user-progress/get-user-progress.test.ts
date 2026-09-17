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
import { getUserProgress } from './get-user-progress.service.js';

describe('getUserProgress', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    userId: 'user_123',
  };

  it('should return user progress summary', async () => {
    // Mock total videos count
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([{ count: 10 }]);

    // Mock user progress records
    const progressRecords = [
      { userId: 'user_123', trainingVideoId: 'video_1', isCompleted: true },
      { userId: 'user_123', trainingVideoId: 'video_2', isCompleted: true },
      { userId: 'user_123', trainingVideoId: 'video_3', isCompleted: false },
    ];
    mockDb.query.userVideoProgress.findMany.mockResolvedValueOnce(
      progressRecords
    );

    const result = await getUserProgress(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalVideos).toBe(10);
      expect(result.data.completedVideos).toBe(2);
      expect(result.data.progressPercentage).toBe(20);
    }
  });

  it('should return 0% progress when no videos completed', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([{ count: 5 }]);

    mockDb.query.userVideoProgress.findMany.mockResolvedValueOnce([]);

    const result = await getUserProgress(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalVideos).toBe(5);
      expect(result.data.completedVideos).toBe(0);
      expect(result.data.progressPercentage).toBe(0);
    }
  });

  it('should return 100% progress when all videos completed', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([{ count: 3 }]);

    const allCompleted = [
      { userId: 'user_123', trainingVideoId: 'video_1', isCompleted: true },
      { userId: 'user_123', trainingVideoId: 'video_2', isCompleted: true },
      { userId: 'user_123', trainingVideoId: 'video_3', isCompleted: true },
    ];
    mockDb.query.userVideoProgress.findMany.mockResolvedValueOnce(allCompleted);

    const result = await getUserProgress(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalVideos).toBe(3);
      expect(result.data.completedVideos).toBe(3);
      expect(result.data.progressPercentage).toBe(100);
    }
  });

  it('should return 0% when no videos exist', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([{ count: 0 }]);

    mockDb.query.userVideoProgress.findMany.mockResolvedValueOnce([]);

    const result = await getUserProgress(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalVideos).toBe(0);
      expect(result.data.completedVideos).toBe(0);
      expect(result.data.progressPercentage).toBe(0);
    }
  });

  it('should round progress percentage', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([{ count: 3 }]);

    const oneCompleted = [
      { userId: 'user_123', trainingVideoId: 'video_1', isCompleted: true },
    ];
    mockDb.query.userVideoProgress.findMany.mockResolvedValueOnce(oneCompleted);

    const result = await getUserProgress(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.progressPercentage).toBe(33); // 1/3 = 33.33, rounded to 33
    }
  });

  it('should only count completed videos', async () => {
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([{ count: 5 }]);

    // Mix of completed and in-progress
    const mixedProgress = [
      { userId: 'user_123', trainingVideoId: 'video_1', isCompleted: true },
      { userId: 'user_123', trainingVideoId: 'video_2', isCompleted: false },
      { userId: 'user_123', trainingVideoId: 'video_3', isCompleted: true },
      { userId: 'user_123', trainingVideoId: 'video_4', isCompleted: false },
    ];
    mockDb.query.userVideoProgress.findMany.mockResolvedValueOnce(
      mixedProgress
    );

    const result = await getUserProgress(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.completedVideos).toBe(2);
    }
  });

  it('should return VALIDATION_ERROR for missing userId', async () => {
    const invalidInput = {};

    await expectResult(
      getUserProgress(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});

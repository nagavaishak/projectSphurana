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
import { listTrainingVideos } from './list-training-videos.service.js';

describe('listTrainingVideos', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    userId: 'user_123',
  };

  it('should return videos grouped by category', async () => {
    const videos = [
      {
        id: 'video_1',
        title: 'Getting Started 1',
        category: 'getting-started',
        isPublished: true,
        sortOrder: 1,
      },
      {
        id: 'video_2',
        title: 'Getting Started 2',
        category: 'getting-started',
        isPublished: true,
        sortOrder: 2,
      },
      {
        id: 'video_3',
        title: 'Lead Management 101',
        category: 'lead-management',
        isPublished: true,
        sortOrder: 1,
      },
    ];

    const progressRecords = [
      { userId: 'user_123', trainingVideoId: 'video_1', isCompleted: true },
    ];

    mockDb.query.trainingVideo.findMany.mockResolvedValueOnce(videos);
    mockDb.query.userVideoProgress.findMany.mockResolvedValueOnce(
      progressRecords
    );

    const result = await listTrainingVideos(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBeGreaterThan(0);
      // Check that videos are grouped by category
      const gettingStarted = result.data.find(
        (g) => g.category === 'getting-started'
      );
      expect(gettingStarted).toBeDefined();
      expect(gettingStarted?.videos).toHaveLength(2);
    }
  });

  it('should return empty array when no published videos', async () => {
    mockDb.query.trainingVideo.findMany.mockResolvedValueOnce([]);
    mockDb.query.userVideoProgress.findMany.mockResolvedValueOnce([]);

    const result = await listTrainingVideos(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  it('should include user progress with each video', async () => {
    const videos = [
      {
        id: 'video_1',
        title: 'Test Video',
        category: 'getting-started',
        isPublished: true,
      },
    ];

    const progressRecords = [
      {
        userId: 'user_123',
        trainingVideoId: 'video_1',
        watchedSeconds: 120,
        isCompleted: false,
      },
    ];

    mockDb.query.trainingVideo.findMany.mockResolvedValueOnce(videos);
    mockDb.query.userVideoProgress.findMany.mockResolvedValueOnce(
      progressRecords
    );

    const result = await listTrainingVideos(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      const category = result.data[0];
      expect(category.videos[0].progress).not.toBeNull();
      expect(category.videos[0].progress?.watchedSeconds).toBe(120);
    }
  });

  it('should return null progress for videos not started', async () => {
    const videos = [
      {
        id: 'video_1',
        title: 'Test Video',
        category: 'getting-started',
        isPublished: true,
      },
    ];

    mockDb.query.trainingVideo.findMany.mockResolvedValueOnce(videos);
    mockDb.query.userVideoProgress.findMany.mockResolvedValueOnce([]);

    const result = await listTrainingVideos(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      const category = result.data[0];
      expect(category.videos[0].progress).toBeNull();
    }
  });

  it('should filter by category when provided', async () => {
    const videos = [
      {
        id: 'video_1',
        title: 'Lead Management 101',
        category: 'lead-management',
        isPublished: true,
      },
    ];

    mockDb.query.trainingVideo.findMany.mockResolvedValueOnce(videos);
    mockDb.query.userVideoProgress.findMany.mockResolvedValueOnce([]);

    const result = await listTrainingVideos(mockDb as never, {
      ...validInput,
      category: 'lead-management',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].category).toBe('lead-management');
    }
  });

  it('should include category labels', async () => {
    const videos = [
      {
        id: 'video_1',
        title: 'Getting Started',
        category: 'getting-started',
        isPublished: true,
      },
    ];

    mockDb.query.trainingVideo.findMany.mockResolvedValueOnce(videos);
    mockDb.query.userVideoProgress.findMany.mockResolvedValueOnce([]);

    const result = await listTrainingVideos(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0].categoryLabel).toBeDefined();
    }
  });

  it('should return VALIDATION_ERROR for missing userId', async () => {
    const invalidInput = {};

    await expectResult(
      listTrainingVideos(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});

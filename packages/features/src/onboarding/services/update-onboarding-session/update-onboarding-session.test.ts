import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { updateOnboardingSession } from './update-onboarding-session.service.js';

const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  returning: vi.fn(),
  query: { onboardingSession: { findFirst: vi.fn() } },
};

describe('updateOnboardingSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
  });

  const session = {
    id: 'sess_1',
    userId: 'user_1',
    status: 'active',
    currentSlide: 'intro',
    answers: { website: 'https://example.com' },
  };

  it('advances the slide and merges the answer', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce(session);
    mockDb.returning.mockResolvedValueOnce([
      { ...session, currentSlide: 'analysis' },
    ]);

    const result = await updateOnboardingSession(mockDb as never, {
      userId: 'user_1',
      currentSlide: 'analysis',
      answer: { slide: 'intro', value: 'continue' },
    });

    expect(result.success).toBe(true);
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        currentSlide: 'analysis',
        answers: expect.objectContaining({
          website: 'https://example.com',
          intro: 'continue',
        }),
      })
    );
  });

  it('upserts the session when none exists yet', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce(undefined);
    mockDb.returning
      .mockResolvedValueOnce([{ ...session, answers: null }]) // insert
      .mockResolvedValueOnce([{ ...session, currentSlide: 'intro' }]); // update

    const result = await updateOnboardingSession(mockDb as never, {
      userId: 'user_1',
      currentSlide: 'intro',
    });

    expect(result.success).toBe(true);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('persists explicit picker selections to the dedicated columns', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce(session);
    mockDb.returning.mockResolvedValueOnce([session]);

    const result = await updateOnboardingSession(mockDb as never, {
      userId: 'user_1',
      selectedGraphicIds: ['g-1', 'g-2'],
      selectedVideoId: 'v-1',
    });

    expect(result.success).toBe(true);
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedGraphicIds: ['g-1', 'g-2'],
        selectedVideoId: 'v-1',
      })
    );
  });

  it('lifts picker selections out of ad_picker / video_picker answers', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValue(session);
    mockDb.returning.mockResolvedValue([session]);

    const adResult = await updateOnboardingSession(mockDb as never, {
      userId: 'user_1',
      currentSlide: 'video_picker',
      answer: {
        slide: 'ad_picker',
        value: { selectedGraphicIds: ['g-1', 'g-2'] },
      },
    });

    expect(adResult.success).toBe(true);
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        currentSlide: 'video_picker',
        selectedGraphicIds: ['g-1', 'g-2'],
      })
    );

    const videoResult = await updateOnboardingSession(mockDb as never, {
      userId: 'user_1',
      currentSlide: 'campaign_review',
      answer: { slide: 'video_picker', value: { selectedVideoId: 'v-1' } },
    });

    expect(videoResult.success).toBe(true);
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        currentSlide: 'campaign_review',
        selectedVideoId: 'v-1',
      })
    );

    // Non-picker slides never touch the columns.
    await updateOnboardingSession(mockDb as never, {
      userId: 'user_1',
      answer: { slide: 'intro', value: { selectedVideoId: 'v-9' } },
    });
    expect(mockDb.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ selectedVideoId: 'v-9' })
    );
    mockDb.query.onboardingSession.findFirst.mockReset();
    mockDb.returning.mockReset();
  });

  it('lifts base price and content source answers into their columns', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValue(session);
    mockDb.returning.mockResolvedValue([session]);

    await updateOnboardingSession(mockDb as never, {
      userId: 'user_1',
      currentSlide: 'intro_offer',
      answer: { slide: 'service_price', value: { servicePriceCents: 20000 } },
    });
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ servicePriceCents: 20000 })
    );

    await updateOnboardingSession(mockDb as never, {
      userId: 'user_1',
      answer: { slide: 'content_source', value: { contentSource: 'stock' } },
    });
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ contentSource: 'stock' })
    );

    mockDb.query.onboardingSession.findFirst.mockReset();
    mockDb.returning.mockReset();
  });

  it('returns CONFLICT for a completed session', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce({
      ...session,
      status: 'completed',
    });

    const result = await updateOnboardingSession(mockDb as never, {
      userId: 'user_1',
      currentSlide: 'intro',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    }
  });

  it('returns VALIDATION_ERROR for an unknown slide key', async () => {
    const result = await updateOnboardingSession(mockDb as never, {
      userId: 'user_1',
      currentSlide: 'not-a-slide' as never,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});

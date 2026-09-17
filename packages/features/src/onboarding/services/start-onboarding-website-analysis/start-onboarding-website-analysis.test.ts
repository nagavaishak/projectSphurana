import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes, ok } from '../../../shared/index.js';
import * as analyzeWebsite from '../../../website-analysis/services/analyze-website/analyze-website.service.js';
import { startOnboardingWebsiteAnalysis } from './start-onboarding-website-analysis.service.js';

// analyze-website is an internal module with its own tests — restored spy,
// not a file-local vi.mock (would leak under isolate:false).
let mockStartJob: ReturnType<typeof vi.spyOn>;

const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue(undefined),
  returning: vi.fn(),
  query: { onboardingSession: { findFirst: vi.fn() } },
};

describe('startOnboardingWebsiteAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValue(undefined);
    mockStartJob = vi
      .spyOn(analyzeWebsite, 'startAnalyzeWebsiteJob')
      .mockResolvedValue(ok({ jobId: 'wa-job:123' }) as never);
  });

  afterEach(() => {
    mockStartJob.mockRestore();
  });

  const session = {
    id: 'sess_1',
    userId: 'user_1',
    status: 'active',
    currentSlide: 'website',
  };

  it('starts analysis scoped to the user and stores the job id', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce(session);

    const result = await startOnboardingWebsiteAnalysis(mockDb as never, {
      userId: 'user_1',
      websiteUrl: 'https://example.com',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.jobId).toBe('wa-job:123');
    // Pre-org: job is scoped by user, not an organization; the OpenAI key is
    // a job parameter (mirrors the website-analysis controller)
    expect(mockStartJob).toHaveBeenCalledWith(
      {
        websiteUrl: 'https://example.com',
        organizationId: 'user:user_1',
      },
      'mock-openai-api-key'
    );
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        websiteUrl: 'https://example.com',
        analysisJobId: 'wa-job:123',
        currentSlide: 'intro',
      })
    );
  });

  it('does not touch the session when the job fails to start', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce(session);
    mockStartJob.mockResolvedValueOnce({
      success: false,
      error: { code: ErrorCodes.INTERNAL_ERROR, message: 'redis down' },
    } as never);

    const result = await startOnboardingWebsiteAnalysis(mockDb as never, {
      userId: 'user_1',
      websiteUrl: 'https://example.com',
    });

    expect(result.success).toBe(false);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for a bad URL', async () => {
    const result = await startOnboardingWebsiteAnalysis(mockDb as never, {
      userId: 'user_1',
      websiteUrl: 'not-a-url',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockStartJob).not.toHaveBeenCalled();
  });
});

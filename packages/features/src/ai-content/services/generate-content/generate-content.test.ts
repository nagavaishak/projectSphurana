import { RATE_LIMIT_MESSAGE, extractJson } from '@borradh-workspace/ai';
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
import * as orgContext from '../../../shared/core/org-context.js';
import { ErrorCodes } from '../../../shared/index.js';

const mocks = vi.hoisted(() => ({
  getOrgContext: vi.fn(),
  trackedResult: vi.fn((_name: string, fn: () => unknown) => fn()),
  logError: vi.fn(),
}));

// `matchCaptions` / the prompt builders are spied on their own modules rather
// than `vi.mock`'d: under `isolate: false` a file-local `vi.mock` persists on
// the shared worker module graph (and a bare factory deletes every export it
// omits). Restored spies are load-order independent and leak nothing.
import * as matchCaptionsModule from './match-captions.js';
import * as promptsModule from './prompts.js';

import { generateContent } from './generate-content.service.js';

let mockMatchCaptions: MockInstance;
let mockBuildAdPrompt: MockInstance;
let mockBuildSocialPostPrompt: MockInstance;

const mockExtractJson = vi.mocked(extractJson);

const mockDb = createMockDatabase();

const validInput = {
  organizationId: 'org-1',
  mediaType: 'image' as const,
  mediaId: 'asset-1',
  contentType: 'ad' as const,
};

const mockOrgContext = {
  businessType: 'beauty_salon',
  name: 'Test Salon',
  credibilityLine: '5 years of experience',
  services: [],
  serviceDetails: [],
};

describe('generateContent', () => {
  // `getOrgContext` is spied on its SOURCE module (`shared/core/org-context.js`)
  // rather than `vi.mock`'d on the `shared/org-context.js` back-compat shim.
  // Under `isolate: false` a file-local `vi.mock` of that shim would persist on
  // the shared worker module graph and leak into every later test file. The spy
  // delegates to the hoisted `mocks.getOrgContext` handle so existing call sites
  // keep working; it is restored in `afterEach`.
  let getOrgContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // clearAllMocks does not drain `mock*Once` queues — reset explicitly.
    mocks.getOrgContext.mockReset();
    getOrgContextSpy = vi
      .spyOn(orgContext, 'getOrgContext')
      .mockImplementation((...args) => mocks.getOrgContext(...args));
    mockMatchCaptions = (
      vi.spyOn(matchCaptionsModule, 'matchCaptions') as unknown as MockInstance
    ).mockResolvedValue(null);
    mockBuildAdPrompt = (
      vi.spyOn(promptsModule, 'buildAdPrompt') as unknown as MockInstance
    ).mockReturnValue({
      systemMessage: 'system',
      userMessage: 'user',
    });
    mockBuildSocialPostPrompt = (
      vi.spyOn(
        promptsModule,
        'buildSocialPostPrompt'
      ) as unknown as MockInstance
    ).mockReturnValue({
      systemMessage: 'system',
      userMessage: 'user',
    });
  });

  afterEach(() => {
    getOrgContextSpy.mockRestore();
    mockMatchCaptions.mockRestore();
    mockBuildAdPrompt.mockRestore();
    mockBuildSocialPostPrompt.mockRestore();
  });

  it('should generate ad content successfully', async () => {
    mocks.getOrgContext.mockResolvedValueOnce(mockOrgContext);
    mockDb.query.asset.findFirst.mockResolvedValueOnce({
      id: 'asset-1',
      organizationId: 'org-1',
      type: 'image',
      blobUrl: 'https://example.com/image.jpg',
      name: 'Test Image',
      tags: [],
    });
    mockExtractJson.mockResolvedValueOnce({
      success: true,
      data: {
        headline: 'Great Service',
        primaryText: 'Book now for amazing results',
        description: 'Limited time',
        callToAction: 'BOOK_NOW',
      },
      raw: '',
    });

    const result = await generateContent(
      mockDb as never,
      validInput,
      'api-key'
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contentType).toBe('ad');
      expect(result.data.content).toHaveProperty('headline');
      expect(result.data.content).toHaveProperty('primaryText');
    }
  });

  it('should generate social post content', async () => {
    mocks.getOrgContext.mockResolvedValueOnce(mockOrgContext);
    mockDb.query.asset.findFirst.mockResolvedValueOnce({
      id: 'asset-1',
      organizationId: 'org-1',
      type: 'image',
      blobUrl: 'https://example.com/image.jpg',
      name: 'Test Image',
      tags: [],
    });
    mockExtractJson.mockResolvedValueOnce({
      success: true,
      data: {
        caption: 'Check out our amazing services!',
        hashtags: ['#beauty', '#salon'],
      },
      raw: '',
    });

    const result = await generateContent(
      mockDb as never,
      { ...validInput, contentType: 'social-post' },
      'api-key'
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contentType).toBe('social-post');
      expect(result.data.content).toHaveProperty('caption');
      expect(result.data.content).toHaveProperty('hashtags');
    }
  });

  it('generates a caption for an unrendered video draft without looking up an asset', async () => {
    mocks.getOrgContext.mockResolvedValueOnce(mockOrgContext);
    mockDb.query.video.findFirst.mockResolvedValueOnce({
      id: 'video-1',
      organizationId: 'org-1',
      title: 'Skin consultation offer',
      blobUrl: null,
      draftConfig: {
        narrationType: 'text_only',
        offerCard: {
          headline: 'Start with a skin consultation',
          bulletPoints: ['Personalised plan', 'No pressure'],
          ctaText: 'Message us to book',
        },
      },
    });
    mockExtractJson.mockResolvedValueOnce({
      success: true,
      data: {
        caption:
          'A personalised place to start when you are not sure what your skin needs. Message us to book.',
        hashtags: ['#skincare'],
      },
      raw: '',
    });

    const result = await generateContent(
      mockDb as never,
      {
        organizationId: 'org-1',
        mediaType: 'video',
        mediaId: 'video-1',
        contentType: 'social-post',
      },
      'api-key'
    );

    expect(result.success).toBe(true);
    expect(mockDb.query.asset.findFirst).not.toHaveBeenCalled();
    expect(mockExtractJson).toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      generateContent(
        mockDb as never,
        { ...validInput, organizationId: '' },
        'api-key'
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid mediaType', async () => {
    await expectResult(
      generateContent(
        mockDb as never,
        { ...validInput, mediaType: 'audio' as never },
        'api-key'
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return NOT_FOUND when organization does not exist', async () => {
    mocks.getOrgContext.mockResolvedValueOnce(null);

    await expectResult(
      generateContent(mockDb as never, validInput, 'api-key')
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return NOT_FOUND when asset does not exist', async () => {
    mocks.getOrgContext.mockResolvedValueOnce(mockOrgContext);
    mockDb.query.asset.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      generateContent(mockDb as never, validInput, 'api-key')
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return matched captions for ads with serviceIds', async () => {
    mocks.getOrgContext.mockResolvedValueOnce(mockOrgContext);
    mockMatchCaptions.mockResolvedValueOnce({
      headline: 'Matched Headline',
      primaryText: 'Matched primary text',
      ctaType: 'CONTACT_US',
      treatmentName: 'Botox',
    });

    const result = await generateContent(
      mockDb as never,
      { ...validInput, serviceIds: ['svc-1'] },
      'api-key'
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content).toHaveProperty(
        'headline',
        'Matched Headline'
      );
    }
    expect(mockExtractJson).not.toHaveBeenCalled();
  });

  it('should return INTERNAL_ERROR when AI extraction fails', async () => {
    mocks.getOrgContext.mockResolvedValueOnce(mockOrgContext);
    mockDb.query.asset.findFirst.mockResolvedValueOnce({
      id: 'asset-1',
      organizationId: 'org-1',
      type: 'image',
      blobUrl: 'https://example.com/image.jpg',
      name: 'Test Image',
      tags: [],
    });
    // Both the initial attempt and the one retry fail.
    const failure = {
      success: false as const,
      data: null,
      raw: 'garbage',
      error: 'parse failed',
    };
    mockExtractJson
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(failure);

    await expectResult(
      generateContent(mockDb as never, validInput, 'api-key')
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
    // Confirms the transient-failure retry actually fired.
    expect(mockExtractJson).toHaveBeenCalledTimes(2);
  });

  it('retries once and succeeds after a transient extraction failure', async () => {
    mocks.getOrgContext.mockResolvedValueOnce(mockOrgContext);
    mockDb.query.asset.findFirst.mockResolvedValueOnce({
      id: 'asset-1',
      organizationId: 'org-1',
      type: 'image',
      blobUrl: 'https://example.com/image.jpg',
      name: 'Test Image',
      tags: [],
    });
    mockExtractJson
      .mockResolvedValueOnce({
        success: false,
        data: null,
        raw: 'garbage',
        error: 'parse failed',
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          headline: 'Recovered headline',
          primaryText: 'Recovered primary text',
          description: 'Recovered description',
          callToAction: 'LEARN_MORE',
        },
      });

    const result = await generateContent(
      mockDb as never,
      validInput,
      'api-key'
    );

    expect(result.success).toBe(true);
    expect(mockExtractJson).toHaveBeenCalledTimes(2);
  });

  it('returns RATE_LIMITED without retrying on an AI rate limit', async () => {
    mocks.getOrgContext.mockResolvedValueOnce(mockOrgContext);
    mockDb.query.asset.findFirst.mockResolvedValueOnce({
      id: 'asset-1',
      organizationId: 'org-1',
      type: 'image',
      blobUrl: 'https://example.com/image.jpg',
      name: 'Test Image',
      tags: [],
    });
    mockExtractJson.mockResolvedValueOnce({
      success: false,
      data: null,
      error: RATE_LIMIT_MESSAGE,
    });

    await expectResult(
      generateContent(mockDb as never, validInput, 'api-key')
    ).toFailWithCode(ErrorCodes.RATE_LIMITED);
    // Rate limits should not be retried — back off and surface a 429.
    expect(mockExtractJson).toHaveBeenCalledTimes(1);
  });
});

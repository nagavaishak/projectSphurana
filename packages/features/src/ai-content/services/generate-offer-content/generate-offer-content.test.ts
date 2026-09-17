import { extractJson } from '@borradh-workspace/ai';
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

// The prompt builders are spied on their own module rather than `vi.mock`'d:
// under `isolate: false` a file-local `vi.mock` persists on the shared worker
// module graph (and a bare factory deletes every export it omits). Restored
// spies are load-order independent and leak nothing.
import * as promptsModule from './prompts.js';

import { generateOfferContent } from './generate-offer-content.service.js';

let mockBuildOfferContentSystemPrompt: MockInstance;
let mockBuildOfferContentUserPrompt: MockInstance;

const mockExtractJson = vi.mocked(extractJson);

const mockDb = createMockDatabase();

const validInput = {
  organizationId: 'org-1',
};

const mockOrgContext = {
  businessType: 'beauty_salon',
  name: 'Test Salon',
  services: [{ name: 'Facial Treatment' }],
  serviceDetails: [
    {
      name: 'Facial Treatment',
      painPoints: ['Acne', 'Wrinkles'],
      expectedResults: ['Clear skin', 'Youthful appearance'],
    },
  ],
};

describe('generateOfferContent', () => {
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
    mockBuildOfferContentSystemPrompt = (
      vi.spyOn(
        promptsModule,
        'buildOfferContentSystemPrompt'
      ) as unknown as MockInstance
    ).mockReturnValue('system prompt');
    mockBuildOfferContentUserPrompt = (
      vi.spyOn(
        promptsModule,
        'buildOfferContentUserPrompt'
      ) as unknown as MockInstance
    ).mockReturnValue('user prompt');
  });

  afterEach(() => {
    mockBuildOfferContentSystemPrompt.mockRestore();
    mockBuildOfferContentUserPrompt.mockRestore();
    getOrgContextSpy.mockRestore();
  });

  it('should generate offer content successfully', async () => {
    mocks.getOrgContext.mockResolvedValueOnce(mockOrgContext);
    mockExtractJson.mockResolvedValueOnce({
      success: true,
      data: {
        headline: 'TRANSFORM YOUR SKIN',
        bulletPoints: [
          'Reduce fine lines',
          'Clear acne fast',
          'Restore natural glow',
        ],
      },
      raw: '',
    });

    const result = await generateOfferContent(
      mockDb as never,
      validInput,
      'api-key'
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.headline).toBe('TRANSFORM YOUR SKIN');
      expect(result.data.bulletPoints).toHaveLength(3);
    }
  });

  it('should generate content with specific serviceId', async () => {
    mocks.getOrgContext.mockResolvedValueOnce(mockOrgContext);
    mockExtractJson.mockResolvedValueOnce({
      success: true,
      data: {
        headline: 'FACIAL SPECIAL',
        bulletPoints: ['Deep cleanse', 'Hydrate skin'],
      },
      raw: '',
    });

    const result = await generateOfferContent(
      mockDb as never,
      { ...validInput, serviceId: 'svc-1' },
      'api-key'
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.headline).toBe('FACIAL SPECIAL');
    }
  });

  it('should pass provided headline to prompts', async () => {
    mocks.getOrgContext.mockResolvedValueOnce(mockOrgContext);
    mockExtractJson.mockResolvedValueOnce({
      success: true,
      data: {
        headline: 'CUSTOM HEADLINE',
        bulletPoints: ['Point 1', 'Point 2'],
      },
      raw: '',
    });

    const result = await generateOfferContent(
      mockDb as never,
      { ...validInput, headline: 'Custom' },
      'api-key'
    );

    expect(result.success).toBe(true);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      generateOfferContent(mockDb as never, { organizationId: '' }, 'api-key')
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return NOT_FOUND when organization does not exist', async () => {
    mocks.getOrgContext.mockResolvedValueOnce(null);

    await expectResult(
      generateOfferContent(mockDb as never, validInput, 'api-key')
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return INTERNAL_ERROR when AI extraction fails', async () => {
    mocks.getOrgContext.mockResolvedValueOnce(mockOrgContext);
    mockExtractJson.mockResolvedValueOnce({
      success: false,
      data: null,
      raw: 'garbage',
      error: 'parse failed',
    });

    await expectResult(
      generateOfferContent(mockDb as never, validInput, 'api-key')
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  it('should return INTERNAL_ERROR when extractJson throws', async () => {
    mocks.getOrgContext.mockResolvedValueOnce(mockOrgContext);
    mockExtractJson.mockRejectedValueOnce(new Error('AI API down'));

    await expectResult(
      generateOfferContent(mockDb as never, validInput, 'api-key')
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});

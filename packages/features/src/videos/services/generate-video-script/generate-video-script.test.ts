import {
  extractJson,
  initAIClient,
  isAIClientInitialized,
} from '@borradh-workspace/ai';
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
import { ErrorCodes } from '../../../shared/index.js';

const hoistedMocks = vi.hoisted(() => ({
  mockGetOrgContext: vi.fn(),
}));

// `getVariationById` is spied (not `vi.mock`'d) so the REAL templates barrel is
// restored after this file. Under `isolate: false` a file-local `vi.mock` of
// this internal barrel would persist on the shared worker graph and DELETE
// every export the factory omitted (`selectRandomVariationForTemplate`,
// `CONTENT_IDEA_TEMPLATES`, …) for every later test file. The spy handle is
// restored in `afterEach` — we restore it specifically rather than calling
// `vi.restoreAllMocks()`, which would also wipe the canonical boundary mocks.
// `getOrgContext` is likewise spied on its SOURCE module
// (`shared/core/org-context.js`) rather than `vi.mock`'d on the
// `shared/org-context.js` back-compat shim, for the same shared-graph reason.
import * as orgContext from '../../../shared/core/org-context.js';
import * as videoTemplates from '../../templates/index.js';
import { generateVideoScript } from './generate-video-script.service.js';
// `buildVideoScriptPrompt` is likewise spied on its own module rather than
// `vi.mock`'d, so the real prompt builder is restored for every later file.
import * as prompts from './prompts.js';

const mocks = {
  mockExtractJson: vi.mocked(extractJson),
  mockInitAIClient: vi.mocked(initAIClient),
  mockIsAIClientInitialized: vi.mocked(isAIClientInitialized),
  mockGetOrgContext: hoistedMocks.mockGetOrgContext,
  mockBuildVideoScriptPrompt: undefined as unknown as MockInstance,
};

describe('generateVideoScript', () => {
  const mockDb = createMockDatabase();
  let mockGetVariationById: MockInstance;
  let mockGetOrgContextSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // clearAllMocks does not drain `mock*Once` queues — reset explicitly.
    mocks.mockGetOrgContext.mockReset();
    mockGetOrgContextSpy = (
      vi.spyOn(orgContext, 'getOrgContext') as MockInstance
    ).mockImplementation((...args) => mocks.mockGetOrgContext(...args));
    mockGetVariationById = vi.spyOn(
      videoTemplates,
      'getVariationById'
    ) as MockInstance;
    mocks.mockIsAIClientInitialized.mockReturnValue(true);
    mocks.mockBuildVideoScriptPrompt = vi.spyOn(
      prompts,
      'buildVideoScriptPrompt'
    ) as unknown as MockInstance;
    mocks.mockBuildVideoScriptPrompt.mockReturnValue({
      systemMessage: 'system',
      userMessage: 'user',
    });
  });

  afterEach(() => {
    mockGetVariationById.mockRestore();
    mockGetOrgContextSpy.mockRestore();
    mocks.mockBuildVideoScriptPrompt.mockRestore();
  });

  const validInput = {
    organizationId: 'org_123',
    templateId: 'tmpl_1',
    variationId: 'var_1',
  };

  it('should generate video script successfully', async () => {
    mockGetVariationById.mockReturnValueOnce({
      variation: { id: 'var_1', name: 'Test Variation' },
    });
    mocks.mockGetOrgContext.mockResolvedValueOnce({
      name: 'Test Org',
      services: [],
    });
    mocks.mockExtractJson.mockResolvedValueOnce({
      success: true,
      data: { scriptText: 'Generated script content' },
    });

    const result = await generateVideoScript(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scriptText).toBe('Generated script content');
    }
  });

  it('should return NOT_FOUND when variation not found', async () => {
    mockGetVariationById.mockReturnValueOnce(null);

    await expectResult(
      generateVideoScript(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return NOT_FOUND when organization not found', async () => {
    mockGetVariationById.mockReturnValueOnce({
      variation: { id: 'var_1' },
    });
    mocks.mockGetOrgContext.mockResolvedValueOnce(null);

    await expectResult(
      generateVideoScript(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return INTERNAL_ERROR when AI extraction fails', async () => {
    mockGetVariationById.mockReturnValueOnce({
      variation: { id: 'var_1' },
    });
    mocks.mockGetOrgContext.mockResolvedValueOnce({
      name: 'Test Org',
    });
    mocks.mockExtractJson.mockResolvedValueOnce({
      success: false,
      data: null,
      raw: 'bad output',
      error: 'Parse error',
    });

    await expectResult(
      generateVideoScript(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  it('should return INTERNAL_ERROR when AI throws', async () => {
    mockGetVariationById.mockReturnValueOnce({
      variation: { id: 'var_1' },
    });
    mocks.mockGetOrgContext.mockResolvedValueOnce({
      name: 'Test Org',
    });
    mocks.mockExtractJson.mockRejectedValueOnce(new Error('AI API error'));

    await expectResult(
      generateVideoScript(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  it('threads the refinement instruction + prior script into the prompt', async () => {
    mockGetVariationById.mockReturnValueOnce({
      variation: { id: 'var_1', name: 'Test Variation' },
    });
    mocks.mockGetOrgContext.mockResolvedValueOnce({ name: 'Test Org' });
    mocks.mockExtractJson.mockResolvedValueOnce({
      success: true,
      data: { scriptText: 'Refined script' },
    });

    await generateVideoScript(mockDb as never, {
      ...validInput,
      refinementInstruction: 'make it shorter',
      priorScriptText: 'A long previous script',
    });

    expect(mocks.mockBuildVideoScriptPrompt).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
      {
        instruction: 'make it shorter',
        priorScriptText: 'A long previous script',
      }
    );
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      generateVideoScript(mockDb as never, {
        ...validInput,
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing variationId', async () => {
    await expectResult(
      generateVideoScript(mockDb as never, {
        ...validInput,
        variationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});

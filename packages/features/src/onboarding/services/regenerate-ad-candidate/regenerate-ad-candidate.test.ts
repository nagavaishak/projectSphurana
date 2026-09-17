import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
// Spy the SOURCE module, not the `graphics/index.js` barrel — barrel re-exports
// are live getters and `vi.spyOn` cannot redefine them.
import * as regenerateGraphicModule from '../../../graphics/services/regenerate-graphic/regenerate-graphic.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import { regenerateAdCandidate } from './regenerate-ad-candidate.service.js';

// A restored `vi.spyOn`, NOT `vi.mock`. Under `isolate: false` the worker shares
// one module graph, so a hoisted `vi.mock` of an internal module silently MISSES
// whenever some earlier file already imported the real module, and its bare
// factory poisons that module for every later file.
let mockRegenerateGraphic: MockInstance;

const queryFns = { onboardingSession: { findFirst: vi.fn() } };
const whereMock = vi.fn().mockResolvedValue([]);
const setMock = vi.fn().mockReturnValue({ where: whereMock });
const mockDb = {
  query: queryFns,
  update: vi.fn().mockReturnValue({ set: setMock }),
};

const baseSession = {
  id: 'sess_1',
  userId: 'user_1',
  organizationId: 'org_1',
  adCandidateGraphicIds: ['g1', 'g2', 'g3', 'g4'],
};

const baseInput = {
  userId: 'user_1',
  graphicId: 'g2',
  prompt: 'make it brighter and lead with the price',
};

describe('regenerateAdCandidate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryFns.onboardingSession.findFirst.mockResolvedValue(baseSession);
    mockRegenerateGraphic = vi
      .spyOn(regenerateGraphicModule, 'regenerateGraphic')
      .mockResolvedValue({
        success: true,
        data: { id: 'g_new' },
      } as never);
    setMock.mockClear();
    setMock.mockReturnValue({ where: whereMock });
  });

  afterEach(() => {
    mockRegenerateGraphic.mockRestore();
  });

  it('re-rolls the candidate and swaps the id in the session list', async () => {
    await expectResult(
      regenerateAdCandidate(mockDb as never, baseInput)
    ).toSucceedWith((data) => {
      expect(data).toEqual({ graphicId: 'g_new' });
    });

    expect(mockRegenerateGraphic).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        organizationId: 'org_1',
        graphicId: 'g2',
        createdById: 'user_1',
        refinementInstruction: baseInput.prompt,
        scope: 'all',
      })
    );
    expect(setMock).toHaveBeenCalledWith({
      adCandidateGraphicIds: ['g1', 'g_new', 'g3', 'g4'],
    });
  });

  it('returns NOT_FOUND when the graphic is not one of the session candidates', async () => {
    await expectResult(
      regenerateAdCandidate(mockDb as never, {
        ...baseInput,
        graphicId: 'g_other',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
    expect(mockRegenerateGraphic).not.toHaveBeenCalled();
  });

  it('returns CONFLICT when the session has no organization yet', async () => {
    queryFns.onboardingSession.findFirst.mockResolvedValue({
      ...baseSession,
      organizationId: null,
    });
    await expectResult(
      regenerateAdCandidate(mockDb as never, baseInput)
    ).toFailWithCode(ErrorCodes.CONFLICT);
  });

  it('returns NOT_FOUND when there is no onboarding session', async () => {
    queryFns.onboardingSession.findFirst.mockResolvedValue(undefined);
    await expectResult(
      regenerateAdCandidate(mockDb as never, baseInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('propagates the regenerate error code', async () => {
    mockRegenerateGraphic.mockResolvedValue({
      success: false,
      error: { code: ErrorCodes.INVALID_STATE, message: 'no service' },
    });
    await expectResult(
      regenerateAdCandidate(mockDb as never, baseInput)
    ).toFailWithCode(ErrorCodes.INVALID_STATE);
    expect(setMock).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for an empty prompt', async () => {
    await expectResult(
      regenerateAdCandidate(mockDb as never, { ...baseInput, prompt: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockRegenerateGraphic).not.toHaveBeenCalled();
  });
});

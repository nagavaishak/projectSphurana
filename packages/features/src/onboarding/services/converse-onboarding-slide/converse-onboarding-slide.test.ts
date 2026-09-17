import { extractJson } from '@borradh-workspace/ai';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
// Spy the SOURCE module, not the `assistant/index.js` barrel — barrel
// re-exports are live getters and `vi.spyOn` cannot redefine them.
import * as getContextModule from '../../../assistant/services/get-context/get-context.service.js';
import { ErrorCodes, FeatureError } from '../../../shared/index.js';
import { converseOnboardingSlide } from './converse-onboarding-slide.service.js';

// A restored `vi.spyOn`, NOT `vi.mock`. Under `isolate: false` the worker shares
// one module graph, so a hoisted `vi.mock` of an internal module silently MISSES
// whenever some earlier file already imported the real module, and its bare
// factory poisons that module for every later file.
let mockGetAssistantContext: MockInstance;

const mockFindFirst = vi.fn();
const mockWhere = vi.fn();
const mockSet = vi.fn(() => ({ where: mockWhere }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));

const mockDb = {
  query: { onboardingSession: { findFirst: mockFindFirst } },
  update: mockUpdate,
} as never;

const baseSession = {
  id: 'sess_1',
  userId: 'user_1',
  organizationId: 'org_1',
  conversationTurns: null,
};

const okContext = {
  success: true as const,
  data: {
    name: 'Glow Clinic',
    address: null,
    businessType: 'aesthetic_clinic',
    businessTypeLabel: 'Aesthetic Clinic',
    brandVoice: ['warm'],
    targetAudienceDescription: 'Women 25-45',
    credibilityLine: null,
    tagline: null,
    services: ['Microneedling', 'HydraFacial'],
    serviceDetails: [],
  },
};

const structuredSlide = {
  headline: "Let's lead with Microneedling",
  description: 'It has the broadest appeal.',
  options: [
    { label: 'Sounds good', value: 'accept' },
    { label: 'Pick another', value: 'change' },
  ],
  input: null,
};

const baseInput = {
  userId: 'user_1',
  slide: 'campaign_pitch' as const,
  userText: 'What about advertising facials instead?',
};

describe('converseOnboardingSlide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSet.mockReturnValue({ where: mockWhere } as never);
    mockUpdate.mockReturnValue({ set: mockSet } as never);
    mockWhere.mockResolvedValue(undefined);
    mockFindFirst.mockResolvedValue(baseSession);
    mockGetAssistantContext = vi
      .spyOn(getContextModule, 'getAssistantContext')
      .mockResolvedValue(okContext as never);
    vi.mocked(extractJson).mockResolvedValue({
      success: true,
      data: structuredSlide,
    });
  });

  afterEach(() => {
    mockGetAssistantContext.mockRestore();
  });

  it('returns the structured slide and appends the turn (happy path)', async () => {
    const result = await converseOnboardingSlide(mockDb, baseInput);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.slide).toBe('campaign_pitch');
    expect(result.data.fallback).toBe(false);
    expect(result.data.response).toEqual(structuredSlide);

    // The turn is persisted onto session.conversationTurns
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const setArg = mockSet.mock.calls[0][0] as {
      conversationTurns: Array<Record<string, unknown>>;
    };
    expect(setArg.conversationTurns).toHaveLength(1);
    expect(setArg.conversationTurns[0]).toMatchObject({
      slide: 'campaign_pitch',
      userText: baseInput.userText,
      response: structuredSlide,
    });

    // The AI call embeds org context + slide goal in the system message
    const [prompt, options] = vi.mocked(extractJson).mock.calls[0] as [
      string,
      { systemMessage: string },
    ];
    expect(prompt).toBe(baseInput.userText);
    expect(options.systemMessage).toContain('Glow Clinic');
    expect(options.systemMessage).toContain('campaign_pitch');
  });

  it('appends to existing turns and feeds prior same-slide turns to Claire', async () => {
    const priorTurn = {
      slide: 'campaign_pitch',
      userText: 'Not sure about that one',
      response: { headline: 'How about HydraFacial?', options: [] },
      at: '2026-07-01T00:00:00.000Z',
    };
    const otherSlideTurn = { ...priorTurn, slide: 'intro_offer' };
    mockFindFirst.mockResolvedValue({
      ...baseSession,
      conversationTurns: [priorTurn, otherSlideTurn],
    });

    const result = await converseOnboardingSlide(mockDb, baseInput);

    expect(result.success).toBe(true);
    const setArg = mockSet.mock.calls[0][0] as {
      conversationTurns: unknown[];
    };
    expect(setArg.conversationTurns).toHaveLength(3);

    const [, options] = vi.mocked(extractJson).mock.calls[0] as [
      string,
      { systemMessage: string },
    ];
    expect(options.systemMessage).toContain('Not sure about that one');
  });

  it('falls back to the safe retry slide when extraction fails', async () => {
    vi.mocked(extractJson).mockResolvedValue({
      success: false,
      data: null,
      error: 'Schema validation failed',
    });

    const result = await converseOnboardingSlide(mockDb, {
      ...baseInput,
      slide: 'intro_offer',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.fallback).toBe(true);
    expect(result.data.response.headline).toMatch(/try that again/i);
    expect(result.data.response.options).toEqual([
      { label: 'OK', value: 'ok' },
    ]);

    // The fallback turn is still recorded so resume re-renders it
    const setArg = mockSet.mock.calls[0][0] as {
      conversationTurns: Array<{ response: { headline: string } }>;
    };
    expect(setArg.conversationTurns[0].response.headline).toMatch(
      /try that again/i
    );
  });

  it('returns CONFLICT when the organization has not been created yet', async () => {
    mockFindFirst.mockResolvedValue({ ...baseSession, organizationId: null });

    const result = await converseOnboardingSlide(mockDb, baseInput);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    expect(vi.mocked(extractJson)).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when no onboarding session exists', async () => {
    mockFindFirst.mockResolvedValue(undefined);

    const result = await converseOnboardingSlide(mockDb, baseInput);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for a non-conversational slide', async () => {
    const result = await converseOnboardingSlide(mockDb, {
      ...baseInput,
      slide: 'analysis' as never,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for empty user text', async () => {
    const result = await converseOnboardingSlide(mockDb, {
      ...baseInput,
      userText: '',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('propagates a context load failure', async () => {
    mockGetAssistantContext.mockResolvedValue({
      success: false,
      error: new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found'),
    });

    const result = await converseOnboardingSlide(mockDb, baseInput);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('returns INTERNAL_ERROR when persisting the turn fails', async () => {
    mockWhere.mockRejectedValue(new Error('db down'));

    const result = await converseOnboardingSlide(mockDb, baseInput);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
  });
});

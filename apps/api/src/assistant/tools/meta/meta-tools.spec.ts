// Coverage for the two always-loaded meta tools that `remember.spec.ts`
// doesn't touch: `dispatchTour` (chat-driven UI tour invocation) and
// `loadSkill` (mid-conversation skill pivot). Same heavy-barrel mocking
// precedent as remember.spec.ts — features/database barrels pull cuid2 +
// t3-env (ESM-only) which swc-jest doesn't transform.
jest.mock('@borradh-workspace/database', () => ({ db: {} }));

const mockGetSkillById = jest.fn();
const mockAppendLoadedSkill = jest.fn();
// jest hoists `jest.mock` above the const declarations, so the factory body
// must call through indirection arrows that resolve the mocks at call time.
jest.mock('@borradh-workspace/features/assistant', () => ({
  getSkillById: (...args: unknown[]) => mockGetSkillById(...args),
  appendLoadedSkill: (...args: unknown[]) => mockAppendLoadedSkill(...args),
  writeKnowledgeEntry: jest.fn(),
  createConfirmationToken: jest.fn(),
  verifyConfirmationToken: jest.fn(),
  validateGeneratedCopy: jest.fn(() => []),
}));

jest.mock('@borradh-workspace/features/organizations', () => ({
  checkAdminAccess: jest.fn(),
}));

jest.mock('@borradh-workspace/env/api', () => ({
  apiEnv: {},
}));

jest.mock('@borradh-workspace/observability', () => ({
  logError: jest.fn(),
  isPostHogInitialized: () => false,
  isSentryInitialized: () => false,
  trackEvent: jest.fn(),
  addBreadcrumb: jest.fn(),
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
  trackedResult: <T>(_name: string, fn: () => Promise<T>) => fn(),
}));

import { createToolCallCounter } from '../../tool-factory/tool-call-limit.js';
import type { AssistantToolsContext } from '../../tool-factory/types.js';
import { dispatchTourTool } from './dispatch-tour.tool.js';
import {
  dispatchTourTool as dispatchTourFromIndex,
  loadSkillTool as loadSkillFromIndex,
  metaTools,
  rememberTool,
} from './index.js';
import { loadSkillTool } from './load-skill.tool.js';

interface CtxOverrides {
  organizationId?: string;
  userId?: string;
  conversationId?: string;
  callCounter?: { count: number; max: number };
  runHardBlocks?: AssistantToolsContext['runHardBlocks'];
}

function buildCtx(overrides: CtxOverrides = {}): AssistantToolsContext {
  const apiFetch = jest.fn() as never;
  return {
    organizationId: overrides.organizationId ?? 'org-1',
    userId: overrides.userId ?? 'user-1',
    conversationId: overrides.conversationId ?? 'conv-1',
    apiFetch,
    buildApiFetch: jest.fn(() => apiFetch) as never,
    callCounter: overrides.callCounter ?? createToolCallCounter(50),
    runHardBlocks:
      overrides.runHardBlocks ??
      (jest.fn(async () => ({ pass: true })) as never),
    createConfirmation: jest.fn() as never,
    verifyConfirmation: jest.fn() as never,
  };
}

describe('meta tools registry', () => {
  it('metaTools exports loadSkill, dispatchTour and remember (in order)', () => {
    expect(metaTools).toHaveLength(3);
    expect(metaTools.map((t) => t.name)).toEqual([
      'meta_loadSkill',
      'meta_dispatchTour',
      'meta_remember',
    ]);
  });

  it('the barrel re-exports the same tool singletons', () => {
    expect(dispatchTourFromIndex).toBe(dispatchTourTool);
    expect(loadSkillFromIndex).toBe(loadSkillTool);
    expect(metaTools).toContain(rememberTool);
  });

  it('all meta tools are non-destructive and feature-tagged "meta"', () => {
    for (const tool of metaTools) {
      expect(tool.destructive).toBe(false);
      expect(tool.feature).toBe('meta');
    }
  });
});

describe('dispatchTourTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the meta_dispatchTour factory name', () => {
    expect(dispatchTourTool.name).toBe('meta_dispatchTour');
    expect(dispatchTourTool.action).toBe('dispatchTour');
    expect(dispatchTourTool.destructive).toBe(false);
  });

  it('rejects a missing tourKind via Zod', async () => {
    const result = await dispatchTourTool.execute({} as never, buildCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('VALIDATION_ERROR');
    }
  });

  it('returns a conversational fallback for an unregistered tour kind (no Sentry noise)', async () => {
    const result = await dispatchTourTool.execute(
      { tourKind: 'find-the-ads-page' },
      buildCtx()
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatch(/no interactive tours/i);
    }
  });
});

describe('loadSkillTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSkillById.mockReset();
    mockAppendLoadedSkill.mockReset();
  });

  const skill = {
    id: 'schedule-post',
    toolNames: ['schedulePost', 'listScheduledPosts'],
    promptFragment: 'You are now in the post-scheduling skill.',
  };

  it('uses the meta_loadSkill factory name', () => {
    expect(loadSkillTool.name).toBe('meta_loadSkill');
    expect(loadSkillTool.action).toBe('loadSkill');
    expect(loadSkillTool.destructive).toBe(false);
  });

  it('appends the skill and returns the freshly-loaded toolset + prompt fragment', async () => {
    mockGetSkillById.mockReturnValueOnce(skill);
    mockAppendLoadedSkill.mockResolvedValueOnce({
      success: true,
      data: { loadedSkillIds: ['create-ad', 'schedule-post'] },
    });

    const ctx = buildCtx({
      conversationId: 'conv-7',
      organizationId: 'org-9',
    });
    const result = await loadSkillTool.execute(
      { skillId: 'schedule-post' },
      ctx
    );

    expect(mockGetSkillById).toHaveBeenCalledWith('schedule-post');
    // The DB write is scoped to the conversation + org from ctx (cross-org
    // isolation: the model can't widen the write past its own org).
    const [, appendArg] = mockAppendLoadedSkill.mock.calls[0] as [
      unknown,
      { conversationId: string; organizationId: string; skillId: string },
    ];
    expect(appendArg).toEqual({
      conversationId: 'conv-7',
      organizationId: 'org-9',
      skillId: 'schedule-post',
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.data) {
      // The controller reads these to rebuild the active tool list mid-turn.
      expect(result.data.loaded).toBe(true);
      expect(result.data.skillId).toBe('schedule-post');
      expect(result.data.newToolsAvailable).toEqual([
        'schedulePost',
        'listScheduledPosts',
      ]);
      expect(result.data.promptFragment).toBe(skill.promptFragment);
      expect(result.data.currentLoadedSkills).toEqual([
        'create-ad',
        'schedule-post',
      ]);
    }
  });

  it('rejects an empty skillId via Zod (no DB write)', async () => {
    const result = await loadSkillTool.execute({ skillId: '' }, buildCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('VALIDATION_ERROR');
    }
    expect(mockGetSkillById).not.toHaveBeenCalled();
    expect(mockAppendLoadedSkill).not.toHaveBeenCalled();
  });

  it('soft-errors for an unknown skill id (no DB write)', async () => {
    mockGetSkillById.mockReturnValueOnce(undefined);

    const result = await loadSkillTool.execute(
      { skillId: 'does-not-exist' },
      buildCtx()
    );

    expect(mockAppendLoadedSkill).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TOOL_EXECUTION_ERROR');
    }
  });

  it('soft-errors when appendLoadedSkill returns a failure Result', async () => {
    mockGetSkillById.mockReturnValueOnce(skill);
    mockAppendLoadedSkill.mockResolvedValueOnce({
      success: false,
      error: { code: 'NOT_FOUND', message: 'conversation vanished mid-turn' },
    });

    const result = await loadSkillTool.execute(
      { skillId: 'schedule-post' },
      buildCtx()
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TOOL_EXECUTION_ERROR');
    }
  });
});

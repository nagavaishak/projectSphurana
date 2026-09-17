import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../shared/index.js';
import {
  CTA,
  HERO,
  OTHER_ORG_ID,
  SITE_ID,
  USER_ID,
  givenDraft,
  homePageRow,
  toolContext,
} from './agent-fixtures.test-utils.js';
import {
  type AgentMockDb,
  createAgentMockDb,
} from './agent-mock-db.test-utils.js';
import { MAX_MICROSITE_TOOL_CALLS, createTurnBudget } from './guardrails.js';
import {
  deleteBlockTool,
  listPagesTool,
  updateBlockTool,
} from './tools/index.js';

let db: AgentMockDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = createAgentMockDb();
  givenDraft(db, [homePageRow()]);
});

describe('the per-turn tool-call cap', () => {
  it('refuses once the turn has spent its budget', async () => {
    const ctx = toolContext(db, { budget: createTurnBudget({ maxCalls: 3 }) });

    for (let i = 0; i < 3; i += 1) {
      const allowed = await listPagesTool.execute(ctx, {});
      expect(allowed.success).toBe(true);
    }

    const refused = await listPagesTool.execute(ctx, {});
    expect(refused.success).toBe(false);
    if (refused.success) return;
    expect(refused.error.code).toBe(ErrorCodes.CONFLICT);
    expect(refused.error.message).toContain('3 allowed edits');
  });

  it('shares one budget across every tool in the turn', async () => {
    const ctx = toolContext(db, { budget: createTurnBudget({ maxCalls: 2 }) });

    await listPagesTool.execute(ctx, {});
    await updateBlockTool.execute(ctx, {
      path: '/',
      blockId: HERO.id,
      propsPatch: { headline: 'Two' },
    });
    const third = await listPagesTool.execute(ctx, {});

    expect(third.success).toBe(false);
  });

  it('defaults to the contract cap', () => {
    expect(createTurnBudget().maxCalls).toBe(MAX_MICROSITE_TOOL_CALLS);
    expect(MAX_MICROSITE_TOOL_CALLS).toBe(25);
  });

  it('charges a refused call, so a failing tool cannot be retried forever', async () => {
    const ctx = toolContext(db, { budget: createTurnBudget({ maxCalls: 2 }) });

    await updateBlockTool.execute(ctx, {
      path: '/',
      blockId: 'nope',
      propsPatch: {},
    });
    await updateBlockTool.execute(ctx, {
      path: '/',
      blockId: 'nope',
      propsPatch: {},
    });
    const third = await updateBlockTool.execute(ctx, {
      path: '/',
      blockId: 'nope',
      propsPatch: {},
    });

    expect(third.success).toBe(false);
    if (third.success) return;
    expect(third.error.code).toBe(ErrorCodes.CONFLICT);
  });
});

describe('the conversion path', () => {
  it('refuses to remove cta_booking from the home page', async () => {
    const result = await deleteBlockTool.execute(toolContext(db), {
      path: '/',
      blockId: CTA.id,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.FORBIDDEN);
    expect(result.error.details).toMatchObject({
      guardrail: 'cta_booking_home_page',
    });
    expect(db.update).not.toHaveBeenCalled();
  });

  it('allows removing a cta_booking from a non-home page', async () => {
    givenDraft(db, [
      {
        ...homePageRow([CTA]),
        id: 'page-offers',
        path: '/offers',
        isSystem: false,
      },
    ]);

    const result = await deleteBlockTool.execute(toolContext(db), {
      path: '/offers',
      blockId: CTA.id,
    });

    expect(result.success).toBe(true);
  });

  it('cannot be talked past by moving the block first', async () => {
    // Moving is allowed; deleting it from the home page still is not.
    const moved = await moveThenDelete(db);
    expect(moved.success).toBe(false);
  });
});

const moveThenDelete = async (mock: AgentMockDb) => {
  const ctx = toolContext(mock);
  await updateBlockTool.execute(ctx, {
    path: '/',
    blockId: CTA.id,
    propsPatch: { headline: 'Still ready?' },
  });
  return deleteBlockTool.execute(ctx, { path: '/', blockId: CTA.id });
};

describe('tenant isolation', () => {
  it('refuses a microsite that does not belong to the caller org', async () => {
    // `loadOwnedMicrosite` filters on (id, organizationId) in the WHERE clause,
    // so another tenant's site simply does not come back.
    db.query.microsite.findFirst.mockResolvedValue(undefined);

    const result = await updateBlockTool.execute(
      toolContext(db, {
        session: {
          micrositeId: SITE_ID,
          organizationId: OTHER_ORG_ID,
          userId: USER_ID,
        },
      }),
      { path: '/', blockId: HERO.id, propsPatch: { headline: 'Mine now' } }
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    // NOT_FOUND, never FORBIDDEN — FORBIDDEN would confirm the site exists.
    expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('ignores a micrositeId supplied in the tool arguments', async () => {
    const result = await updateBlockTool.execute(toolContext(db), {
      path: '/',
      blockId: HERO.id,
      propsPatch: { headline: 'Hi' },
      // A model emitting this is emitting an ignored field.
      micrositeId: 'someone-elses-site',
      organizationId: OTHER_ORG_ID,
    } as never);

    expect(result.success).toBe(true);
    // The read went through the session's site, not the argument's.
    expect(db.query.microsite.findFirst).toHaveBeenCalled();
  });
});

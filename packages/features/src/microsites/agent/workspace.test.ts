import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../shared/index.js';
import {
  CTA,
  HERO,
  ORG_ID,
  SESSION,
  givenDraft,
  homePageRow,
  micrositeRow,
} from './agent-fixtures.test-utils.js';
import {
  type AgentMockDb,
  createAgentMockDb,
} from './agent-mock-db.test-utils.js';
import { applyManualBlockEdit, getOrganizationWorkspace } from './workspace.js';

let db: AgentMockDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = createAgentMockDb();
  givenDraft(db, [homePageRow()]);
  db.insertReturning.mockResolvedValue([
    {
      id: 'rev-1',
      micrositeId: SESSION.micrositeId,
      organizationId: SESSION.organizationId,
      label: null,
      createdBy: 'user',
      promptId: null,
      createdAt: new Date('2026-02-01T00:00:00Z'),
    },
  ]);
});

describe('getOrganizationWorkspace', () => {
  it('returns the draft plus a server-built preview url', async () => {
    const result = await getOrganizationWorkspace(db as never, ORG_ID);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.micrositeId).toBe(micrositeRow().id);
    expect(result.data.pages).toHaveLength(1);
    // The client must never build this itself — the apex is env-driven AND the
    // URL carries a signed token. It must point at the TOKEN-GATED DRAFT route,
    // not the wildcard host (which does not exist until Phase 4) and not the
    // published page (which would show the editor the wrong thing).
    const previewUrl = result.data.previewUrl as string;
    expect(previewUrl).toContain(`/sites/preview/${micrositeRow().id}`);
    expect(previewUrl).toMatch(/[?&]token=/);
    expect(previewUrl).not.toContain('acme-salon.');
  });

  it('is NOT_FOUND when the org has no website yet', async () => {
    db.query.microsite.findFirst.mockResolvedValue(undefined);

    const result = await getOrganizationWorkspace(db as never, ORG_ID);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });
});

describe('applyManualBlockEdit', () => {
  const writtenBlocks = () =>
    (db.updateSet.mock.calls
      .map((call) => call[0] as { blocks?: unknown[] })
      .filter((value) => value.blocks)
      .at(-1)?.blocks ?? []) as {
      id: string;
      variant: string;
      props: Record<string, unknown>;
    }[];

  it('patches props through the agent’s own update_block', async () => {
    const result = await applyManualBlockEdit(db as never, SESSION, {
      pageId: 'page-home',
      blockId: HERO.id,
      propsPatch: { headline: 'Typo fixed' },
    });

    expect(result.success).toBe(true);
    const hero = writtenBlocks().find((block) => block.id === HERO.id);
    expect(hero?.props.headline).toBe('Typo fixed');
    // The untouched field survives, exactly as it does for the agent.
    expect(hero?.props.subheadline).toBe('We are open');
  });

  it('reorders through the agent’s own move_block', async () => {
    const result = await applyManualBlockEdit(db as never, SESSION, {
      pageId: 'page-home',
      blockId: CTA.id,
      toIndex: 0,
    });

    expect(result.success).toBe(true);
    expect(writtenBlocks()[0].id).toBe(CTA.id);
  });

  it('changes a variant, correcting an unknown one to the fallback', async () => {
    const result = await applyManualBlockEdit(db as never, SESSION, {
      pageId: 'page-home',
      blockId: HERO.id,
      variant: 'not-a-variant',
    });

    expect(result.success).toBe(true);
    expect(writtenBlocks().find((b) => b.id === HERO.id)?.variant).toBe(
      'image-right'
    );
  });

  it('is a revision too — undo does not care who made the change', async () => {
    givenDraft(db, [homePageRow()]);
    db.query.micrositePage.findMany
      .mockResolvedValueOnce([homePageRow()])
      .mockResolvedValueOnce([homePageRow()])
      .mockResolvedValue([homePageRow([CTA, HERO])]);

    const result = await applyManualBlockEdit(db as never, SESSION, {
      pageId: 'page-home',
      blockId: CTA.id,
      toIndex: 0,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.revisionId).toBe('rev-1');
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('refuses a body that asks for nothing', async () => {
    const result = await applyManualBlockEdit(db as never, SESSION, {
      pageId: 'page-home',
      blockId: HERO.id,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('honours the conversion-path guardrail from the inspector too', async () => {
    // The manual path runs the same tools, so the same refusals apply. An
    // invalid patch on the protected block is refused, not silently written.
    const result = await applyManualBlockEdit(db as never, SESSION, {
      pageId: 'page-home',
      blockId: CTA.id,
      propsPatch: { buttonLabel: '' },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });
});

import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import * as getContextModule from '../../assistant/services/get-context/get-context.service.js';
import { ErrorCodes } from '../../shared/index.js';
import {
  HERO,
  RICH_TEXT,
  SESSION,
  aboutPageRow,
  givenDraft,
  homePageRow,
  micrositeRow,
} from './agent-fixtures.test-utils.js';
import {
  type AgentMockDb,
  createAgentMockDb,
} from './agent-mock-db.test-utils.js';
import { computeMicrositeDiff } from './diff.js';
import { beginMicrositeTurn, completeMicrositeTurn } from './turn.js';

let db: AgentMockDb;
const spies: { mockRestore: () => void }[] = [];

const ORG_CONTEXT = {
  success: true as const,
  data: {
    name: 'Acme Salon',
    address: null,
    timezone: 'Europe/Dublin',
    businessType: 'salon',
    businessTypeLabel: 'Salon',
    brandVoice: ['warm'],
    targetAudienceDescription: null,
    credibilityLine: null,
    tagline: null,
    services: ['Facial'],
    serviceDetails: [],
  },
};

/** The draft as read at the start of the turn, then after it. */
const givenDraftSequence = (
  before: ReturnType<typeof homePageRow>[],
  after: ReturnType<typeof homePageRow>[]
) => {
  db.query.microsite.findFirst.mockResolvedValue(micrositeRow());
  db.query.micrositePage.findMany
    .mockResolvedValueOnce(before)
    .mockResolvedValueOnce(after)
    .mockResolvedValue(after);
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const spy of spies.splice(0)) spy.mockRestore();
  db = createAgentMockDb();
  spies.push(
    vi
      .spyOn(getContextModule, 'getAssistantContext')
      .mockResolvedValue(ORG_CONTEXT as never)
  );
  db.query.micrositeMessage.findMany.mockResolvedValue([]);
  db.insertReturning.mockResolvedValue([
    {
      id: 'rev-1',
      micrositeId: SESSION.micrositeId,
      organizationId: SESSION.organizationId,
      label: null,
      createdBy: 'agent',
      promptId: null,
      createdAt: new Date('2026-02-01T00:00:00Z'),
    },
  ]);
});

describe('beginMicrositeTurn', () => {
  it('stores the user message and builds the turn context', async () => {
    givenDraft(db, [homePageRow()]);

    const result = await beginMicrositeTurn(db as never, {
      session: SESSION,
      message: 'Make the headline shorter',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.systemText).toContain('Acme Salon');
    // The compact structure, not the props.
    expect(result.data.systemText).toContain('[blk-hero] hero/image-right');
    expect(result.data.systemText).not.toContain('We are open');
    expect(result.data.promptId).toBeDefined();
  });

  it('refuses an empty message', async () => {
    givenDraft(db, [homePageRow()]);

    const result = await beginMicrositeTurn(db as never, {
      session: SESSION,
      message: '   ',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('refuses a microsite belonging to another org', async () => {
    db.query.microsite.findFirst.mockResolvedValue(undefined);

    const result = await beginMicrositeTurn(db as never, {
      session: { ...SESSION, organizationId: 'org-2' },
      message: 'Change everything',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });
});

describe('one turn, one revision', () => {
  it('writes exactly one revision for a turn that changed the draft', async () => {
    givenDraftSequence([homePageRow()], [homePageRow(), aboutPageRow()]);

    const begun = await beginMicrositeTurn(db as never, {
      session: SESSION,
      message: 'Add an about page',
    });
    expect(begun.success).toBe(true);
    if (!begun.success) return;

    const completed = await completeMicrositeTurn(db as never, {
      session: SESSION,
      turn: begun.data,
      assistantText: 'Added an About page.',
      toolCalls: [],
    });

    expect(completed.success).toBe(true);
    if (!completed.success) return;
    expect(completed.data.revisionId).toBe('rev-1');
    expect(completed.data.diff.added).toHaveLength(1);
    expect(completed.data.diff.added[0].blockId).toBe(RICH_TEXT.id);

    // ONE revision insert — the undo unit is the turn.
    const revisionInserts = db.transaction.mock.calls.length;
    expect(revisionInserts).toBe(1);
  });

  it('writes NO revision when the turn changed nothing', async () => {
    givenDraftSequence([homePageRow()], [homePageRow()]);

    const begun = await beginMicrositeTurn(db as never, {
      session: SESSION,
      message: 'What is on the home page?',
    });
    if (!begun.success) return;

    const completed = await completeMicrositeTurn(db as never, {
      session: SESSION,
      turn: begun.data,
      assistantText: 'A hero and a booking call-to-action.',
      toolCalls: [],
    });

    expect(completed.success).toBe(true);
    if (!completed.success) return;
    expect(completed.data.revisionId).toBeNull();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('writes the revision inside a transaction, so the draft pointer cannot go stale', async () => {
    givenDraftSequence([homePageRow()], [homePageRow(), aboutPageRow()]);

    const begun = await beginMicrositeTurn(db as never, {
      session: SESSION,
      message: 'Add an about page',
    });
    if (!begun.success) return;

    await completeMicrositeTurn(db as never, {
      session: SESSION,
      turn: begun.data,
      assistantText: 'Done.',
      toolCalls: [],
    });

    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('records the assistant turn against the revision it produced', async () => {
    givenDraftSequence([homePageRow()], [homePageRow(), aboutPageRow()]);

    const begun = await beginMicrositeTurn(db as never, {
      session: SESSION,
      message: 'Add an about page',
    });
    if (!begun.success) return;

    await completeMicrositeTurn(db as never, {
      session: SESSION,
      turn: begun.data,
      assistantText: 'Done.',
      toolCalls: [
        { id: 'call-1', name: 'create_page', args: { path: '/about' } },
      ],
    });

    const messageWrite = db.values.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .find((value) => value.role === 'assistant');
    expect(messageWrite).toMatchObject({
      role: 'assistant',
      revisionId: 'rev-1',
    });
  });
});

describe('the diff the sidebar renders', () => {
  const doc = (pages: ReturnType<typeof homePageRow>[]) => ({
    theme: micrositeRow().theme,
    pages: pages.map((page) => ({
      id: page.id,
      path: page.path,
      title: page.title,
      seo: {},
      blocks: page.blocks,
      order: page.order,
      isSystem: page.isSystem,
    })),
  });

  it('reports an added block', () => {
    const diff = computeMicrositeDiff(
      doc([homePageRow([HERO])]),
      doc([homePageRow([HERO, RICH_TEXT])])
    );
    expect(diff.added.map((entry) => entry.blockId)).toEqual([RICH_TEXT.id]);
    expect(diff.edited).toHaveLength(0);
  });

  it('reports an edited block', () => {
    const edited = {
      ...HERO,
      props: { ...HERO.props, headline: 'Different' },
    };
    const diff = computeMicrositeDiff(
      doc([homePageRow([HERO])]),
      doc([homePageRow([edited])])
    );
    expect(diff.edited.map((entry) => entry.blockId)).toEqual([HERO.id]);
  });

  it('reports a moved block as edited', () => {
    const diff = computeMicrositeDiff(
      doc([homePageRow([HERO, RICH_TEXT])]),
      doc([homePageRow([RICH_TEXT, HERO])])
    );
    expect(diff.edited).toHaveLength(2);
  });

  it('reports a removed block, including one on a deleted page', () => {
    const diff = computeMicrositeDiff(
      doc([homePageRow([HERO]), aboutPageRow()]),
      doc([homePageRow([HERO])])
    );
    expect(diff.removed.map((entry) => entry.blockId)).toEqual([RICH_TEXT.id]);
  });

  it('reports a theme change — a restore replaces the theme as well as the pages', () => {
    const before = doc([homePageRow([HERO])]);
    const after = {
      ...doc([homePageRow([HERO])]),
      theme: {
        ...before.theme,
        brand: { ...before.theme.brand, primary: '#000000' },
      },
    };
    expect(computeMicrositeDiff(before, after).themeChanged).toBe(true);
    expect(computeMicrositeDiff(before, before).themeChanged).toBe(false);
  });
});

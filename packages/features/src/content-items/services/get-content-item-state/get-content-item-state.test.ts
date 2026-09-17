import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

// Spy the SOURCE module, not the barrel: barrel re-exports are live getters
// under Vite SSR and cannot be redefined.
import * as loadSlotModule from '../load-slot/load-slot.js';
import { getContentItemState } from './get-content-item-state.js';

const ITEM_ID = 'item-1';
const ORG_ID = 'org-1';

const slot = (overrides: Record<string, unknown> = {}) => ({
  id: ITEM_ID,
  organizationId: ORG_ID,
  kind: 'video' as const,
  reviewStatus: 'pending',
  targetPageIds: null,
  pendingRegenerate: null,
  ...overrides,
});

const attempt = (overrides: Record<string, unknown> = {}) => ({
  id: 'attempt-2',
  slotId: ITEM_ID,
  attemptNumber: 1,
  videoId: 'video-2',
  graphicId: null,
  caption: 'The live caption.',
  ...overrides,
});

/**
 * The mock only has to answer two shapes of read: the attempt lookup (a
 * `select().from().where().limit()`) and the video's draftConfig. Both
 * terminate on `.limit`, so results are queued in call order.
 */
function createMockDb(rows: unknown[][]) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  const queue = [...rows];

  chain.select = vi.fn(self);
  chain.from = vi.fn(self);
  chain.where = vi.fn(self);
  chain.limit = vi.fn(() => Promise.resolve(queue.shift() ?? []));
  return chain;
}

const loaded = (slotRow: unknown, attemptRow: unknown) =>
  vi.spyOn(loadSlotModule, 'loadSlotForOrg').mockResolvedValue({
    success: true,
    data: { slot: slotRow, attempt: attemptRow },
  } as never);

/**
 * The one fact a card cannot know about itself.
 *
 * A card in a transcript is a HISTORICAL object reading LIVE state. Everything
 * here exists so it can tell the difference — which cut it was drawn for, which
 * cut is live now, and whether the content it offered to act on has been made
 * yet. Getting that wrong is what left an approved-and-rendered proposal still
 * offering Accept after a reload, and what lit up every graphic card in a
 * conversation at once.
 */
describe('getContentItemState', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('reports the live cut when no attempt is named', async () => {
    loaded(slot(), attempt());
    const db = createMockDb([[]]);

    const result = await getContentItemState(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.attemptId).toBe('attempt-2');
    expect(result.data.assetId).toBe('video-2');
    expect(result.data.superseded).toBe(false);
    expect(result.data.caption).toBe('The live caption.');
  });

  // The stamp. A card asks about the attempt it was drawn for, and the answer
  // has to be about THAT cut — otherwise an old card reads the current one and
  // believes it is still live.
  it('reads the NAMED attempt and marks it superseded', async () => {
    loaded(slot(), attempt());
    const db = createMockDb([
      [
        {
          id: 'attempt-0',
          slotId: ITEM_ID,
          attemptNumber: 0,
          videoId: 'video-1',
          graphicId: null,
          caption: 'The old caption.',
        },
      ],
      [],
    ]);

    const result = await getContentItemState(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      attemptId: 'attempt-0',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.attemptId).toBe('attempt-0');
    expect(result.data.assetId).toBe('video-1');
    expect(result.data.superseded).toBe(true);
    // The caption belongs to the cut asked about, not to the live one.
    expect(result.data.caption).toBe('The old caption.');
  });

  // `attemptNumber` exists because a card written before the id stamp existed
  // can never gain one — it opened its item, so its content is attempt 0 by
  // construction, and that needs nothing stored in the card to say so.
  it('accepts an attempt NUMBER as well as an id', async () => {
    loaded(slot(), attempt());
    const db = createMockDb([
      [
        {
          id: 'attempt-0',
          slotId: ITEM_ID,
          attemptNumber: 0,
          videoId: 'video-1',
          graphicId: null,
          caption: null,
        },
      ],
      [],
    ]);

    const result = await getContentItemState(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      attemptNumber: 0,
    });

    expect(result.success && result.data.attemptId).toBe('attempt-0');
    expect(result.success && result.data.superseded).toBe(true);
  });

  // Asking for the cut that IS live must not cost a second query, and must not
  // report itself as superseded.
  it('does not re-read when the named attempt is already the live one', async () => {
    loaded(slot(), attempt());
    const db = createMockDb([[]]);

    const result = await getContentItemState(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      attemptId: 'attempt-2',
    });

    expect(result.success && result.data.superseded).toBe(false);
    // One read only — the draftConfig lookup.
    expect((db.limit as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  // A PROPOSAL: shown to the owner, not yet acted on. The null asset IS the
  // state — it is how a card knows it has not already been accepted, which
  // React state forgets on every remount.
  it('reports a null asset for a proposal', async () => {
    loaded(
      slot({ kind: 'graphic' }),
      attempt({ videoId: null, graphicId: null, caption: null })
    );
    const db = createMockDb([]);

    const result = await getContentItemState(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
    });

    expect(result.success && result.data.assetId).toBeNull();
  });

  it('prefers the graphic id on a graphic post', async () => {
    loaded(
      slot({ kind: 'graphic' }),
      attempt({ videoId: null, graphicId: 'graphic-1' })
    );
    const db = createMockDb([]);

    const result = await getContentItemState(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
    });

    expect(result.success && result.data.assetId).toBe('graphic-1');
    // Graphics have no editable text — their words are pixels.
    expect(result.success && result.data.textFields).toEqual({});
    expect(result.success && result.data.templateKey).toBeNull();
  });

  // What makes "change point 3" answerable. Without it the model could only ask
  // the owner to read their own screen aloud.
  it('lists a video’s on-screen text and the block it lives in', async () => {
    loaded(slot(), attempt());
    const db = createMockDb([
      [
        {
          draftConfig: {
            numberedList: { title: 'Three steps', items: ['One', 'Two'] },
          },
        },
      ],
    ]);

    const result = await getContentItemState(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
    });

    expect(result.success && result.data.templateKey).toBe('numberedList');
    expect(result.success && result.data.textFields).toMatchObject({
      items: ['One', 'Two'],
    });
  });

  // A missing video row is not an error: the state is still worth reporting.
  it('survives a video row that is not there', async () => {
    loaded(slot(), attempt());
    const db = createMockDb([[]]);

    const result = await getContentItemState(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.textFields).toEqual({});
  });

  // The proposal the owner has been offered and not paid for. Invisible here
  // meant it was reported as done over a slide that had not changed.
  it('surfaces a proposed re-roll', async () => {
    const pending = [{ slideIndex: 5, op: 'refine', note: 'warmer' }];
    loaded(slot({ kind: 'graphic', pendingRegenerate: pending }), attempt());
    const db = createMockDb([]);

    const result = await getContentItemState(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
    });

    expect(result.success && result.data.pendingRegenerate).toEqual(pending);
  });

  it('reports no proposal as null rather than an empty list', async () => {
    loaded(slot(), attempt());
    const db = createMockDb([[]]);

    const result = await getContentItemState(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
    });

    expect(result.success && result.data.pendingRegenerate).toBeNull();
  });

  it('defaults target pages to an empty list', async () => {
    loaded(slot({ targetPageIds: null }), attempt());
    const db = createMockDb([[]]);

    const result = await getContentItemState(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
    });

    expect(result.success && result.data.targetPageIds).toEqual([]);
  });

  it('passes a load failure through', async () => {
    vi.spyOn(loadSlotModule, 'loadSlotForOrg').mockResolvedValue({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Item not found' },
    } as never);

    const result = await getContentItemState(createMockDb([]) as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(false);
  });
});

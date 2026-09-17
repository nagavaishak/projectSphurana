import { extractJson } from '@borradh-workspace/ai';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
// Spy the SOURCE module, not the barrel: barrel re-exports are live getters
// under Vite SSR and cannot be redefined.
import * as selectStockBRollModule from '../../../stock-footage/services/select-stock-broll/select-stock-broll.service.js';
import { handleReviewTurn } from './handle-review-turn.service.js';
import { buildReviewTurnPrompt } from './prompts.js';

const ITEM_ID = 'item-1';
const ORG_ID = 'org-1';

// The thread hangs off the slot; the copy it edits is on the cut.
import { attemptFixture, slotFixture } from '../_shared/test-fixtures.js';

const pendingItem = (overrides: Record<string, unknown> = {}) =>
  slotFixture({
    id: ITEM_ID,
    batchId: 'batch-1',
    kind: 'graphic',
    ...overrides,
  });

const pendingAttempt = (overrides: Record<string, unknown> = {}) =>
  attemptFixture({
    slotId: ITEM_ID,
    batchId: 'batch-1',
    videoId: null,
    graphicId: 'graphic-1',
    caption: 'Two weeks after her second Profhilo session.',
    ...overrides,
  });

/**
 * The service issues, in order: item+batch join, prior messages, org brandVoice,
 * content rules, then the transaction. Each read terminates on a different
 * chain method, so the mock queues results per terminal.
 */
function createMockDb(options: {
  itemRows?: unknown[];
  priorMessages?: unknown[];
  orgRows?: unknown[];
  ruleRows?: unknown[];
  videoRows?: unknown[];
  /** Clip names, read only when the video actually has clips. */
  assetRows?: unknown[];
  onTransaction?: () => void;
}) {
  const {
    itemRows = [
      {
        slot: pendingItem(),
        attempt: pendingAttempt(),
        batchOrgId: ORG_ID,
      },
    ],
    priorMessages = [],
    orgRows = [{ brandVoice: ['warm'] }],
    ruleRows = [],
    videoRows,
    assetRows,
    onTransaction = () => undefined,
  } = options;

  const inserted: unknown[][] = [];
  let selectCall = 0;

  const chain: Record<string, unknown> = {};
  const self = () => chain;

  chain.select = vi.fn(() => {
    selectCall += 1;
    return chain;
  });
  chain.from = vi.fn(self);
  chain.innerJoin = vi.fn(self);
  chain.where = vi.fn(() => {
    // 2nd select (prior messages) terminates on .orderBy, 4th (rules) on .limit
    // The clip-name lookup is the one read that terminates HERE, and it only
    // runs when the video has clips.
    if (assetRows && selectCall === 4) return Promise.resolve(assetRows);
    return chain;
  });
  // A VIDEO post reads its draftConfig as select 3 — after the item join and
  // the prior messages — shifting org and rules by one. Graphic posts skip it.
  const videoOffset = videoRows ? 1 : 0;
  const assetOffset = assetRows ? 1 : 0;

  chain.orderBy = vi.fn(() => {
    // prior messages (2) or content rules (which also has .limit)
    return selectCall === 2 ? Promise.resolve(priorMessages) : chain;
  });
  chain.limit = vi.fn(() => {
    if (selectCall === 1) return Promise.resolve(itemRows);
    if (videoRows && selectCall === 3) return Promise.resolve(videoRows);
    if (selectCall === 3 + videoOffset + assetOffset)
      return Promise.resolve(orgRows);
    return Promise.resolve(ruleRows);
  });

  chain.transaction = vi.fn(async (cb: (trx: unknown) => Promise<void>) => {
    onTransaction();
    const trx = {
      update: vi.fn(() => trx),
      set: vi.fn(() => trx),
      where: vi.fn(() => Promise.resolve([])),
      insert: vi.fn(() => trx),
      values: vi.fn((rows: unknown[]) => {
        inserted.push(rows);
        return Promise.resolve([]);
      }),
    } as Record<string, unknown>;
    await cb(trx);
  });

  return { db: chain, inserted };
}

const aiOk = (data: Record<string, unknown>) => ({
  success: true,
  data,
  raw: '',
  error: undefined,
});

describe('handleReviewTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rewrites the caption and appends exactly two thread messages', async () => {
    vi.mocked(extractJson).mockResolvedValueOnce(
      aiOk({
        kind: 'caption',
        caption: 'Skin that holds water again. Course of two, €390.',
        reply: 'Trimmed the opening and kept the hashtags.',
        suggestedRule: null,
      }) as never
    );

    const { db, inserted } = createMockDb({});

    const result = await handleReviewTurn(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      userId: 'user-1',
      instruction: 'shorter',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.caption).toContain('holds water again');
      expect(result.data.messages).toHaveLength(2);
      expect(result.data.messages[0]?.role).toBe('user');
      expect(result.data.messages[0]?.content).toBe('shorter');
      expect(result.data.messages[1]?.role).toBe('assistant');
      // The snapshot is what makes a turn revertible.
      expect(result.data.messages[1]?.captionSnapshot).toBe(
        result.data.caption
      );
    }

    expect(inserted[0]).toHaveLength(2);
  });

  it('never bumps regenerationCount — rewording is not a re-roll', async () => {
    vi.mocked(extractJson).mockResolvedValueOnce(
      aiOk({
        kind: 'caption',
        caption: 'A shorter caption here.',
        reply: 'Shortened it.',
      }) as never
    );

    const { db } = createMockDb({});

    await handleReviewTurn(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      userId: 'user-1',
      instruction: 'shorter',
    });

    // The only UPDATE is the caption write; nothing in this service touches
    // the regeneration counter — a caption rewrite is not a re-roll.
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('surfaces a generalisable instruction as a suggested rule', async () => {
    vi.mocked(extractJson).mockResolvedValueOnce(
      aiOk({
        kind: 'caption',
        caption: 'One hashtag only now. #profhilo',
        reply: 'Cut it to one hashtag.',
        suggestedRule: {
          title: 'One hashtag',
          content: 'Use exactly one hashtag on every post.',
        },
      }) as never
    );

    const { db } = createMockDb({});

    const result = await handleReviewTurn(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      userId: 'user-1',
      instruction: 'stop using three hashtags',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.suggestedRule?.content).toContain('one hashtag');
    }
  });

  it('reports a staged text edit in its own words, not the model’s', async () => {
    // SHIPPED DEFECT. The model answered "Changed the text in line 1 to '…'"
    // — past tense for something only STAGED (the video does not change until
    // it re-renders), and the wrong line: it wrote `lines[1]`, which is line 2.
    // Both facts are known exactly in the service, so it writes the sentence.
    vi.mocked(extractJson).mockResolvedValueOnce(
      aiOk({
        kind: 'text',
        field: 'lines',
        index: 1,
        value: 'Enhance your beautiful shape effortlessly',
        reply: 'Changed the text in line 1 to it. Done!',
      }) as never
    );

    const { db } = createMockDb({
      itemRows: [
        {
          slot: pendingItem({ kind: 'video' }),
          attempt: pendingAttempt({ videoId: 'video-1', graphicId: null }),
          batchOrgId: ORG_ID,
        },
      ],
      videoRows: [
        {
          draftConfig: {
            bRollClips: [],
            fadeBenefits: {
              lines: [
                'Body Contouring',
                'Enhance your natural shape effortlessly',
              ],
            },
          },
        },
      ],
    });

    const result = await handleReviewTurn(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      userId: 'user-1',
      instruction:
        'change the text from enhance your natural shape effortlessly to enhance your beautiful shape effortlessly',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const reply = result.data.messages[1]?.content ?? '';
      expect(reply).toContain('line 2');
      expect(reply).not.toContain('Changed the text in line 1');
      // Says plainly that nothing has happened to the video yet.
      expect(reply).toMatch(/hasn't changed yet|apply/i);
    }
  });

  // A null service is not "any service", it is NO SIGNAL — the stock matcher
  // falls back to the generic/ambient pool, which is how a microneedling post
  // ended up showing a dentist. The swap has to draw from the post's own
  // treatment.
  it("scopes a clip swap to the post's service", async () => {
    // The stock bank is not the subject — what matters is WHICH pool the swap
    // draws from, which is an argument, not a result.
    const selectStockBRoll = vi
      .spyOn(selectStockBRollModule, 'selectStockBRoll')
      .mockResolvedValue({ success: true, data: [] } as never);
    vi.mocked(extractJson).mockResolvedValueOnce(
      aiOk({
        kind: 'clips',
        operations: [{ op: 'swap', clipNumber: 1 }],
        reply: 'Swapped it.',
      }) as never
    );

    const { db } = createMockDb({
      itemRows: [
        {
          slot: pendingItem({ kind: 'video' }),
          attempt: pendingAttempt({ videoId: 'video-1', graphicId: null }),
          batchOrgId: ORG_ID,
        },
      ],
      videoRows: [
        {
          draftConfig: { bRollClips: [{ assetId: 'asset-1', order: 0 }] },
          serviceId: 'service-microneedling',
        },
      ],
      assetRows: [{ id: 'asset-1', name: 'Treatment room pan' }],
    });

    await handleReviewTurn(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      userId: 'user-1',
      instruction: 'change the first clip',
    });

    expect(selectStockBRoll).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ serviceId: 'service-microneedling' })
    );
  });

  // "Swap the second clip for something with the treatment room in it" used to
  // return the first clip of an arbitrary pool, because the description never
  // left the model's answer.
  it("searches the bank with the owner's description of the replacement", async () => {
    const selectStockBRoll = vi
      .spyOn(selectStockBRollModule, 'selectStockBRoll')
      .mockResolvedValue({ success: true, data: [] } as never);
    vi.mocked(extractJson).mockResolvedValueOnce(
      aiOk({
        kind: 'clips',
        operations: [
          {
            op: 'swap',
            clipNumber: 1,
            description: 'something with the treatment room in it',
          },
        ],
        reply: 'Swapped it.',
      }) as never
    );

    const { db } = createMockDb({
      itemRows: [
        {
          slot: pendingItem({ kind: 'video' }),
          attempt: pendingAttempt({ videoId: 'video-1', graphicId: null }),
          batchOrgId: ORG_ID,
        },
      ],
      videoRows: [
        {
          draftConfig: { bRollClips: [{ assetId: 'asset-1', order: 0 }] },
          serviceId: 'service-microneedling',
        },
      ],
      assetRows: [{ id: 'asset-1', name: 'Treatment room pan' }],
    });

    await handleReviewTurn(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      userId: 'user-1',
      instruction: 'swap the first clip for something with the treatment room',
    });

    expect(selectStockBRoll).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        query: 'something with the treatment room in it',
      })
    );
  });

  it('refuses a text edit that would change nothing', async () => {
    // The model can be talked into "changing" a line to what it already says.
    // Staging that lights up Apply and buys a byte-identical re-render.
    vi.mocked(extractJson).mockResolvedValueOnce(
      aiOk({
        kind: 'text',
        field: 'lines',
        index: 0,
        value: 'Body Contouring',
        reply: 'Updated it.',
      }) as never
    );

    const { db } = createMockDb({
      itemRows: [
        {
          slot: pendingItem({ kind: 'video' }),
          attempt: pendingAttempt({ videoId: 'video-1', graphicId: null }),
          batchOrgId: ORG_ID,
        },
      ],
      videoRows: [
        {
          draftConfig: {
            bRollClips: [],
            fadeBenefits: { lines: ['Body Contouring', 'Second line'] },
          },
        },
      ],
    });

    const result = await handleReviewTurn(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      userId: 'user-1',
      instruction: 'make line 1 say Body Contouring',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stagedEdits).toBeNull();
      expect(result.data.messages[1]?.content).toContain('already reads');
    }
  });

  it('returns NOT_FOUND for an item belonging to another org', async () => {
    const { db } = createMockDb({
      itemRows: [],
    });

    const result = await handleReviewTurn(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      userId: 'user-1',
      instruction: 'shorter',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  // A post made in conversation has NO caption — nothing writes one at create.
  // The guard this replaces was built for batch posts, where the planner always
  // supplies one, so an empty caption meant something upstream had broken. On a
  // Claire-made video it meant every caption request came back INVALID_STATE,
  // and the model — handed "no caption to edit yet" — invented a mechanism to
  // explain it and offered the owner two workarounds for a thing that works.
  it('WRITES a caption for a post that has never had one', async () => {
    vi.mocked(extractJson).mockResolvedValueOnce(
      aiOk({
        kind: 'caption',
        caption:
          'Three sessions is all it takes — microneedling that actually shows.',
        reply: 'Written.',
      }) as never
    );

    const { db } = createMockDb({
      itemRows: [
        {
          slot: pendingItem({ kind: 'video' }),
          attempt: pendingAttempt({
            videoId: 'video-1',
            graphicId: null,
            caption: null,
          }),
          batchOrgId: ORG_ID,
        },
      ],
      videoRows: [{ draftConfig: { bRollClips: [] }, serviceId: null }],
    });

    const result = await handleReviewTurn(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      userId: 'user-1',
      instruction: 'edit the caption to be more salesy',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.caption).toContain('microneedling');
    }
  });

  // The prompt has to SAY there is none. An empty string on its own reads as a
  // caption the owner chose to leave blank.
  it('tells the model it is composing rather than rewriting', async () => {
    vi.mocked(extractJson).mockResolvedValueOnce(
      aiOk({
        kind: 'caption',
        caption: 'A caption long enough to satisfy the schema minimum.',
        reply: 'Written.',
      }) as never
    );

    const { db } = createMockDb({
      itemRows: [
        {
          slot: pendingItem({ kind: 'video' }),
          attempt: pendingAttempt({
            videoId: 'video-1',
            graphicId: null,
            caption: null,
          }),
          batchOrgId: ORG_ID,
        },
      ],
      videoRows: [{ draftConfig: { bRollClips: [] }, serviceId: null }],
    });

    await handleReviewTurn(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      userId: 'user-1',
      instruction: 'make the caption punchier',
    });

    const { userMessage } = buildReviewTurnPrompt({
      currentCaption: '',
      instruction: 'make the caption punchier',
      priorMessages: [],
      contentRules: [],
      video: null,
      graphic: null,
    });
    expect(userMessage).toMatch(/none yet/i);
    expect(userMessage).toMatch(/WRITE one/i);
  });

  // "change the text to be less salesy" on a GRAPHIC rewrote the caption and
  // left the image untouched — then reported the text as updated. The caption
  // action called itself "the default for anything about the words", which
  // matches that request almost verbatim, and it sat in the ACTIONS list while
  // the pixels rule sat in a context block above it.
  it('tells the model that "the text" on a graphic means the pixels', () => {
    const { systemMessage, userMessage } = buildReviewTurnPrompt({
      currentCaption: 'A caption.',
      instruction: 'change the text to be less salesy',
      priorMessages: [],
      contentRules: [],
      video: null,
      graphic: { kind: 'single', slideCount: 1 },
    });

    // The post-specific block travels with the post, in the user message.
    expect(userMessage).toMatch(/"the text" MEANS THE PIXELS/i);
    // And the caption action no longer claims every request about wording.
    expect(systemMessage).toMatch(/words published ALONGSIDE the post/i);
  });

  it('refuses to edit an already-decided post', async () => {
    const { db } = createMockDb({
      itemRows: [
        {
          slot: pendingItem({ reviewStatus: 'accepted' }),
          attempt: pendingAttempt(),
          batchOrgId: ORG_ID,
        },
      ],
    });

    const result = await handleReviewTurn(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      userId: 'user-1',
      instruction: 'shorter',
    });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
  });

  it('returns VALIDATION_ERROR for an empty instruction', async () => {
    const { db } = createMockDb({});

    const result = await handleReviewTurn(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      userId: 'user-1',
      instruction: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(db.select).not.toHaveBeenCalled();
  });

  it('does not persist anything when the model fails', async () => {
    vi.mocked(extractJson).mockResolvedValueOnce({
      success: false,
      data: undefined,
      raw: 'nonsense',
      error: 'schema mismatch',
    } as never);

    const onTransaction = vi.fn();
    const { db } = createMockDb({ onTransaction });

    const result = await handleReviewTurn(db as never, {
      itemId: ITEM_ID,
      organizationId: ORG_ID,
      userId: 'user-1',
      instruction: 'shorter',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
    expect(onTransaction).not.toHaveBeenCalled();
  });
});

describe('buildReviewTurnPrompt', () => {
  const base = {
    video: null,
    currentCaption: 'Two weeks after her second Profhilo session.',
    instruction: 'less salesy',
    priorMessages: [],
    contentRules: [],
  };

  it('keeps the caption action from touching the rendered asset', () => {
    // The turn as a whole CAN now change the video — but only through the
    // named clip/text actions. "Less salesy" must still never be read as
    // licence to re-roll an asset that cost real time and money.
    const { systemMessage } = buildReviewTurnPrompt(base);

    expect(systemMessage).toMatch(/caption TEXT ONLY/);
    expect(systemMessage).toMatch(/cannot change, re-shoot, re-crop/i);
  });

  it('tells a graphic post it has no clips, and that its words need a re-roll', () => {
    const { userMessage } = buildReviewTurnPrompt(base);

    expect(userMessage).toMatch(/THIS POST IS A GRAPHIC/);
    expect(userMessage).toMatch(/no clips/i);
    // The prompt used to end there and send every text request to
    // "unsupported", telling the owner to go and regenerate the image by hand.
    // Changing words on a graphic IS possible — it just costs a render.
    expect(userMessage).toMatch(/PIXELS, not editable fields/);
    expect(userMessage).toMatch(/regenerate/i);
  });

  it('names a carousel’s slide count so a proposal can target one', () => {
    // Without this the model is guessing how many slides exist, and "fix slide
    // 3" on a two-slide deck reaches the renderer before anything checks.
    const { userMessage } = buildReviewTurnPrompt({
      ...base,
      graphic: { kind: 'carousel', slideCount: 5 },
    });

    expect(userMessage).toMatch(/CAROUSEL of 5 slides/);
  });

  it('lists the clips and editable text of a video post', () => {
    const { userMessage } = buildReviewTurnPrompt({
      ...base,
      video: {
        clips: ['Treatment room pan', 'Syringe tray'],
        templateKey: 'fadeBenefits',
        textFields: { lines: ['Skin that holds water', 'No filler'] },
      },
    });

    // Numbered from 1, because that is how the owner says "clip 2".
    expect(userMessage).toContain('1. Treatment room pan');
    expect(userMessage).toContain('2. Syringe tray');
    expect(userMessage).toContain('fadeBenefits');
    expect(userMessage).toContain('0: "Skin that holds water"');
  });

  it('tells the model to leave unrequested parts alone', () => {
    const { systemMessage } = buildReviewTurnPrompt(base);

    expect(systemMessage).toMatch(/leave the rest alone/i);
  });

  it('biases towards no standing rule when uncertain', () => {
    const { systemMessage } = buildReviewTurnPrompt(base);

    expect(systemMessage).toMatch(/When in doubt, return null/i);
  });

  it('includes prior turns so follow-ups resolve', () => {
    const { userMessage } = buildReviewTurnPrompt({
      ...base,
      instruction: 'shorter than that',
      priorMessages: [
        {
          id: 'm1',
          role: 'user',
          content: 'less salesy',
          captionSnapshot: null,
          createdAt: '2026-07-01T10:00:00.000Z',
        },
      ],
    });

    expect(userMessage).toContain('EARLIER IN THIS THREAD');
    expect(userMessage).toContain('Owner: less salesy');
  });

  it('marks standing rules as overriding', () => {
    const { systemMessage } = buildReviewTurnPrompt({
      ...base,
      contentRules: ['Use exactly one hashtag.'],
    });

    expect(systemMessage).toContain('- Use exactly one hashtag.');
    expect(systemMessage).toMatch(/OVERRIDE/);
  });
});

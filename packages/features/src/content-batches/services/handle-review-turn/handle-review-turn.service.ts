import { randomUUID } from 'node:crypto';
import {
  RATE_LIMIT_MESSAGE,
  extractJson,
  initAIClient,
  isAIClientInitialized,
  isRateLimitError,
} from '@borradh-workspace/ai';
import {
  type VideoDraftConfig,
  asset,
  contentAttempt,
  contentItem,
  contentItemMessage,
  graphic as graphicTable,
  organization,
  video as videoTable,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { getContentRuleLines } from '../../../assistant/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { selectStockBRoll } from '../../../stock-footage/index.js';
import { loadPendingSlotForOrg } from '../_shared/index.js';
import {
  type HandleReviewTurnInput,
  type ReviewThreadMessage,
  type ReviewTurnResponse,
  type StagedClipEdit,
  handleReviewTurnSchema,
  reviewTurnActionSchema,
} from './handle-review-turn.schema.js';
import {
  type GraphicContext,
  type VideoContext,
  buildReviewTurnPrompt,
} from './prompts.js';
import {
  activeTemplateKey,
  buildTextPatch,
  draftWithStagedPatch,
  hasStagedEdits,
  mergePatches,
  parsePendingVideoEdits,
  templateTextFields,
} from './video-edits.js';

const ensureAIClient = async (): Promise<Result<void>> => {
  if (isAIClientInitialized()) return ok(undefined);
  const { apiEnv } = await import('@borradh-workspace/env/api');
  const apiKey = apiEnv.OPENAI_API_KEY;
  if (!apiKey) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'OpenAI API key not configured'
      )
    );
  }
  initAIClient({ apiKey });
  return ok(undefined);
};

const toThreadMessage = (row: {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  captionSnapshot: string | null;
  createdAt: Date;
}): ReviewThreadMessage => ({
  id: row.id,
  role: row.role,
  content: row.content,
  captionSnapshot: row.captionSnapshot,
  createdAt: row.createdAt.toISOString(),
});

/**
 * One turn of the per-post review thread.
 *
 * The turn resolves to EXACTLY ONE action — rewrite the caption, stage clip
 * edits, stage an on-screen text change, or explain why it can't. Splitting
 * them at the model boundary is what keeps a free change (words) from silently
 * costing a re-render (pixels).
 *
 * Video edits are STAGED, never applied here. Committing them is
 * `applyBatchItemVideoEdits`, because every commit is a render and "remove clip
 * 1, change clip 2, fix the text" should cost one, not three.
 *
 * Nothing in this service bumps `regenerationCount`: that cap bounds AI
 * re-rolls, and a considered clip change is not indecision.
 *
 * The thread is scoped to this item. Prior turns are loaded so "shorter than
 * that" and "change it again" resolve, but no other post's copy is ever in
 * context — a rewrite that can see post 1 while editing post 3 will borrow.
 */
const handleReviewTurnImpl = async (
  db: DbConnection,
  input: HandleReviewTurnInput
): Promise<Result<ReviewTurnResponse>> => {
  const parsed = handleReviewTurnSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { itemId, organizationId, userId, instruction } = parsed.data;

  const loaded = await loadPendingSlotForOrg(db, { itemId, organizationId });
  if (!loaded.success) return err(loaded.error);
  // The thread hangs off the SLOT so it survives a regenerate; the copy and the
  // clips it edits belong to the ATTEMPT currently on screen.
  const { slot: item, attempt } = loaded.data;

  // A post with NO caption gets one written, not a refusal.
  //
  // This guard was correct for the surface it was built on: a batch post always
  // arrives with a caption from the planner, so an empty one meant something had
  // gone wrong upstream. A post made in conversation has none — nothing writes a
  // caption at create — so "make the caption more salesy" hit INVALID_STATE on
  // every Claire-made video, and the model, handed "no caption to edit yet",
  // invented a mechanism to explain it ("it gets generated at render time") and
  // offered the owner two workarounds for a thing that simply works.
  //
  // "Make it more salesy" with nothing there is a perfectly good brief. The
  // prompt below is told whether it is rewriting or composing.
  const currentCaption = attempt.caption?.trim() ?? '';

  const priorRows = await withOrgScope(
    (tx) =>
      tx
        .select({
          id: contentItemMessage.id,
          role: contentItemMessage.role,
          content: contentItemMessage.content,
          captionSnapshot: contentItemMessage.captionSnapshot,
          createdAt: contentItemMessage.createdAt,
        })
        .from(contentItemMessage)
        .where(eq(contentItemMessage.itemId, itemId))
        .orderBy(asc(contentItemMessage.createdAt)),
    { db }
  );
  const priorMessages = priorRows.map(toThreadMessage);

  // ── The video, when there is one ─────────────────────────────────────────
  let draftConfig: VideoDraftConfig | null = null;
  let clipAssetIds: string[] = [];
  let videoContext: VideoContext | null = null;
  /**
   * The treatment this post is about, carried to the clip swap below.
   *
   * Without it the swap draws from the generic/ambient pool, which is how a
   * microneedling post ended up showing a dentist. Same failure the stock
   * matcher has: a null service is not "any service", it is "no signal".
   */
  let videoServiceId: string | null = null;

  if (item.kind === 'video' && attempt.videoId) {
    const [videoRow] = await withOrgScope(
      (tx) =>
        tx
          .select({
            draftConfig: videoTable.draftConfig,
            serviceId: videoTable.serviceId,
          })
          .from(videoTable)
          .where(eq(videoTable.id, attempt.videoId as string))
          .limit(1),
      { db }
    );

    draftConfig = videoRow?.draftConfig ?? null;
    videoServiceId = videoRow?.serviceId ?? null;
    clipAssetIds = (draftConfig?.bRollClips ?? [])
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((clip) => clip.assetId);

    // Name the clips so the model — and the reply the owner reads — can refer
    // to something more useful than a position.
    const names = new Map<string, string>();
    if (clipAssetIds.length > 0) {
      const assetRows = await withOrgScope(
        (tx) =>
          tx
            .select({ id: asset.id, name: asset.name })
            .from(asset)
            .where(inArray(asset.id, clipAssetIds)),
        { db }
      );
      for (const a of assetRows) names.set(a.id, a.name);
    }

    videoContext = {
      clips: clipAssetIds.map((id) => names.get(id) ?? 'Untitled clip'),
      templateKey: activeTemplateKey(draftConfig),
      textFields: templateTextFields(draftConfig),
    };
  }

  // ── The graphic, when there is one ───────────────────────────────────────
  //
  // Slide count, so a proposal can name the right slide. Without it the model
  // is guessing how many there are, and "fix slide 3" on a two-slide deck would
  // reach the renderer before anything checked.
  let graphicContext: GraphicContext | null = null;
  if (item.kind === 'graphic' && attempt.graphicId) {
    const [graphicRow] = await withOrgScope(
      (tx) =>
        tx
          .select({ kind: graphicTable.kind, outputs: graphicTable.outputs })
          .from(graphicTable)
          .where(eq(graphicTable.id, attempt.graphicId as string))
          .limit(1),
      { db }
    );
    if (graphicRow) {
      graphicContext = {
        kind: graphicRow.kind ?? 'single',
        slideCount: Math.max(1, (graphicRow.outputs ?? []).length),
      };
    }
  }

  const aiInit = await ensureAIClient();
  if (!aiInit.success) return err(aiInit.error);

  const [org] = await withOrgScope(
    (tx) =>
      tx
        .select({ brandVoice: organization.brandVoice })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1),
    { db }
  );

  const contentRules = await getContentRuleLines(db, organizationId);

  const { systemMessage, userMessage } = buildReviewTurnPrompt({
    currentCaption,
    instruction,
    priorMessages,
    contentRules,
    brandVoice: (org?.brandVoice as string[] | null) ?? undefined,
    video: videoContext,
    graphic: graphicContext,
  });

  let action: import('./handle-review-turn.schema.js').ReviewTurnAction;

  try {
    const result = await extractJson(userMessage, {
      systemMessage,
      schema: reviewTurnActionSchema,
      // Cooler than first-draft generation: this is an edit to existing copy or
      // a classification, and the owner asked for one specific change.
      temperature: 0.5,
    });

    if (!result.success || !result.data) {
      if (result.error === RATE_LIMIT_MESSAGE) {
        return err(
          new FeatureError(ErrorCodes.RATE_LIMITED, RATE_LIMIT_MESSAGE)
        );
      }
      logError(
        'contentBatches.handleReviewTurn',
        new Error('AI extraction failed'),
        {
          feature: 'content-batches',
          extra: {
            itemId,
            organizationId,
            raw: result.raw,
            error: result.error,
          },
        }
      );
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to work out what to change'
        )
      );
    }

    action = result.data;
  } catch (error) {
    if (isRateLimitError(error)) {
      return err(new FeatureError(ErrorCodes.RATE_LIMITED, RATE_LIMIT_MESSAGE));
    }
    logError('contentBatches.handleReviewTurn', error, {
      feature: 'content-batches',
      extra: { itemId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to work out what to change'
      )
    );
  }

  // ── Turn the action into a caption write and/or staged edits ─────────────
  const staged = parsePendingVideoEdits(attempt.pendingVideoEdits);
  // Starts EMPTY, not null: a post made in conversation has never had a caption,
  // and the response contract carries a string. Whether one was written is
  // `captionSnapshot`, not the absence of a value.
  let nextCaption = currentCaption;
  let reply = action.reply;
  let captionSnapshot: string | null = null;
  let stagedClips: StagedClipEdit[] = staged.clipOperations.map((op) =>
    op.op === 'replace-all'
      ? { op: 'relist' as const, clipCount: op.assetIds.length }
      : {
          op: op.op,
          clipNumber: op.index + 1,
          ...(op.op === 'swap' ? { assetId: op.assetId } : {}),
        }
  );
  const textChanges: string[] = [];
  let nextEdits = staged;

  if (action.kind === 'caption') {
    nextCaption = action.caption;
    captionSnapshot = action.caption;
  }

  if (action.kind === 'clips') {
    if (!videoContext || clipAssetIds.length === 0) {
      reply =
        "There aren't any clips on this post to change — regenerating the asset is a separate action.";
    } else {
      // Resolve swaps HERE, not at apply time: it lets the reply name what it
      // picked, and lets "change it again" exclude the previous pick.
      const excluded = new Set<string>(clipAssetIds);
      for (const op of staged.clipOperations) {
        if (op.op === 'swap') excluded.add(op.assetId);
      }

      const needsReplacement = action.operations.filter(
        (op) => op.op === 'swap'
      ).length;
      let candidates: string[] = [];

      // What they said they wanted, if anything. Several swaps in one turn
      // share a pool, so the descriptions are joined — the ranking is a filter,
      // not a per-clip assignment, and two descriptions narrow it further than
      // one.
      const swapQuery = action.operations
        .flatMap((op) =>
          op.op === 'swap' && op.description ? [op.description] : []
        )
        .join(' ');

      if (needsReplacement > 0) {
        const selection = await selectStockBRoll(db, {
          organizationId,
          ...(swapQuery ? { query: swapQuery } : {}),
          // The post's own treatment, not the generic pool — see
          // `videoServiceId` above.
          serviceId: videoServiceId,
          uploadedById: userId,
          count: Math.min(20, clipAssetIds.length + needsReplacement + 4),
        });
        if (selection.success) {
          candidates = selection.data
            .map((clip) => clip.assetId)
            .filter((id) => !excluded.has(id));
        }
      }

      const applied: StagedClipEdit[] = [];
      const rejected: number[] = [];

      for (const op of action.operations) {
        const index = op.clipNumber - 1;
        if (index < 0 || index >= clipAssetIds.length) {
          rejected.push(op.clipNumber);
          continue;
        }
        if (op.op === 'remove') {
          nextEdits = {
            ...nextEdits,
            clipOperations: [
              ...nextEdits.clipOperations,
              { op: 'remove', index },
            ],
          };
          applied.push({ op: 'remove', clipNumber: op.clipNumber });
          continue;
        }
        const replacement = candidates.shift();
        if (!replacement) {
          rejected.push(op.clipNumber);
          continue;
        }
        excluded.add(replacement);
        nextEdits = {
          ...nextEdits,
          clipOperations: [
            ...nextEdits.clipOperations,
            { op: 'swap', index, assetId: replacement },
          ],
        };
        applied.push({
          op: 'swap',
          clipNumber: op.clipNumber,
          assetId: replacement,
        });
      }

      stagedClips = [...stagedClips, ...applied];

      if (applied.length === 0) {
        reply =
          rejected.length > 0
            ? `This post only has ${clipAssetIds.length} clip${clipAssetIds.length === 1 ? '' : 's'}, so I couldn't change clip ${rejected[0]}.`
            : "I couldn't find different footage to swap in.";
      } else if (rejected.length > 0) {
        reply = `${action.reply} I couldn't do clip ${rejected.join(', ')} — this post only has ${clipAssetIds.length}.`;
      }
    }
  }

  if (action.kind === 'text') {
    // Against the draft AS STAGED, not as rendered. A second edit built from the
    // raw draft snapshots an array that is missing the first one, and the array
    // replaces wholesale on merge — so edit 1 vanished when edit 2 was staged.
    // This is also what makes "line 2 already reads X" true of what the owner
    // has asked for rather than of what is currently on screen.
    const patch = buildTextPatch(
      draftWithStagedPatch(draftConfig, nextEdits.patch),
      action.field,
      action.value,
      action.index
    );
    if (patch.ok) {
      nextEdits = {
        ...nextEdits,
        patch: mergePatches(nextEdits.patch, patch.patch),
      };
      textChanges.push(patch.summary);
      // The service writes this sentence, not the model.
      //
      // Left to itself the model reported in the PAST TENSE ("Changed the text
      // in line 1 to …") for something that has only been staged, and named the
      // wrong line — it said line 1 for an edit to `lines[1]`, which is line 2.
      // Both facts are known exactly here: `patch.summary` is built from the
      // index actually written. A caption edit lands immediately and may be
      // described as done; on-screen text cannot, because it does not exist
      // until the video is re-rendered.
      reply = `Staged ${patch.summary}. The video hasn't changed yet — apply it to re-render.`;
    } else {
      // The model named a field that isn't there. Say so rather than writing a
      // key into the draft that no template reads.
      reply = `I couldn't change that — ${patch.reason}.`;
    }
  }

  // ── A proposed re-roll ─────────────────────────────────────────────────
  //
  // Nothing is spent here. The proposal lands on the SLOT and the reply points
  // at the button; pressing it is what costs a render. This is the only way a
  // GRAPHIC changes its words — its text is pixels, not data — and the thread
  // used to refuse the ask outright and send the owner off to do it by hand.
  let pendingRegenerate:
    | {
        slideIndex: number | null;
        op: 'refine' | 'remove';
        note?: string;
        intent?: 'copy' | 'image' | 'branding' | 'full';
      }[]
    | null = null;

  if (action.kind === 'regenerate') {
    if (
      item.kind === 'video' &&
      action.edits.some((e) => e.slideIndex !== null)
    ) {
      // A video has no slides. Rather than fail the turn, treat it as a
      // whole-asset re-roll and keep the instruction.
      pendingRegenerate = [
        {
          slideIndex: null,
          op: 'refine',
          ...(action.intent ? { intent: action.intent } : {}),
          note: action.edits
            .map((e) => e.note)
            .filter((note): note is string => Boolean(note))
            .join(' '),
        },
      ];
    } else {
      // The intent rides on each entry so it survives the round-trip through
      // the slot and back up on confirm — the renderer needs it, and losing it
      // there is what turned a logo request into "the picture must not move".
      pendingRegenerate = action.edits.map((edit) => ({
        ...edit,
        ...(action.intent ? { intent: action.intent } : {}),
      }));
    }
    reply = action.reply;
  }

  const now = new Date();
  const userMessageRow = {
    id: randomUUID(),
    organizationId: item.organizationId,
    batchId: item.batchId,
    itemId,
    role: 'user' as const,
    content: instruction,
    captionSnapshot: null,
    createdAt: now,
  };
  const assistantMessageRow = {
    id: randomUUID(),
    organizationId: item.organizationId,
    batchId: item.batchId,
    itemId,
    role: 'assistant' as const,
    content: reply,
    // The caption AFTER this turn — what makes every caption turn revertible
    // without a second table. Null when the turn didn't touch the words.
    captionSnapshot,
    createdAt: new Date(now.getTime() + 1),
  };

  const editsChanged = nextEdits !== staged;

  try {
    await withOrgScope(
      (tx) =>
        // One transaction: a caption or a staged edit that moved without its
        // thread entry would show the owner a change nobody asked for.
        (tx as DbConnection).transaction(async (trx) => {
          if (pendingRegenerate) {
            // Slot-level: the proposal outlives the cut it was asked about, and
            // is cleared when the re-roll it describes is actually spent.
            await trx
              .update(contentItem)
              .set({ pendingRegenerate })
              .where(
                and(
                  eq(contentItem.id, itemId),
                  eq(contentItem.reviewStatus, 'pending')
                )
              );
          }

          if (action.kind === 'caption' || editsChanged) {
            await trx
              .update(contentAttempt)
              .set({
                ...(action.kind === 'caption' ? { caption: nextCaption } : {}),
                ...(editsChanged ? { pendingVideoEdits: nextEdits } : {}),
              })
              // Re-assert inside the transaction what was true when the model
              // started thinking. Two things can have moved in that window, and
              // both make this write wrong rather than merely stale: the owner
              // may have hit Accept in another tab (silently editing a decided
              // post is worse than failing), or regenerated, in which case this
              // caption belongs to a cut nobody is looking at any more.
              .where(
                and(
                  eq(contentAttempt.id, attempt.id),
                  sql`EXISTS (
                    SELECT 1 FROM ${contentItem}
                    WHERE ${contentItem.id} = ${itemId}
                      AND ${contentItem.reviewStatus} = 'pending'
                      AND ${contentItem.currentAttemptId} = ${attempt.id}
                  )`
                )
              );
          }

          await trx
            .insert(contentItemMessage)
            .values([userMessageRow, assistantMessageRow]);
        }),
      { db }
    );
  } catch (error) {
    logError('contentBatches.handleReviewTurn.persist', error, {
      feature: 'content-batches',
      extra: { itemId, organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to save that change')
    );
  }

  return ok({
    caption: nextCaption,
    messages: [
      ...priorMessages,
      toThreadMessage(userMessageRow),
      toThreadMessage(assistantMessageRow),
    ],
    suggestedRule:
      action.kind === 'caption' ? (action.suggestedRule ?? null) : null,
    stagedEdits: hasStagedEdits(nextEdits)
      ? { clips: stagedClips, textChanges }
      : null,
    renderCount: attempt.editRenderCount,
    pendingRegenerate,
  });
};

export const handleReviewTurn = (
  db: DbConnection,
  input: HandleReviewTurnInput
) =>
  trackedResult(
    'contentBatches.handleReviewTurn',
    () => handleReviewTurnImpl(db, input),
    {
      properties: {
        itemId: input.itemId,
        organizationId: input.organizationId,
      },
    }
  );

export type HandleReviewTurnResult = Awaited<
  ReturnType<typeof handleReviewTurn>
>;

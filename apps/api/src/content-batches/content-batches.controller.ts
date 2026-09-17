import { db } from '@borradh-workspace/database';
import {
  acceptBatchItem,
  applyBatchItemVideoEdits,
  deleteCurrentBatch,
  discardItemVideoEdits,
  getBatch,
  getCurrentBatch,
  handleReviewTurn,
  listBatchItemClips,
  listBatchItemMessages,
  listContentBatches,
  regenerateBatchItem,
  rejectBatchItem,
  requestMonthlyBatch,
  stageItemClipEdits,
  undoRegenerate,
  updateBatchItemCaption,
} from '@borradh-workspace/features/content-batches';
import { getContentItemState } from '@borradh-workspace/features/content-items';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ActiveOrganization, AuthGuard, CurrentUser } from '../common/index.js';
import {
  AcceptBatchItemDto,
  GenerateContentBatchDto,
  ListContentBatchesDto,
  RegenerateBatchItemDto,
  ReviewTurnDto,
  StageItemClipsDto,
  UpdateBatchItemCaptionDto,
} from './dto/index.js';
import { signBatchMedia } from './sign-batch-media.js';

@Controller('content-batches')
@UseGuards(AuthGuard)
export class ContentBatchesController {
  private readonly logger = new Logger(ContentBatchesController.name);

  private requireActiveOrganization(
    organizationId: string | undefined
  ): string {
    if (!organizationId) {
      throw new HttpException(
        'No active organization selected',
        HttpStatus.BAD_REQUEST
      );
    }
    return organizationId;
  }

  /**
   * Returns the batch for the current UTC month, with items + assets
   * hydrated. The Socials page hits this on load to decide whether to
   * show the review modal.
   *
   * Returns 404 if the cron hasn't run yet for this org/month — the UI
   * treats that as "no batch this month" rather than an error.
   */
  @Get('current')
  async current(@ActiveOrganization() orgId: string | undefined) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await getCurrentBatch(db, { organizationId });
    if (!result.success) throw this.mapError(result.error);
    return signBatchMedia(result.data);
  }

  /**
   * Reset bulk content: hard-delete this month's batch (items + their
   * video/graphic rows + the batch row). After this `GET current` 404s again
   * and the planner's Bulk Create button re-enables. Idempotent — deleting
   * when there's no batch returns `deleted: false`.
   */
  @Delete('current')
  async deleteCurrent(@ActiveOrganization() orgId: string | undefined) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await deleteCurrentBatch(db, { organizationId });
    if (!result.success) throw this.mapError(result.error);
    this.logger.log(
      `Content batch reset: deleted=${result.data.deleted}${
        result.data.batchId ? ` (${result.data.batchId})` : ''
      } (org=${organizationId})`
    );
    return result.data;
  }

  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async list(
    @ActiveOrganization() orgId: string | undefined,
    @Query() query: ListContentBatchesDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listContentBatches(db, {
      ...query,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get(':id')
  async findOne(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await getBatch(db, { id, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return signBatchMedia(result.data);
  }

  /**
   * Manual trigger for the monthly content batch. The cron runs the same
   * planning on the 1st of every month — this endpoint lets a user (or smoke
   * test) kick it off mid-month with custom counts.
   *
   * ASYNC: the heavy LLM plan + per-video dispatch can take 30–60s, so this
   * endpoint performs media/service preflight plus fast DB prep, then enqueues
   * the slow seed on BullMQ. It returns `queued: true` only after Redis accepts
   * the job; the client polls `GET /content-batches/current` for progress.
   *
   * Idempotent on `(organizationId, periodMonth)` by default: if a batch
   * already exists and neither `append` nor `replace` is set, the existing
   * row is returned with `alreadyExisted: true` and nothing is queued. The
   * manual "Create Batch" button passes `replace: true` so each click wipes
   * the review queue and regenerates from scratch.
   */
  @Post('generate')
  @UsePipes(new ValidationPipe({ transform: true }))
  async generate(
    @ActiveOrganization() orgId: string | undefined,
    @CurrentUser('id') userId: string,
    @Body() body: GenerateContentBatchDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await requestMonthlyBatch(db, {
      ...body,
      organizationId,
      createdById: userId,
    });
    if (!result.success) throw this.mapError(result.error);
    this.logger.log(
      `Content batch ${result.data.queued ? 'queued' : 'already existed'}: ${result.data.batch.id} (org=${organizationId}, alreadyExisted=${result.data.alreadyExisted})`
    );
    return result.data;
  }

  /**
   * Accept a batch item and schedule it to socials. The (optionally edited)
   * caption / schedule / target pages come from the review dialog; the
   * service resolves the item's media, creates the social post, and links it
   * back to the item.
   */
  @Post('items/:itemId/accept')
  @UsePipes(new ValidationPipe({ transform: true }))
  async accept(
    @ActiveOrganization() orgId: string | undefined,
    @CurrentUser('id') userId: string,
    @Param('itemId') itemId: string,
    @Body() body: AcceptBatchItemDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await acceptBatchItem(db, {
      ...body,
      itemId,
      organizationId,
      createdById: userId,
    });
    if (!result.success) throw this.mapError(result.error);
    this.logger.log(
      `Content batch item accepted: ${itemId} (org=${organizationId})`
    );
    return result.data;
  }

  /**
   * Mark a single batch item as rejected. The slot is dropped with no
   * replacement and no follow-up social post — the user decided it isn't
   * worth shipping. Other slots in the batch are unaffected.
   */
  @Post('items/:itemId/reject')
  async reject(
    @ActiveOrganization() orgId: string | undefined,
    @Param('itemId') itemId: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await rejectBatchItem(db, { itemId, organizationId });
    if (!result.success) throw this.mapError(result.error);
    this.logger.log(
      `Content batch item rejected: ${itemId} (org=${organizationId})`
    );
    return result.data;
  }

  /**
   * Re-roll the post: append a fresh cut and make it the live one.
   *
   * The id in the path is the id that comes back — a regenerate no longer
   * mints a replacement row, so the client's selection and the post's thread
   * both stay put. The new render is queued out-of-band; the UI polls until the
   * underlying graphic/video flips to `ready`.
   *
   * SPREADS the validated body rather than hand-picking off it. This used to
   * forward `reason` alone, silently dropping `slideIndex` (and later `edits`)
   * AFTER the DTO had validated them — so "change slide 2" reached the service
   * as a bare re-roll with nothing to amend, fell through to composing a fresh
   * deck, and returned slides of unrelated copy. Per-slide refinement had never
   * once worked through the API. The DTO is the allow-list (it omits exactly
   * the three fields taken from the path and session), so re-filtering here
   * could only lose fields, never add safety.
   */
  @Post('items/:itemId/regenerate')
  @UsePipes(new ValidationPipe({ transform: true }))
  async regenerate(
    @ActiveOrganization() orgId: string | undefined,
    @CurrentUser('id') userId: string,
    @Param('itemId') itemId: string,
    @Body() body: RegenerateBatchItemDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await regenerateBatchItem(db, {
      ...body,
      itemId,
      organizationId,
      createdById: userId,
    });
    if (!result.success) throw this.mapError(result.error);
    this.logger.log(
      `Content batch item regenerated: ${itemId} → attempt ${result.data.attemptNumber} (org=${organizationId})`
    );
    return result.data;
  }

  /**
   * Go back to the previous cut of a post.
   *
   * No body: there is exactly one place to go back to, and offering a target
   * attempt id would be an addressable version history — a different feature
   * (see the design doc's "undo-to-previous only" decision).
   *
   * Instant, because nothing is re-rendered — the previous attempt's asset was
   * never destroyed. It does NOT refund a regeneration.
   */
  @Post('items/:itemId/undo-regenerate')
  async undoRegenerateItem(
    @ActiveOrganization() orgId: string | undefined,
    @Param('itemId') itemId: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await undoRegenerate(db, { itemId, organizationId });
    if (!result.success) throw this.mapError(result.error);
    this.logger.log(
      `Content batch item reverted: ${itemId} → attempt ${result.data.attemptNumber} (org=${organizationId})`
    );
    return result.data;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Per-post review thread — conversational copy editing
  // ──────────────────────────────────────────────────────────────────────

  /**
   * The review thread for one item, oldest first. Empty is the normal case;
   * the workspace restores this when the user navigates back to a post they
   * already edited.
   */
  @Get('items/:itemId/messages')
  async messages(
    @ActiveOrganization() orgId: string | undefined,
    @Param('itemId') itemId: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listBatchItemMessages(db, { itemId, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * One turn of the thread: the user asks for a change, Claire rewrites the
   * caption and replies.
   *
   * The turn resolves to exactly ONE action: rewrite the caption, stage clip
   * edits ("get rid of clip 1"), stage an on-screen text change, or explain why
   * it can't. Video edits are STAGED, never applied here — committing them is
   * `POST items/:itemId/apply-edits`, so several instructions cost one render.
   *
   * Never spends a regeneration from the cap: that bounds AI re-rolls, and a
   * considered clip change is not indecision.
   */
  @Post('items/:itemId/messages')
  @UsePipes(new ValidationPipe({ transform: true }))
  async reviewTurn(
    @ActiveOrganization() orgId: string | undefined,
    @CurrentUser('id') userId: string,
    @Param('itemId') itemId: string,
    @Body() body: ReviewTurnDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await handleReviewTurn(db, {
      itemId,
      organizationId,
      userId,
      instruction: body.instruction,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Set the caption directly — a hand-edit in the caption box, or a revert to
   * an earlier version from the thread. No model call, no thread entry.
   */
  @Patch('items/:itemId/caption')
  @UsePipes(new ValidationPipe({ transform: true }))
  async updateCaption(
    @ActiveOrganization() orgId: string | undefined,
    @Param('itemId') itemId: string,
    @Body() body: UpdateBatchItemCaptionDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await updateBatchItemCaption(db, {
      itemId,
      organizationId,
      caption: body.caption,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * The clips behind this post, in order, with any staged edit marked.
   *
   * Sourced from the video's `draftConfig.bRollClips` — the list the render
   * uses — not the editor's `video_draft_clip` tray, which batch-generated
   * videos never populate.
   */
  @Get('items/:itemId/clips')
  async clips(
    @ActiveOrganization() orgId: string | undefined,
    @Param('itemId') itemId: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listBatchItemClips(db, { itemId, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * The item as a CARD needs to see it: which cut is live, and whether it has
   * been made yet.
   *
   * `assetId: null` means the item is still only a proposal — shown to the
   * owner, not acted on. That is the one fact a card cannot know about itself,
   * and holding it in React state meant a remount handed back an Accept button
   * over a proposal that had already been accepted.
   *
   * Kind-agnostic on purpose: video and graphic cards ask the same question.
   */
  @Get('items/:itemId/state')
  async itemState(
    @ActiveOrganization() orgId: string | undefined,
    @Param('itemId') itemId: string,
    @Query('attemptId') attemptId?: string,
    @Query('attemptNumber') attemptNumber?: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const parsedNumber =
      attemptNumber === undefined ? undefined : Number(attemptNumber);
    const result = await getContentItemState(db, {
      itemId,
      organizationId,
      attemptId,
      ...(parsedNumber !== undefined && Number.isInteger(parsedNumber)
        ? { attemptNumber: parsedNumber }
        : {}),
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Stage the clip list the owner arranged in the editor. Renders nothing.
   *
   * A write rather than component state because the edit has to be legible to
   * Claire: she addresses the ITEM, and a list held in the browser is invisible
   * to the one party who has to act on "now render it". See
   * `stageItemClipEdits` for the five attempts that established this.
   */
  @Post('items/:itemId/stage-clips')
  @UsePipes(new ValidationPipe({ transform: true }))
  async stageClips(
    @ActiveOrganization() orgId: string | undefined,
    @Param('itemId') itemId: string,
    @Body() body: StageItemClipsDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await stageItemClipEdits(db, {
      itemId,
      organizationId,
      assetIds: body.assetIds,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Throw away everything staged against this post's cut — the card's Reject.
   *
   * DELETE, because that is what it is: the staged edits stop existing and the
   * video is exactly as it was.
   */
  @Delete('items/:itemId/staged-edits')
  async discardVideoEdits(
    @ActiveOrganization() orgId: string | undefined,
    @Param('itemId') itemId: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await discardItemVideoEdits(db, { itemId, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Commit everything the thread staged for this post's video, in one render.
   *
   * Separate from the turn that staged it because a render costs real time and
   * money: three instructions should cost one render, and the owner should be
   * the one who decides when it fires.
   */
  @Post('items/:itemId/apply-edits')
  async applyVideoEdits(
    @ActiveOrganization() orgId: string | undefined,
    @Param('itemId') itemId: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await applyBatchItemVideoEdits(db, {
      itemId,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    this.logger.log(
      `Content batch item edits applied: ${itemId} (org=${organizationId}, applied=${result.data.applied})`
    );
    return result.data;
  }

  private mapError(error: { code: string; message: string }) {
    switch (error.code) {
      case ErrorCodes.VALIDATION_ERROR:
      case ErrorCodes.INVALID_INPUT:
        return new HttpException(error.message, HttpStatus.BAD_REQUEST);
      case ErrorCodes.UNAUTHORIZED:
        return new HttpException(error.message, HttpStatus.UNAUTHORIZED);
      case ErrorCodes.FORBIDDEN:
        return new HttpException(error.message, HttpStatus.FORBIDDEN);
      case ErrorCodes.NOT_FOUND:
        return new HttpException(error.message, HttpStatus.NOT_FOUND);
      case ErrorCodes.ALREADY_EXISTS:
      case ErrorCodes.CONFLICT:
        return new HttpException(error.message, HttpStatus.CONFLICT);
      case ErrorCodes.INVALID_STATE:
        return new HttpException(error.message, HttpStatus.BAD_REQUEST);
      // The refine endpoint calls the model, so this is now reachable. As a
      // 500 the UI would tell the user something broke rather than "try again
      // in a moment", and they'd retype the instruction into a dead screen.
      case ErrorCodes.RATE_LIMITED:
        return new HttpException(error.message, HttpStatus.TOO_MANY_REQUESTS);
      default:
        return new HttpException(
          error.message || 'Internal server error',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
    }
  }
}

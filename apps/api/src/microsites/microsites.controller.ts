import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ActiveOrganization,
  AuthGuard,
  CurrentUser,
  MicrositeEditorGuard,
} from '../common/index.js';
import { respondWithMicrositeStream } from './agent/respond-microsite-stream.js';
import {
  MICROSITE_STREAM_TIMEOUT_MS,
  planMicrositeChatTurn,
} from './agent/run-microsite-chat-turn.js';
import {
  ListMicrositeRevisionsDto,
  MicrositeChatDto,
  PublishMicrositeDto,
  UpdateMicrositeBlockDto,
} from './dto/index.js';
import {
  createWorkspace,
  editBlock,
  publishDraft,
  readConversation,
  readRevisions,
  readWorkspace,
  restoreMicrositeRevision,
} from './microsite-workspace.js';

/**
 * The staff-facing microsite surface (contract §4).
 *
 * Transport only. The org lookup, the services and the Result→HTTP mapping are
 * in `microsite-workspace.ts`; the chat turn is planned in
 * `agent/run-microsite-chat-turn.ts` and written to the wire by
 * `agent/respond-microsite-stream.ts` — the same split Claire's chat controller
 * uses, so there is one streaming mechanism in the codebase.
 *
 * `@UseGuards(AuthGuard)` at the class is the policy declaration for every
 * route here (Gate 3). The org comes from the session, never from the body.
 *
 * `MicrositeEditorGuard` runs FIRST and 404s the whole controller while the
 * editor is switched off. Hiding the dashboard tab is not a lock — these
 * routes stay reachable by URL, and the chat turn spends model budget. The
 * PUBLIC render endpoints are deliberately not guarded: turning the editor
 * off must never take a tenant's live site down.
 */
@Controller('microsites')
@UseGuards(MicrositeEditorGuard, AuthGuard)
export class MicrositesController {
  private readonly logger = new Logger(MicrositesController.name);

  /** The caller's org microsite plus its draft document. */
  @Get('mine')
  async mine(@ActiveOrganization() organizationId: string) {
    return readWorkspace(organizationId);
  }

  /**
   * Create this org's website.
   *
   * Deliberately a request, not a side effect of onboarding — see
   * `createWorkspace`. Returns the same shape as `GET mine`, so the editor can
   * render straight from the response instead of round-tripping.
   */
  @Post()
  async create(@ActiveOrganization() organizationId: string) {
    return createWorkspace(organizationId);
  }

  /** The agent turn. SSE; the sidebar consumes the contract §4 events. */
  @Post(':id/chat')
  @UsePipes(new ValidationPipe({ transform: true }))
  async chat(
    @Param('id') micrositeId: string,
    @Body() dto: MicrositeChatDto,
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') userId: string,
    @Res() res: Response
  ): Promise<void> {
    res.setTimeout(MICROSITE_STREAM_TIMEOUT_MS);
    const plan = await planMicrositeChatTurn({
      body: dto,
      micrositeId,
      organizationId,
      userId,
      logger: this.logger,
    });
    await respondWithMicrositeStream(res, plan);
  }

  @Get(':id/conversations/:conversationId')
  async conversation(
    @Param('id') micrositeId: string,
    @Param('conversationId') conversationId: string,
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') userId: string
  ) {
    return readConversation(
      micrositeId,
      conversationId,
      organizationId,
      userId
    );
  }

  @Get(':id/revisions')
  @UsePipes(new ValidationPipe({ transform: true }))
  async revisions(
    @Param('id') micrositeId: string,
    @Query() dto: ListMicrositeRevisionsDto,
    @ActiveOrganization() organizationId: string
  ) {
    return readRevisions(micrositeId, organizationId, dto);
  }

  /** Undo and redo are both this: restore a revision the history already holds. */
  @Post(':id/revisions/:revisionId/restore')
  async restore(
    @Param('id') micrositeId: string,
    @Param('revisionId') revisionId: string,
    @ActiveOrganization() organizationId: string
  ) {
    return restoreMicrositeRevision(micrositeId, revisionId, organizationId);
  }

  @Post(':id/publish')
  @UsePipes(new ValidationPipe({ transform: true }))
  async publish(
    @Param('id') micrositeId: string,
    @Body() dto: PublishMicrositeDto,
    @ActiveOrganization() organizationId: string
  ) {
    return publishDraft(micrositeId, organizationId, dto.label);
  }

  /** The inspector edit and the canvas drag — the agent's own tools, and a revision. */
  @Patch(':id/pages/:pageId/blocks/:blockId')
  @UsePipes(new ValidationPipe({ transform: true }))
  async updateBlock(
    @Param('id') micrositeId: string,
    @Param('pageId') pageId: string,
    @Param('blockId') blockId: string,
    @Body() dto: UpdateMicrositeBlockDto,
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') userId: string
  ) {
    return editBlock(
      { micrositeId, pageId, blockId, organizationId, userId },
      dto
    );
  }
}

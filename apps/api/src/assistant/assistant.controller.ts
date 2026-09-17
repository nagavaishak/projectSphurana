import { db } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import {
  createConversation,
  deleteConversation,
  escalateConversation,
  formatKnowledgeContext,
  generateConversationTitle,
  getAssistantContext,
  getConversation,
  incrementAssistantUsage,
  listConversations,
  queryKnowledge,
  requestClaireHandoff,
  updateConversation,
} from '@borradh-workspace/features/assistant';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ActiveOrganization,
  ActiveOrganizationGuard,
  AuthGuard,
  type AuthenticatedRequest,
  CurrentUser,
} from '../common/index.js';
import {
  CreateConversationDto,
  GenerateTitleDto,
  GetUsageHistoryDto,
  QueryKnowledgeDto,
  UpdateConversationDto,
} from './dto/index.js';
import {
  buildAssistantUsageHistoryView,
  buildAssistantUsageView,
} from './usage-view.js';
import { isClaireV3EnabledForOrg } from './v3-status.js';

@Controller('assistant')
// Every route here is org-scoped; the guard replaces the identical six-line
// `if (!organizationId) throw 400` that opened all fourteen handlers, and
// covers the fifteenth automatically.
@UseGuards(AuthGuard, ActiveOrganizationGuard)
export class AssistantController {
  private mapErrorToHttpException(error: { code: string; message: string }) {
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
      default:
        return new HttpException(
          error.message || 'Internal server error',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
    }
  }

  @Get('v3-status')
  v3Status(@ActiveOrganization() organizationId: string) {
    return {
      enabled: isClaireV3EnabledForOrg(organizationId),
    };
  }

  @Get('usage')
  async getUsage(@ActiveOrganization() organizationId: string) {
    return buildAssistantUsageView(organizationId);
  }

  @Get('usage/history')
  @UsePipes(new ValidationPipe({ transform: true }))
  async getUsageHistory(
    @Query() dto: GetUsageHistoryDto,
    @ActiveOrganization() organizationId: string
  ) {
    return buildAssistantUsageHistoryView(
      organizationId,
      { days: dto.days, monthlyMonths: dto.monthlyMonths },
      (error) => this.mapErrorToHttpException(error)
    );
  }

  @Post('usage/increment')
  async incrementUsage(@ActiveOrganization() organizationId: string) {
    const result = await incrementAssistantUsage(db, { organizationId });
    if (!result.success) {
      throw new HttpException(
        result.error.message,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    return { messageCount: result.data.messageCount };
  }

  @Get('context')
  async getContext(@ActiveOrganization() organizationId: string) {
    const result = await getAssistantContext(db, { organizationId });
    if (!result.success) {
      throw new HttpException(
        result.error.message,
        result.error.code === 'NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    return result.data;
  }

  @Get('conversations')
  async listConversationsEndpoint(
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') userId: string
  ) {
    const result = await listConversations(db, { organizationId, userId });
    if (!result.success) {
      throw new HttpException(
        result.error.message,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    return result.data;
  }

  @Get('conversations/:id')
  async getConversationEndpoint(
    @Param('id') id: string,
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') userId: string
  ) {
    const result = await getConversation(db, { id, organizationId, userId });
    if (!result.success) {
      throw new HttpException(
        result.error.message,
        result.error.code === 'NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    return result.data;
  }

  @Post('conversations')
  @UsePipes(new ValidationPipe({ transform: true }))
  async createConversationEndpoint(
    @Body() dto: CreateConversationDto,
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') userId: string
  ) {
    const result = await createConversation(db, {
      ...dto,
      organizationId,
      userId,
    });
    if (!result.success) {
      throw new HttpException(
        result.error.message,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    return result.data;
  }

  @Patch('conversations/:id')
  @UsePipes(new ValidationPipe({ transform: true }))
  async updateConversationEndpoint(
    @Param('id') id: string,
    @Body() dto: UpdateConversationDto,
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') userId: string
  ) {
    const result = await updateConversation(db, {
      id,
      ...dto,
      organizationId,
      userId,
    });
    if (!result.success) {
      throw new HttpException(
        result.error.message,
        result.error.code === 'NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    return result.data;
  }

  @Delete('conversations/:id')
  async deleteConversationEndpoint(
    @Param('id') id: string,
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') userId: string
  ) {
    const result = await deleteConversation(db, {
      id,
      organizationId,
      userId,
    });
    if (!result.success) {
      throw new HttpException(
        result.error.message,
        result.error.code === 'NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    return { success: true };
  }

  @Post('conversations/:id/escalate')
  async escalateConversationEndpoint(
    @Param('id') conversationId: string,
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') userId: string
  ) {
    const result = await escalateConversation(db, {
      conversationId,
      organizationId,
      userId,
      reason: 'user_requested',
    });
    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  /**
   * Hand the conversation off to a live support agent in Intercom.
   *
   * Creates a new Intercom conversation seeded with the recent Claire
   * transcript (so the agent picks up with context), persists the Intercom
   * conversation id on `assistantConversation`, and flips status to
   * `escalated`. The actual back-and-forth happens inside the Intercom
   * messenger — the Claire UI just shows a "talk to support" card + banner
   * while escalated.
   *
   * Idempotent: re-calling on an already-escalated conversation returns the
   * existing Intercom id without spinning up a duplicate.
   */
  @Post('conversations/:id/handoff')
  async requestSupportChat(
    @Param('id') conversationId: string,
    @Body() body: { reason?: string },
    @ActiveOrganization() organizationId: string,
    @CurrentUser() user: AuthenticatedRequest['user']
  ) {
    const result = await requestClaireHandoff(
      db,
      {
        conversationId,
        organizationId,
        userId: user.id,
        userEmail: user.email,
        userName: user.name,
        reason: body?.reason?.trim() || 'Owner asked to talk to a human.',
      },
      { accessToken: apiEnv.INTERCOM_ACCESS_TOKEN }
    );

    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  // Note: there is no public POST `/assistant/conversations/:id/messages`.
  // The chat controller (`assistant-chat.controller.ts`) is the only writer
  // — it calls the `saveMessages` service directly after the model finishes
  // streaming. Exposing a public endpoint that takes user-controlled
  // `assistantText` would let a caller plant fake "the assistant agreed to
  // X" turns into their own conversation history, weakening audit value.

  @Post('conversations/:id/generate-title')
  @UsePipes(new ValidationPipe({ transform: true }))
  async generateTitleEndpoint(
    @Param('id') conversationId: string,
    @Body() dto: GenerateTitleDto,
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') userId: string
  ) {
    const result = await generateConversationTitle(db, {
      ...dto,
      conversationId,
      organizationId,
      userId,
    });
    if (!result.success) {
      throw new HttpException(
        result.error.message,
        result.error.code === 'NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    return result.data;
  }

  @Post('knowledge/query')
  @UsePipes(new ValidationPipe({ transform: true }))
  async queryKnowledgeEndpoint(
    @Body() dto: QueryKnowledgeDto,
    @ActiveOrganization() organizationId: string
  ) {
    const results = await queryKnowledge(db, {
      query: dto.query,
      organizationId,
      topK: dto.topK,
    });

    return {
      results,
      context: formatKnowledgeContext(results),
    };
  }
}

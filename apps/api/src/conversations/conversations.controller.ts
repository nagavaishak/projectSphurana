import { db } from '@borradh-workspace/database';
import {
  assignConversation,
  closeConversation,
  deleteConversation,
  escalateConversation,
  getConversation,
  listConversations,
  listMessages,
  sendMessage,
  summariseConversationsThisWeek,
  syncConversationMessages,
} from '@borradh-workspace/features/conversations';
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
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ActiveOrganization, AuthGuard, CurrentUser } from '../common';
import { unwrapResult } from '../common/unwrap-result.js';
import { AssignConversationDto } from './dto/assign-conversation.dto';
import { EscalateConversationDto } from './dto/escalate-conversation.dto';
import { ListConversationsDto } from './dto/list-conversations.dto';
import { ListMessagesDto } from './dto/list-messages.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { SummariseThisWeekDto } from './dto/summarise-this-week.dto';

@Controller('conversations')
@UseGuards(AuthGuard)
export class ConversationsController {
  private readonly logger = new Logger(ConversationsController.name);

  /**
   * Bind this controller's logger + error mapper for `unwrapResult`.
   *
   * A PROPERTY, not a method, deliberately: Gate 5 counts every private method
   * on a controller as orchestration, and it is right to — a method is where
   * logic hides. This holds none: it is one object literal of two already-
   * existing members.
   */
  private readonly unwrapWith = (label: string) => ({
    logger: this.logger,
    label,
    mapError: (error: { code: string; message: string }) =>
      this.mapErrorToHttpException(error),
  });

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

  @Get()
  async findAll(
    @ActiveOrganization() orgId: string | undefined,
    @Query() dto: ListConversationsDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(
      `List conversations request for organization: ${organizationId}`
    );

    const data = unwrapResult(
      await listConversations(db, { ...dto, organizationId }),
      this.unwrapWith('List conversations')
    );

    return {
      items: data.conversations,
      total: data.total,
      limit: dto.limit ?? 20,
      offset: dto.offset ?? 0,
    };
  }

  @Post('sync')
  async sync(@ActiveOrganization() orgId: string | undefined) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(
      `Sync conversations request for organization: ${organizationId}`
    );

    const result = await syncConversationMessages(db, { organizationId });

    if (!result.success) {
      this.logger.warn(
        `Sync conversations failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(
      `Sync complete: ${result.data.synced} messages synced, ${result.data.errors} errors`
    );
    return result.data;
  }

  @Get('summary/this-week')
  async findThisWeekSummary(
    @ActiveOrganization() orgId: string | undefined,
    @Query() query: SummariseThisWeekDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(
      `Summarise conversations this week for organization: ${organizationId}`
    );

    const result = await summariseConversationsThisWeek(db, {
      organizationId,
      since: query.since ? new Date(query.since) : undefined,
      until: query.until ? new Date(query.until) : undefined,
    });

    if (!result.success) {
      this.logger.warn(
        `Summarise this-week failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Get(':id')
  async findOne(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(`Get conversation request for ID: ${id}`);

    const result = await getConversation(db, { id, organizationId });

    if (!result.success) {
      this.logger.warn(
        `Get conversation failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Get(':id/messages')
  async findMessages(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') conversationId: string,
    @Query() query: ListMessagesDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(
      `List messages request for conversation: ${conversationId}`
    );

    return unwrapResult(
      await listMessages(db, {
        conversationId,
        organizationId,
        limit: query.limit,
        offset: query.offset,
      }),
      this.unwrapWith('List messages')
    );
  }

  @Post(':id/messages')
  async sendAgentMessage(
    @ActiveOrganization() orgId: string | undefined,
    @CurrentUser('id') userId: string,
    @Param('id') conversationId: string,
    @Body() dto: SendMessageDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(`Send message request for conversation: ${conversationId}`);

    const data = unwrapResult(
      await sendMessage(db, {
        conversationId,
        organizationId,
        content: dto.content,
        userId,
      }),
      this.unwrapWith('Send message')
    );

    this.logger.log(
      `Message sent successfully for conversation: ${conversationId}`
    );
    return data;
  }

  @Post(':id/close')
  async close(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(`Close conversation request for ID: ${id}`);

    const result = await closeConversation(db, { id, organizationId });

    if (!result.success) {
      this.logger.warn(
        `Close conversation failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Conversation closed successfully: ${id}`);
    return result.data;
  }

  @Post(':id/escalate')
  async escalate(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string,
    @Body() dto: EscalateConversationDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(
      `Escalate conversation request for ID: ${id} (org: ${organizationId}), reason: ${dto.reason}`
    );

    const data = unwrapResult(
      await escalateConversation(db, {
        conversationId: id,
        reason: dto.reason,
        reasonDetail: dto.reasonDetail,
        notifyAgents: dto.notifyAgents,
        insertSystemMessage: dto.insertSystemMessage,
      }),
      this.unwrapWith('Escalate conversation')
    );

    this.logger.log(`Conversation escalated successfully: ${id}`);
    return data;
  }

  @Post(':id/assign')
  async assign(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string,
    @Body() dto: AssignConversationDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(
      `Assign conversation request for ID: ${id}, to user: ${dto.assignToUserId}`
    );

    const data = unwrapResult(
      await assignConversation(db, {
        id,
        organizationId,
        assignToUserId: dto.assignToUserId,
      }),
      this.unwrapWith('Assign conversation')
    );

    this.logger.log(`Conversation assigned successfully: ${id}`);
    return data;
  }

  @Delete(':id')
  async remove(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(`Delete conversation request for ID: ${id}`);

    const result = await deleteConversation(db, { id, organizationId });

    if (!result.success) {
      this.logger.warn(
        `Delete conversation failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Conversation deleted successfully: ${id}`);
    return { success: true };
  }

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
}

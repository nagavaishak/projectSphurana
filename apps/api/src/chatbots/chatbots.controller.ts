import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ActiveOrganization, AuthGuard } from '../common';
import { TestChatDto } from './dto/test-chat.dto';
import { runTestChat } from './test-chat-stream.js';

@Controller('chatbots')
@UseGuards(AuthGuard)
export class ChatbotsController {
  private readonly logger = new Logger(ChatbotsController.name);

  /**
   * Test chat endpoint — loads chatbot config from the session's organization.
   * No chatbot ID needed since each org has exactly one implicit chatbot.
   */
  @Post('test-chat')
  async testChatStream(
    @ActiveOrganization() orgId: string | undefined,
    @Body() body: TestChatDto,
    @Res() res: Response
  ) {
    return runTestChat(res, orgId, body, this.logger, (error) =>
      this.mapErrorToHttpException(error)
    );
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
      default:
        return new HttpException(
          error.message || 'Internal server error',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
    }
  }
}

import { db } from '@borradh-workspace/database';
import {
  getWhatsappLinkStatus,
  revokeWhatsappLink,
  startWhatsappLink,
  verifyWhatsappLink,
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
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ActiveOrganization,
  AuthGuard,
  ClaireAccessGuard,
  CurrentUser,
} from '../common/index.js';
import { VerifyWhatsappLinkDto } from './dto/index.js';

/**
 * Owner WhatsApp pairing (WS-3).
 *
 * Access gate is the SAME as web-Claire (decision Q3): `AuthGuard` +
 * `ClaireAccessGuard`, the plan-tier check used by `AssistantChatController`
 * (which 403s `NO_ACCESS` when the plan lacks assistant access). Only
 * Claire-eligible owners may pair/use Claire on WhatsApp.
 *
 * `POST /verify` is normally driven by the inbound webhook (WS-10) when the
 * owner sends the pairing code; it is exposed here for manual/testing use.
 */
@Controller('assistant/whatsapp-link')
@UseGuards(AuthGuard, ClaireAccessGuard)
export class WhatsappLinkController {
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
          'Internal server error',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
    }
  }

  @Post('start')
  async start(
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') userId: string
  ) {
    const result = await startWhatsappLink(db, { userId, organizationId });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Post('verify')
  @UsePipes(new ValidationPipe({ transform: true }))
  async verify(@Body() dto: VerifyWhatsappLinkDto) {
    const result = await verifyWhatsappLink(db, {
      code: dto.code,
      fromPhoneE164: dto.fromPhoneE164,
    });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Get('status')
  async status(
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') userId: string
  ) {
    const result = await getWhatsappLinkStatus(db, { userId, organizationId });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string) {
    const result = await revokeWhatsappLink(db, { id, userId });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return { success: true };
  }
}

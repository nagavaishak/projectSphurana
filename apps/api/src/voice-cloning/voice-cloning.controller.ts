import { db } from '@borradh-workspace/database';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  getVoiceCloneStatus,
  queueVoiceIngest,
} from '@borradh-workspace/features/voice-cloning';
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ActiveOrganization,
  AuthGuard,
  GlobalAdminGuard,
} from '../common/index.js';
import type { TriggerIngestDto } from './dto/index.js';

@Controller('voice-cloning')
@UseGuards(AuthGuard)
export class VoiceCloningController {
  private readonly logger = new Logger(VoiceCloningController.name);

  @Post('admin/ingest')
  @UseGuards(GlobalAdminGuard)
  async adminTriggerIngest(
    @Body() body: { organizationId: string; metaAdsPageId: string }
  ) {
    const result = await queueVoiceIngest({
      organizationId: body.organizationId,
      metaAdsPageId: body.metaAdsPageId,
      triggerReason: 'manual',
    });

    if (!result.success) {
      throw this.mapError(result.error);
    }

    this.logger.log(
      `Voice ingest queued for org=${body.organizationId} page=${body.metaAdsPageId}`
    );
    return { success: true, ...result.data };
  }

  @Post('admin/status')
  @UseGuards(GlobalAdminGuard)
  async adminGetStatus(@Body() body: { organizationId: string }) {
    const result = await getVoiceCloneStatus(db, {
      organizationId: body.organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post('ingest')
  @UseGuards(AuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async triggerIngest(
    @Body() dto: TriggerIngestDto,
    @ActiveOrganization() organizationId: string
  ) {
    if (!organizationId) {
      throw new HttpException(
        'No active organization selected',
        HttpStatus.BAD_REQUEST
      );
    }

    const result = await queueVoiceIngest({
      organizationId,
      metaAdsPageId: dto.metaAdsPageId,
      triggerReason: 'manual',
    });

    if (!result.success) {
      throw this.mapError(result.error);
    }

    return result.data;
  }

  @Get('status')
  @UseGuards(AuthGuard)
  async getStatus(@ActiveOrganization() organizationId: string) {
    if (!organizationId) {
      throw new HttpException(
        'No active organization selected',
        HttpStatus.BAD_REQUEST
      );
    }

    const result = await getVoiceCloneStatus(db, { organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  private mapError(error: { code: string; message: string }) {
    const map: Record<string, HttpStatus> = {
      [ErrorCodes.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
      [ErrorCodes.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
      [ErrorCodes.FORBIDDEN]: HttpStatus.FORBIDDEN,
      [ErrorCodes.NOT_FOUND]: HttpStatus.NOT_FOUND,
      [ErrorCodes.ALREADY_EXISTS]: HttpStatus.CONFLICT,
      [ErrorCodes.CONFLICT]: HttpStatus.CONFLICT,
    };
    return new HttpException(
      error.message,
      map[error.code] || HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}

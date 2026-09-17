import { db } from '@borradh-workspace/database';
import { backfillAnalytics } from '@borradh-workspace/features/analytics';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Controller,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { GlobalAdminGuard } from '../common/guards/global-admin.guard.js';
import { AuthGuard } from '../common/index.js';
import { BackfillAnalyticsDto } from './dto/index.js';

@Controller('analytics')
@UseGuards(AuthGuard, GlobalAdminGuard)
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  @Post('backfill')
  @UsePipes(new ValidationPipe({ transform: true }))
  async backfill(@Query() dto: BackfillAnalyticsDto) {
    const result = await backfillAnalytics(db, {
      from: dto.from,
      to: dto.to,
    });

    if (!result.success) {
      throw this.mapError(result.error);
    }

    this.logger.log(
      `Backfill complete: ${result.data.daysProcessed} days, ${result.data.errors.length} errors`
    );
    return result.data;
  }

  private mapError(error: { code: string; message: string }) {
    const map: Record<string, HttpStatus> = {
      [ErrorCodes.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
      [ErrorCodes.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
      [ErrorCodes.FORBIDDEN]: HttpStatus.FORBIDDEN,
    };
    return new HttpException(
      error.message,
      map[error.code] || HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}

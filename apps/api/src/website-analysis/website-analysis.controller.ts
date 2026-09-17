import { db } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  analyzeWebsite,
  applyAnalysisJob,
  getAnalyzeWebsiteJob,
  getDebugContentJob,
  previewAnalysisJob,
  startAnalyzeWebsiteJob,
  startDebugContentJob,
} from '@borradh-workspace/features/website-analysis';
import {
  Body,
  Controller,
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
  SkipPaidPlanCheck,
} from '../common/index.js';
import {
  AnalyzeWebsiteDto,
  ApplyAnalysisDto,
  DebugContentDto,
  PreviewAnalysisDto,
} from './dto/index.js';
import { getScrapingConfig } from './scraping-config.js';

@Controller('website-analysis')
@UseGuards(AuthGuard)
@SkipPaidPlanCheck()
export class WebsiteAnalysisController {
  @Post('analyze')
  @UsePipes(new ValidationPipe({ transform: true }))
  async analyze(
    @Body() dto: AnalyzeWebsiteDto,
    @ActiveOrganization() organizationId: string
  ) {
    const apiKey = apiEnv.OPENAI_API_KEY;
    if (!apiKey) {
      throw new HttpException(
        'Website analysis is not configured',
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    const result = await analyzeWebsite(
      { ...dto, organizationId },
      apiKey,
      getScrapingConfig()
    );
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /** Start a website analysis job (returns immediately with jobId) */
  @Post('analyze/start')
  @UsePipes(new ValidationPipe({ transform: true }))
  async startAnalyze(
    @Body() dto: AnalyzeWebsiteDto,
    @ActiveOrganization() organizationId?: string
  ) {
    const apiKey = apiEnv.OPENAI_API_KEY;
    if (!apiKey) {
      throw new HttpException(
        'Website analysis is not configured',
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    const result = await startAnalyzeWebsiteJob(
      { ...dto, organizationId },
      apiKey,
      getScrapingConfig()
    );
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /** Poll for website analysis result */
  @Get('analyze/:jobId')
  async getAnalyze(
    @Param('jobId') jobId: string,
    @ActiveOrganization() organizationId?: string
  ) {
    const result = await getAnalyzeWebsiteJob(jobId, organizationId);
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Diff a finished scan against the active organization WITHOUT writing —
   * what the settings panel renders before the owner commits (ENG-659).
   */
  @Post('preview')
  @UsePipes(new ValidationPipe({ transform: true }))
  async preview(
    @Body() dto: PreviewAnalysisDto,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await previewAnalysisJob(db, { ...dto, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Write a finished scan into the active organization — services, prices,
   * locations, the booking page description, opening hours, brand, staff and
   * packages (ENG-659), each according to the mode the owner chose in the
   * preview.
   */
  @Post('apply')
  @UsePipes(new ValidationPipe({ transform: true }))
  async apply(
    @Body() dto: ApplyAnalysisDto,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await applyAnalysisJob(db, { ...dto, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /** Start a debug content analysis job (returns immediately with jobId) */
  @Post('debug-content')
  @UsePipes(new ValidationPipe({ transform: true }))
  async startDebugContent(
    @Body() dto: DebugContentDto,
    @ActiveOrganization() organizationId: string
  ) {
    const apiKey = apiEnv.OPENAI_API_KEY;
    const result = await startDebugContentJob(dto, organizationId, apiKey);
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /** Poll for debug content analysis result */
  @Get('debug-content/:jobId')
  async getDebugContent(
    @Param('jobId') jobId: string,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await getDebugContentJob(jobId, organizationId);
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  private mapError(error: { code: string; message: string }) {
    const map: Record<string, HttpStatus> = {
      [ErrorCodes.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
      [ErrorCodes.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
      [ErrorCodes.FORBIDDEN]: HttpStatus.FORBIDDEN,
      [ErrorCodes.NOT_FOUND]: HttpStatus.NOT_FOUND,
      // A scan that is still running, that failed, or that finished with no
      // usable result is a CONFLICT — a normal, user-reachable state the
      // preview/apply use cases return a deliberate, customer-readable message
      // for ("The scan has not finished yet", or the scan's own error). Without
      // this entry it fell through to 500 and that message was replaced by a
      // generic server error, so the panel could only say "something broke".
      [ErrorCodes.CONFLICT]: HttpStatus.CONFLICT,
      [ErrorCodes.EXTERNAL_SERVICE_ERROR]: HttpStatus.BAD_GATEWAY,
      [ErrorCodes.RATE_LIMITED]: HttpStatus.TOO_MANY_REQUESTS,
    };
    return new HttpException(
      error.message,
      map[error.code] || HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}

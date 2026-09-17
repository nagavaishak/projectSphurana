import { db } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import {
  generateContent,
  generateOfferContent,
  generateOfferCopy,
} from '@borradh-workspace/features/ai-content';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ActiveOrganization, AuthGuard } from '../common';
import {
  GenerateContentDto,
  GenerateOfferContentDto,
  GenerateOfferCopyDto,
} from './dto/index.js';

@Controller('ai-content')
@UseGuards(AuthGuard)
export class AiContentController {
  @Post('generate')
  @UsePipes(new ValidationPipe({ transform: true }))
  async generate(
    @Body() dto: GenerateContentDto,
    @ActiveOrganization() organizationId: string
  ) {
    const apiKey = apiEnv.OPENAI_API_KEY;
    if (!apiKey) {
      throw new HttpException(
        'AI service not configured',
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    const result = await generateContent(
      db,
      { ...dto, organizationId },
      apiKey
    );

    if (!result.success) {
      throw this.mapError(result.error);
    }

    return result.data;
  }

  @Post('generate-offer-content')
  @UsePipes(new ValidationPipe({ transform: true }))
  async generateOffer(
    @Body() dto: GenerateOfferContentDto,
    @ActiveOrganization() organizationId: string
  ) {
    const apiKey = apiEnv.OPENAI_API_KEY;
    if (!apiKey) {
      throw new HttpException(
        'AI service not configured',
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    const result = await generateOfferContent(
      db,
      { ...dto, organizationId },
      apiKey
    );

    if (!result.success) {
      throw this.mapError(result.error);
    }

    return result.data;
  }

  /**
   * Generate the full video-copy bundle for a selected offer.
   *
   * Window 9 (offer rework) endpoint — backs the create-video offer step
   * after the offer table dropped its video-copy columns. Returns
   * `{ headline, ctaText, urgencyText, audienceText, bulletPoints }` for
   * the given offer. If the LLM is unavailable, the service returns
   * templated fallback copy so the flow never blocks.
   */
  @Post('generate-offer-copy')
  @UsePipes(new ValidationPipe({ transform: true }))
  async generateOfferCopyEndpoint(
    @Body() dto: GenerateOfferCopyDto,
    @ActiveOrganization() organizationId: string
  ) {
    const apiKey = apiEnv.OPENAI_API_KEY;
    const result = await generateOfferCopy(
      db,
      { ...dto, organizationId },
      apiKey
    );

    if (!result.success) {
      throw this.mapError(result.error);
    }

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
      // AI provider busy/over quota — let the client back off and retry
      // rather than reporting a generic 500 (ENG-385 / ENG-377).
      [ErrorCodes.RATE_LIMITED]: HttpStatus.TOO_MANY_REQUESTS,
      [ErrorCodes.EXTERNAL_SERVICE_ERROR]: HttpStatus.BAD_GATEWAY,
    };
    return new HttpException(
      error.message,
      map[error.code] || HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}

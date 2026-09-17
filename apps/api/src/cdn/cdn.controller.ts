import { generateCdnSignedCookies } from '@borradh-workspace/features/cdn';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  generateSignedCookies,
  getCdnUrl,
  isCdnEnabled,
} from '@borradh-workspace/storage';
import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ActiveOrganization, AuthGuard } from '../common';
import {
  isProductionHost,
  respondCdnCookieError,
  respondClearingCdnCookies,
  respondNoActiveOrganization,
  respondWithCdnCookies,
} from './cdn-cookies.js';

@Controller('cdn')
@UseGuards(AuthGuard)
export class CdnController {
  private readonly cdnDeps = {
    isCdnEnabled,
    getCdnUrl,
    generateSignedCookies,
  };

  /**
   * Get CDN status
   */
  @Get('status')
  getStatus() {
    return {
      enabled: isCdnEnabled(),
      cdnUrl: getCdnUrl() ?? null,
    };
  }

  /**
   * Generate and set signed cookies for CloudFront private content
   */
  @Post('signed-cookies')
  async getSignedCookies(
    @ActiveOrganization() organizationId: string | undefined,
    @Res() res: Response
  ) {
    if (!organizationId) return respondNoActiveOrganization(res);

    const result = await generateCdnSignedCookies(
      this.cdnDeps,
      { organizationId },
      isProductionHost()
    );

    if (!result.success) {
      return respondCdnCookieError(
        res,
        result.error,
        this.mapError(result.error).getStatus()
      );
    }
    return respondWithCdnCookies(res, result.data, organizationId);
  }

  /**
   * Clear CDN cookies
   */
  @Post('clear-cookies')
  clearCookies(@Res() res: Response) {
    return respondClearingCdnCookies(res);
  }

  /**
   * One code, one status. Style-A map — `error-status-map` parses this table
   * out of the controller with the TypeScript AST, so it must stay a literal
   * here. Only the STATUS is used: this endpoint replies with its own
   * `{ success: false, error }` envelope rather than throwing.
   */
  private mapError(error: { code: string; message: string }) {
    const map: Record<string, HttpStatus> = {
      // The CDN is switched off on this deployment — not a permission failure.
      [ErrorCodes.NOT_CONFIGURED]: HttpStatus.SERVICE_UNAVAILABLE,
      [ErrorCodes.INTERNAL_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
    };
    return new HttpException(
      error.message,
      map[error.code] || HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}

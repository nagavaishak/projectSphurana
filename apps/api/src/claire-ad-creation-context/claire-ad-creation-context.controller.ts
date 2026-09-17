import { db } from '@borradh-workspace/database';
import {
  type AdCreationContextResponse,
  type BackfillBusinessProfilesSummary,
  backfillBusinessProfiles,
  getAdCreationContext,
  reclassifyBusiness,
  resolveDisagreement,
  setAxisOverride,
  setMarketPosition,
} from '@borradh-workspace/features/claire';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ActiveOrganization,
  AuthGuard,
  CurrentUser,
  GlobalAdminGuard,
} from '../common/index.js';
import {
  OverrideAxesDto,
  ResolveDisagreementDto,
  SetMarketPositionDto,
} from './dto/index.js';

function mapErrorToHttpException(error: { code: string; message: string }) {
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

@Controller('claire')
@UseGuards(AuthGuard)
export class ClaireAdCreationContextController {
  @Get('ad-creation-context')
  async getContext(
    @ActiveOrganization() organizationId: string
  ): Promise<AdCreationContextResponse> {
    if (!organizationId) {
      throw new HttpException(
        'No active organization selected',
        HttpStatus.BAD_REQUEST
      );
    }
    const result = await getAdCreationContext(db, { organizationId });
    if (!result.success) throw mapErrorToHttpException(result.error);
    return result.data;
  }

  @Post('business-profile/override-axes')
  @UsePipes(new ValidationPipe({ transform: true }))
  async overrideAxes(
    @Body() dto: OverrideAxesDto,
    @CurrentUser('id') userId: string,
    @ActiveOrganization() organizationId: string
  ) {
    if (!organizationId) {
      throw new HttpException(
        'No active organization selected',
        HttpStatus.BAD_REQUEST
      );
    }
    const result = await setAxisOverride(db, {
      organizationId,
      userId,
      axes: dto.axes,
    });
    if (!result.success) throw mapErrorToHttpException(result.error);
    return result.data;
  }

  @Post('business-profile/resolve-disagreement')
  @UsePipes(new ValidationPipe({ transform: true }))
  async resolveDisagreement(
    @Body() dto: ResolveDisagreementDto,
    @ActiveOrganization() organizationId: string
  ) {
    if (!organizationId) {
      throw new HttpException(
        'No active organization selected',
        HttpStatus.BAD_REQUEST
      );
    }
    const result = await resolveDisagreement(db, {
      organizationId,
      resolution: dto.resolution,
    });
    if (!result.success) throw mapErrorToHttpException(result.error);
    return result.data;
  }

  @Post('business-profile/set-market-position')
  @UsePipes(new ValidationPipe({ transform: true }))
  async setMarketPosition(
    @Body() dto: SetMarketPositionDto,
    @ActiveOrganization() organizationId: string
  ) {
    if (!organizationId) {
      throw new HttpException(
        'No active organization selected',
        HttpStatus.BAD_REQUEST
      );
    }
    const result = await setMarketPosition(db, {
      organizationId,
      marketPosition: dto.marketPosition,
    });
    if (!result.success) throw mapErrorToHttpException(result.error);
    return result.data;
  }

  /**
   * Synchronously (re)classify the active organization. Idempotent: the
   * classifier short-circuits when `inputHash` + `classifierVersion` already
   * match. Use this from onboarding completion or from a manual "refresh
   * recommendations" button. Blocks the request for the duration of the
   * classify call (LLM call ~10–40s) — call it from a queue or background
   * job if the caller can't tolerate that latency.
   */
  @Post('business-profile/classify')
  async classify(@ActiveOrganization() organizationId: string) {
    if (!organizationId) {
      throw new HttpException(
        'No active organization selected',
        HttpStatus.BAD_REQUEST
      );
    }
    const result = await reclassifyBusiness(db, { organizationId });
    if (!result.success) throw mapErrorToHttpException(result.error);
    return result.data;
  }
}

/**
 * Global-admin-only batch backfill. Replaces
 * `scripts/backfill-business-profiles.ts` for prod operations — no need to
 * spin up a Fly machine or run a script with prod creds locally.
 *
 * Idempotent. Orgs with zero services are skipped. The classifier itself
 * short-circuits orgs whose profile is already up-to-date (matching
 * `inputHash` + `classifierVersion`), so re-runs are cheap.
 *
 * Mounted on its own controller so the `GlobalAdminGuard` doesn't leak
 * onto the regular owner-scoped endpoints above.
 */
@Controller('claire/admin')
@UseGuards(AuthGuard, GlobalAdminGuard)
export class ClaireAdminController {
  @Post('business-profile/backfill-all')
  async backfillAll(): Promise<BackfillBusinessProfilesSummary> {
    return backfillBusinessProfiles(db);
  }
}

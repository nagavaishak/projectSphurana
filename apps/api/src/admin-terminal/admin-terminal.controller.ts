import { auth } from '@borradh-workspace/auth/server';
import { db } from '@borradh-workspace/database';
import {
  getOrganizationConversationStats,
  getOrganizationOnboarding,
  getOrganizationWithMembers,
  impersonateUser,
  listAllOrganizations,
  listAuditLogs,
  stopImpersonating,
  verifyAdminTotp,
} from '@borradh-workspace/features/admin-terminal';
import {
  backfillAssetAnalysis,
  backfillAssetProbes,
  backfillAssetThumbnails,
  backfillAssetTranscodes,
} from '@borradh-workspace/features/assets';
import { seedSubscription } from '@borradh-workspace/features/billing';
import {
  claimPendingMetaConnection,
  getSelfServeMetaLink,
  getSelfServeStripeLink,
  linkStripeAccount,
  listPendingMetaConnections,
} from '@borradh-workspace/features/integrations';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  AuthGuard,
  CurrentUser,
  IsMobileClient,
  RawCookieHeader,
  SessionToken,
  SkipMemberCheck,
  SkipPaidPlanCheck,
} from '../common';
import { GlobalAdminGuard } from '../common/guards/global-admin.guard';
import { PlatformAdminGuard } from '../common/guards/platform-admin.guard';
import { sendSessionSwap, setAdmin2faCookie } from '../common/session/index.js';
import {
  ClaimPendingMetaConnectionDto,
  ImpersonateUserDto,
  LinkStripeAccountDto,
  ListAllOrganizationsDto,
  ListAuditLogsDto,
  SeedSubscriptionDto,
  StopImpersonatingDto,
  Verify2faDto,
} from './dto/index.js';

@Controller('admin-terminal')
@SkipMemberCheck()
@SkipPaidPlanCheck()
export class AdminTerminalController {
  private readonly logger = new Logger(AdminTerminalController.name);

  /**
   * Verify TOTP code for admin 2FA.
   * Only requires AuthGuard + admin ID check (not GlobalAdminGuard which checks the cookie).
   */
  @Post('verify-2fa')
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @UseGuards(AuthGuard, PlatformAdminGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async verify2fa(
    @Body() dto: Verify2faDto,
    @CurrentUser('id') userId: string,
    @RawCookieHeader() cookieHeader: string | undefined,
    @SessionToken() sessionToken: string,
    @Res() res: Response
  ) {
    const result = await verifyAdminTotp(auth.api, {
      code: dto.code,
      cookieHeader,
      sessionToken,
    });
    if (!result.success) {
      this.logger.warn(`Admin 2FA verification failed for user ${userId}`);
      throw this.mapError(result.error);
    }
    setAdmin2faCookie(res, userId);
    this.logger.log(`Admin 2FA verified for user ${userId}`);
    return res.status(HttpStatus.OK).json({ verified: true });
  }

  /**
   * List all organizations (paginated, searchable)
   */
  @Get('organizations')
  @UseGuards(AuthGuard, GlobalAdminGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async listOrganizations(@Query() dto: ListAllOrganizationsDto) {
    const result = await listAllOrganizations(db, dto);
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Get organization detail with members
   */
  @Get('organizations/:id')
  @UseGuards(AuthGuard, GlobalAdminGuard)
  async getOrganization(@Param('id') id: string): Promise<unknown> {
    const result = await getOrganizationWithMembers(db, {
      organizationId: id,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Conversation stats for an org (new conversations today / past 7 days /
   * total), used by the admin Conversations panel's stat cards.
   */
  @Get('organizations/:id/conversation-stats')
  @UseGuards(AuthGuard, GlobalAdminGuard)
  async getOrganizationConversationStats(
    @Param('id') id: string
  ): Promise<unknown> {
    const result = await getOrganizationConversationStats(db, {
      organizationId: id,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * The shareable Stripe onboarding link to send a merchant after a sales call.
   *
   * Constant per environment rather than per organization — it works for
   * someone who has no Borradh account at all, which is the entire reason it
   * exists. Served from here rather than hardcoded in the UI because it is
   * built from the platform's Connect client id and API origin.
   */
  @Get('stripe/self-serve-link')
  @UseGuards(AuthGuard, GlobalAdminGuard)
  async stripeSelfServeLink(): Promise<unknown> {
    const result = await getSelfServeStripeLink();
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * The shareable Facebook Login for Business link for this environment.
   *
   * One URL for everyone, so it can sit in an email template. The prospect who
   * follows it needs no Borradh account — which is the whole point, and why
   * this returns a constant rather than anything org-scoped.
   */
  @Get('meta/self-serve-link')
  @UseGuards(AuthGuard, GlobalAdminGuard)
  async getSelfServeMetaLink(): Promise<unknown> {
    const result = await getSelfServeMetaLink();
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Connections authorised through that link that nobody has attached yet.
   */
  @Get('meta/pending')
  @UseGuards(AuthGuard, GlobalAdminGuard)
  async listPendingMetaConnections(): Promise<unknown> {
    const result = await listPendingMetaConnections(db);
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Attach a parked connection to a workspace.
   *
   * The operator supplies the pairing, because only they know which business
   * the Page belongs to — the same judgement as the Stripe acct_ paste, and
   * the same reason it is a named human's action rather than an inference.
   */
  @Post('meta/pending/:pendingId/claim')
  @UseGuards(AuthGuard, GlobalAdminGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async claimPendingMetaConnection(
    @Param('pendingId') pendingId: string,
    @Body() dto: ClaimPendingMetaConnectionDto,
    @CurrentUser('id') adminUserId: string
  ): Promise<unknown> {
    const result = await claimPendingMetaConnection(db, {
      pendingConnectionId: pendingId,
      organizationId: dto.organizationId,
      claimedById: adminUserId,
      pageIds: dto.pageIds,
      adAccountId: dto.adAccountId,
      adAccountName: dto.adAccountName,
    });
    if (!result.success) throw this.mapError(result.error);
    this.logger.log(
      `Pending Meta connection ${pendingId} claimed by organization ${dto.organizationId}`
    );
    return result.data;
  }

  /**
   * What this organization has already had attached — subscription and Stripe
   * connected account.
   *
   * The onboarding screen is a pair of input boxes, and an empty box says "not
   * done", which is false for an org onboarded last week and an invitation to
   * attach a second subscription to one that already has one.
   */
  @Get('organizations/:id/onboarding')
  @UseGuards(AuthGuard, GlobalAdminGuard)
  async getOrganizationOnboarding(@Param('id') id: string): Promise<unknown> {
    const result = await getOrganizationOnboarding(db, {
      organizationId: id,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Attach an existing Stripe connected account to an organization.
   *
   * The same action the owner has on their own payments page, available to an
   * operator who is setting the workspace up beside the customer rather than
   * inside their account — which is the normal case right after a sales call,
   * when the merchant has finished Stripe onboarding from the shared link and
   * their `acct_` id is sitting in our Connect dashboard.
   */
  @Post('organizations/:id/stripe/link')
  @UseGuards(AuthGuard, GlobalAdminGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async linkStripeAccountForOrg(
    @Param('id') id: string,
    @Body() dto: LinkStripeAccountDto,
    @CurrentUser('id') adminUserId: string
  ): Promise<unknown> {
    const result = await linkStripeAccount(db, {
      organizationId: id,
      userId: adminUserId,
      stripeAccountId: dto.stripeAccountId,
    });
    if (!result.success) throw this.mapError(result.error);
    this.logger.log(
      `Stripe account ${result.data.stripeAccountId} linked to organization ${id}`
    );
    return result.data;
  }

  /**
   * Attach a Stripe subscription that already exists to an organization.
   *
   * Customers sold over the phone pay in Stripe during the call, not through
   * onboarding — so their workspace would otherwise look unsubscribed, with no
   * plan and no credit balance, until someone put them through a checkout they
   * had already paid for.
   */
  @Post('organizations/:id/subscription/seed')
  @UseGuards(AuthGuard, GlobalAdminGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async seedSubscription(
    @Param('id') id: string,
    @Body() dto: SeedSubscriptionDto
  ): Promise<unknown> {
    const result = await seedSubscription(db, {
      organizationId: id,
      stripeRef: dto.stripeRef,
    });
    if (!result.success) throw this.mapError(result.error);
    this.logger.log(
      `Subscription ${result.data.stripeSubscriptionId} seeded onto organization ${id}`
    );
    return result.data;
  }

  /**
   * List audit logs (paginated, filterable)
   */
  @Get('audit-logs')
  @UseGuards(AuthGuard, GlobalAdminGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async listAuditLogs(@Query() dto: ListAuditLogsDto) {
    const result = await listAuditLogs(db, dto);
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Impersonate a user. Creates a new session as the target user.
   */
  @Post('impersonate')
  @UseGuards(AuthGuard, GlobalAdminGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async impersonateUser(
    @Body() dto: ImpersonateUserDto,
    @CurrentUser('id') adminId: string,
    @RawCookieHeader() cookieHeader: string | undefined,
    @SessionToken() sessionToken: string,
    @IsMobileClient() isMobile: boolean,
    @Res() res: Response
  ) {
    const result = await impersonateUser(auth.api, {
      userId: dto.userId,
      cookieHeader,
      sessionToken,
    });
    if (!result.success) {
      this.logger.warn(
        `Impersonation failed for admin ${adminId} → user ${dto.userId}: ${result.error.message}`
      );
      throw this.mapError(result.error);
    }

    this.logger.log(`Admin ${adminId} impersonating user ${dto.userId}`);
    return sendSessionSwap(res, isMobile, result.data);
  }

  /**
   * Stop impersonating and restore the original admin session.
   */
  @Post('stop-impersonating')
  @UseGuards(AuthGuard)
  async stopImpersonating(
    @Body() dto: StopImpersonatingDto,
    @CurrentUser('id') adminId: string,
    @RawCookieHeader() cookieHeader: string | undefined,
    @SessionToken() sessionToken: string,
    @IsMobileClient() isMobile: boolean,
    @Res() res: Response
  ) {
    const result = await stopImpersonating(auth.api, {
      cookieHeader,
      sessionToken,
      adminSessionCookie: dto?.adminSessionToken,
    });
    if (!result.success) throw this.mapError(result.error);

    this.logger.log(`Admin ${adminId} stopped impersonating`);
    return sendSessionSwap(res, isMobile, result.data);
  }

  /**
   * Backfill thumbnails for all video assets that don't have one.
   * Enqueues jobs to the video-worker which generates thumbnails via FFmpeg.
   */
  @Post('backfill-asset-thumbnails')
  @UseGuards(AuthGuard)
  async backfillThumbnails(@Query('organizationId') organizationId?: string) {
    this.logger.log('Backfill asset thumbnails requested');
    const result = await backfillAssetThumbnails(db, { organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Backfill analysis for all raw assets that don't have an analysis record.
   */
  @Post('backfill-asset-analysis')
  async backfillAnalysis(@Query('organizationId') organizationId?: string) {
    this.logger.log('Backfill asset analysis requested');
    const result = await backfillAssetAnalysis(db, { organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Backfill ffprobe metadata for video assets with probeStatus = 'pending'.
   * The probe processor cascades into the transcode queue automatically, so
   * running this is usually enough to normalize the entire corpus.
   */
  @Post('backfill-asset-probes')
  @UseGuards(AuthGuard)
  async backfillProbes(@Query('organizationId') organizationId?: string) {
    this.logger.log('Backfill asset probes requested');
    const result = await backfillAssetProbes(db, { organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Backfill transcodes for video assets that are probed but still pending
   * transcoding. Useful for re-running failures without re-probing.
   */
  @Post('backfill-asset-transcodes')
  @UseGuards(AuthGuard)
  async backfillTranscodes(@Query('organizationId') organizationId?: string) {
    this.logger.log('Backfill asset transcodes requested');
    const result = await backfillAssetTranscodes(db, { organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  private mapError(error: { code: string; message: string }) {
    const map: Record<string, HttpStatus> = {
      [ErrorCodes.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
      [ErrorCodes.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
      [ErrorCodes.FORBIDDEN]: HttpStatus.FORBIDDEN,
      [ErrorCodes.NOT_FOUND]: HttpStatus.NOT_FOUND,
      [ErrorCodes.CONFLICT]: HttpStatus.CONFLICT,
      // 400 to match every other controller — the gate in
      // error-status-map.spec requires ONE status per code across the API, and
      // a second meaning for INVALID_STATE would make the code useless as a
      // signal. The message carries the "configure this secret" detail.
      [ErrorCodes.INVALID_STATE]: HttpStatus.BAD_REQUEST,
      [ErrorCodes.EXTERNAL_SERVICE_ERROR]: HttpStatus.BAD_GATEWAY,
    };
    return new HttpException(
      error.message,
      map[error.code] || HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}

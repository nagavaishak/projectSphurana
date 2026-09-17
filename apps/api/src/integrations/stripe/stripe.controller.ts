import { db } from '@borradh-workspace/database';
import {
  createAccountLink,
  createAccountSession,
  getStripeConnectStatus,
  linkStripeAccount,
  listStripeTaxCodes,
  refreshStripeAccount,
} from '@borradh-workspace/features/integrations';
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
import { ActiveOrganization, AuthGuard, CurrentUser } from '../../common';
import type {
  CreateAccountLinkDto,
  CreateAccountSessionDto,
  LinkStripeAccountDto,
} from './dto';
import { publicReturnUrl } from './public-return-url.js';

/**
 * Embedded Stripe Connect onboarding (contract §7.A). Thin controller —
 * kept separate from the monolithic integrations.controller.ts.
 */
@Controller('integrations/stripe')
@UseGuards(AuthGuard)
export class IntegrationsStripeController {
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

  @Post('account-session')
  @UsePipes(new ValidationPipe({ transform: true }))
  async accountSession(
    @Body() dto: CreateAccountSessionDto,
    @ActiveOrganization() orgId: string | undefined,
    @CurrentUser() user: { id: string; email?: string | null }
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await createAccountSession(db, {
      organizationId,
      userId: user.id,
      userEmail: user.email ?? undefined,
      components: dto.components,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post('account-link')
  @UsePipes(new ValidationPipe({ transform: true }))
  async accountLink(
    @Body() dto: CreateAccountLinkDto,
    @ActiveOrganization() orgId: string | undefined,
    @CurrentUser() user: { id: string; email?: string | null }
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await createAccountLink(db, {
      organizationId,
      userId: user.id,
      userEmail: user.email ?? undefined,
      // Rebased, not trusted: stale native bundles still post a
      // `localhost`/`capacitor://` origin, which Stripe refuses in live mode.
      returnUrl: publicReturnUrl(dto.returnUrl),
      refreshUrl: publicReturnUrl(dto.refreshUrl),
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Attach an EXISTING Stripe connected account to this workspace by its
   * `acct_` id.
   *
   * Serves the sales-led path: the merchant finishes Stripe onboarding from a
   * link sent after the call, so by the time their workspace exists the account
   * is already live and there is no OAuth handshake or Account Link left to
   * complete. Pasting the id is the only way to connect it.
   */
  @Post('link-account')
  @UsePipes(new ValidationPipe({ transform: true }))
  async linkAccount(
    @Body() dto: LinkStripeAccountDto,
    @ActiveOrganization() orgId: string | undefined,
    @CurrentUser() user: { id: string }
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await linkStripeAccount(db, {
      organizationId,
      userId: user.id,
      stripeAccountId: dto.stripeAccountId,
    });
    if (!result.success) throw this.mapError(result.error);

    // Return the same shape as account-status so the client can prime its
    // cache without a second round trip.
    const status = await getStripeConnectStatus(db, { organizationId });
    if (!status.success) throw this.mapError(status.error);
    return status.data;
  }

  @Get('account-status')
  async accountStatus(@ActiveOrganization() orgId: string | undefined) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await getStripeConnectStatus(db, { organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Stripe's own tax-code catalogue for the product and service pickers. This
   * is server-side so the Stripe secret stays private; the feature service
   * caches it in Redis rather than calling Stripe every time an editor opens.
   */
  @Get('tax-codes')
  async taxCodes(@ActiveOrganization() orgId: string | undefined) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listStripeTaxCodes({ organizationId });
    if (!result.success) throw this.mapError(result.error);
    return { taxCodes: result.data };
  }

  /**
   * Pull the latest account state from Stripe (used when the user returns from
   * hosted onboarding, before the account.updated webhook has arrived) and
   * return the refreshed status.
   */
  @Post('account-refresh')
  async accountRefresh(@ActiveOrganization() orgId: string | undefined) {
    const organizationId = this.requireActiveOrganization(orgId);
    // Best-effort live sync; if there's no account yet, fall through to status.
    await refreshStripeAccount(db, { organizationId });
    const result = await getStripeConnectStatus(db, { organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  private mapError(error: { code: string; message: string }) {
    const map: Record<string, HttpStatus> = {
      [ErrorCodes.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
      [ErrorCodes.INVALID_STATE]: HttpStatus.BAD_REQUEST,
      [ErrorCodes.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
      [ErrorCodes.FORBIDDEN]: HttpStatus.FORBIDDEN,
      [ErrorCodes.NOT_FOUND]: HttpStatus.NOT_FOUND,
      [ErrorCodes.CONFLICT]: HttpStatus.CONFLICT,
      // Stripe unreachable is not our fault and not a crash — 502, matching
      // every other controller that maps this code.
      [ErrorCodes.EXTERNAL_SERVICE_ERROR]: HttpStatus.BAD_GATEWAY,
    };
    return new HttpException(
      error.message,
      map[error.code] || HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}

import { db } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import {
  addMetaAdsPage,
  bookVoiceAppointment,
  completeCalendlyCallback,
  completeGmailCallback,
  completeGoogleCalendarCallback,
  completeGoogleMyBusinessCallback,
  completeInstagramCallback,
  completeMetaAdsCallback,
  completeOutlookCallback,
  completeStripeCallback,
  completeTimelyCallback,
  configureMetaIntegration,
  connectMetaAds,
  connectPhorest,
  createMetaLeadForm,
  createWhatsappTemplate,
  deleteWhatsappTemplate,
  disconnectBookingAccount,
  disconnectCalendarAccount,
  disconnectEmailAccount,
  disconnectGoogleMyBusiness,
  disconnectInstagram,
  disconnectMetaIntegration,
  disconnectStripe,
  disconnectWhatsAppAccount,
  finalizeWhatsappConnectFlow,
  fixInstagramUserIds,
  getGoogleReviewLink,
  getInstagramIntegration,
  getMetaIntegration,
  getPageInsights,
  getStripeConnection,
  handleFacebookLeadWebhook,
  importExternalTeamMembers,
  initiateMetaAdsFlfb,
  instagramAuthorizeUrl,
  listBookingAccounts,
  listCalendarAccounts,
  listEmailAccounts,
  listExternalTeamMembers,
  listGoogleCalendars,
  listGoogleMyBusinessAccounts,
  listMetaAdAccountsForWizard,
  listMetaAdsPages,
  listMetaLeadForms,
  listMetaPagesForWizard,
  listWhatsAppAccounts,
  listWhatsappTemplates,
  registerSelfServeMetaConnection,
  registerSelfServeStripeAccount,
  removeMetaAdsPage,
  setDefaultLeadForm,
  setDefaultMetaAdsPage,
  startCalendlyConnect,
  startGmailConnect,
  startGoogleCalendarConnect,
  startGoogleMyBusinessConnect,
  startInstagramConnect,
  startMetaAdsConnect,
  startOutlookConnect,
  startStripeConnect,
  startTimelyConnect,
  subscribeInstagramWebhooks,
  syncGoogleReviews,
  toggleInstagramChatbot,
  togglePageChatbot,
  toggleWhatsAppChatbot,
  updateCalendarSelection,
} from '@borradh-workspace/features/integrations';
// Every provider OAuth SDK import that used to live here is gone: building the
// authorize URL is now a use case, so the controller no longer knows any
// provider exists. `@Res()`/`Response` went with them — OAuthRedirectInterceptor
// renders the redirects.
import { ErrorCodes } from '@borradh-workspace/features/shared';
import type { OAuthStatePayload } from '@borradh-workspace/features/shared/oauth';
import { FacebookLeadsService } from '@borradh-workspace/integrations/facebook';
import { trackOrgEvent } from '@borradh-workspace/observability';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseFilters,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  ActiveOrganization,
  ApiKeyGuard,
  ApiKeyOrganization,
  AuthGuard,
  CurrentUser,
  OAuthCallback,
  OAuthRedirectInterceptor,
  OAuthState,
  OAuthStateExceptionFilter,
  OAuthStateGuard,
  Public,
  SkipPaidPlanCheck,
} from '../common';
import {
  ImportTeamMembersDto,
  OAuthCallbackQueryDto,
  VoiceBookAppointmentDto,
} from './dto';
import type {
  AddMetaAdsPageBody,
  ConfigureMetaAdsBody,
  CreateMetaLeadFormBody,
  CreateWhatsappTemplateBody,
  MetaAdsConnectBody,
  MetaAdsInitiateBody,
  PhorestConnectBody,
  WhatsappFinalizeBody,
} from './dto';

@Controller('integrations')
@SkipPaidPlanCheck()
// Renders OAuth callback outcomes as redirects, and a failed state
// verification as the same friendly redirect a malformed state always produced.
@UseInterceptors(OAuthRedirectInterceptor)
@UseFilters(OAuthStateExceptionFilter)
export class IntegrationsController {
  private readonly logger = new Logger(IntegrationsController.name);

  // ============================================
  // Facebook/Meta Lead Webhook Endpoints
  // ============================================
  // Note: For Facebook/Meta OAuth, use the Meta Ads integration endpoints
  // (/meta-ads/auth, /meta-ads/callback) which properly store tokens.

  /**
   * Facebook Webhook - Verify webhook
   * https://developers.facebook.com/docs/graph-api/webhooks/getting-started
   */
  @Get('facebook/webhook')
  async facebookWebhookVerify(
    @Query('hub.mode') mode: string,
    @Query('hub.challenge') challenge: string,
    @Query('hub.verify_token') verifyToken: string
  ) {
    this.logger.log('Facebook webhook verification request');

    const expectedToken = apiEnv.META_WEBHOOK_VERIFY_TOKEN;

    if (mode === 'subscribe' && verifyToken === expectedToken) {
      this.logger.log('Facebook webhook verified successfully');
      return challenge;
    }

    this.logger.warn('Facebook webhook verification failed');
    throw new HttpException('Verification failed', HttpStatus.FORBIDDEN);
  }

  /**
   * Facebook Webhook - Receive lead events
   *
   * Processes leadgen webhook events from Meta and creates leads in the database.
   * Automatically assigns leads to sequences that have a facebook_lead trigger.
   */
  @Post('facebook/webhook')
  async facebookWebhook(
    @Headers('x-hub-signature-256') signature: string,
    @Req() req: RawBodyRequest<Request>
  ) {
    const result = await handleFacebookLeadWebhook(db, {
      payload: req.rawBody?.toString('utf8'),
      signature,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Subscribe a Facebook page to receive lead form webhooks
   */
  @Post('facebook/subscribe-page')
  @UseGuards(AuthGuard)
  async subscribePage(
    @ActiveOrganization() organizationId: string,
    @Body() body: { pageId: string; pageAccessToken: string }
  ) {
    this.logger.log(
      `Subscribe Facebook page for organization: ${organizationId}`
    );

    const fbService = new FacebookLeadsService();

    const success = await fbService.subscribePage(
      body.pageId,
      body.pageAccessToken
    );

    if (!success) {
      throw new HttpException(
        'Failed to subscribe page',
        HttpStatus.BAD_REQUEST
      );
    }

    this.logger.log(`Page subscribed successfully: ${body.pageId}`);
    return { success: true };
  }

  // ============================================
  // Email Integration Endpoints (Gmail/Outlook)
  // ============================================

  /**
   * Gmail OAuth - Redirect to Google for authorization
   */
  @Get('email/auth/gmail')
  @UseGuards(AuthGuard)
  async gmailAuth(
    @ActiveOrganization() organizationId: string | undefined,
    @CurrentUser('id') userId: string,
    @Query('returnTo') returnTo: string | undefined
  ) {
    const result = await startGmailConnect({
      organizationId,
      userId,
      returnTo,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Gmail OAuth - Handle callback from Google
   */
  @OAuthCallback('gmail')
  @UseGuards(OAuthStateGuard)
  @Get('email/callback/gmail')
  async gmailCallback(
    @OAuthState() state: OAuthStatePayload,
    @Query() query: OAuthCallbackQueryDto
  ) {
    return completeGmailCallback(db, { state, ...query });
  }

  /**
   * Outlook OAuth - Redirect to Microsoft for authorization
   */
  @Get('email/auth/outlook')
  @UseGuards(AuthGuard)
  async outlookAuth(
    @ActiveOrganization() organizationId: string | undefined,
    @CurrentUser('id') userId: string,
    @Query('returnTo') returnTo: string | undefined
  ) {
    const result = await startOutlookConnect({
      organizationId,
      userId,
      returnTo,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Outlook OAuth - Handle callback from Microsoft
   */
  @OAuthCallback('outlook')
  @UseGuards(OAuthStateGuard)
  @Get('email/callback/outlook')
  async outlookCallback(
    @OAuthState() state: OAuthStatePayload,
    @Query() query: OAuthCallbackQueryDto
  ) {
    return completeOutlookCallback(db, { state, ...query });
  }

  /**
   * List all email accounts for the organization
   */
  @Get('email/accounts')
  @UseGuards(AuthGuard)
  async listOrgEmailAccounts(@ActiveOrganization() organizationId: string) {
    const result = await listEmailAccounts(db, { organizationId });

    if (!result.success) {
      throw new HttpException(result.error.message, HttpStatus.BAD_REQUEST);
    }

    return { accounts: result.data };
  }

  /**
   * Disconnect an email account
   */
  @Delete('email/accounts/:id')
  @UseGuards(AuthGuard)
  async disconnectOrgEmailAccount(
    @ActiveOrganization() organizationId: string,
    @Param('id') accountId: string
  ) {
    const result = await disconnectEmailAccount(db, {
      organizationId,
      accountId,
    });

    if (!result.success) {
      throw new HttpException(
        result.error.message,
        result.error.code === 'NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : HttpStatus.BAD_REQUEST
      );
    }

    return { success: true };
  }

  // ============================================
  // Calendar Integration Endpoints
  // ============================================

  /**
   * Google Calendar OAuth - Redirect to Google for authorization
   */
  @Get('calendar/auth/google')
  @UseGuards(AuthGuard)
  async googleCalendarAuth(
    @ActiveOrganization() organizationId: string | undefined,
    @CurrentUser('id') userId: string,
    @Query('returnTo') returnTo: string | undefined
  ) {
    const result = await startGoogleCalendarConnect({
      organizationId,
      userId,
      returnTo,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Google Calendar OAuth - Handle callback from Google
   */
  @OAuthCallback('google_calendar', 'calendar')
  @UseGuards(OAuthStateGuard)
  @Get('calendar/callback/google')
  async googleCalendarCallback(
    @OAuthState() state: OAuthStatePayload,
    @Query() query: OAuthCallbackQueryDto
  ) {
    return completeGoogleCalendarCallback(db, { state, ...query });
  }

  /**
   * List all calendar accounts for the organization
   */
  @Get('calendar/accounts')
  @UseGuards(AuthGuard)
  async listOrgCalendarAccounts(@ActiveOrganization() organizationId: string) {
    const result = await listCalendarAccounts(db, { organizationId });

    if (!result.success) {
      throw new HttpException(result.error.message, HttpStatus.BAD_REQUEST);
    }

    return { accounts: result.data };
  }

  /**
   * Disconnect a calendar account
   */
  @Delete('calendar/accounts/:id')
  @UseGuards(AuthGuard)
  async disconnectOrgCalendarAccount(
    @ActiveOrganization() organizationId: string,
    @Param('id') accountId: string
  ) {
    const result = await disconnectCalendarAccount(db, {
      organizationId,
      accountId,
    });

    if (!result.success) {
      throw new HttpException(
        result.error.message,
        result.error.code === 'NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : HttpStatus.BAD_REQUEST
      );
    }

    return { success: true };
  }

  /**
   * List available Google calendars for a connected account
   */
  @Get('calendar/accounts/:id/calendars')
  @UseGuards(AuthGuard)
  async listGoogleCalendarsForAccount(
    @ActiveOrganization() organizationId: string,
    @Param('id') accountId: string
  ) {
    const result = await listGoogleCalendars(db, {
      organizationId,
      accountId,
    });

    if (!result.success) {
      throw this.mapError(result.error);
    }

    return { calendars: result.data };
  }

  /**
   * Update the selected calendar for a connected account
   */
  @Put('calendar/accounts/:id')
  @UseGuards(AuthGuard)
  async updateCalendarAccountSelection(
    @ActiveOrganization() organizationId: string,
    @Param('id') accountId: string,
    @Body() body: { calendarId: string }
  ) {
    const result = await updateCalendarSelection(db, {
      organizationId,
      accountId,
      calendarId: body.calendarId,
    });

    if (!result.success) {
      throw this.mapError(result.error);
    }

    return result.data;
  }

  // ============================================
  // WhatsApp Integration Endpoints
  // ============================================

  /**
   * Finalize the WhatsApp Embedded Signup flow.
   *
   * The frontend opens Meta's Embedded Signup popup, which returns an
   * authorization `code` via the FB JS SDK callback and a `waba_id` via
   * a `postMessage` event. This endpoint exchanges the code for a
   * biSUAT, fetches the WABA's phone numbers, subscribes our app to
   * WABA webhooks, and upserts `whatsappAccount` rows.
   */
  @Post('whatsapp/finalize')
  @UseGuards(AuthGuard)
  async whatsappFinalize(
    @ActiveOrganization() organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() body: WhatsappFinalizeBody
  ) {
    const result = await finalizeWhatsappConnectFlow(db, {
      organizationId,
      connectedById: user.id,
      wabaId: body.wabaId,
      code: body.code,
    });
    if (!result.success)
      throw new HttpException(result.error.message, HttpStatus.BAD_REQUEST);
    return result.data;
  }

  /**
   * List all WhatsApp accounts for the organization
   */
  @Get('whatsapp/accounts')
  @UseGuards(AuthGuard)
  async listOrgWhatsAppAccounts(@ActiveOrganization() organizationId: string) {
    const result = await listWhatsAppAccounts(db, { organizationId });

    if (!result.success) {
      throw new HttpException(result.error.message, HttpStatus.BAD_REQUEST);
    }

    return { accounts: result.data };
  }

  /**
   * Disconnect a WhatsApp account
   */
  @Delete('whatsapp/accounts/:id')
  @UseGuards(AuthGuard)
  async disconnectOrgWhatsAppAccount(
    @ActiveOrganization() organizationId: string,
    @Param('id') accountId: string
  ) {
    const result = await disconnectWhatsAppAccount(db, {
      organizationId,
      accountId,
    });

    if (!result.success) {
      throw new HttpException(
        result.error.message,
        result.error.code === 'NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : HttpStatus.BAD_REQUEST
      );
    }

    return { success: true };
  }

  // ============================================
  // WhatsApp Template Management
  // ============================================

  /**
   * List message templates for a WhatsApp account
   */
  @Get('whatsapp/accounts/:id/templates')
  @UseGuards(AuthGuard)
  async listWhatsappTemplates(
    @ActiveOrganization() organizationId: string,
    @Param('id') accountId: string
  ) {
    const result = await listWhatsappTemplates(db, {
      organizationId,
      accountId,
    });

    if (!result.success) {
      throw new HttpException(
        result.error.message,
        result.error.code === ErrorCodes.NOT_FOUND
          ? HttpStatus.NOT_FOUND
          : HttpStatus.BAD_REQUEST
      );
    }

    return { templates: result.data };
  }

  /**
   * Create a message template for a WhatsApp account
   */
  @Post('whatsapp/accounts/:id/templates')
  @UseGuards(AuthGuard)
  async createWhatsappTemplate(
    @ActiveOrganization() organizationId: string,
    @Param('id') accountId: string,
    @Body() body: CreateWhatsappTemplateBody
  ) {
    const result = await createWhatsappTemplate(db, {
      organizationId,
      accountId,
      ...body,
    });

    if (!result.success) {
      throw new HttpException(
        result.error.message,
        result.error.code === ErrorCodes.NOT_FOUND
          ? HttpStatus.NOT_FOUND
          : result.error.code === ErrorCodes.VALIDATION_ERROR
            ? HttpStatus.BAD_REQUEST
            : HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    return { template: result.data };
  }

  /**
   * Delete a message template for a WhatsApp account
   */
  @Delete('whatsapp/accounts/:id/templates/:templateName')
  @UseGuards(AuthGuard)
  async deleteWhatsappTemplate(
    @ActiveOrganization() organizationId: string,
    @Param('id') accountId: string,
    @Param('templateName') templateName: string
  ) {
    const result = await deleteWhatsappTemplate(db, {
      organizationId,
      accountId,
      templateName,
    });

    if (!result.success) {
      throw new HttpException(
        result.error.message,
        result.error.code === ErrorCodes.NOT_FOUND
          ? HttpStatus.NOT_FOUND
          : HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    return { success: true };
  }

  // ============================================
  // Meta Ads Integration Endpoints (Setup Wizard)
  // ============================================

  /**
   * Meta Ads OAuth - Redirect to Facebook for authorization
   */
  @Get('meta-ads/auth')
  @UseGuards(AuthGuard)
  async metaAdsAuth(
    @ActiveOrganization() organizationId: string | undefined,
    @CurrentUser('id') userId: string
  ) {
    const result = await startMetaAdsConnect({ organizationId, userId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Meta Ads — Facebook Login for Business (FLFB) popup finalize.
   *
   * The frontend opens the FLFB popup (config_id) which returns an
   * authorization `code` in-page (redirect-less, no redirect_uri). This
   * endpoint exchanges it in a single call for a non-expiring system-user
   * token, saves the integration with pending_selection status, and returns
   * the integrationId for the selection wizard — the same result shape the
   * classic GET /meta-ads/callback produces, minus the browser redirect.
   */
  @Post('meta-ads/initiate')
  @UseGuards(AuthGuard)
  async metaAdsInitiate(
    @ActiveOrganization() organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() body: MetaAdsInitiateBody
  ) {
    const result = await initiateMetaAdsFlfb(db, {
      organizationId,
      userId: user.id,
      code: body.code,
    });
    if (!result.success)
      throw new HttpException(result.error.message, HttpStatus.BAD_REQUEST);
    return result.data; // { integrationId }
  }

  /**
   * Meta Ads OAuth - Handle callback and save integration immediately
   * Redirects with integrationId for the wizard to fetch data
   */
  @OAuthCallback('meta_ads', 'meta-ads')
  @UseGuards(OAuthStateGuard)
  @Get('meta-ads/callback')
  async metaAdsCallback(
    @OAuthState() state: OAuthStatePayload,
    @Query() query: OAuthCallbackQueryDto
  ) {
    return completeMetaAdsCallback(db, { state, ...query });
  }

  /**
   * Complete Meta Ads connection with wizard selections
   */
  @Post('meta-ads/connect')
  @UseGuards(AuthGuard)
  async metaAdsConnect(
    @ActiveOrganization() organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() body: MetaAdsConnectBody
  ) {
    const result = await connectMetaAds(db, {
      ...body,
      organizationId,
      userId: user.id,
      platform: 'facebook',
    });

    if (!result.success) {
      throw new HttpException(result.error.message, HttpStatus.BAD_REQUEST);
    }

    return { success: true, integration: result.data };
  }

  /**
   * Configure a pending Meta Ads integration (wizard completion)
   * Used when integration is saved with pending_selection status
   */
  @Post('meta-ads/configure')
  @UseGuards(AuthGuard)
  async configureMetaAdsIntegration(
    @ActiveOrganization() organizationId: string,
    @Body() body: ConfigureMetaAdsBody
  ) {
    const result = await configureMetaIntegration(db, {
      ...body,
      organizationId,
    });

    if (!result.success) {
      const status =
        result.error.code === ErrorCodes.NOT_FOUND
          ? HttpStatus.NOT_FOUND
          : result.error.code === ErrorCodes.CONFLICT
            ? HttpStatus.CONFLICT
            : HttpStatus.BAD_REQUEST;
      throw new HttpException(result.error.message, status);
    }

    return {
      success: true,
      integration: result.data.integration,
      pages: result.data.pages,
    };
  }

  /**
   * Get current Meta Ads integration for the organization
   */
  @Get('meta-ads/integration')
  @UseGuards(AuthGuard)
  async getOrgMetaIntegration(@ActiveOrganization() organizationId: string) {
    const result = await getMetaIntegration(db, { organizationId });

    if (!result.success) {
      throw new HttpException(result.error.message, HttpStatus.BAD_REQUEST);
    }

    return { integration: result.data };
  }

  /**
   * Get page-level insights (impressions, engaged users, followers, page views)
   * Uses pages_read_engagement and read_insights permissions
   */
  @Get('meta-ads/page-insights')
  @UseGuards(AuthGuard)
  async getMetaPageInsights(
    @ActiveOrganization() organizationId: string,
    @Query('since') since?: string,
    @Query('until') until?: string
  ) {
    const result = await getPageInsights(db, {
      organizationId,
      since,
      until,
    });

    if (!result.success) {
      const status =
        result.error.code === ErrorCodes.FORBIDDEN
          ? HttpStatus.PRECONDITION_FAILED
          : result.error.code === ErrorCodes.VALIDATION_ERROR
            ? HttpStatus.BAD_REQUEST
            : HttpStatus.INTERNAL_SERVER_ERROR;
      throw new HttpException(result.error.message, status);
    }

    return result.data;
  }

  /**
   * Disconnect Meta Ads integration
   */
  @Delete('meta-ads/integration')
  @UseGuards(AuthGuard)
  async disconnectOrgMetaIntegration(
    @ActiveOrganization() organizationId: string
  ) {
    const result = await disconnectMetaIntegration(db, { organizationId });

    if (!result.success) {
      throw new HttpException(
        result.error.message,
        result.error.code === 'NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : HttpStatus.BAD_REQUEST
      );
    }

    return { success: true };
  }

  // ============================================
  // Meta Ads Page Management Endpoints
  // ============================================

  /**
   * List all Meta Ads pages for the organization
   */
  @Get('meta-ads/pages')
  @UseGuards(AuthGuard)
  async listOrgMetaAdsPages(@ActiveOrganization() organizationId: string) {
    const result = await listMetaAdsPages(db, { organizationId });

    if (!result.success) {
      throw new HttpException(
        result.error.message,
        result.error.code === 'NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : HttpStatus.BAD_REQUEST
      );
    }

    return { pages: result.data };
  }

  /**
   * Add a new Meta Ads page to the organization's integration
   */
  @Post('meta-ads/pages')
  @UseGuards(AuthGuard)
  async addOrgMetaAdsPage(
    @ActiveOrganization() organizationId: string,
    @Body() body: AddMetaAdsPageBody
  ) {
    const result = await addMetaAdsPage(db, {
      ...body,
      organizationId,
      setAsDefault: body.setAsDefault ?? false,
    });

    if (!result.success) {
      throw new HttpException(
        result.error.message,
        result.error.code === 'NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : result.error.code === 'ALREADY_EXISTS'
            ? HttpStatus.CONFLICT
            : HttpStatus.BAD_REQUEST
      );
    }

    return { page: result.data };
  }

  /**
   * Remove a Meta Ads page from the organization's integration
   */
  @Delete('meta-ads/pages/:pageId')
  @UseGuards(AuthGuard)
  async removeOrgMetaAdsPage(
    @ActiveOrganization() organizationId: string,
    @Param('pageId') pageId: string
  ) {
    const result = await removeMetaAdsPage(db, { organizationId, pageId });

    if (!result.success) {
      throw new HttpException(
        result.error.message,
        result.error.code === 'NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : HttpStatus.BAD_REQUEST
      );
    }

    return { success: true };
  }

  /**
   * Set the default Meta Ads page for the organization's integration
   */
  @Put('meta-ads/pages/:pageId/default')
  @UseGuards(AuthGuard)
  async setDefaultOrgMetaAdsPage(
    @ActiveOrganization() organizationId: string,
    @Param('pageId') pageId: string
  ) {
    const result = await setDefaultMetaAdsPage(db, { organizationId, pageId });

    if (!result.success) {
      throw new HttpException(
        result.error.message,
        result.error.code === 'NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : HttpStatus.BAD_REQUEST
      );
    }

    return { integration: result.data };
  }

  /**
   * Get available ad accounts for wizard (uses temp access token)
   */
  @Post('meta-ads/ad-accounts')
  @UseGuards(AuthGuard)
  async getMetaAdAccounts(@Body() body: { accessToken: string }) {
    const result = await listMetaAdAccountsForWizard(body.accessToken);
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Get available pages for wizard (uses temp access token)
   */
  @Post('meta-ads/pages')
  @UseGuards(AuthGuard)
  async getMetaPages(@Body() body: { accessToken: string }) {
    const result = await listMetaPagesForWizard(body.accessToken);
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * List lead forms from the connected Meta page
   * Fetches forms directly from Meta's API (no local storage)
   */
  @Get('meta-ads/lead-forms')
  @UseGuards(AuthGuard)
  async listMetaLeadFormsEndpoint(
    @ActiveOrganization() organizationId: string
  ) {
    const result = await listMetaLeadForms(db, { organizationId });

    if (!result.success) {
      throw this.mapError(result.error);
    }

    return result.data;
  }

  /**
   * Set the default lead form for the organization's Meta integration
   */
  @Put('meta-ads/default-lead-form')
  @UseGuards(AuthGuard)
  async setDefaultMetaLeadForm(
    @ActiveOrganization() organizationId: string,
    @Body() body: { leadFormId: string; leadFormName?: string }
  ) {
    const result = await setDefaultLeadForm(db, {
      organizationId,
      leadFormId: body.leadFormId,
      leadFormName: body.leadFormName,
    });

    if (!result.success) {
      throw new HttpException(
        result.error.message,
        result.error.code === 'NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : HttpStatus.BAD_REQUEST
      );
    }

    return result.data;
  }

  /**
   * Create a lead form on Meta and set it as default
   */
  @Post('meta-ads/lead-forms')
  @UseGuards(AuthGuard)
  async createMetaLeadFormEndpoint(
    @ActiveOrganization() organizationId: string,
    @Body() body: CreateMetaLeadFormBody
  ) {
    const result = await createMetaLeadForm(db, { ...body, organizationId });

    if (!result.success) {
      throw this.mapError(result.error);
    }

    return result.data;
  }

  // ============================================
  // Instagram Integration Endpoints
  // ============================================

  @Get('instagram/auth')
  @UseGuards(AuthGuard)
  async instagramAuth(
    @ActiveOrganization() organizationId: string | undefined,
    @CurrentUser('id') userId: string
  ) {
    const result = await startInstagramConnect({ organizationId, userId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Instagram OAuth - Return the provider authorize URL as JSON.
   *
   * The SPA authenticates XHRs with a Bearer token; a full-page navigation to
   * `instagram/auth` can only carry cookies, so users whose session cookie has
   * lapsed (but whose Bearer token is still live) hit the AuthGuard 401. The
   * frontend fetches this endpoint with the Bearer attached, then redirects the
   * browser to `url` — removing the cookie dependency entirely.
   */
  @Get('instagram/authorize-url')
  @UseGuards(AuthGuard)
  async instagramAuthorizeUrlEndpoint(
    @ActiveOrganization() organizationId: string | undefined,
    @CurrentUser('id') userId: string
  ) {
    const result = await instagramAuthorizeUrl({ organizationId, userId });
    if (!result.success) throw this.mapError(result.error);
    trackOrgEvent(
      organizationId as string,
      'integrations.instagram_connect.started',
      {
        userId,
        initiator: 'authorize-url',
      }
    );
    return { url: result.data };
  }

  /**
   * Instagram OAuth - Handle callback and save integration
   */
  @OAuthCallback('instagram')
  @UseGuards(OAuthStateGuard)
  @Get('instagram/callback')
  async instagramCallback(
    @OAuthState() state: OAuthStatePayload,
    @Query() query: OAuthCallbackQueryDto
  ) {
    return completeInstagramCallback(db, { state, ...query });
  }

  /**
   * Get current Instagram integration for the organization
   */
  @Get('instagram/integration')
  @UseGuards(AuthGuard)
  async getOrgInstagramIntegration(
    @ActiveOrganization() organizationId: string
  ) {
    const result = await getInstagramIntegration(db, { organizationId });

    if (!result.success) {
      throw new HttpException(result.error.message, HttpStatus.BAD_REQUEST);
    }

    return result.data;
  }

  /**
   * Disconnect Instagram integration
   */
  @Delete('instagram/integration')
  @UseGuards(AuthGuard)
  async disconnectOrgInstagramIntegration(
    @ActiveOrganization() organizationId: string
  ) {
    const result = await disconnectInstagram(db, { organizationId });

    if (!result.success) {
      throw new HttpException(
        result.error.message,
        result.error.code === 'NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : HttpStatus.BAD_REQUEST
      );
    }

    return { success: true };
  }

  /**
   * Toggle chatbot for Instagram DMs
   */
  @Put('instagram/chatbot')
  @UseGuards(AuthGuard)
  async toggleInstagramChatbotEndpoint(
    @ActiveOrganization() organizationId: string,
    @Body() body: { enabled: boolean }
  ) {
    const result = await toggleInstagramChatbot(db, {
      organizationId,
      enabled: body.enabled,
    });

    if (!result.success) {
      throw new HttpException(
        result.error.message,
        result.error.code === ErrorCodes.NOT_FOUND
          ? HttpStatus.NOT_FOUND
          : HttpStatus.BAD_REQUEST
      );
    }

    return result.data;
  }

  /**
   * Toggle chatbot for a Meta Ads page (Messenger)
   */
  @Put('meta-ads-pages/:pageId/chatbot')
  @UseGuards(AuthGuard)
  async togglePageChatbotEndpoint(
    @ActiveOrganization() organizationId: string,
    @Param('pageId') pageId: string,
    @Body() body: { enabled: boolean }
  ) {
    const result = await togglePageChatbot(db, {
      organizationId,
      pageId,
      enabled: body.enabled,
    });

    if (!result.success) {
      throw new HttpException(
        result.error.message,
        result.error.code === ErrorCodes.NOT_FOUND
          ? HttpStatus.NOT_FOUND
          : HttpStatus.BAD_REQUEST
      );
    }

    return result.data;
  }

  /**
   * Toggle chatbot for a WhatsApp account
   */
  @Put('whatsapp/:accountId/chatbot')
  @UseGuards(AuthGuard)
  async toggleWhatsAppChatbotEndpoint(
    @ActiveOrganization() organizationId: string,
    @Param('accountId') accountId: string,
    @Body() body: { enabled: boolean }
  ) {
    const result = await toggleWhatsAppChatbot(db, {
      organizationId,
      accountId,
      enabled: body.enabled,
    });

    if (!result.success) {
      throw new HttpException(
        result.error.message,
        result.error.code === ErrorCodes.NOT_FOUND
          ? HttpStatus.NOT_FOUND
          : HttpStatus.BAD_REQUEST
      );
    }

    return result.data;
  }

  /**
   * Fix instagram_user_id for all active integrations (admin/one-time fix)
   */
  @Post('instagram/fix-user-ids')
  @UseGuards(AuthGuard)
  async fixInstagramUserIdsEndpoint() {
    const result = await fixInstagramUserIds(db);

    if (!result.success) {
      throw new HttpException(
        result.error.message,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    return result.data;
  }

  /**
   * Subscribe all active Instagram integrations to messaging webhooks (one-time migration)
   */
  @Post('instagram/subscribe-webhooks')
  @UseGuards(AuthGuard)
  async subscribeInstagramWebhooksEndpoint() {
    const result = await subscribeInstagramWebhooks(db);

    if (!result.success) {
      throw new HttpException(
        result.error.message,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    return result.data;
  }

  // ============================================
  // Stripe Connect Integration Endpoints
  // ============================================

  /**
   * Stripe Connect OAuth - Return auth URL for frontend redirect
   */
  @Get('stripe/auth')
  @UseGuards(AuthGuard)
  async stripeAuth(
    @ActiveOrganization() organizationId: string | undefined,
    @CurrentUser('id') userId: string,
    @Query('returnTo') returnTo: string | undefined
  ) {
    const result = await startStripeConnect(db, {
      organizationId,
      userId,
      returnTo,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Stripe Connect OAuth - Handle callback from Stripe
   */
  @OAuthCallback('stripe')
  @UseGuards(OAuthStateGuard)
  @Get('stripe/callback')
  async stripeCallback(
    @OAuthState() state: OAuthStatePayload,
    @Query() query: OAuthCallbackQueryDto
  ) {
    return completeStripeCallback(db, { state, ...query });
  }

  /**
   * Stripe Connect OAuth — callback for the SHAREABLE self-serve link.
   *
   * PUBLIC by design, and marked as such rather than merely left unguarded.
   * The point of the link is that it can be sent to a business before they
   * have a Borradh account, so there is no session, no active organization and
   * no signed state to verify — which is exactly the shape the org-scoped
   * `stripe/callback` above is right to reject.
   *
   * Throttled because it is unauthenticated and every call reaches Stripe.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('stripe/self-serve/callback')
  async stripeSelfServeCallback(
    @Query('code') code: string | undefined,
    @Query('error') error: string | undefined
  ) {
    return registerSelfServeStripeAccount({ code, error });
  }

  /**
   * Facebook Login for Business — callback for the SHAREABLE self-serve link.
   *
   * PUBLIC by design, same reasoning as the Stripe twin above: the link goes
   * to a prospect who has no Borradh account, so there is no session and no
   * org to scope to. The connection is PARKED, never used, until a platform
   * admin attaches it to a workspace.
   *
   * Throttled because it is unauthenticated and every call reaches Meta.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('meta/self-serve/callback')
  async metaSelfServeCallback(@Query('code') code: string | undefined) {
    return registerSelfServeMetaConnection(db, { code: code ?? '' });
  }

  /**
   * Get Stripe Connect integration status
   */
  @Get('stripe/integration')
  @UseGuards(AuthGuard)
  async getOrgStripeConnection(@ActiveOrganization() organizationId: string) {
    const result = await getStripeConnection(db, { organizationId });

    if (!result.success) {
      throw this.mapError(result.error);
    }

    return { integration: result.data };
  }

  /**
   * Disconnect Stripe Connect integration
   */
  @Delete('stripe/integration')
  @UseGuards(AuthGuard)
  async disconnectOrgStripeConnection(
    @ActiveOrganization() organizationId: string
  ) {
    const result = await disconnectStripe(db, { organizationId });

    if (!result.success) {
      throw this.mapError(result.error);
    }

    return { success: true };
  }

  // ============================================
  // Booking Integration Endpoints (Calendly, Timely, Phorest, Fresha)
  // ============================================

  /**
   * Calendly OAuth - Redirect to Calendly for authorization
   */
  @Get('booking/auth/calendly')
  @UseGuards(AuthGuard)
  async calendlyAuth(
    @ActiveOrganization() organizationId: string | undefined,
    @CurrentUser('id') userId: string,
    @Query('returnTo') returnTo: string | undefined
  ) {
    const result = await startCalendlyConnect({
      organizationId,
      userId,
      returnTo,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Calendly OAuth - Handle callback from Calendly
   */
  @OAuthCallback('calendly')
  @UseGuards(OAuthStateGuard)
  @Get('booking/callback/calendly')
  async calendlyCallback(
    @OAuthState() state: OAuthStatePayload,
    @Query() query: OAuthCallbackQueryDto
  ) {
    return completeCalendlyCallback(db, { state, ...query });
  }

  /**
   * Timely OAuth - Redirect to Timely for authorization
   */
  @Get('booking/auth/timely')
  @UseGuards(AuthGuard)
  async timelyAuth(
    @ActiveOrganization() organizationId: string | undefined,
    @CurrentUser('id') userId: string,
    @Query('returnTo') returnTo: string | undefined
  ) {
    const result = await startTimelyConnect({
      organizationId,
      userId,
      returnTo,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Timely OAuth - Handle callback from Timely
   */
  @OAuthCallback('timely')
  @UseGuards(OAuthStateGuard)
  @Get('booking/callback/timely')
  async timelyCallback(
    @OAuthState() state: OAuthStatePayload,
    @Query() query: OAuthCallbackQueryDto
  ) {
    return completeTimelyCallback(db, { state, ...query });
  }

  /**
   * Phorest - Connect using API credentials (no OAuth)
   */
  @Post('booking/connect/phorest')
  @UseGuards(AuthGuard)
  async phorestConnect(
    @ActiveOrganization() organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() body: PhorestConnectBody
  ) {
    const result = await connectPhorest(db, {
      ...body,
      organizationId,
      userId: user.id,
      region: body.region ?? 'eu',
    });

    if (!result.success) {
      throw new HttpException(result.error.message, HttpStatus.BAD_REQUEST);
    }

    return { success: true, account: result.data };
  }

  /**
   * List all booking accounts for the organization
   */
  @Get('booking/accounts')
  @UseGuards(AuthGuard)
  async listOrgBookingAccounts(
    @ActiveOrganization() organizationId: string,
    @Query('provider') provider?: 'calendly' | 'timely' | 'phorest' | 'fresha'
  ) {
    const result = await listBookingAccounts(db, { organizationId, provider });

    if (!result.success) {
      throw new HttpException(result.error.message, HttpStatus.BAD_REQUEST);
    }

    return { accounts: result.data };
  }

  /**
   * Disconnect a booking account
   */
  @Delete('booking/accounts/:id')
  @UseGuards(AuthGuard)
  async disconnectOrgBookingAccount(
    @ActiveOrganization() organizationId: string,
    @Param('id') accountId: string
  ) {
    const result = await disconnectBookingAccount(db, {
      organizationId,
      accountId,
    });

    if (!result.success) {
      throw new HttpException(
        result.error.message,
        result.error.code === 'NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : HttpStatus.BAD_REQUEST
      );
    }

    return { success: true };
  }

  /**
   * List external team members from a connected booking provider
   */
  @Get('booking/accounts/:id/team-members')
  @UseGuards(AuthGuard)
  async listExternalTeamMembersEndpoint(
    @ActiveOrganization() organizationId: string,
    @Param('id') accountId: string
  ) {
    const result = await listExternalTeamMembers(db, {
      bookingAccountId: accountId,
      organizationId,
    });

    if (!result.success) {
      throw this.mapError(result.error);
    }

    return { members: result.data };
  }

  /**
   * Import external team members as practitioners
   */
  @Post('booking/accounts/:id/import-team-members')
  @UseGuards(AuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async importExternalTeamMembersEndpoint(
    @ActiveOrganization() organizationId: string,
    @Param('id') accountId: string,
    @Body() dto: ImportTeamMembersDto
  ) {
    const result = await importExternalTeamMembers(db, {
      organizationId,
      bookingAccountId: accountId,
      ...dto,
    });

    if (!result.success) {
      throw this.mapError(result.error);
    }

    return result.data;
  }

  // ============================================
  // Google My Business Integration Endpoints
  // ============================================

  /**
   * Google My Business OAuth - Redirect to Google for authorization
   */
  @Get('google-my-business/auth')
  @UseGuards(AuthGuard)
  async googleMyBusinessAuth(
    @ActiveOrganization() organizationId: string | undefined,
    @CurrentUser('id') userId: string,
    @Query('returnTo') returnTo: string | undefined
  ) {
    const result = await startGoogleMyBusinessConnect({
      organizationId,
      userId,
      returnTo,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Google My Business OAuth - Handle callback from Google
   */
  @OAuthCallback('google_my_business', 'google-my-business')
  @UseGuards(OAuthStateGuard)
  @Get('google-my-business/callback')
  async googleMyBusinessCallback(
    @OAuthState() state: OAuthStatePayload,
    @Query() query: OAuthCallbackQueryDto
  ) {
    return completeGoogleMyBusinessCallback(db, { state, ...query });
  }

  /**
   * List all Google My Business accounts for the organization
   */
  @Get('google-my-business/accounts')
  @UseGuards(AuthGuard)
  async listOrgGoogleMyBusinessAccounts(
    @ActiveOrganization() organizationId: string
  ) {
    const result = await listGoogleMyBusinessAccounts(db, { organizationId });

    if (!result.success) {
      throw new HttpException(result.error.message, HttpStatus.BAD_REQUEST);
    }

    return { accounts: result.data };
  }

  /**
   * Get the Google review link for a specific account
   */
  @Get('google-my-business/accounts/:id/review-link')
  @UseGuards(AuthGuard)
  async getGoogleMyBusinessReviewLink(
    @ActiveOrganization() organizationId: string,
    @Param('id') accountId: string
  ) {
    const result = await getGoogleReviewLink(db, {
      organizationId,
      accountId,
    });

    if (!result.success) {
      throw new HttpException(
        result.error.message,
        result.error.code === 'NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : HttpStatus.BAD_REQUEST
      );
    }

    return result.data;
  }

  /**
   * Sync Google reviews for a specific account
   */
  @Post('google-my-business/accounts/:id/sync')
  @UseGuards(AuthGuard)
  async syncGoogleMyBusinessReviews(
    @ActiveOrganization() organizationId: string,
    @Param('id') accountId: string
  ) {
    const result = await syncGoogleReviews(db, {
      organizationId,
      accountId,
    });

    if (!result.success) {
      throw this.mapError(result.error);
    }

    return result.data;
  }

  /**
   * Disconnect a Google My Business account
   */
  @Delete('google-my-business/accounts/:id')
  @UseGuards(AuthGuard)
  async disconnectOrgGoogleMyBusinessAccount(
    @ActiveOrganization() organizationId: string,
    @Param('id') accountId: string
  ) {
    const result = await disconnectGoogleMyBusiness(db, {
      organizationId,
      accountId,
    });

    if (!result.success) {
      throw new HttpException(
        result.error.message,
        result.error.code === 'NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : HttpStatus.BAD_REQUEST
      );
    }

    return { success: true };
  }

  // ============================================
  // Voice AI Booking Integration
  // ============================================

  /**
   * Book an appointment via AI voice call
   *
   * This endpoint is called by the voice AI (ElevenLabs) when a customer books
   * an appointment during a voice call. The API key determines which
   * organization the appointment is created for.
   *
   * Authentication: X-API-Key header (organization API key)
   */
  @Post('voice/book')
  @UseGuards(ApiKeyGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async voiceBookAppointment(
    @ApiKeyOrganization('id') organizationId: string,
    @Body() dto: VoiceBookAppointmentDto
  ) {
    const result = await bookVoiceAppointment(db, { ...dto, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  private mapError(error: {
    code: string;
    message: string;
  }) {
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

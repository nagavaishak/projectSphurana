import { db } from '@borradh-workspace/database';
import { runHealthAlerts } from '@borradh-workspace/features/meta-ads';
import {
  inspectConversationIntent,
  listCampaignConversationIntents,
} from '@borradh-workspace/features/meta-campaigns';
import { queueVoiceIngest } from '@borradh-workspace/features/voice-cloning';
import type { AssetSource } from '@borradh-workspace/labels';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  DestructiveTestingGuard,
  SeedTokenGuard,
} from './guards/seed-token.guard.js';
import { TestingService } from './testing.service.js';

/** The catch-all e2e email pattern — every seeded user matches it. */
const BROAD_E2E_PATTERN = 'e2e.test.%';

/**
 * Minimum age for a BROAD sweep. Anything younger may still belong to a
 * running suite. Junk from earlier runs is hours old and still gets reaped.
 */
const BROAD_SWEEP_MIN_AGE_MINUTES = 120;

/**
 * Testing controller for E2E test data management.
 *
 * Two tiers of access:
 * - Safe endpoints (@UseGuards(SeedTokenGuard)): available anywhere E2E_SEED_TOKEN is set.
 *   Read-only or simulation-only (health, simulate-webhook, etc.)
 * - Destructive endpoints (@UseGuards(DestructiveTestingGuard)): require token AND NODE_ENV !== 'production'
 *   (unless E2E_DESTRUCTIVE_ALLOWED). Data mutation (cleanup, force-verify, seed, delete) AND
 *   token/session reads (create-session, verification-token, reset-password-token) — the latter
 *   are token-exfiltration vectors, so a leaked seed token on a prod-mode host must not expose them.
 */
@Controller('testing')
export class TestingController {
  constructor(private readonly testingService: TestingService) {}

  /**
   * Health check for testing endpoints.
   */
  @UseGuards(SeedTokenGuard)
  @Get('health')
  @HttpCode(HttpStatus.OK)
  async healthCheck() {
    return this.testingService.healthCheck();
  }

  /**
   * Create a session for a test user.
   * Returns the session token for constructing storageState in E2E tests.
   */
  @UseGuards(DestructiveTestingGuard)
  @Post('create-session')
  @HttpCode(HttpStatus.OK)
  async createSession(@Body() body: { email: string; password: string }) {
    // Issues a real session token — a token-exfiltration vector, so it must be
    // blocked on prod-mode hosts even if a seed token leaks.
    return this.testingService.createSession(body.email, body.password);
  }

  /**
   * PRD-46 — synthetic DB pool-wedge reproducer / idle-in-transaction mitigation
   * verifier. Opens N concurrent idle transactions and reports how many the
   * `idle_in_transaction_session_timeout` guard reaped. Destructive-gated: it
   * holds pooled connections (can briefly exhaust the pool), so it must not be
   * callable on a prod-mode host without explicit allow. See
   * TestingService.holdIdleTransactions + apps/load-tests/scripts/pool-wedge.js.
   */
  @UseGuards(DestructiveTestingGuard)
  @Post('db-pool-hold')
  @HttpCode(HttpStatus.OK)
  async dbPoolHold(
    @Body() body: { connections?: number; idleHoldMs?: number }
  ) {
    return this.testingService.holdIdleTransactions(body ?? {});
  }

  /**
   * Get the latest email verification token for a given email.
   */
  @UseGuards(DestructiveTestingGuard)
  @Get('verification-token')
  @HttpCode(HttpStatus.OK)
  async getVerificationToken(@Query('email') email: string) {
    // Returns a real verification token — exfiltration vector. Block on
    // prod-mode hosts even with a valid seed token.
    return this.testingService.getVerificationToken(email);
  }

  /**
   * Mint a patient manage-booking link for an appointment.
   *
   * E2E cannot read the link out of the DB — only the SHA-256 is stored — so it
   * asks for a fresh one, exactly as the confirmation email does. Returns a live
   * capability, so it carries the same prod guard as `verification-token`.
   */
  @UseGuards(DestructiveTestingGuard)
  @Post('manage-booking-link')
  @HttpCode(HttpStatus.OK)
  async issueManageBookingLink(@Body() body: { appointmentId: string }) {
    return this.testingService.issueManageBookingLink(body.appointmentId);
  }

  /**
   * Mint a retrievable patient sign-in OTP (ENG-647 portal auth E2E). The
   * emailed code is hashed at rest, so E2E asks for a fresh usable one. Returns
   * a live credential → same prod guard as the other token endpoints.
   */
  @UseGuards(DestructiveTestingGuard)
  @Post('patient-otp')
  @HttpCode(HttpStatus.OK)
  async issuePatientOtp(
    @Body() body: { email: string; organizationSlug: string }
  ) {
    return this.testingService.issuePatientOtp(
      body.email,
      body.organizationSlug
    );
  }

  /**
   * Get the latest password reset token for a given email.
   * Orders by createdAt desc to ensure we get the reset token, not an older verification token.
   */
  @UseGuards(DestructiveTestingGuard)
  @Get('reset-password-token')
  @HttpCode(HttpStatus.OK)
  async getResetPasswordToken(@Query('email') email: string) {
    // Returns a real password-reset token — exfiltration vector. Block on
    // prod-mode hosts even with a valid seed token.
    return this.testingService.getResetPasswordToken(email);
  }

  /**
   * Force-verify a user's email address.
   */
  @UseGuards(DestructiveTestingGuard)
  @Post('force-verify')
  @HttpCode(HttpStatus.OK)
  async forceVerifyUser(@Body() body: { email: string }) {
    return this.testingService.forceVerifyUser(body.email);
  }

  /**
   * Force-verify an organization.
   */
  @UseGuards(DestructiveTestingGuard)
  @Post('force-verify-org')
  @HttpCode(HttpStatus.OK)
  async forceVerifyOrganization(@Body() body: { organizationId: string }) {
    return this.testingService.forceVerifyOrganization(body.organizationId);
  }

  /**
   * Seed the platform admin the admin-terminal E2E needs — verified, with a
   * password and a TOTP secret it can derive live codes from.
   *
   * Returns the TOTP secret in plaintext so the spec drives the REAL
   * `verify-2fa` endpoint rather than stubbing the gate. Destructive (writes
   * user, account and two_factor rows) and a credential vector, so it needs the
   * seed token AND a non-production host.
   */
  @UseGuards(DestructiveTestingGuard)
  @Post('seed-platform-admin')
  @HttpCode(HttpStatus.OK)
  async seedPlatformAdmin(@Body() body: { email: string; password: string }) {
    return this.testingService.seedPlatformAdmin(body);
  }

  /**
   * Create a verified organization for an existing user (the user becomes its
   * owner). The pure-API org provisioner behind `createEmptyVerifiedOrg` — lets
   * a connected/targeting E2E test mint a fresh per-test org instead of
   * mutating shared org state (CONNECTED-ISOLATION.md). Destructive (writes
   * organization + member rows), so it requires the seed token AND is blocked
   * in production.
   */
  @UseGuards(DestructiveTestingGuard)
  @Post('create-org')
  @HttpCode(HttpStatus.OK)
  async createOrg(
    @Body() body: { userId: string; name: string; businessType?: string }
  ) {
    return this.testingService.createOrg(body);
  }

  /**
   * Provision a whole ready-to-use org (verified user + verified org +
   * subscription + session) in ONE call.
   *
   * Replaces the runner-side chain of sign-up → force-verify → create-session →
   * create-org: four HTTP round trips, two password-KDF passes, and a
   * sign-up/sign-in race that produced most of the tabs suite's flake under ~26
   * concurrent workers. See TestingService.provisionOrg.
   */
  @UseGuards(DestructiveTestingGuard)
  @Post('provision-org')
  @HttpCode(HttpStatus.OK)
  async provisionOrg(
    @Body()
    body: {
      email: string;
      password: string;
      name: string;
      orgName: string;
      businessType?: string;
    }
  ) {
    return this.testingService.provisionOrg(body);
  }

  /**
   * Get the active organization ID from a session token.
   */
  @UseGuards(SeedTokenGuard)
  @Get('active-organization')
  @HttpCode(HttpStatus.OK)
  async getActiveOrganizationId(@Query('sessionToken') sessionToken: string) {
    return this.testingService.getActiveOrganizationId(sessionToken);
  }

  /**
   * Force-create a subscription for an organization.
   * Bypasses Stripe checkout for E2E testing.
   */
  @UseGuards(DestructiveTestingGuard)
  @Post('force-subscription')
  @HttpCode(HttpStatus.OK)
  async forceCreateSubscription(@Body() body: { organizationId: string }) {
    return this.testingService.forceCreateSubscription(body.organizationId);
  }

  /**
   * Seed test data for E2E tests.
   * Creates test users, organizations, and other necessary data.
   */
  @UseGuards(DestructiveTestingGuard)
  @Post('seed')
  @HttpCode(HttpStatus.OK)
  async seedTestData() {
    return this.testingService.seedTestData();
  }

  /**
   * Simulate a webhook by calling handleIncomingMessage directly.
   * Used for chatbot E2E testing since Meta has no API for sending messages AS a user.
   */
  @UseGuards(SeedTokenGuard)
  @Post('simulate-webhook')
  @HttpCode(HttpStatus.OK)
  async simulateWebhook(
    @Body()
    body: {
      platform: 'facebook_messenger' | 'instagram_dm' | 'whatsapp';
      pageId: string;
      senderId: string;
      messageText: string;
      queueDelayMs?: number;
      adReferral?: { metaAdId: string; source?: string; adTitle?: string };
    }
  ) {
    return this.testingService.simulateWebhook(body);
  }

  /**
   * Run Claire's outbound-first sequence for a lead, without waiting on Meta.
   *
   * The real trigger is a Meta lead-form webhook, which a test cannot produce.
   * This runs the SAME services the queue worker runs, so the send path,
   * consent gate, idempotency and stage transitions are the real ones — only
   * the trigger is faked. `step` lets a test fire a 4h/24h nudge immediately
   * instead of waiting for the delayed job.
   *
   * Sends still go through Twilio/Meta, so pair it with CAMPAIGNS_DRY_RUN
   * unless a real message is intended.
   */
  @UseGuards(SeedTokenGuard)
  @Post('simulate-lead-first-touch')
  @HttpCode(HttpStatus.OK)
  async simulateLeadFirstTouch(
    @Body()
    body: {
      organizationId: string;
      leadId: string;
      step?: 'opener' | 'followup_1' | 'followup_2';
      conversationId?: string;
    }
  ) {
    return this.testingService.simulateLeadFirstTouch(body);
  }

  /**
   * Inject a Stripe Connect webhook event (no signature verification) so E2E can
   * settle card/QR/deposit/subscription/refund tenders deterministically.
   * Reproduces the real StripeConnectWebhooksController routing. Safe tier —
   * touches only the caller's seeded org, no outbound call.
   */
  @UseGuards(SeedTokenGuard)
  @Post('simulate-stripe-webhook')
  @HttpCode(HttpStatus.OK)
  async simulateStripeWebhook(
    // The event shape is the service's to define — mirroring it here was 24
    // lines of duplicate union that could silently drift from the handler it
    // forwards to. No ValidationPipe runs on this route, so the inline literal
    // was never validating anything either.
    @Body() body: Parameters<TestingService['simulateStripeWebhook']>[0]
  ) {
    return this.testingService.simulateStripeWebhook(body);
  }

  /**
   * Seed a Stripe Connect integration row so Stripe-backed tenders find an
   * active connected account (with STRIPE_E2E_STUB on). Destructive — writes a
   * row; never on real production.
   */
  @UseGuards(DestructiveTestingGuard)
  @Post('seed-stripe-connect')
  @HttpCode(HttpStatus.OK)
  async seedStripeConnect(
    @Body()
    body: {
      organizationId: string;
      stripeAccountId?: string;
      defaultCurrency?: string;
      chargesEnabled?: boolean;
      payoutsEnabled?: boolean;
      detailsSubmitted?: boolean;
      isActive?: boolean;
    }
  ) {
    return this.testingService.seedStripeConnect(body);
  }

  /**
   * Look up the org's open sale + payment rows so E2E can inject a settlement
   * webhook by salePaymentId. Safe tier (read-only).
   */
  @UseGuards(SeedTokenGuard)
  @Get('open-sale')
  @HttpCode(HttpStatus.OK)
  async getOpenSale(@Query('organizationId') organizationId: string) {
    return this.testingService.getOpenSale(organizationId);
  }

  /**
   * Force a REAL Messenger delivery failure (delivery-failure handling test).
   * Records an inbound message on a connected page with a deliberately-invalid
   * PSID and lets the bot reply attempt a real Meta send, which Meta rejects —
   * exercising the escalation + conversation_delivery_failed observability path
   * and surfacing the exact Meta error code.
   *
   * Destructive-gated: makes a real outbound Meta call, so it never runs on a
   * real production host (preview Fly apps set E2E_DESTRUCTIVE_ALLOWED).
   */
  @UseGuards(DestructiveTestingGuard)
  @Post('force-delivery-failure')
  @HttpCode(HttpStatus.OK)
  async forceDeliveryFailure(
    @Body() body: { pageId: string; senderId?: string; messageText?: string }
  ) {
    return this.testingService.forceMessengerDeliveryFailure(body);
  }

  /**
   * Simulate an assistant (Claire) chat message by running a single turn
   * headlessly. The assistant analogue of `simulate-webhook` — gives E2E
   * tests a deterministic injection path into the LLM-driven assistant.
   *
   * `forceSkillIds` bypasses the first-turn `classifyIntent` router so a test
   * can target one skill's tools deterministically. This override is testing
   * only; the public `/assistant/chat` controller never exposes it.
   */
  @UseGuards(SeedTokenGuard)
  @Post('simulate-assistant-message')
  @HttpCode(HttpStatus.OK)
  async simulateAssistantMessage(
    @Body()
    body: {
      organizationId: string;
      userId: string;
      conversationId?: string;
      messageText: string;
      forceSkillIds?: string[];
      sessionToken?: string;
    }
  ) {
    return this.testingService.simulateAssistantMessage(body);
  }

  /**
   * Simulate a full Claire-on-WhatsApp owner turn (WS-10) WITHOUT the real
   * WhatsApp number. Runs the worker process function against a MOCKED
   * WhatsAppCloudService that captures the outbound sends, and returns them so
   * an integration test can assert the text/media/CTA shape. This is the
   * Phase-2 integration gate.
   *
   * Either pass `userId` directly, or `fromPhone` to resolve the paired owner
   * via `resolveOwnerByPhone`.
   */
  @UseGuards(SeedTokenGuard)
  @Post('simulate-claire-whatsapp-turn')
  @HttpCode(HttpStatus.OK)
  async simulateClaireWhatsappTurn(
    @Body()
    body: {
      organizationId?: string;
      userId?: string;
      fromPhone?: string;
      message: string;
    }
  ) {
    return this.testingService.simulateClaireWhatsappTurn(body);
  }

  /**
   * Inspect a conversation's CTWA attribution + high-intent classification
   * (PRD-1 follow-up). Look it up by `conversationId`, or by
   * `organizationId` + `platform` + `externalUserId` — the latter lets you
   * verify a live click-to-WhatsApp conversation: send a CTWA message from a
   * phone, then look it up by that WhatsApp number to confirm `adMetaId`
   * landed and see whether it counts as a high-intent lead (with reasons).
   */
  @UseGuards(SeedTokenGuard)
  @Get('conversation-intent')
  @HttpCode(HttpStatus.OK)
  async getConversationIntent(
    @Query('conversationId') conversationId?: string,
    @Query('organizationId') organizationId?: string,
    @Query('platform')
    platform?: 'facebook_messenger' | 'instagram_dm' | 'whatsapp',
    @Query('externalUserId') externalUserId?: string
  ) {
    const result = await inspectConversationIntent(db, {
      ...(conversationId ? { conversationId } : {}),
      ...(organizationId ? { organizationId } : {}),
      ...(platform ? { platform } : {}),
      ...(externalUserId ? { externalUserId } : {}),
    });
    if (!result.success) {
      throw new UnauthorizedException(result.error.message);
    }
    return result.data;
  }

  /**
   * Per-conversation high vs low intent breakdown for a campaign (PRD-1
   * follow-up). Shows exactly which attributed conversations count as
   * high-intent leads and why — the testable view behind `diagnoseCampaign`'s
   * `highIntentLeadCount`.
   */
  @UseGuards(SeedTokenGuard)
  @Get('campaign-conversation-intents')
  @HttpCode(HttpStatus.OK)
  async getCampaignConversationIntents(
    @Query('organizationId') organizationId: string,
    @Query('metaCampaignId') metaCampaignId: string,
    @Query('withinDays') withinDays?: string
  ) {
    const parsedWindow = withinDays
      ? Number.parseInt(withinDays, 10)
      : undefined;
    const result = await listCampaignConversationIntents(db, {
      organizationId,
      metaCampaignId,
      ...(parsedWindow && !Number.isNaN(parsedWindow)
        ? { withinDays: parsedWindow }
        : {}),
    });
    if (!result.success) {
      throw new UnauthorizedException(result.error.message);
    }
    return result.data;
  }

  /**
   * Get conversation messages for test assertions.
   */
  @UseGuards(SeedTokenGuard)
  @Get('conversation-messages')
  @HttpCode(HttpStatus.OK)
  async getConversationMessages(
    @Query('conversationId') conversationId: string,
    @Query('limit') limit?: string
  ) {
    return this.testingService.getConversationMessages(
      conversationId,
      limit ? Number.parseInt(limit, 10) : 20
    );
  }

  /**
   * Ensure the chatbot is enabled for a specific Meta Ads page.
   * Used before webhook tests to guarantee the chatbot will process messages.
   */
  @UseGuards(SeedTokenGuard)
  @Post('ensure-chatbot-enabled')
  @HttpCode(HttpStatus.OK)
  async ensureChatbotEnabled(@Body() body: { pageId: string }) {
    return this.testingService.ensureChatbotEnabled(body.pageId);
  }

  /**
   * Get the organization ID for a user by email.
   */
  @UseGuards(SeedTokenGuard)
  @Get('organization-by-email')
  @HttpCode(HttpStatus.OK)
  async getOrganizationByEmail(@Query('email') email: string) {
    return this.testingService.getOrganizationByEmail(email);
  }

  /**
   * Delete all organizations for a user by email.
   * Resets the user to pre-onboarding state.
   */
  @UseGuards(DestructiveTestingGuard)
  @Post('delete-user-orgs')
  @HttpCode(HttpStatus.OK)
  async deleteUserOrganizations(@Body() body: { email: string }) {
    return this.testingService.deleteUserOrganizations(body.email);
  }

  /**
   * Clone a durable public E2E fixture to a throwaway key.
   *
   * Specs that seed an asset and then DELETE it must not point that asset at
   * the shared fixture — `deleteAsset` hard-deletes the S3 object behind
   * `blobUrl`, which is how the shared fixture kept disappearing and breaking
   * every downstream suite. Clone first, seed the clone.
   * See TestingService.cloneFixture.
   */
  @UseGuards(SeedTokenGuard)
  @Post('clone-fixture')
  @HttpCode(HttpStatus.OK)
  async cloneFixture(@Body() body: { sourceUrl: string }) {
    return this.testingService.cloneFixture(body);
  }

  /**
   * Seed a video asset for E2E tests.
   * Creates an asset record with type='video' and source='edited' (skips AI analysis)
   * unless `source: 'raw'` is passed — the uploaded-footage picker lists raw
   * uploads only, so it needs 'raw' to see the seed.
   * Uses a deterministic per-org, per-source ID for idempotency.
   */
  @UseGuards(SeedTokenGuard)
  @Post('seed-asset')
  @HttpCode(HttpStatus.OK)
  async seedAsset(
    @Body()
    body: {
      organizationId: string;
      uploadedById: string;
      name: string;
      blobUrl: string;
      source?: AssetSource;
    }
  ) {
    return this.testingService.seedAsset(body);
  }

  /**
   * Seed a ready video for E2E tests.
   * Creates a video record with status='ready' and a minimal draftConfig.
   * Uses a deterministic ID for idempotency.
   */
  @UseGuards(SeedTokenGuard)
  @Post('seed-video')
  @HttpCode(HttpStatus.OK)
  async seedVideo(
    @Body()
    body: {
      organizationId: string;
      createdById: string;
      title: string;
      blobUrl: string;
    }
  ) {
    return this.testingService.seedVideo(body);
  }

  /**
   * Seed a configured Meta Ads (Facebook) connection for E2E / preview tests.
   * Writes meta_ads_integration + meta_ads_page directly from a provided
   * (ideally never-expiring system-user) token, bypassing the live OAuth
   * popup. Idempotent. NOT yet called from setup-connected.ts.
   */
  @UseGuards(SeedTokenGuard)
  @Post('seed-meta-ads')
  @HttpCode(HttpStatus.OK)
  async seedMetaAds(
    @Body()
    body: {
      organizationId: string;
      connectedById: string;
      accessToken: string;
      pageId: string;
      pageName?: string;
      adAccountId?: string;
      adAccountName?: string;
    }
  ) {
    return this.testingService.seedMetaAds(body);
  }

  /**
   * Seed a valid WhatsApp Business connection for E2E / preview tests.
   * Writes a whatsapp_account row directly from a provided (ideally
   * never-expiring system-user) token, bypassing the Embedded Signup flow.
   * Idempotent on (organizationId, phoneNumberId).
   */
  @UseGuards(SeedTokenGuard)
  @Post('seed-whatsapp')
  @HttpCode(HttpStatus.OK)
  async seedWhatsApp(
    @Body()
    body: {
      organizationId: string;
      connectedById: string;
      accessToken: string;
      phoneNumberId: string;
      wabaId: string;
      phoneNumber: string;
      displayName?: string;
    }
  ) {
    return this.testingService.seedWhatsAppAccount(body);
  }

  /**
   * Seed an appointment for E2E tests.
   * Creates an appointment via the feature service using the session token's org.
   */
  @UseGuards(SeedTokenGuard)
  @Post('seed-appointment')
  @HttpCode(HttpStatus.OK)
  async seedAppointment(
    @Body()
    body: {
      sessionToken: string;
      title: string;
      startDate: string;
      endDate: string;
      color?: string;
      status?: string;
      leadId: string;
      assignedToId: string;
    }
  ) {
    return this.testingService.seedAppointment(body);
  }

  /**
   * Clean up test data by email pattern.
   * Deletes all users matching the pattern and cascades through organizations and feature data.
   * Default pattern: 'e2e.test.%'
   */
  @UseGuards(DestructiveTestingGuard)
  @Post('cleanup')
  @HttpCode(HttpStatus.OK)
  async cleanupTestData(
    @Body() body?: { pattern?: string; olderThanMinutes?: number }
  ) {
    const pattern = body?.pattern ?? BROAD_E2E_PATTERN;

    // A sweep of the WHOLE e2e namespace is never safe without an age guard.
    // Playwright's workers share one database inside a lane, so an unguarded
    // broad sweep deletes the organizations other workers are mid-test on:
    // their next sign-in answers "Invalid email or password", their next
    // insert dies on a foreign key, and a dozen unrelated specs fail in the
    // same second looking like a flaky app.
    //
    // Defaulted HERE rather than trusted to every caller, because the failure
    // mode is omission — `seed.cleanup()` with no arguments, which is exactly
    // how it was reintroduced. A caller that names a NARROW pattern (its own
    // run's namespace) still reaps immediately, which is what those callers
    // want and cannot hurt anyone else.
    const olderThanMinutes =
      body?.olderThanMinutes ??
      (pattern === BROAD_E2E_PATTERN ? BROAD_SWEEP_MIN_AGE_MINUTES : undefined);

    return this.testingService.cleanupByEmailPattern(pattern, olderThanMinutes);
  }

  /**
   * Trigger the monthly content batch for an org (skips the 1st-of-month
   * cron wait). Used by the long-running image-generation E2E spec to seed
   * real Fabric graphics into a batch.
   */
  @UseGuards(DestructiveTestingGuard)
  @Post('trigger-monthly-content-batch')
  @HttpCode(HttpStatus.OK)
  async triggerMonthlyContentBatch(
    @Body()
    body: {
      organizationId: string;
      periodMonth?: string;
      graphicCount?: number;
      videoCount?: number;
    }
  ) {
    return this.testingService.triggerMonthlyContentBatch(body);
  }

  /**
   * Delete a content batch and everything it spawned (items, graphics).
   * Used by the image-generation E2E spec's teardown.
   */
  @UseGuards(DestructiveTestingGuard)
  @Post('cleanup-content-batch')
  @HttpCode(HttpStatus.OK)
  async cleanupContentBatch(@Body() body: { contentBatchId: string }) {
    return this.testingService.cleanupContentBatch(body.contentBatchId);
  }

  /**
   * Update organization settings directly (bypasses auth guards).
   * Used by E2E tests that need to modify org settings for chatbot behavior tests.
   */
  @UseGuards(SeedTokenGuard)
  @Patch('update-org-settings')
  @HttpCode(HttpStatus.OK)
  async updateOrgSettings(
    @Body()
    body: {
      organizationId: string;
      bookingDestination?: 'borradh' | 'external_link';
      defaultBookingLink?: string | null;
    }
  ) {
    return this.testingService.updateOrgSettings(body);
  }

  /**
   * Update chatbot settings directly (bypasses auth guards).
   * Used by E2E tests that need to modify chatbot system prompts.
   */
  /**
   * Trigger voice cloning ingest for an existing org/page.
   * Pulls historical messages, analyzes style, embeds for retrieval.
   */
  @UseGuards(SeedTokenGuard)
  @Post('trigger-voice-ingest')
  @HttpCode(HttpStatus.OK)
  async triggerVoiceIngest(
    @Body() body: { organizationId: string; metaAdsPageId: string }
  ) {
    const result = await queueVoiceIngest({
      organizationId: body.organizationId,
      metaAdsPageId: body.metaAdsPageId,
      triggerReason: 'manual',
    });
    if (!result.success) {
      return { success: false, error: result.error.message };
    }
    return { success: true, ...result.data };
  }

  /**
   * Get the status of a conversation.
   * Used by targeting tests to verify bot activation vs agent_handling.
   */
  @UseGuards(SeedTokenGuard)
  @Get('conversation-status')
  @HttpCode(HttpStatus.OK)
  async getConversationStatus(@Query('conversationId') conversationId: string) {
    return this.testingService.getConversationStatus(conversationId);
  }

  /**
   * Trigger Meta account health alerts manually.
   * Runs the full health check + alert flow for all active integrations.
   */
  @UseGuards(SeedTokenGuard)
  @Post('trigger-health-alerts')
  @HttpCode(HttpStatus.OK)
  async triggerHealthAlerts(@Body() body: { organizationId?: string } = {}) {
    const result = await runHealthAlerts(db, {
      organizationId: body.organizationId,
    });
    if (!result.success) {
      return { success: false, error: result.error.message };
    }
    return { success: true, ...result.data };
  }

  @UseGuards(SeedTokenGuard)
  @Put('update-chatbot-settings')
  @HttpCode(HttpStatus.OK)
  async updateChatbotSettings(
    @Body()
    body: {
      organizationId: string;
      chatbotSystemPrompt?: string | null;
      chatbotSettings?: Record<string, unknown>;
    }
  ) {
    return this.testingService.updateChatbotSettings(body);
  }
}

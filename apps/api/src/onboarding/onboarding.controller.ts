import { auth } from '@borradh-workspace/auth/server';
import { db } from '@borradh-workspace/database';
import {
  acceptIntroOffer,
  applyAnalysisToOrganization,
  completeOnboardingSession,
  converseOnboardingSlide,
  generateAdCandidates,
  generateVideoCandidates,
  getOnboardingSession,
  launchStagedCampaign,
  onboardingAnalysisScopeKey,
  previewIntroOffer,
  regenerateAdCandidate,
  resetOnboardingSession,
  stageOnboardingCampaign,
  startOnboardingWebsiteAnalysis,
  suggestCampaignService,
  updateOnboardingSession,
} from '@borradh-workspace/features/onboarding';
import { setActiveOrganization } from '@borradh-workspace/features/organizations';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import { getAnalyzeWebsiteJob } from '@borradh-workspace/features/website-analysis';
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  AuthGuard,
  CurrentUser,
  SessionToken,
  SkipPaidPlanCheck,
} from '../common/index.js';
import { buildCandidatesView } from './candidates-view.js';
import {
  AcceptIntroOfferDto,
  ConverseOnboardingSlideDto,
  RegenerateAdCandidateDto,
  StageOnboardingCampaignDto,
  StartOnboardingWebsiteDto,
  UpdateOnboardingSessionDto,
} from './dto/index.js';
import {
  kickCandidateGeneration,
  persistAnalysisSnapshot,
  startOnboardingContentBatch,
} from './session-artifacts.js';

/**
 * Claire-guided onboarding (Typeform-style slide deck).
 *
 * The WHOLE controller skips the paid-plan check: billing happens AFTER
 * onboarding (owner decision), so no subscription exists for the freshly
 * created organization while these endpoints run.
 *
 * The session/website/analysis endpoints additionally skip email
 * verification — they serve slide 0 and the analysis that runs WHILE the
 * user verifies their email (before any organization exists).
 */
@Controller('onboarding')
@UseGuards(AuthGuard)
@SkipPaidPlanCheck()
export class OnboardingController {
  private readonly logger = new Logger(OnboardingController.name);

  // ==================== SESSION (pre-verification safe) ====================

  /**
   * GET /onboarding/session — current user's session, or null when they never
   * started the flow. Deliberately NON-creating: login-landing peeks this to
   * decide whether to resume onboarding, and legacy users must not get a
   * session minted just by signing in. Creation happens on the first real
   * interaction (PATCH upserts; POST /website creates).
   */
  @Get('session')
  async getSession(@CurrentUser('id') userId: string) {
    const result = await getOnboardingSession(db, {
      userId,
      createIfMissing: false,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /** PATCH /onboarding/session — advance slide and/or record an answer. */
  @Patch('session')
  async updateSession(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateOnboardingSessionDto
  ) {
    const result = await updateOnboardingSession(db, { userId, ...dto });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /** POST /onboarding/website — store the URL + start website analysis. */
  @Post('website')
  async startWebsite(
    @CurrentUser('id') userId: string,
    @Body() dto: StartOnboardingWebsiteDto
  ) {
    const result = await startOnboardingWebsiteAnalysis(db, {
      userId,
      websiteUrl: dto.websiteUrl,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * GET /onboarding/analysis/:jobId — poll the website-analysis job. Jobs are
   * scoped by `user:{userId}` (pre-org), so users only read their own jobs.
   * On completion the result snapshot is persisted to the session's
   * `analysisResult` column so `apply-analysis` can bootstrap the org from it
   * (and the analysis slide can re-render on resume).
   */
  @Get('analysis/:jobId')
  async getAnalysis(
    @Param('jobId') jobId: string,
    @CurrentUser('id') userId: string
  ) {
    const result = await getAnalyzeWebsiteJob(
      jobId,
      onboardingAnalysisScopeKey(userId)
    );
    if (!result.success) throw this.mapError(result.error);

    if (result.data.status === 'done' && result.data.result) {
      await persistAnalysisSnapshot(
        this.logger,
        userId,
        jobId,
        result.data.result
      );
    }

    return result.data;
  }

  // ==================== ORG BOOTSTRAP + CAMPAIGN FLOW ====================

  /**
   * POST /onboarding/apply-analysis — create the organization + services
   * from the analysis snapshot (idempotent), then set it as the user's
   * active organization (mirrors POST /organization/active) so subsequent
   * org-scoped requests work without a separate call.
   */
  @Post('apply-analysis')
  async applyAnalysis(
    @CurrentUser('id') userId: string,
    @SessionToken() sessionToken: string
  ) {
    const result = await applyAnalysisToOrganization(db, { userId });
    if (!result.success) throw this.mapError(result.error);

    const activeResult = await setActiveOrganization(auth.api, {
      sessionToken,
      organizationId: result.data.organizationId,
    });
    if (!activeResult.success) {
      // Non-fatal: the org exists and getActive falls back to the user's
      // single org on next session read; the frontend can also retry via
      // POST /organization/active.
      this.logger.warn(
        `Failed to set active organization ${result.data.organizationId} after apply-analysis: ${activeResult.error.message}`
      );
    }

    return result.data;
  }

  /**
   * POST /onboarding/content-batch — kick the month-of-content generation
   * for the content_source slide. Idempotent: requestMonthlyBatch no-ops on
   * an existing batch for the month. The heavy seeding is fire-and-forget
   * server-side; the content-approval slide polls the batch as usual.
   */
  @Post('content-batch')
  async startContentBatch(@CurrentUser('id') userId: string) {
    const result = await startOnboardingContentBatch(this.logger, userId);
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /** POST /onboarding/suggest-service — pick the service to advertise. */
  @Post('suggest-service')
  async suggestService(@CurrentUser('id') userId: string) {
    const result = await suggestCampaignService(db, { userId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * GET /onboarding/offer-preview — the intro offer `accept-offer` WOULD
   * create (read-only), so the slide can show the actual first-visit price.
   */
  @Get('offer-preview')
  async offerPreview(@CurrentUser('id') userId: string) {
    const result = await previewIntroOffer(db, { userId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /** POST /onboarding/converse — Claire free-text slide round-trip. */
  @Post('converse')
  async converse(
    @CurrentUser('id') userId: string,
    @Body() dto: ConverseOnboardingSlideDto
  ) {
    const result = await converseOnboardingSlide(db, { userId, ...dto });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * POST /onboarding/accept-offer — persist the intro offer, then
   * fire-and-forget BOTH candidate generators (videos are minutes-scale, so
   * kicking them here hides the latency behind the next slides). The
   * ad/video-candidates endpoints stay available for idempotent re-entry.
   */
  @Post('accept-offer')
  async acceptOffer(
    @CurrentUser('id') userId: string,
    @Body() dto: AcceptIntroOfferDto
  ) {
    const result = await acceptIntroOffer(db, { userId, ...dto });
    if (!result.success) throw this.mapError(result.error);

    kickCandidateGeneration(this.logger, userId);

    return result.data;
  }

  // ==================== CANDIDATES ====================

  /** POST /onboarding/ad-candidates — (re)generate the ad-picker grid. */
  @Post('ad-candidates')
  async generateAds(@CurrentUser('id') userId: string) {
    const result = await generateAdCandidates(db, { userId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /** POST /onboarding/ad-candidates/:graphicId/regenerate — re-roll one. */
  @Post('ad-candidates/:graphicId/regenerate')
  async regenerateAd(
    @Param('graphicId') graphicId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: RegenerateAdCandidateDto
  ) {
    const result = await regenerateAdCandidate(db, {
      userId,
      graphicId,
      prompt: dto.prompt,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /** POST /onboarding/video-candidates — (re)generate the video grid. */
  @Post('video-candidates')
  async generateVideos(@CurrentUser('id') userId: string) {
    const result = await generateVideoCandidates(db, { userId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * GET /onboarding/candidates — lightweight render-status poll for the
   * ad-picker / video-picker slides. Reads the graphic/video rows referenced
   * by the session and re-signs stored private-CDN media (mirrors the
   * content-batches controller) so the grids can load them directly.
   */
  @Get('candidates')
  async getCandidates(@CurrentUser('id') userId: string) {
    const sessionResult = await getOnboardingSession(db, {
      userId,
      createIfMissing: false,
    });
    if (!sessionResult.success) throw this.mapError(sessionResult.error);
    const session = sessionResult.data;

    const organizationId = session?.organizationId;
    if (!session || !organizationId) {
      return { adCandidates: [], videoCandidates: [] };
    }

    return buildCandidatesView(session, organizationId, userId);
  }

  // ==================== LAUNCH + COMPLETE ====================

  /** POST /onboarding/stage-campaign — stage the campaign locally. */
  @Post('stage-campaign')
  async stageCampaign(
    @CurrentUser('id') userId: string,
    @Body() dto: StageOnboardingCampaignDto
  ) {
    const result = await stageOnboardingCampaign(db, { userId, ...dto });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * POST /onboarding/launch — run the launch orchestrator (idempotent /
   * resumable). Failures carry `step` (+ `launchProgress`) in the response
   * body so the frontend can show a step-specific message and resume-retry.
   */
  @Post('launch')
  async launch(@CurrentUser('id') userId: string) {
    const result = await launchStagedCampaign(db, { userId });
    if (!result.success) {
      const details = (
        result.error as {
          details?: { step?: string; launchProgress?: string };
        }
      ).details;
      throw new HttpException(
        {
          message: result.error.message,
          step: details?.step,
          launchProgress: details?.launchProgress,
        },
        this.mapError(result.error).getStatus()
      );
    }
    return result.data;
  }

  /** POST /onboarding/complete — mark the session completed. */
  @Post('complete')
  async complete(@CurrentUser('id') userId: string) {
    const result = await completeOnboardingSession(db, { userId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * POST /onboarding/reset — rewind the flow to the first slide so the user
   * can walk it again. Keeps the org + everything already created; clears
   * only the flow's progress. Pre-verification safe (the restart button is
   * available on every slide, including the pre-verification ones).
   */
  @Post('reset')
  async reset(@CurrentUser('id') userId: string) {
    const result = await resetOnboardingSession(db, { userId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * One code, one status. Style-A map — `error-status-map` (the
   * one-code-one-status gate) parses this table out of the controller with the
   * TypeScript AST, so it must stay a literal here rather than move to a shared
   * module.
   *
   * `POST /onboarding/launch` needs the STATUS for a custom body; it reads it
   * back with `.getStatus()` rather than duplicating the table.
   */
  private mapError(error: { code: string; message: string }) {
    const map: Record<string, HttpStatus> = {
      [ErrorCodes.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
      [ErrorCodes.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
      [ErrorCodes.FORBIDDEN]: HttpStatus.FORBIDDEN,
      [ErrorCodes.NOT_FOUND]: HttpStatus.NOT_FOUND,
      [ErrorCodes.ALREADY_EXISTS]: HttpStatus.CONFLICT,
      [ErrorCodes.CONFLICT]: HttpStatus.CONFLICT,
      [ErrorCodes.INVALID_STATE]: HttpStatus.BAD_REQUEST,
      [ErrorCodes.EXTERNAL_SERVICE_ERROR]: HttpStatus.BAD_GATEWAY,
      [ErrorCodes.RATE_LIMITED]: HttpStatus.TOO_MANY_REQUESTS,
    };
    return new HttpException(
      error.message,
      map[error.code] || HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}

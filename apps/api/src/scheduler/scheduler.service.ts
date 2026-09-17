import {
  conversation,
  db,
  sql,
  withSystemScope,
} from '@borradh-workspace/database';
// TODO: uncomment when recommendations generation/digest features are committed
// import {
//   generateAllRecommendations,
//   sendWeeklyDigest,
// } from '@borradh-workspace/features/recommendations';
import { observabilityEnv } from '@borradh-workspace/env/observability';
import { exportSnapshots } from '@borradh-workspace/features/analytics';
import {
  enqueueDueDepositExpirations,
  enqueueDueReminders,
  expireAppointmentHolds,
} from '@borradh-workspace/features/appointments';
// DISABLED: assistant knowledge population is retired (BOR-160)
// import {
//   extractAdChatbotPatterns,
//   extractChatbotInsights,
//   extractFAQs,
//   populateAll,
//   runAllAggregations,
// } from '@borradh-workspace/features/assistant';
import { renewCalendarWatches } from '@borradh-workspace/features/calendar';
import { runMonthlyBatchesCron } from '@borradh-workspace/features/content-batches';
import {
  detectStuckConversations,
  syncConversationMessages,
} from '@borradh-workspace/features/conversations';
import {
  listActiveMetaIntegrations,
  refreshInstagramTokens,
  refreshMetaTokens,
  snapshotMetaTokenHealth,
} from '@borradh-workspace/features/integrations';
import { pollMetaLeadForms } from '@borradh-workspace/features/lead-forms';
import { syncAllAds } from '@borradh-workspace/features/meta-ads';
import { syncCampaignInsights } from '@borradh-workspace/features/meta-campaigns';
import { conversationInboxUrl } from '@borradh-workspace/features/shared';
import { publishDuePosts } from '@borradh-workspace/features/social-posts';
import {
  createRunAutoClockDeps,
  listAutoClockCandidates,
  runAutoClock,
} from '@borradh-workspace/features/timesheets';
import { MetaAppSecretMismatchError } from '@borradh-workspace/integrations';
import {
  logError,
  mirrorSentryNativeEvents,
  pingHeartbeat,
  trackEvent,
} from '@borradh-workspace/observability';
import { getRedis } from '@borradh-workspace/redis';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { logSchedulerResultError } from './scheduler-error';

const DEPOSIT_LOCK_KEY = 'scheduler:deposit-expiration:lock';
const HOLD_EXPIRATION_LOCK_KEY = 'scheduler:appointment-hold-expiration:lock';
const META_SYNC_LOCK_KEY = 'scheduler:meta-ads-sync:lock';
const META_TOKEN_REFRESH_LOCK_KEY = 'scheduler:meta-token-refresh:lock';
const INSTAGRAM_TOKEN_REFRESH_LOCK_KEY =
  'scheduler:instagram-token-refresh:lock';
const REMINDER_LOCK_KEY = 'scheduler:appointment-reminders:lock';
const CALENDAR_WATCH_LOCK_KEY = 'scheduler:calendar-watch-renewal:lock';
// DISABLED: assistant knowledge population is retired (BOR-160)
// const AGGREGATE_INSIGHTS_LOCK_KEY = 'scheduler:aggregate-insights:lock';
// const KNOWLEDGE_REFRESH_LOCK_KEY = 'scheduler:knowledge-refresh:lock';
const CONVERSATION_SYNC_LOCK_KEY = 'scheduler:conversation-message-sync:lock';
const CAMPAIGN_INSIGHTS_SYNC_LOCK_KEY = 'scheduler:campaign-insights-sync:lock';
const ANALYTICS_EXPORT_LOCK_KEY = 'scheduler:analytics-export:lock';
const STUCK_CONVERSATIONS_LOCK_KEY = 'scheduler:stuck-conversations:lock';
// const RECOMMENDATIONS_LOCK_KEY = 'scheduler:recommendations:lock';
// const WEEKLY_DIGEST_LOCK_KEY = 'scheduler:weekly-digest:lock';
const MONTHLY_CONTENT_BATCH_LOCK_KEY = 'scheduler:monthly-content-batch:lock';
const META_HEALTH_ALERT_LOCK_KEY = 'scheduler:meta-health-alerts:lock';
const META_TOKEN_HEALTH_LOCK_KEY = 'scheduler:meta-token-health:lock';
const META_LEAD_POLL_LOCK_KEY = 'scheduler:meta-lead-poll:lock';
const SCHEDULED_POSTS_LOCK_KEY = 'scheduler:scheduled-posts-publish:lock';
const AUTO_CLOCK_LOCK_KEY = 'scheduler:timesheet-auto-clock:lock';
const SENTRY_MIRROR_LOCK_KEY = 'scheduler:sentry-native-mirror:lock';

/**
 * Per-event claim keys for the Sentry → PostHog native mirror. TTL must exceed
 * the mirror's lookback window (120 min) by a wide margin, or an event could
 * fall out of the claim set while still inside the query window and be
 * forwarded a second time. 7 days also covers a multi-day outage.
 */
const SENTRY_MIRROR_CLAIM_TTL_SECONDS = 7 * 24 * 60 * 60;
const sentryMirrorClaimKey = (eventId: string) =>
  `sentry-mirror:event:${eventId}`;

const SCHEDULER_DISTINCT_ID = 'system:scheduler';
const LOCK_TTL_MS = 30000; // 30 seconds - lock expires if instance crashes

@Injectable()
export class SchedulerService implements OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private isProcessingDeposits = false;
  private isExpiringHolds = false;
  private isSyncingMetaAds = false;
  private isRefreshingMetaTokens = false;
  private isRefreshingInstagramTokens = false;
  private isSendingReminders = false;
  private isRenewingCalendarWatches = false;
  // DISABLED: assistant knowledge population is retired (BOR-160)
  // private isAggregatingInsights = false;
  // private isRefreshingKnowledge = false;
  private isSyncingConversationMessages = false;
  private isSyncingCampaignInsights = false;
  private isExportingAnalytics = false;
  private isCheckingStuckConversations = false;
  // private isGeneratingRecommendations = false;
  // private isSendingWeeklyDigest = false;
  private isRunningMonthlyContentBatch = false;
  private isCheckingMetaHealth = false;
  private isSnapshottingMetaTokenHealth = false;
  private isPollingMetaLeads = false;
  private isPublishingScheduledPosts = false;
  private isRunningAutoClock = false;
  private isMirroringSentryNativeEvents = false;
  // Last-seen kill-switch state, so we log only on transitions (not every tick).
  private instanceId = `${process.pid}-${Date.now()}`;

  async onModuleDestroy() {
    // Release locks on shutdown
    await this.releaseLock(DEPOSIT_LOCK_KEY);
    await this.releaseLock(META_SYNC_LOCK_KEY);
    await this.releaseLock(META_TOKEN_REFRESH_LOCK_KEY);
    await this.releaseLock(REMINDER_LOCK_KEY);
    await this.releaseLock(CALENDAR_WATCH_LOCK_KEY);
    await this.releaseLock(INSTAGRAM_TOKEN_REFRESH_LOCK_KEY);
    await this.releaseLock(CONVERSATION_SYNC_LOCK_KEY);
    await this.releaseLock(CAMPAIGN_INSIGHTS_SYNC_LOCK_KEY);
    await this.releaseLock(ANALYTICS_EXPORT_LOCK_KEY);
    await this.releaseLock(STUCK_CONVERSATIONS_LOCK_KEY);
    // await this.releaseLock(RECOMMENDATIONS_LOCK_KEY);
    // await this.releaseLock(WEEKLY_DIGEST_LOCK_KEY);
    await this.releaseLock(MONTHLY_CONTENT_BATCH_LOCK_KEY);
    await this.releaseLock(META_HEALTH_ALERT_LOCK_KEY);
    await this.releaseLock(META_TOKEN_HEALTH_LOCK_KEY);
    await this.releaseLock(SCHEDULED_POSTS_LOCK_KEY);
    await this.releaseLock(AUTO_CLOCK_LOCK_KEY);
  }

  /**
   * Try to acquire a distributed lock using Redis
   * Returns true if lock acquired, false otherwise
   */
  private async acquireLock(
    lockKey: string,
    ttlMs = LOCK_TTL_MS
  ): Promise<boolean> {
    try {
      const redis = getRedis();
      // SET key value NX PX milliseconds - only set if not exists, with expiry
      const result = await redis.set(
        lockKey,
        this.instanceId,
        'PX',
        ttlMs,
        'NX'
      );
      return result === 'OK';
    } catch (error) {
      this.logger.warn(
        `Failed to acquire lock ${lockKey}: ${error instanceof Error ? error.message : error}`
      );
      return false;
    }
  }

  /**
   * Release the distributed lock (only if we own it)
   */
  private async releaseLock(lockKey: string): Promise<void> {
    try {
      const redis = getRedis();
      // Only delete if we own the lock
      const currentHolder = await redis.get(lockKey);
      if (currentHolder === this.instanceId) {
        await redis.del(lockKey);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to release lock ${lockKey}: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  /**
   * Check for expired deposits every 5 minutes
   * Uses Redis distributed lock for multi-instance safety
   */
  @Interval(300000) // 5 minutes
  async handleDepositExpirations() {
    if (this.isProcessingDeposits) return;

    const hasLock = await this.acquireLock(DEPOSIT_LOCK_KEY);
    if (!hasLock) return;

    this.isProcessingDeposits = true;

    try {
      // Fan out: enqueue one expiry job per due deposit onto the booking worker
      // (bounded concurrency + retries) instead of draining a fixed batch here.
      const { enqueued } = await withSystemScope(
        (conn) => enqueueDueDepositExpirations(conn),
        { db }
      );
      if (enqueued > 0) {
        this.logger.log(`Deposit expiration: ${enqueued} expiry jobs queued`);
      }
    } catch (error) {
      logError('scheduler.depositExpiration', error, { feature: 'scheduler' });
    } finally {
      this.isProcessingDeposits = false;
      await this.releaseLock(DEPOSIT_LOCK_KEY);
    }
  }

  /**
   * Release `held` slots whose hold clock has run out, every 5 minutes.
   *
   * The deposit sweep above only reaches holds that are backed by a PENDING
   * DEPOSIT — it drives off `appointment_deposit.expiresAt`. A hold that took
   * no payment (Claire reserving a slot while the customer decides) has no
   * deposit row, so nothing there ever releases it and the slot stays blocked
   * forever. That is the bug this branch exists to fix, and it is not fixed
   * until something calls the service.
   *
   * Drains in bounded batches rather than fanning out one job per hold: a hold
   * release is a single UPDATE with no external I/O, so the queue hop the
   * deposit path needs (Stripe cancel + retries) would buy nothing here.
   *
   * Safe to overlap with the deposit sweep — this only touches rows still in
   * `held`, so whichever runs second is a no-op rather than a double-cancel.
   */
  @Interval(300000) // 5 minutes
  async handleAppointmentHoldExpirations() {
    if (this.isExpiringHolds) return;

    const hasLock = await this.acquireLock(HOLD_EXPIRATION_LOCK_KEY);
    if (!hasLock) return;

    this.isExpiringHolds = true;

    try {
      const result = await withSystemScope(
        (conn) => expireAppointmentHolds(conn, {}),
        { db }
      );
      if (!result.success) {
        logSchedulerResultError(
          'scheduler.appointmentHoldExpiration',
          result.error
        );
      } else if (result.data.releasedCount > 0) {
        this.logger.log(
          `Appointment holds: ${result.data.releasedCount} expired holds released`
        );
      }
    } catch (error) {
      logError('scheduler.appointmentHoldExpiration', error, {
        feature: 'scheduler',
      });
    } finally {
      this.isExpiringHolds = false;
      await this.releaseLock(HOLD_EXPIRATION_LOCK_KEY);
    }
  }

  /**
   * Timesheet auto-clock tick every 5 minutes (contract §1.5). Resolves the
   * auto clock-in / clock-out flags (practitioner_wage_config → org_defaults →
   * false) in ONE query and applies today's shift windows only to the
   * practitioners those flags are actually on for.
   *
   * It used to fan out over every active practitioner and let `runAutoClock`
   * short-circuit after two cheap reads. Cheap per call, but the call count is
   * `practitioners × 288/day` on a population that is overwhelmingly opted out
   * (auto-clock is off unless an org turns it on), and each one also emitted a
   * PostHog success event — which alone became ~95% of the project's event
   * volume. Filtering first makes an all-disabled fleet cost one indexed query
   * per tick and emit one summary event.
   *
   * Runs under system scope so the org-scoped feature services reach every
   * org; a Redis lock keeps a single instance active across the fleet.
   */
  @Interval(300000) // 5 minutes
  async handleAutoClock() {
    if (this.isRunningAutoClock) return;

    // TTL must outlive a full pass, or a second instance picks up the lock
    // mid-run and duplicates the whole fan-out. 5 min covers the tick period.
    const hasLock = await this.acquireLock(AUTO_CLOCK_LOCK_KEY, 300000);
    if (!hasLock) return;

    this.isRunningAutoClock = true;

    try {
      const deps = createRunAutoClockDeps(db);

      const candidatesResult = await withSystemScope(
        (conn) => listAutoClockCandidates(conn),
        { db }
      );
      if (!candidatesResult.success) {
        logSchedulerResultError('scheduler.autoClock', candidatesResult.error);
        return;
      }
      const candidates = candidatesResult.data;
      if (candidates.length === 0) return;

      let clockedIn = 0;
      let clockedOut = 0;
      let breaksInserted = 0;
      let failed = 0;

      for (const c of candidates) {
        const result = await withSystemScope(
          (conn) =>
            runAutoClock(
              conn,
              {
                organizationId: c.organizationId,
                practitionerId: c.practitionerId,
              },
              deps
            ),
          { db }
        );
        if (result.success) {
          if (result.data.clockedIn) clockedIn++;
          if (result.data.clockedOut) clockedOut++;
          breaksInserted += result.data.autoBreaksInserted;
        } else {
          failed++;
        }
      }

      // One event per tick instead of one per practitioner per tick. Only when
      // the tick did something (or broke) — an idle tick is not news.
      if (clockedIn > 0 || clockedOut > 0 || breaksInserted > 0 || failed > 0) {
        this.logger.log(
          `Auto-clock: ${clockedIn} clocked in, ${clockedOut} clocked out, ${breaksInserted} auto breaks, ${failed} failed (${candidates.length} candidates)`
        );
        trackEvent(SCHEDULER_DISTINCT_ID, 'timesheets.autoClockTick', {
          candidates: candidates.length,
          clockedIn,
          clockedOut,
          breaksInserted,
          failed,
        });
      }
    } catch (error) {
      logError('scheduler.autoClock', error, { feature: 'scheduler' });
    } finally {
      this.isRunningAutoClock = false;
      await this.releaseLock(AUTO_CLOCK_LOCK_KEY);
    }
  }

  /**
   * Publish social posts whose scheduled time has passed, every minute.
   * `createSocialPost` only inserts a `scheduled` row — this is the runner
   * that actually fires it. Uses a Redis lock for multi-instance safety and
   * runs under system scope so the org-scoped publish can reach every org.
   */
  @Interval(60000) // 1 minute
  async handleScheduledPostPublishing() {
    if (this.isPublishingScheduledPosts) return;

    const hasLock = await this.acquireLock(SCHEDULED_POSTS_LOCK_KEY);
    if (!hasLock) return;

    this.isPublishingScheduledPosts = true;

    try {
      const result = await withSystemScope(
        (conn) => publishDuePosts(conn, {}),
        { db }
      );

      if (result.success) {
        const { published, failed, skippedStale } = result.data;
        if (published > 0 || failed > 0) {
          this.logger.log(
            `Scheduled posts: ${published} published, ${failed} failed`
          );
        }
        // One event per tick that DID something, instead of one per minute
        // reporting an empty queue.
        if (published > 0 || failed > 0 || skippedStale > 0) {
          trackEvent(SCHEDULER_DISTINCT_ID, 'socialPosts.publishTick', {
            published,
            failed,
            skippedStale,
          });
        }
        if (skippedStale > 0) {
          this.logger.warn(
            `Scheduled posts: ${skippedStale} stale post(s) past the overdue cutoff were skipped (not auto-published)`
          );
        }
      } else {
        logSchedulerResultError(
          'scheduler.publishScheduledPosts',
          result.error
        );
      }
    } catch (error) {
      logError('scheduler.publishScheduledPosts', error, {
        feature: 'scheduler',
      });
    } finally {
      this.isPublishingScheduledPosts = false;
      await this.releaseLock(SCHEDULED_POSTS_LOCK_KEY);
    }
  }

  /**
   * Sync Meta Ads statuses every 15 minutes
   * Loops through all configured integrations and syncs ad data from Meta
   */
  @Interval(900000) // 15 minutes
  async handleMetaAdsSync() {
    if (this.isSyncingMetaAds) return;

    const hasLock = await this.acquireLock(META_SYNC_LOCK_KEY, 120000); // 2 min TTL
    if (!hasLock) return;

    this.isSyncingMetaAds = true;

    try {
      const listResult = await withSystemScope(
        (conn) => listActiveMetaIntegrations(conn),
        { db }
      );
      if (!listResult.success) {
        logError('scheduler.metaAdsSync', new Error(listResult.error.message), {
          feature: 'scheduler',
          extra: { code: listResult.error.code },
        });
        return;
      }

      const integrations = listResult.data;
      let synced = 0;
      let failed = 0;
      let skippedAppSecret = 0;

      for (const integration of integrations) {
        try {
          const result = await withSystemScope(
            (conn) =>
              syncAllAds(conn, {
                organizationId: integration.organizationId,
              }),
            { db }
          );
          if (result.success) {
            synced++;
          } else {
            failed++;
          }
        } catch (error) {
          // TODO: root cause is META_APP_SECRET vs stored token app mismatch — see
          // fix/sentry-api-error-handling-hardening.
          if (error instanceof MetaAppSecretMismatchError) {
            skippedAppSecret++;
            this.logger.warn(
              `Meta Ads sync: skipping org ${integration.organizationId} due to appsecret_proof mismatch`
            );
            continue;
          }
          throw error;
        }
      }

      if (synced > 0 || failed > 0 || skippedAppSecret > 0) {
        this.logger.log(
          `Meta Ads sync: ${synced} orgs synced, ${failed} failed, ${skippedAppSecret} skipped (appsecret) (${integrations.length} total)`
        );
      }
    } catch (error) {
      logError('scheduler.metaAdsSync', error, { feature: 'scheduler' });
    } finally {
      this.isSyncingMetaAds = false;
      await this.releaseLock(META_SYNC_LOCK_KEY);
    }
  }

  /**
   * Refresh expiring Meta tokens every 24 hours
   * Refreshes long-lived tokens expiring within 7 days
   */
  @Interval(86400000) // 24 hours
  async handleMetaTokenRefresh() {
    if (this.isRefreshingMetaTokens) return;

    const hasLock = await this.acquireLock(META_TOKEN_REFRESH_LOCK_KEY, 60000); // 1 min TTL
    if (!hasLock) return;

    this.isRefreshingMetaTokens = true;

    try {
      const result = await withSystemScope(
        (conn) => refreshMetaTokens(conn, { daysBeforeExpiry: 7 }),
        { db }
      );

      if (result.success) {
        const { refreshed, failed, skipped } = result.data;
        if (refreshed > 0 || failed > 0) {
          this.logger.log(
            `Meta token refresh: ${refreshed} refreshed, ${failed} failed, ${skipped} skipped`
          );
        }
      } else {
        logError(
          'scheduler.metaTokenRefresh',
          new Error(result.error.message),
          { feature: 'scheduler', extra: { code: result.error.code } }
        );
      }
    } catch (error) {
      logError('scheduler.metaTokenRefresh', error, { feature: 'scheduler' });
    } finally {
      this.isRefreshingMetaTokens = false;
      await this.releaseLock(META_TOKEN_REFRESH_LOCK_KEY);
    }
  }

  /**
   * Refresh expiring Instagram tokens every 24 hours
   * Refreshes long-lived tokens expiring within 7 days
   */
  @Interval(86400000) // 24 hours
  async handleInstagramTokenRefresh() {
    if (this.isRefreshingInstagramTokens) return;

    const hasLock = await this.acquireLock(
      INSTAGRAM_TOKEN_REFRESH_LOCK_KEY,
      60000
    );
    if (!hasLock) return;

    this.isRefreshingInstagramTokens = true;

    try {
      const result = await withSystemScope(
        (conn) => refreshInstagramTokens(conn, { daysBeforeExpiry: 7 }),
        { db }
      );

      if (result.success) {
        const { refreshed, failed, skipped } = result.data;
        if (refreshed > 0 || failed > 0) {
          this.logger.log(
            `Instagram token refresh: ${refreshed} refreshed, ${failed} failed, ${skipped} skipped`
          );
        }
      } else {
        logError(
          'scheduler.instagramTokenRefresh',
          new Error(result.error.message),
          { feature: 'scheduler', extra: { code: result.error.code } }
        );
      }
    } catch (error) {
      logError('scheduler.instagramTokenRefresh', error, {
        feature: 'scheduler',
      });
    } finally {
      this.isRefreshingInstagramTokens = false;
      await this.releaseLock(INSTAGRAM_TOKEN_REFRESH_LOCK_KEY);
    }
  }

  /**
   * Send appointment reminders every 5 minutes
   * Sends 24h and 1h email reminders before scheduled appointments
   */
  @Interval(300000) // 5 minutes
  async handleAppointmentReminders() {
    if (this.isSendingReminders) return;

    const hasLock = await this.acquireLock(REMINDER_LOCK_KEY);
    if (!hasLock) return;

    this.isSendingReminders = true;

    try {
      // Fan out: enqueue one reminder job per due appointment onto the booking
      // worker. Unlike the old fixed batch, this cannot silently drop reminders
      // when more appointments fall in a window than one tick could send —
      // throughput now scales with worker concurrency, and deterministic job ids
      // make re-scanning each tick idempotent.
      const { enqueued24h, enqueued1h } = await withSystemScope(
        (conn) => enqueueDueReminders(conn),
        { db }
      );
      if (enqueued24h > 0 || enqueued1h > 0) {
        this.logger.log(
          `Appointment reminders: ${enqueued24h} 24h + ${enqueued1h} 1h reminder jobs queued`
        );
      }
    } catch (error) {
      logError('scheduler.appointmentReminders', error, {
        feature: 'scheduler',
      });
    } finally {
      this.isSendingReminders = false;
      await this.releaseLock(REMINDER_LOCK_KEY);
    }
  }

  /**
   * Renew expiring Google Calendar watch channels every hour.
   * Watches expire after ~7 days; this renews any expiring within 24 hours.
   */
  @Interval(3600000) // 1 hour
  async handleCalendarWatchRenewal() {
    if (this.isRenewingCalendarWatches) return;

    const hasLock = await this.acquireLock(CALENDAR_WATCH_LOCK_KEY, 60000); // 1 min TTL
    if (!hasLock) return;

    this.isRenewingCalendarWatches = true;

    try {
      const result = await withSystemScope(
        (conn) =>
          renewCalendarWatches(conn, {
            expiringWithinHours: 24,
          }),
        { db }
      );

      if (result.success) {
        const { renewed, failed, total } = result.data;
        if (total > 0) {
          this.logger.log(
            `Calendar watch renewal: ${renewed} renewed, ${failed} failed (${total} total)`
          );
        }
      } else {
        logError(
          'scheduler.calendarWatchRenewal',
          new Error(result.error.message),
          { feature: 'scheduler', extra: { code: result.error.code } }
        );
      }
    } catch (error) {
      logError('scheduler.calendarWatchRenewal', error, {
        feature: 'scheduler',
      });
    } finally {
      this.isRenewingCalendarWatches = false;
      await this.releaseLock(CALENDAR_WATCH_LOCK_KEY);
    }
  }

  /**
   * DISABLED — was deleting user-uploaded photos/assets that weren't yet
   * referenced by a video draft, wiping entire photo libraries after 24h.
   * The "orphan" heuristic is wrong: assets are standalone content, not just
   * video inputs.  Needs a redesign before re-enabling.
   *
   * @see https://github.com/your-org/borradh-workspace/issues/XXX
   */
  // @Interval(86400000)
  // async handleOrphanedAssetCleanup() { ... }

  // DISABLED: assistant knowledge population is retired (BOR-160)
  // handleAggregateInsights and handleKnowledgeRefresh commented out —
  // the assistant knowledge base is unused and was causing TypeError (Date vs string)
  // in knowledge_entry inserts. Re-enable when assistant feature is revived.

  // @Cron('0 4 * * 0')
  // async handleAggregateInsights() { ... }

  // @Cron('0 3 * * *')
  // async handleKnowledgeRefresh() { ... }

  @Interval(6 * 60 * 60 * 1000) // Every 6 hours
  async handleConversationMessageSync() {
    if (this.isSyncingConversationMessages) return;

    const hasLock = await this.acquireLock(CONVERSATION_SYNC_LOCK_KEY, 300000); // 5 min TTL
    if (!hasLock) return;

    this.isSyncingConversationMessages = true;

    try {
      const orgs = await withSystemScope(
        (conn) =>
          conn
            .selectDistinct({ organizationId: conversation.organizationId })
            .from(conversation)
            .where(
              sql`${conversation.platform} IN ('facebook_messenger', 'instagram_dm')`
            ),
        { db }
      );

      let synced = 0;
      let failed = 0;

      for (const { organizationId } of orgs) {
        const result = await withSystemScope(
          (conn) => syncConversationMessages(conn, { organizationId }),
          { db }
        );
        if (result.success) {
          synced++;
        } else {
          failed++;
        }
      }

      if (synced > 0 || failed > 0) {
        this.logger.log(
          `Conversation message sync: ${synced} orgs synced, ${failed} failed (${orgs.length} total)`
        );
      }
    } catch (error) {
      logError('scheduler.conversationMessageSync', error, {
        feature: 'scheduler',
      });
    } finally {
      this.isSyncingConversationMessages = false;
      await this.releaseLock(CONVERSATION_SYNC_LOCK_KEY);
    }
  }

  /**
   * Sync campaign daily insights from Meta Ads API at 4 AM UTC.
   * Fetches yesterday's spend, impressions, clicks, etc. for all campaigns
   * and stores in meta_campaign_daily_insights table.
   * Runs before the 5 AM analytics export so data is fresh for S3/PostHog.
   */
  @Cron('0 4 * * *')
  async handleCampaignInsightsSync() {
    if (this.isSyncingCampaignInsights) return;

    const hasLock = await this.acquireLock(
      CAMPAIGN_INSIGHTS_SYNC_LOCK_KEY,
      600000
    ); // 10 min TTL
    if (!hasLock) return;

    this.isSyncingCampaignInsights = true;

    try {
      const listResult = await withSystemScope(
        (conn) => listActiveMetaIntegrations(conn),
        { db }
      );
      if (!listResult.success) {
        logError(
          'scheduler.campaignInsightsSync',
          new Error(listResult.error.message),
          {
            feature: 'scheduler',
            extra: { code: listResult.error.code },
          }
        );
        return;
      }

      const integrations = listResult.data;
      let synced = 0;
      let failed = 0;
      let skipped = 0;
      let skippedAppSecret = 0;

      for (const integration of integrations) {
        try {
          const result = await withSystemScope(
            (conn) =>
              syncCampaignInsights(conn, {
                organizationId: integration.organizationId,
              }),
            { db }
          );
          if (result.success) {
            synced += result.data.synced;
            failed += result.data.failed;
            skipped += result.data.skipped;
          } else {
            failed++;
          }
        } catch (error) {
          // TODO: root cause is META_APP_SECRET vs stored token app mismatch — see
          // fix/sentry-api-error-handling-hardening.
          if (error instanceof MetaAppSecretMismatchError) {
            skippedAppSecret++;
            this.logger.warn(
              `Campaign insights sync: skipping org ${integration.organizationId} due to appsecret_proof mismatch`
            );
            continue;
          }
          throw error;
        }
      }

      this.logger.log(
        `Campaign insights sync: ${synced} campaigns synced, ${failed} failed, ${skipped} skipped, ${skippedAppSecret} skipped (appsecret) (${integrations.length} orgs)`
      );
    } catch (error) {
      logError('scheduler.campaignInsightsSync', error, {
        feature: 'scheduler',
      });
    } finally {
      this.isSyncingCampaignInsights = false;
      await this.releaseLock(CAMPAIGN_INSIGHTS_SYNC_LOCK_KEY);
    }
  }

  /**
   * Snapshot Meta token health for every connected org once a day (3 AM UTC).
   * DB-only — reads stored tokenStatus/expiry, no Meta API calls — and emits a
   * `meta_token_health` PostHog event per org so we can trend the percentage of
   * orgs with a healthy Meta connection over time.
   */
  /**
   * Mirror NATIVE crashes and ANRs from Sentry into PostHog, every 15 minutes.
   *
   * Native crashes are captured by sentry-cocoa / sentry-android, persisted to
   * disk (the process is dead, so nothing can run in JS) and shipped by the
   * native layer on the device's NEXT LAUNCH. The @sentry/capacitor bridge is
   * one-way for events, so they never enter JavaScript and no client-side hook
   * can re-route them. Mirroring server-side out of Sentry's API is the only way
   * to see them in PostHog — which is why Sentry shrinks to a native crash
   * collector rather than disappearing.
   *
   * Latency is irrelevant here (the event is already hours old by the time
   * Sentry has it), so the schedule is chosen for gentleness, not freshness.
   */
  @Cron('*/15 * * * *')
  async handleSentryNativeMirror() {
    if (this.isMirroringSentryNativeEvents) return;

    const hasLock = await this.acquireLock(SENTRY_MIRROR_LOCK_KEY, 120000);
    if (!hasLock) return;

    this.isMirroringSentryNativeEvents = true;

    try {
      const result = await mirrorSentryNativeEvents({
        // Redis SET NX is the claim: it is what stops the deliberately
        // overlapping lookback window from forwarding the same crash twice.
        // Returning false (already claimed) must be indistinguishable from
        // "someone else claimed it", which SET NX gives us for free.
        claimEvent: async (eventId) => {
          const redis = getRedis();
          const claimed = await redis.set(
            sentryMirrorClaimKey(eventId),
            '1',
            'EX',
            SENTRY_MIRROR_CLAIM_TTL_SECONDS,
            'NX'
          );
          return claimed === 'OK';
        },
      });

      if (result.forwarded > 0) {
        this.logger.log(
          `Sentry native mirror: forwarded ${result.forwarded} of ${result.native} native events (${result.scanned} scanned)`
        );
      }
    } catch (error) {
      // mirrorSentryNativeEvents does not throw, so reaching here means the
      // claim closure or Redis itself failed outright.
      logError('scheduler.sentryNativeMirror', error, { feature: 'scheduler' });
    } finally {
      this.isMirroringSentryNativeEvents = false;
      await this.releaseLock(SENTRY_MIRROR_LOCK_KEY);
    }
  }

  /**
   * Reconciliation poll for Meta instant-form leads.
   *
   * Meta can accept our `leadgen` webhook subscription and still silently
   * withhold delivery for a Page — seven Pages in prod, ~18% of paid form
   * leads lost, zero errors on our side (ENG-786). Lead *reads* are not
   * subject to that gate, so this pulls anything the webhook never brought us.
   *
   * Every 5 minutes. The `leads_count` short-circuit makes a quiet page cost a
   * single `leadgen_forms` call per tick, so ~71 pages is ~20k calls/day —
   * comfortably inside Meta's per-page lead-read budget — and it keeps a gated
   * Page's leads fresh enough that Claire's opener still lands inside the
   * freshness window rather than arriving as a stale lead.
   */
  @Cron('*/5 * * * *')
  async handleMetaLeadPoll() {
    if (this.isPollingMetaLeads) return;

    // TTL must sit UNDER the 5-minute interval, or a crashed holder blocks the
    // next tick as well. Overlap is harmless anyway: `isPollingMetaLeads`
    // guards in-process and every write dedupes on `facebook_lead_id`.
    const hasLock = await this.acquireLock(META_LEAD_POLL_LOCK_KEY, 240000); // 4 min TTL
    if (!hasLock) return;

    this.isPollingMetaLeads = true;

    try {
      const result = await withSystemScope((conn) => pollMetaLeadForms(conn), {
        db,
      });

      if (result.success) {
        const { pagesPolled, leadsCreated, pagesFailed } = result.data;
        if (leadsCreated > 0 || pagesFailed.length > 0) {
          const failed = pagesFailed.length
            ? `, ${pagesFailed.length} pages failed`
            : '';
          this.logger.log(
            `Meta lead poll: ${leadsCreated} leads recovered across ${pagesPolled} pages${failed}`
          );
        }
      } else {
        logSchedulerResultError('scheduler.metaLeadPoll', result.error);
      }
    } catch (error) {
      logError('scheduler.metaLeadPoll', error, { feature: 'scheduler' });
    } finally {
      this.isPollingMetaLeads = false;
      await this.releaseLock(META_LEAD_POLL_LOCK_KEY);
    }
  }

  @Cron('0 3 * * *')
  async handleMetaTokenHealthSnapshot() {
    if (this.isSnapshottingMetaTokenHealth) return;

    const hasLock = await this.acquireLock(META_TOKEN_HEALTH_LOCK_KEY, 120000);
    if (!hasLock) return;

    this.isSnapshottingMetaTokenHealth = true;

    try {
      const result = await withSystemScope(
        (conn) => snapshotMetaTokenHealth(conn),
        { db }
      );
      if (result.success) {
        const { total, healthy, needsReconnect, expired } = result.data;
        this.logger.log(
          `Meta token health: ${healthy}/${total} healthy, ${needsReconnect} need reconnect, ${expired} expired`
        );
      } else {
        logError(
          'scheduler.metaTokenHealthSnapshot',
          new Error(result.error.message),
          { feature: 'scheduler', extra: { code: result.error.code } }
        );
      }
    } catch (error) {
      logError('scheduler.metaTokenHealthSnapshot', error, {
        feature: 'scheduler',
      });
    } finally {
      this.isSnapshottingMetaTokenHealth = false;
      await this.releaseLock(META_TOKEN_HEALTH_LOCK_KEY);
    }
  }

  /**
   * Export analytics snapshots daily at 5 AM.
   * Runs after knowledge refresh (3 AM) and aggregate insights (4 AM).
   * Exports yesterday's data to S3 as Parquet files for PostHog Data Warehouse.
   */
  @Cron('0 5 * * *')
  async handleAnalyticsExport() {
    if (this.isExportingAnalytics) return;

    const hasLock = await this.acquireLock(ANALYTICS_EXPORT_LOCK_KEY, 600000); // 10 min TTL
    if (!hasLock) return;

    this.isExportingAnalytics = true;

    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const result = await withSystemScope(
        (conn) => exportSnapshots(conn, { date: yesterday }),
        { db }
      );

      if (result.success) {
        const { exported, failed } = result.data;
        this.logger.log(
          `Analytics export: ${exported.length} domains exported, ${failed.length} failed`
        );
        if (failed.length > 0) {
          this.logger.warn(`Failed domains: ${failed.join(', ')}`);
        }
        // Heartbeat only on a successful export — a silent failure (or the cron
        // never running) stops the pings and Better Stack alerts.
        void pingHeartbeat(
          observabilityEnv.BETTERSTACK_ANALYTICS_HEARTBEAT_URL
        );
      } else {
        logError('scheduler.analyticsExport', new Error(result.error.message), {
          feature: 'scheduler',
          extra: { code: result.error.code },
        });
      }
    } catch (error) {
      logError('scheduler.analyticsExport', error, { feature: 'scheduler' });
    } finally {
      this.isExportingAnalytics = false;
      await this.releaseLock(ANALYTICS_EXPORT_LOCK_KEY);
    }
  }

  /**
   * Check for stuck bot_handling conversations every 10 minutes.
   * Sends an alert email if any conversation has an unanswered user message
   * for more than 15 minutes.
   */
  @Interval(600000) // 10 minutes
  async handleStuckConversationsCheck() {
    if (this.isCheckingStuckConversations) return;

    const hasLock = await this.acquireLock(STUCK_CONVERSATIONS_LOCK_KEY);
    if (!hasLock) return;

    this.isCheckingStuckConversations = true;

    try {
      const { apiEnv } = await import('@borradh-workspace/env/api');
      const alertEmail = apiEnv.ALERT_EMAIL;
      if (!alertEmail) return;

      const result = await withSystemScope(
        (conn) => detectStuckConversations(conn, { staleMinutes: 15 }),
        { db }
      );

      if (!result.success) {
        logError(
          'scheduler.stuckConversations',
          new Error(result.error.message),
          { feature: 'scheduler', extra: { code: result.error.code } }
        );
        return;
      }

      const { stuck } = result.data;
      if (stuck.length === 0) return;

      // Deduplicate: only alert for conversations we haven't alerted on recently
      const redis = getRedis();
      const newStuck = [];
      for (const conv of stuck) {
        const alertKey = `stuck-alert:${conv.conversationId}`;
        const alreadyAlerted = await redis.get(alertKey);
        if (!alreadyAlerted) {
          newStuck.push(conv);
          // Don't re-alert for this conversation for 2 hours
          await redis.set(alertKey, '1', 'EX', 7200);
        }
      }

      if (newStuck.length === 0) return;

      const { sendEmail, StuckConversationsAlertEmail } = await import(
        '@borradh-workspace/email'
      );

      await sendEmail({
        to: alertEmail,
        subject: `⚠️ ${newStuck.length} stuck chatbot conversation${newStuck.length === 1 ? '' : 's'}`,
        template: StuckConversationsAlertEmail,
        props: {
          stuckConversations: newStuck.map((s) => ({
            conversationId: s.conversationId,
            organizationName: s.organizationName,
            externalUserName: s.externalUserName,
            platformLabel: s.platformLabel,
            lastUserMessage: s.lastUserMessage,
            lastUserMessageAt: s.lastUserMessageAt
              .toISOString()
              .replace('T', ' ')
              .slice(0, 16),
            dashboardUrl: apiEnv.WEB_URL
              ? conversationInboxUrl(apiEnv.WEB_URL, s.conversationId)
              : null,
          })),
          staleMinutes: 15,
        },
      });

      this.logger.warn(
        `Stuck conversations alert sent: ${newStuck.length} conversations`
      );
    } catch (error) {
      logError('scheduler.stuckConversations', error, { feature: 'scheduler' });
    } finally {
      this.isCheckingStuckConversations = false;
      await this.releaseLock(STUCK_CONVERSATIONS_LOCK_KEY);
    }
  }

  /**
   * Run Meta account health checks every 15 minutes.
   * Detects billing errors, account bans, TOS issues, expired tokens, etc.
   * Alerts the team via email and the user via Intercom + push notification.
   * Each issue is deduplicated per org per check type for 2 hours.
   */
  // @Interval(3600000) // 1 hour — disabled temporarily
  async handleMetaHealthAlerts() {
    if (this.isCheckingMetaHealth) return;

    const hasLock = await this.acquireLock(META_HEALTH_ALERT_LOCK_KEY, 120000);
    if (!hasLock) return;

    this.isCheckingMetaHealth = true;

    try {
      const { runHealthAlerts } = await import(
        '@borradh-workspace/features/meta-ads'
      );

      const result = await withSystemScope((conn) => runHealthAlerts(conn), {
        db,
      });

      if (result.success) {
        const { totalChecked, totalFailing, alertsSent } = result.data;
        if (totalFailing > 0) {
          this.logger.warn(
            `Meta health alerts: ${alertsSent} alerts sent (${totalFailing} failing across ${totalChecked} integrations)`
          );
        }
      } else {
        logError(
          'scheduler.metaHealthAlerts',
          new Error(result.error.message),
          { feature: 'scheduler', extra: { code: result.error.code } }
        );
      }
    } catch (error) {
      logError('scheduler.metaHealthAlerts', error, { feature: 'scheduler' });
    } finally {
      this.isCheckingMetaHealth = false;
      await this.releaseLock(META_HEALTH_ALERT_LOCK_KEY);
    }
  }

  // TODO: uncomment when recommendations features are committed
  //
  // @Cron('0 6 * * *')
  // async handleRecommendationGeneration() { ... }
  //
  // @Cron('0 9 * * 1')
  // async handleWeeklyDigest() { ... }

  /**
   * Generate the monthly organic content batch for every qualifying org at
   * 06:00 UTC on the 1st of each month. Each batch seeds up to 4 organic
   * graphics + 4 organic videos and queues their renders; the user then
   * reviews via the Socials page modal (accept / regenerate per item).
   *
   * Long TTL (30 min) because a 500-org run at 4 graphics each is ~2k
   * render jobs queued — DB inserts are quick but template-selection
   * SQL plus BullMQ adds latency at scale.
   */
  // DISABLED: automatic monthly bulk content generation is turned off — content
  // is now created on demand via the manual "Create Batch" action (gated behind
  // the `socials-create-actions` flag). Re-enable by restoring the @Cron
  // decorator below. The method is kept intact so a manual/cron re-enable is a
  // one-line change.
  // @Cron('0 6 1 * *')
  async handleMonthlyContentBatch() {
    if (this.isRunningMonthlyContentBatch) return;

    const hasLock = await this.acquireLock(
      MONTHLY_CONTENT_BATCH_LOCK_KEY,
      30 * 60 * 1000
    );
    if (!hasLock) return;

    this.isRunningMonthlyContentBatch = true;

    try {
      const result = await withSystemScope(
        (conn) => runMonthlyBatchesCron(conn),
        { db }
      );
      if (result.success) {
        const { created, skipped, failed } = result.data;
        this.logger.log(
          `Monthly content batch: ${created} created, ${skipped} skipped (already existed), ${failed} failed`
        );
      } else {
        logError(
          'scheduler.monthlyContentBatch',
          new Error(result.error.message),
          { feature: 'scheduler', extra: { code: result.error.code } }
        );
      }
    } catch (error) {
      logError('scheduler.monthlyContentBatch', error, {
        feature: 'scheduler',
      });
    } finally {
      this.isRunningMonthlyContentBatch = false;
      await this.releaseLock(MONTHLY_CONTENT_BATCH_LOCK_KEY);
    }
  }
}

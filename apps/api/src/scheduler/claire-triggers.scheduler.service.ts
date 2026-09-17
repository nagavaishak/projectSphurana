import { db, withSystemScope } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import { observabilityEnv } from '@borradh-workspace/env/observability';
import {
  runCampaignLearningPhaseExitTrigger,
  runClaireWhatsappNudges,
  runContentLearningPhasePromptTrigger,
  runContentNoPost14DaysTrigger,
  runContentUnusedAssetsTrigger,
  runCplSpikeTrigger,
  runCreativeBurnoutTrigger,
  runFourDayNoLeadsTrigger,
  runLeadUnreplied2hTrigger,
  runLeadVolumeDropTrigger,
  runLearningPhaseReassuranceTrigger,
  runNoShowSurgeTrigger,
  runOfferExpiringSoonTrigger,
  runOperationalSnapshotCron,
  runPreAppointmentPrepTrigger,
  runPromptCreateFirstAdTrigger,
  runPromptCreateFirstOfferTrigger,
  runPromptCreateFirstPostTrigger,
  runPromptRecordFirstVideoTrigger,
} from '@borradh-workspace/features/assistant';
import { runAutoIgnoreDisagreementsTrigger } from '@borradh-workspace/features/claire';
import { WhatsAppCloudService } from '@borradh-workspace/integrations/whatsapp';
import {
  logError,
  pingHeartbeat,
  trackEvent,
} from '@borradh-workspace/observability';
import { getRedis } from '@borradh-workspace/redis';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { logSchedulerResultError } from './scheduler-error';

/**
 * Scheduled jobs that populate `assistant_recommendation` rows for the
 * Claire widget.
 *
 * Each job follows the same shape (copied from `SchedulerService`):
 *   1. Guard re-entrancy with an `is*` flag
 *   2. Acquire a Redis distributed lock (multi-instance safety)
 *   3. Call the trigger function
 *   4. Log created/skipped/failed counts
 *   5. Release the lock, reset the flag
 *
 * See docs/plans/claire-spec-v2.md Decision 7 (catalogue) and the scheduler
 * wiring section of docs/plans/claire-build-plan.md.
 */

const LOCK_TTL_MS = 30_000;

const TRIGGERS_DISTINCT_ID = 'system:claire-triggers';

const LOCK_KEYS = {
  contentNoPost14: 'scheduler:claire-content-no-post-14-days:lock',
  contentUnusedAssets: 'scheduler:claire-content-unused-assets:lock',
  contentLearningPrompt: 'scheduler:claire-content-learning-phase-prompt:lock',
  leadUnreplied2h: 'scheduler:claire-lead-unreplied-2h:lock',
  preAppointmentPrep: 'scheduler:claire-pre-appointment-prep:lock',
  campaignLearningExit: 'scheduler:claire-campaign-learning-phase-exit:lock',
  learningReassurance: 'scheduler:claire-learning-phase-reassurance:lock',
  promptCreateFirstAd: 'scheduler:claire-prompt-create-first-ad:lock',
  promptCreateFirstOffer: 'scheduler:claire-prompt-create-first-offer:lock',
  promptRecordFirstVideo: 'scheduler:claire-prompt-record-first-video:lock',
  promptCreateFirstPost: 'scheduler:claire-prompt-create-first-post:lock',
  operationalSnapshot: 'scheduler:claire-operational-snapshot:lock',
  // W-C16-lifecycle-triggers (Phase 4).
  noShowSurge: 'scheduler:claire-no-show-surge:lock',
  offerExpiringSoon: 'scheduler:claire-offer-expiring-soon:lock',
  // W-C16-perf-triggers (Phase 4).
  cplSpike: 'scheduler:claire-cpl-spike:lock',
  creativeBurnout: 'scheduler:claire-creative-burnout:lock',
  leadVolumeDrop: 'scheduler:claire-lead-volume-drop:lock',
  // PRD-1 — Campaign Troubleshooting Framework (proactive trigger).
  fourDayNoLeads: 'scheduler:claire-four-day-no-leads:lock',
  // Window 8 — auto-ignore stale classifier disagreements (daily).
  autoIgnoreDisagreements: 'scheduler:claire-auto-ignore-disagreements:lock',
  // WS-11 — Claire-on-WhatsApp proactive nudges (daily).
  whatsappNudges: 'scheduler:claire-whatsapp-nudges:lock',
} as const;

@Injectable()
export class ClaireTriggersSchedulerService implements OnModuleDestroy {
  private readonly logger = new Logger(ClaireTriggersSchedulerService.name);
  private readonly instanceId = `${process.pid}-${Date.now()}`;

  private flags = {
    contentNoPost14: false,
    contentUnusedAssets: false,
    contentLearningPrompt: false,
    leadUnreplied2h: false,
    preAppointmentPrep: false,
    campaignLearningExit: false,
    learningReassurance: false,
    promptCreateFirstAd: false,
    promptCreateFirstOffer: false,
    promptRecordFirstVideo: false,
    promptCreateFirstPost: false,
    operationalSnapshot: false,
    // W-C16-lifecycle-triggers (Phase 4).
    noShowSurge: false,
    offerExpiringSoon: false,
    // W-C16-perf-triggers (Phase 4).
    cplSpike: false,
    creativeBurnout: false,
    leadVolumeDrop: false,
    // PRD-1 — Campaign Troubleshooting Framework (proactive trigger).
    fourDayNoLeads: false,
    // Window 8 — auto-ignore stale disagreements.
    autoIgnoreDisagreements: false,
    // WS-11 — Claire-on-WhatsApp proactive nudges.
    whatsappNudges: false,
  };

  async onModuleDestroy() {
    for (const key of Object.values(LOCK_KEYS)) {
      await this.releaseLock(key);
    }
  }

  private async acquireLock(
    lockKey: string,
    ttlMs = LOCK_TTL_MS
  ): Promise<boolean> {
    try {
      const redis = getRedis();
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

  private async releaseLock(lockKey: string): Promise<void> {
    try {
      const redis = getRedis();
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
   * Tiny wrapper so each @Cron/@Interval method fits in ~6 lines.
   */
  private async run(
    flagKey: keyof typeof LOCK_KEYS,
    name: string,
    trigger: (
      db: Parameters<typeof runContentNoPost14DaysTrigger>[0]
    ) => Promise<Awaited<ReturnType<typeof runContentNoPost14DaysTrigger>>>,
    lockTtlMs = LOCK_TTL_MS
  ) {
    if (this.flags[flagKey]) return;

    const lockKey = LOCK_KEYS[flagKey];
    const hasLock = await this.acquireLock(lockKey, lockTtlMs);
    if (!hasLock) return;

    this.flags[flagKey] = true;

    try {
      const result = await withSystemScope((conn) => trigger(conn), { db });
      if (result.success) {
        const { created, skipped, failed } = result.data;
        if (created > 0 || failed > 0) {
          this.logger.log(
            `${name}: ${created} created, ${skipped} skipped, ${failed} failed`
          );
          // Outcome event — this trigger actually produced (or failed to
          // produce) recommendations. Distinct in purpose from a trigger's own
          // `.success` event, which only records that the run happened.
          trackEvent(TRIGGERS_DISTINCT_ID, 'claire.triggerOutcome', {
            trigger: flagKey,
            created,
            skipped,
            failed,
          });
        }
      } else {
        // Surface the trigger's real cause, not the blanket INTERNAL_ERROR.
        logSchedulerResultError(`scheduler.${name}`, result.error, {
          trigger: flagKey,
        });
      }
    } catch (error) {
      logError(`scheduler.${name}`, error, { feature: 'scheduler' });
    } finally {
      this.flags[flagKey] = false;
      await this.releaseLock(lockKey);
    }
  }

  // --- Content-related triggers (all daily at 6am UTC) ---

  @Cron('0 6 * * *')
  async handleContentNoPost14Days() {
    await this.run(
      'contentNoPost14',
      'claire.contentNoPost14',
      runContentNoPost14DaysTrigger
    );
  }

  @Cron('5 6 * * *')
  async handleContentUnusedAssets() {
    await this.run(
      'contentUnusedAssets',
      'claire.contentUnusedAssets',
      runContentUnusedAssetsTrigger
    );
  }

  @Cron('10 6 * * *')
  async handleContentLearningPhasePrompt() {
    await this.run(
      'contentLearningPrompt',
      'claire.contentLearningPhasePrompt',
      runContentLearningPhasePromptTrigger
    );
  }

  // --- Lead trigger (every 15 min) ---

  @Interval(15 * 60 * 1000)
  async handleLeadUnreplied2h() {
    await this.run(
      'leadUnreplied2h',
      'claire.leadUnreplied2h',
      runLeadUnreplied2hTrigger
    );
    // Liveness heartbeat for Claire's proactive triggers: this 15-min interval
    // is the most frequent, so it's the fastest signal that the scheduled
    // recommendation engine has stopped firing.
    void pingHeartbeat(observabilityEnv.BETTERSTACK_CLAIRE_HEARTBEAT_URL);
  }

  // --- Appointment prep (daily at 9am UTC) ---

  @Cron('0 9 * * *')
  async handlePreAppointmentPrep() {
    await this.run(
      'preAppointmentPrep',
      'claire.preAppointmentPrep',
      runPreAppointmentPrepTrigger
    );
  }

  // --- Campaign lifecycle (daily at 6:15-6:25am UTC) ---

  @Cron('15 6 * * *')
  async handleCampaignLearningPhaseExit() {
    await this.run(
      'campaignLearningExit',
      'claire.campaignLearningPhaseExit',
      runCampaignLearningPhaseExitTrigger
    );
  }

  @Cron('20 6 * * *')
  async handleLearningPhaseReassurance() {
    await this.run(
      'learningReassurance',
      'claire.learningPhaseReassurance',
      runLearningPhaseReassuranceTrigger
    );
  }

  // --- LLM-generated trigger (daily at 7am UTC, longer lock — LLM calls) ---

  @Cron('0 7 * * *')
  async handlePromptCreateFirstAd() {
    await this.run(
      'promptCreateFirstAd',
      'claire.promptCreateFirstAd',
      runPromptCreateFirstAdTrigger,
      10 * 60 * 1000 // 10 min TTL — LLM calls per org, can run long
    );
  }

  @Cron('5 7 * * *')
  async handlePromptCreateFirstOffer() {
    await this.run(
      'promptCreateFirstOffer',
      'claire.promptCreateFirstOffer',
      runPromptCreateFirstOfferTrigger,
      10 * 60 * 1000 // 10 min TTL — LLM calls per org, can run long
    );
  }

  @Cron('10 7 * * *')
  async handlePromptRecordFirstVideo() {
    await this.run(
      'promptRecordFirstVideo',
      'claire.promptRecordFirstVideo',
      runPromptRecordFirstVideoTrigger,
      10 * 60 * 1000 // 10 min TTL — LLM calls per org, can run long
    );
  }

  @Cron('15 7 * * *')
  async handlePromptCreateFirstPost() {
    await this.run(
      'promptCreateFirstPost',
      'claire.promptCreateFirstPost',
      runPromptCreateFirstPostTrigger,
      10 * 60 * 1000 // 10 min TTL — LLM calls per org, can run long
    );
  }

  // --- Operational snapshot (W-C13-operational-snapshots, daily 04:30 UTC) ---
  // Runs after `handleCampaignInsightsSync` (04:00 UTC) so the local
  // `meta_campaign_daily_insights` table is fresh for the ad rollup section
  // of the snapshot. Iterates orgs in batches of 10; per-org embedding +
  // INSERT is ~200ms, so a 200-org run completes in ~4 minutes. Lock TTL is
  // 15 min to cover the slowest expected run + headroom.
  @Cron('30 4 * * *')
  async handleOperationalSnapshot() {
    await this.run(
      'operationalSnapshot',
      'claire.operationalSnapshot',
      runOperationalSnapshotCron,
      15 * 60 * 1000
    );
  }

  // --- Lifecycle recommendation triggers (W-C16-lifecycle-triggers) ---
  // Both fire daily after the 06:00 content cluster + 06:15-06:25 campaign
  // cluster so they layer cleanly into the existing schedule. Each runs as
  // a single SQL pass + per-org LLM payload generation (the generator
  // itself falls back to static copy on any LLM failure), so the lock TTL
  // tracks the LLM surface — same 10-min budget as the 07:00 prompt
  // triggers.

  @Cron('30 6 * * *')
  async handleNoShowSurge() {
    await this.run(
      'noShowSurge',
      'claire.noShowSurge',
      runNoShowSurgeTrigger,
      10 * 60 * 1000
    );
  }

  @Cron('35 6 * * *')
  async handleOfferExpiringSoon() {
    await this.run(
      'offerExpiringSoon',
      'claire.offerExpiringSoon',
      runOfferExpiringSoonTrigger,
      10 * 60 * 1000
    );
  }

  // --- Performance recommendation triggers (W-C16-perf-triggers) ---
  // All three fire daily after the 06:30-06:35 lifecycle cluster. They run
  // off the same `meta_campaign_daily_insights` table the operational
  // snapshot uses; sync from Meta lands at 04:00 UTC and the snapshot at
  // 04:30, so by 06:40+ the data is fresh. Each is a single SQL pass +
  // per-org LLM payload generation; the generator falls back to static
  // copy on LLM failure. Lock TTL matches the lifecycle triggers (10 min).

  @Cron('40 6 * * *')
  async handleCplSpike() {
    await this.run(
      'cplSpike',
      'claire.cplSpike',
      runCplSpikeTrigger,
      10 * 60 * 1000
    );
  }

  @Cron('45 6 * * *')
  async handleCreativeBurnout() {
    await this.run(
      'creativeBurnout',
      'claire.creativeBurnout',
      runCreativeBurnoutTrigger,
      10 * 60 * 1000
    );
  }

  @Cron('50 6 * * *')
  async handleLeadVolumeDrop() {
    await this.run(
      'leadVolumeDrop',
      'claire.leadVolumeDrop',
      runLeadVolumeDropTrigger,
      10 * 60 * 1000
    );
  }

  // --- Campaign troubleshooting (PRD-1, proactive) ---
  // Fires daily after the 06:40-06:50 performance cluster, off the same
  // `meta_campaign_daily_insights` table. One SQL pass for spend-gated
  // candidates + a per-campaign high-intent check sharing the diagnose
  // service's predicate, then a per-org recommendation. Static copy (no LLM),
  // but it advances troubleshoot state per qualifying campaign, so the 10-min
  // lock budget tracks the lifecycle cluster.

  @Cron('55 6 * * *')
  async handleFourDayNoLeads() {
    await this.run(
      'fourDayNoLeads',
      'claire.fourDayNoLeads',
      runFourDayNoLeadsTrigger,
      10 * 60 * 1000
    );
  }

  // --- Window 8 — auto-ignore stale classifier disagreements ---
  // Daily sweep over `business_profile.disagreement` jsonb. Disagreements
  // that were `surfaced` more than 30 days ago and still `pending` flip to
  // `ignored`. Independent of the recommendation triggers — no Meta data
  // needed — so its slot is end-of-cluster at 07:30 UTC.
  @Cron('30 7 * * *')
  async handleAutoIgnoreDisagreements() {
    const name = 'claire.autoIgnoreDisagreements';
    if (this.flags.autoIgnoreDisagreements) return;
    const lockKey = LOCK_KEYS.autoIgnoreDisagreements;
    const hasLock = await this.acquireLock(lockKey);
    if (!hasLock) return;
    this.flags.autoIgnoreDisagreements = true;
    try {
      const result = await withSystemScope(
        (conn) => runAutoIgnoreDisagreementsTrigger(conn),
        { db }
      );
      if (result.success) {
        const { swept, failed } = result.data;
        if (swept > 0 || failed > 0) {
          this.logger.log(`${name}: ${swept} swept, ${failed} failed`);
        }
      } else {
        // Surface the real cause, not the blanket INTERNAL_ERROR.
        logSchedulerResultError(`scheduler.${name}`, result.error, {
          trigger: 'autoIgnoreDisagreements',
        });
      }
    } catch (error) {
      logError(`scheduler.${name}`, error, { feature: 'scheduler' });
    } finally {
      this.flags.autoIgnoreDisagreements = false;
      await this.releaseLock(lockKey);
    }
  }

  // --- WS-11 — Claire-on-WhatsApp proactive nudges (daily 10:00 UTC) ---
  // For every org with an ACTIVE WhatsApp link, evaluate the gating conditions
  // (quiet hours, frequency cap, opt-out, usage cap) via the pure decideNudge
  // and, when one fires, send the APPROVED template + bridge it into the inbound
  // Claire thread. Gated on CLAIRE_WHATSAPP_PROACTIVE_ENABLED (default false —
  // templates must be operator-approved in the Meta UI first, plan §0.C). The
  // 10:00 slot keeps nudges inside the default daytime window. Static gating, but
  // a per-owner LLM-free send + bridge; 10-min lock budget for headroom.
  @Cron('0 10 * * *')
  async handleWhatsappNudges() {
    if (!apiEnv.CLAIRE_WHATSAPP_PROACTIVE_ENABLED) return;
    const name = 'claire.whatsappNudges';
    if (this.flags.whatsappNudges) return;
    const lockKey = LOCK_KEYS.whatsappNudges;
    const hasLock = await this.acquireLock(lockKey, 10 * 60 * 1000);
    if (!hasLock) return;
    this.flags.whatsappNudges = true;
    try {
      const service = new WhatsAppCloudService(
        apiEnv.CLAIRE_WHATSAPP_ACCESS_TOKEN,
        apiEnv.CLAIRE_WHATSAPP_PHONE_NUMBER_ID
      );
      const result = await withSystemScope(
        (conn) =>
          runClaireWhatsappNudges(conn, {
            service,
            optedOutPhonesRaw: apiEnv.CLAIRE_WHATSAPP_OPTED_OUT,
          }),
        { db }
      );
      if (result.success) {
        const { sent, skipped, failed } = result.data;
        if (sent > 0 || failed > 0) {
          this.logger.log(
            `${name}: ${sent} sent, ${skipped} skipped, ${failed} failed`
          );
        }
      } else {
        logError(`scheduler.${name}`, new Error(result.error.message), {
          feature: 'scheduler',
          extra: { code: result.error.code },
        });
      }
    } catch (error) {
      logError(`scheduler.${name}`, error, { feature: 'scheduler' });
    } finally {
      this.flags.whatsappNudges = false;
      await this.releaseLock(lockKey);
    }
  }
}

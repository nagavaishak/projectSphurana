import {
  and,
  db,
  eq,
  orgSmsNumber,
  orgSmsSender,
  organization,
  whatsappAccount,
  withSystemScope,
} from '@borradh-workspace/database';
import {
  CAMPAIGN_SEND_QUEUE,
  type CampaignSendJobPayload,
  moveToCampaignDLQ,
  resolveSmsSender,
  sendCampaignMessage,
} from '@borradh-workspace/features/campaigns';
import { decryptCredentials } from '@borradh-workspace/integrations';
import { createLogger, logError } from '@borradh-workspace/observability';
import { getBullMqPrefix, getRedis } from '@borradh-workspace/redis';
import { type Job, Worker } from 'bullmq';
import { buildChannelSenders } from './build-channel-senders.js';
import { CAMPAIGN_SEND_MAX_PER_SECOND } from './campaign-send-rate.js';

const logger = createLogger('CampaignSendWorker');

const MAX_ATTEMPTS = 3;

/**
 * BullMQ worker for the campaign-send queue. One job = one recipient × channel.
 *
 * Runs under system scope (cross-org, BYPASSRLS) like the other workers. The
 * per-recipient idempotency + credit debit + record-keeping live in
 * `sendCampaignMessage`; this worker resolves the org's senders and drives it.
 *
 * TODO (Phase 4 hardening, plan §4b): quiet-hours re-delay, per-org/channel
 * throttle token-bucket, and the campaign-send killswitch all belong here as
 * pre-send checks that `moveToDelayed` rather than fail.
 */
export function createCampaignSendWorker(): Worker {
  const worker = new Worker<CampaignSendJobPayload>(
    CAMPAIGN_SEND_QUEUE,
    async (job: Job<CampaignSendJobPayload>) => {
      const { recipientId, organizationId } = job.data;

      await withSystemScope(
        async (conn) => {
          const number = await conn.query.orgSmsNumber.findFirst({
            where: eq(orgSmsNumber.organizationId, organizationId),
          });
          const smsSenderRow = await conn.query.orgSmsSender.findFirst({
            where: eq(orgSmsSender.organizationId, organizationId),
          });
          const org = await conn.query.organization.findFirst({
            where: eq(organization.id, organizationId),
            columns: { name: true, slug: true },
          });
          const wa = await conn.query.whatsappAccount.findFirst({
            where: and(
              eq(whatsappAccount.organizationId, organizationId),
              eq(whatsappAccount.isActive, true)
            ),
          });
          let whatsapp:
            | { accessToken: string; phoneNumberId: string }
            | undefined;
          if (wa) {
            const creds = decryptCredentials<{ accessToken: string }>(
              wa.encryptedCredentials
            );
            whatsapp = {
              accessToken: creds.accessToken,
              phoneNumberId: wa.phoneNumberId,
            };
          }
          // Each business sends from its own <slug>@campaign.borradh.io
          // address (slug is unique + subdomain-safe) — campaign.borradh.io is
          // the verified Resend sending domain. Fall back to the shared
          // CAMPAIGN_FROM_ADDRESS only if the org somehow has no slug.
          const campaignDomain =
            process.env.CAMPAIGN_FROM_DOMAIN ?? 'campaign.borradh.io';
          const fromAddress = org?.slug
            ? `${org.slug}@${campaignDomain}`
            : process.env.CAMPAIGN_FROM_ADDRESS;

          const senders = buildChannelSenders({
            smsSender: resolveSmsSender({
              sender: smsSenderRow ?? null,
              number: number ?? null,
              orgName: org?.name ?? '',
            }),
            fromName: org?.name,
            fromAddress,
            whatsapp,
          });

          const res = await sendCampaignMessage(
            conn,
            { recipientId, organizationId },
            senders
          );

          // Let BullMQ retry only genuinely transient/internal failures; expected
          // outcomes (skipped, ineligible, provider-rejected) are terminal and
          // already recorded on the recipient row.
          if (!res.success && res.error.code === 'INTERNAL_ERROR') {
            throw new Error(res.error.message);
          }
        },
        { db }
      );
    },
    {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      concurrency: 10,
      limiter: { max: CAMPAIGN_SEND_MAX_PER_SECOND, duration: 1000 },
      lockDuration: 60_000,
      stalledInterval: 30_000,
      maxStalledCount: 1,
    }
  );

  worker.on('failed', async (job, error) => {
    logError('campaigns.sendWorker.jobFailed', error, {
      feature: 'campaigns',
      extra: {
        jobId: job?.id,
        recipientId: job?.data?.recipientId,
        attemptsMade: job?.attemptsMade,
      },
    });
    if (job && job.attemptsMade >= MAX_ATTEMPTS) {
      await moveToCampaignDLQ({
        id: job.id ?? 'unknown',
        data: job.data,
        failedReason: error.message,
        attemptsMade: job.attemptsMade,
      });
    }
  });

  logger.info('Campaign send worker started');
  return worker;
}

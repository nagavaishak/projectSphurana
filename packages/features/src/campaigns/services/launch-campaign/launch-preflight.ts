import {
  type CampaignChannel,
  creditBalances,
  orgSmsNumber,
  orgSmsSender,
  organization,
  whatsappAccount,
  whatsappTemplate,
} from '@borradh-workspace/database';
import { campaignChannelLabels } from '@borradh-workspace/labels';
import { and, eq } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';
import { resolveSmsSender } from '../_shared/index.js';

/**
 * Per-channel launch readiness pre-flight.
 *
 * A campaign materializes one recipient per (eligible lead × selected channel).
 * If a selected channel has no message — or the org can't actually deliver on it
 * (no SMS number / no credits / no WhatsApp account) — every one of those
 * recipients fails at send time as `channel_not_configured` with no explanation
 * to the user. This gate runs BEFORE materialization so launch can refuse with an
 * actionable per-channel reason instead of producing silent failures.
 *
 * Pure IO over an already org-scoped connection (the caller wraps it in
 * `withOrgScope`), so it's trivially unit-testable with a mocked `db.query.*`.
 */

/** Why a selected channel can't be launched yet. */
export type LaunchBlockerReason =
  | 'missing_content'
  | 'missing_subject'
  | 'no_sms_sender'
  | 'insufficient_credits'
  | 'no_whatsapp_account'
  | 'whatsapp_template_required'
  | 'whatsapp_template_not_approved';

export interface LaunchBlocker {
  channel: CampaignChannel;
  reason: LaunchBlockerReason;
  /** Human-readable, user-facing explanation of how to fix it. */
  message: string;
}

/** Minimal message shape the content check needs (subset of campaignMessage). */
export interface PreflightMessage {
  channel: CampaignChannel;
  subject: string | null;
  body: string;
  whatsappTemplateId?: string | null;
}

export interface CollectLaunchBlockersInput {
  organizationId: string;
  channels: CampaignChannel[];
  messages: PreflightMessage[];
}

/**
 * Collect every reason a selected channel isn't ready to launch. Empty array
 * means all selected channels are good to go.
 */
export async function collectLaunchBlockers(
  db: DbConnection,
  input: CollectLaunchBlockersInput
): Promise<LaunchBlocker[]> {
  const { organizationId, channels, messages } = input;
  const byChannel = new Map(messages.map((m) => [m.channel, m]));
  const blockers: LaunchBlocker[] = [];

  for (const channel of channels) {
    const message = byChannel.get(channel);

    // 1. Content — nothing to send if the channel has no saved body.
    if (!message || message.body.trim().length === 0) {
      blockers.push({
        channel,
        reason: 'missing_content',
        message: `Write the ${campaignChannelLabels[channel]} message before launching.`,
      });
      continue; // no point checking deliverability with nothing to send
    }
    if (channel === 'email' && (message.subject ?? '').trim().length === 0) {
      blockers.push({
        channel,
        reason: 'missing_subject',
        message: 'Add an email subject line before launching.',
      });
      continue;
    }

    // OPT-OUT HARD GATE (email): a campaign email can NEVER ship without an
    // unsubscribe affordance. This is enforced structurally, not per-message:
    // the sender always appends the `renderCampaignEmailHtml(..., {
    // unsubscribeUrl })` footer AND sets the `List-Unsubscribe` /
    // `List-Unsubscribe-Post` headers from the per-recipient unsubscribe URL
    // (see `build-channel-senders.ts`). The URL is derived from the tracking
    // secret + recipient, so there is no editable field to remove it and thus
    // nothing to block on here — the guarantee lives in the sender, and this
    // comment is the explicit record of the gate. (WhatsApp's equivalent STOP
    // line is likewise baked into the canonical template, checked below.)

    // 2. Deliverability — the org must actually be able to send on this channel.
    if (channel === 'sms') {
      // Resolve the org's sender: alpha (branded sender ID, the default — no
      // number needed) or a dedicated number. Only block if neither resolves.
      const [senderRow, numberRow, org] = await Promise.all([
        db.query.orgSmsSender.findFirst({
          where: eq(orgSmsSender.organizationId, organizationId),
        }),
        db.query.orgSmsNumber.findFirst({
          where: eq(orgSmsNumber.organizationId, organizationId),
        }),
        db.query.organization.findFirst({
          where: eq(organization.id, organizationId),
          columns: { name: true },
        }),
      ]);
      const resolved = resolveSmsSender({
        sender: senderRow ?? null,
        number: numberRow ?? null,
        orgName: org?.name ?? '',
      });
      if (resolved.mode === 'none') {
        blockers.push({
          channel,
          reason: 'no_sms_sender',
          message: `${resolved.reason}. Set a sender ID in SMS settings before launching.`,
        });
        continue;
      }
      // SMS is the only metered channel. Per-recipient exhaustion is still
      // handled at send time (pause/resume); this just blocks a launch that
      // can't send a single message.
      const balance = await db.query.creditBalances.findFirst({
        where: eq(creditBalances.organizationId, organizationId),
        columns: { balance: true },
      });
      if (!balance || balance.balance <= 0) {
        blockers.push({
          channel,
          reason: 'insufficient_credits',
          message: 'Not enough SMS credits. Top up to send.',
        });
      }
      continue;
    }

    if (channel === 'whatsapp') {
      const account = await db.query.whatsappAccount.findFirst({
        where: and(
          eq(whatsappAccount.organizationId, organizationId),
          eq(whatsappAccount.isActive, true)
        ),
        columns: { id: true },
      });
      if (!account) {
        blockers.push({
          channel,
          reason: 'no_whatsapp_account',
          message:
            'Connect a WhatsApp account before sending WhatsApp campaigns.',
        });
        continue;
      }
      // Bulk WhatsApp is TEMPLATE-ONLY: free-form only reaches contacts inside
      // the 24h window, so a campaign without an approved template would fail
      // for almost every recipient. Require a template up front.
      if (!message.whatsappTemplateId) {
        blockers.push({
          channel,
          reason: 'whatsapp_template_required',
          message:
            'Choose an approved WhatsApp template — bulk WhatsApp is template-only.',
        });
        continue;
      }
      // Template sends are business-initiated and only deliver when the
      // template is still APPROVED on Meta — catch pauses/rejections here
      // instead of failing every recipient at send time.
      const template = await db.query.whatsappTemplate.findFirst({
        where: eq(whatsappTemplate.id, message.whatsappTemplateId),
        columns: { id: true, status: true },
      });
      if (!template || template.status !== 'approved') {
        blockers.push({
          channel,
          reason: 'whatsapp_template_not_approved',
          message:
            'The selected WhatsApp template is not approved. Pick an approved template or refresh templates.',
        });
      }
    }
  }

  return blockers;
}

/** One-line summary for the launch error message. */
export function formatLaunchBlockers(blockers: LaunchBlocker[]): string {
  return blockers
    .map((b) => `${campaignChannelLabels[b.channel]}: ${b.message}`)
    .join(' ');
}

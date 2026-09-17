import {
  conversation,
  conversationMessage,
  lead,
  leadForm,
  orgSmsNumber,
  organization,
  organizationService,
  suppression,
  whatsappAccount,
  whatsappTemplate,
} from '@borradh-workspace/database';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { WhatsAppCloudService } from '@borradh-workspace/integrations/whatsapp';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';

import {
  buildSuppressionIndex,
  contactForChannel,
  isChannelEligible,
} from '../../../campaigns/index.js';
import { deliverMessages } from '../../../chatbots/index.js';
import { advanceLeadStage } from '../../../leads/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  logConversationEvent,
  logFirstTouchOutcome,
  ok,
} from '../../../shared/index.js';
import {
  type ComposedFirstTouch,
  composeFirstTouch,
} from './compose-first-touch.js';
import { scheduleFollowUps } from './schedule-follow-ups.js';
import {
  type SendLeadFirstTouchInput,
  sendLeadFirstTouchSchema,
} from './send-lead-first-touch.schema.js';

const logger = createLogger('SendLeadFirstTouch');

/** The template a clinic's WhatsApp opener is sent from. */
export const FIRST_TOUCH_TEMPLATE_NAME = 'claire_first_touch';

/**
 * The `externalUserId` a conversation is keyed on, per platform.
 *
 * Meta identifies a WhatsApp user by `wa_id` — digits, no leading `+` — and
 * every inbound handler stores `msg.from` exactly as Meta sends it. A
 * conversation keyed on E.164 therefore can NEVER match one opened by an
 * inbound message, in either direction. Production bears this out: all 2,610
 * WhatsApp conversations (and every Messenger and Instagram one) are stored
 * without a `+`.
 *
 * This matters most for the click-to-WhatsApp path. A lead who taps the
 * WhatsApp CTA on a form or ad sends us a message first, which opens a
 * conversation under their `wa_id`; the lead-form webhook then fires first
 * touch. Keyed on E.164 the dedup check misses, and Claire sends "I'm getting
 * in touch about the form you submitted" to someone who is already mid-
 * conversation — from a second, parallel conversation row that splits the
 * thread and the bot's context.
 *
 * SMS is left alone: Twilio speaks E.164 with the `+`, `handleInboundSms`
 * stores it that way, and prod has no SMS conversations to contradict it.
 */
export const conversationKey = (
  platform: 'whatsapp' | 'sms',
  contact: string
): string => (platform === 'whatsapp' ? contact.replace(/\D/g, '') : contact);

export type FirstTouchOutcome =
  | { sent: true; channel: 'whatsapp' | 'sms'; conversationId: string }
  | { sent: false; reason: FirstTouchSkipReason };

export type FirstTouchSkipReason =
  | 'already_contacted'
  | 'no_eligible_channel'
  // Reachable, and a sender EXISTS, but the clinic has Claire switched off on
  // it — so an opener would be a question nobody answers.
  | 'chatbot_disabled'
  // Reachable, but the clinic has no sender on that channel at all. Nothing to
  // switch on: they have to connect WhatsApp or provision a number first.
  | 'no_sender_configured'
  | 'lead_not_found'
  | 'org_not_found'
  | 'delivery_failed';

/**
 * Which service the lead enquired about, when we can tell.
 *
 * Meta-native forms carry no service link, so `leadForm.organizationServiceId`
 * is populated at sync time by matching the form to the org's services. A null
 * here is normal and simply means the opener asks the generic question.
 */
async function resolveEnquiredServiceName(
  db: DbConnection,
  leadRow: { formData: unknown }
): Promise<string | null> {
  const formId = (leadRow.formData as { form_id?: string } | null)?.form_id;
  if (!formId) return null;

  const form = await db.query.leadForm.findFirst({
    where: eq(leadForm.metaFormId, formId),
    columns: { organizationServiceId: true },
  });
  if (!form?.organizationServiceId) return null;

  const service = await db.query.organizationService.findFirst({
    where: eq(organizationService.id, form.organizationServiceId),
    columns: { name: true },
  });
  return service?.name ?? null;
}

/**
 * Can this org start a WhatsApp conversation right now?
 *
 * Best-effort: if the health check itself fails we assume yes and let the send
 * decide, because a transient Graph error must not push every lead onto SMS.
 */
async function canWhatsAppInitiate(
  waAccount: {
    id: string;
    phoneNumberId: string;
    encryptedCredentials: string;
  },
  organizationId: string
): Promise<boolean> {
  try {
    const credentials = decryptCredentials<{ accessToken: string }>(
      waAccount.encryptedCredentials
    );
    const whatsapp = new WhatsAppCloudService(
      credentials.accessToken,
      waAccount.phoneNumberId
    );
    const health = await whatsapp.getSendHealth();
    if (health.canSendMessage !== 'BLOCKED') return true;

    logError(
      'conversations.sendLeadFirstTouch.whatsappBlocked',
      new Error(
        `WhatsApp cannot initiate conversations: ${health.blockers
          .map((b) => `${b.entityType} ${b.code} ${b.description}`)
          .join('; ')}`
      ),
      {
        feature: 'conversations',
        extra: {
          organizationId,
          blockers: health.blockers,
        },
      }
    );
    return false;
  } catch {
    return true;
  }
}

/**
 * Send the opener as an approved WhatsApp template and record it.
 *
 * A business-initiated WhatsApp message outside the 24h customer-service window
 * must be a template, which is why this cannot go through `deliverMessages`
 * (that path sends free-form text).
 */
async function deliverWhatsAppTemplate(args: {
  db: DbConnection;
  conversationId: string;
  organizationId: string;
  to: string;
  waAccount: {
    id: string;
    phoneNumberId: string;
    encryptedCredentials: string;
  } | null;
  template: { name: string; languageCode: string } | null;
  composed: ComposedFirstTouch;
}): Promise<boolean> {
  const {
    db,
    conversationId,
    organizationId,
    to,
    waAccount,
    template,
    composed,
  } = args;
  if (!waAccount || !template) return false;

  try {
    const credentials = decryptCredentials<{ accessToken: string }>(
      waAccount.encryptedCredentials
    );
    const whatsapp = new WhatsAppCloudService(
      credentials.accessToken,
      waAccount.phoneNumberId
    );

    const result = await whatsapp.sendTemplateMessage({
      to,
      templateName: template.name,
      languageCode: template.languageCode,
      parameters: Object.fromEntries(
        composed.templateParameters.map((value, i) => [String(i), value])
      ),
    });

    if (!result.success) return false;

    await db.insert(conversationMessage).values({
      conversationId,
      role: 'bot',
      content: composed.body,
      messageType: 'text',
      externalMessageId: result.messageId || null,
      sentAt: new Date(),
    });
    return true;
  } catch (error) {
    logError('conversations.sendLeadFirstTouch.whatsapp', error, {
      feature: 'conversations',
      extra: { conversationId, organizationId },
    });
    await logConversationEvent(db, {
      organizationId,
      conversationId,
      event: 'delivery_failed',
      metadata: { platform: 'whatsapp', source: 'lead_form_first_touch' },
    });
    return false;
  }
}

/**
 * Claire's opening message to a lead who has just submitted a Meta lead form.
 *
 * The lead never messaged us, so there is no inbound event to hang a
 * conversation off — this is the one path that creates a conversation before
 * a single message has been exchanged. Creating it up front is what makes the
 * lead's eventual reply thread into the same conversation instead of opening a
 * second, contextless one.
 *
 * Channel choice is WhatsApp when the clinic has a connected account with an
 * approved opener template and the lead is reachable there, else SMS. Both go
 * out under the same consent and suppression rules campaigns use — this must
 * never become a second consent implementation.
 */
const sendLeadFirstTouchImpl = async (
  db: DbConnection,
  input: SendLeadFirstTouchInput
): Promise<Result<FirstTouchOutcome>> => {
  const parsed = sendLeadFirstTouchSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, leadId } = parsed.data;

  const [leadRow, org] = await Promise.all([
    db.query.lead.findFirst({ where: eq(lead.id, leadId) }),
    db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
    }),
  ]);

  if (!leadRow) return ok({ sent: false, reason: 'lead_not_found' });
  if (!org) return ok({ sent: false, reason: 'org_not_found' });

  const suppressionRows = await db.query.suppression.findMany({
    where: eq(suppression.organizationId, organizationId),
    columns: { channel: true, contact: true },
  });
  const suppressionIndex = buildSuppressionIndex(suppressionRows);

  // WhatsApp first — it carries the clinic's name and logo, and is two-way
  // without the sender trade-off SMS forces (docs/plans/sms-three-geo-rollout).
  const waAccount = await db.query.whatsappAccount.findFirst({
    where: and(
      eq(whatsappAccount.organizationId, organizationId),
      eq(whatsappAccount.isActive, true)
    ),
  });

  // A business-initiated WhatsApp message outside the 24h window MUST be an
  // approved template. No approved opener ⇒ WhatsApp is not available yet, and
  // SMS is the designed path rather than an afterthought.
  const approvedTemplate = waAccount
    ? await db.query.whatsappTemplate.findFirst({
        where: and(
          eq(whatsappTemplate.organizationId, organizationId),
          eq(whatsappTemplate.name, FIRST_TOUCH_TEMPLATE_NAME),
          eq(whatsappTemplate.status, 'approved')
        ),
      })
    : undefined;

  // Meta ACCEPTS business-initiated sends it has already decided never to
  // deliver — a blocked WABA returns a wamid and `accepted`, then drops the
  // message silently. Ask before sending, so a blocked account falls back to
  // SMS instead of quietly eating every lead.
  const whatsappHealthy =
    !!waAccount && !!approvedTemplate
      ? await canWhatsAppInitiate(waAccount, organizationId)
      : false;

  // Claire must be able to ANSWER before she is allowed to speak first.
  //
  // The opener introduces her, asks a qualifying question and invites a reply.
  // If the chatbot is off on that channel, the lead's reply lands in an
  // `agent_handling` conversation and nothing responds — see
  // `handle-incoming-message`, which logs `bot_suppressed`
  // (reason: chatbot_disabled) and returns. Cold-messaging someone and then
  // ignoring their answer is worse than never messaging them, so an opener on
  // a channel that cannot hold the conversation is not sent at all.
  //
  // Measured in production before this gate existed: of the seven clinics with
  // an approved opener template, three had `isChatbotActive = false`.
  //
  // The flag is per-channel and lives beside the sender, not on the org:
  // `whatsapp_account.isChatbotActive` and `org_sms_number.isChatbotActive`.
  // Both are read here so neither channel can promise a conversation it will
  // not have.
  const smsNumber = await db.query.orgSmsNumber.findFirst({
    where: eq(orgSmsNumber.organizationId, organizationId),
    columns: { isChatbotActive: true },
  });

  const whatsappBotOn = waAccount?.isChatbotActive === true;
  const smsBotOn = smsNumber?.isChatbotActive === true;

  const canWhatsApp =
    whatsappHealthy &&
    whatsappBotOn &&
    isChannelEligible(leadRow, 'whatsapp', suppressionIndex);
  const canSms =
    smsBotOn && isChannelEligible(leadRow, 'sms', suppressionIndex);

  const channel = canWhatsApp ? 'whatsapp' : canSms ? 'sms' : null;
  if (!channel) {
    // THREE different causes, three different fixes. Collapsing them sends
    // whoever is debugging a silent clinic to the wrong place:
    //
    //   no_eligible_channel  — the lead cannot be reached at all (no number,
    //                          no consent, suppressed). A lead-data problem.
    //   chatbot_disabled     — a sender EXISTS and the clinic switched Claire
    //                          off on it. Someone flips a setting.
    //   no_sender_configured — the clinic has no sender on any channel the
    //                          lead is reachable on. Nothing to switch on;
    //                          they have to connect a channel first.
    //
    // The third was previously reported as `chatbot_disabled`, which reads as
    // "they turned it off" for a clinic that never had it — the exact
    // conflation this block exists to avoid. Production's first real skip
    // (The Fountain of Youth Spa, no WhatsApp account and no SMS number) hit
    // precisely that case.
    // "Reachable on WhatsApp" requires a connected ACCOUNT as well as a
    // reachable lead. Without that clause a lead who merely has a phone number
    // looks WhatsApp-reachable at an org that has never connected WhatsApp,
    // and every no-consent SMS lead would be reported as a missing sender
    // rather than an unreachable lead.
    const reachableOnWhatsApp =
      !!waAccount && isChannelEligible(leadRow, 'whatsapp', suppressionIndex);
    const reachableOnSms = isChannelEligible(leadRow, 'sms', suppressionIndex);

    // "Muted" needs a sender to be muted. `whatsappHealthy` already implies a
    // connected account with an approved template; SMS needs the row itself.
    const whatsappMuted =
      whatsappHealthy && !whatsappBotOn && reachableOnWhatsApp;
    const smsMuted = !!smsNumber && !smsBotOn && reachableOnSms;

    const reason: FirstTouchSkipReason =
      whatsappMuted || smsMuted
        ? 'chatbot_disabled'
        : reachableOnWhatsApp || reachableOnSms
          ? 'no_sender_configured'
          : 'no_eligible_channel';

    logger.info('First touch not sent', {
      organizationId,
      leadId,
      reason,
      whatsappHealthy,
      whatsappBotOn,
      hasSmsNumber: !!smsNumber,
      smsBotOn,
      reachableOnWhatsApp,
      reachableOnSms,
    });
    await logFirstTouchOutcome(db, {
      organizationId,
      leadId,
      channel: null,
      reason,
      metadata: {
        whatsappHealthy,
        whatsappBotOn,
        hasSmsNumber: !!smsNumber,
        smsBotOn,
        reachableOnWhatsApp,
        reachableOnSms,
      },
    });
    return ok({ sent: false, reason });
  }

  const composed = composeFirstTouch({
    firstName: leadRow.firstName,
    clinicName: org.name,
    serviceName: await resolveEnquiredServiceName(db, leadRow),
  });
  const displayName =
    [leadRow.firstName, leadRow.lastName].filter(Boolean).join(' ') || null;

  /**
   * Open a conversation on one channel and send the opener into it.
   *
   * Returns `already_contacted` rather than sending when a conversation for
   * this (org, contact, platform) exists — Meta retries the webhook and the
   * queue can redeliver, and `leadId` lives in conversation metadata rather
   * than a column, so this keys off the real unique constraint, which is
   * exactly what the insert would collide on.
   */
  const attempt = async (
    on: 'whatsapp' | 'sms'
  ): Promise<
    | { ok: true; conversationId: string }
    | { ok: false; reason: FirstTouchSkipReason }
  > => {
    // Same resolution the eligibility gate used — WhatsApp falls back to the
    // lead's phone, which is the only number a Meta lead form gives us.
    const contact = contactForChannel(leadRow, on) ?? '';
    const externalUserId = conversationKey(on, contact);

    const existing = await db.query.conversation.findFirst({
      where: and(
        eq(conversation.organizationId, organizationId),
        eq(conversation.externalUserId, externalUserId),
        eq(conversation.platform, on)
      ),
    });
    if (existing) return { ok: false, reason: 'already_contacted' };

    const [created] = await db
      .insert(conversation)
      .values({
        organizationId,
        platform: on,
        externalUserId,
        externalUserName: displayName,
        whatsappAccountId: on === 'whatsapp' ? (waAccount?.id ?? null) : null,
        metaAdsPageId: null,
        // Claire owns the conversation from the first word — she opened it.
        status: 'bot_handling',
        lastMessageAt: new Date(),
        metadata: { leadId },
      })
      .returning();

    await logConversationEvent(db, {
      organizationId,
      conversationId: created.id,
      event: 'conversation_created',
      action: 'create',
      metadata: {
        platform: on,
        status: created.status,
        source: 'lead_form_first_touch',
      },
    });

    const delivered =
      on === 'whatsapp'
        ? await deliverWhatsAppTemplate({
            db,
            conversationId: created.id,
            organizationId,
            to: contact,
            waAccount: waAccount ?? null,
            template: approvedTemplate ?? null,
            composed,
          })
        : // SMS reuses the chatbot delivery path so sender resolution, the
          // alpha-sender refusal, message recording and delivery-failure
          // events all behave identically to any other Claire message.
          (
            await deliverMessages({
              db,
              conversationId: created.id,
              messages: [{ type: 'text', text: composed.body }],
            })
          ).delivered > 0;

    // The conversation row stays even on failure: it is the idempotency
    // record, and dropping it would let a retry double-message the lead.
    // `delivery_failed` has already been logged by the delivery path.
    return delivered
      ? { ok: true, conversationId: created.id }
      : { ok: false, reason: 'delivery_failed' };
  };

  let outcome = await attempt(channel);
  let usedChannel: 'whatsapp' | 'sms' = channel;

  // Fallback: a WhatsApp opener that does not land is the single most likely
  // failure (no WhatsApp on that number, template paused, 24h/window quirks),
  // and a lead who hears nothing is the whole problem this feature exists to
  // fix. Retry once on SMS. Only on a delivery failure — never on
  // `already_contacted`, which would double-message someone we have reached.
  if (
    !outcome.ok &&
    outcome.reason === 'delivery_failed' &&
    channel === 'whatsapp' &&
    canSms
  ) {
    logger.info('WhatsApp first touch failed, falling back to SMS', {
      organizationId,
      leadId,
    });
    const smsOutcome = await attempt('sms');
    if (smsOutcome.ok) {
      outcome = smsOutcome;
      usedChannel = 'sms';
    }
  }

  if (!outcome.ok) {
    logger.warn('First touch not delivered', {
      organizationId,
      leadId,
      channel,
      reason: outcome.reason,
    });
    await logFirstTouchOutcome(db, {
      organizationId,
      leadId,
      channel: null,
      reason: outcome.reason,
      metadata: { attemptedChannel: channel },
    });
    return ok({ sent: false, reason: outcome.reason });
  }

  // The lead has now been contacted. Only ever advances — a status a human has
  // already moved on must not be dragged back to `contacted`.
  await advanceLeadStage(db, { leadId, from: 'new', to: 'contacted' });

  // Schedule both nudges up front. They check at fire time whether the lead has
  // replied, so scheduling the 24h one now (rather than chaining it off the 4h
  // one) means a failed or lost 4h job cannot silently swallow the second.
  await scheduleFollowUps({
    organizationId,
    leadId,
    conversationId: outcome.conversationId,
  });

  logger.info('Sent first touch', {
    conversationId: outcome.conversationId,
    organizationId,
    leadId,
    channel: usedChannel,
    treatmentCategory: composed.category,
  });

  await logFirstTouchOutcome(db, {
    organizationId,
    leadId,
    channel: usedChannel,
    metadata: {
      conversationId: outcome.conversationId,
      treatmentCategory: composed.category,
      // True when WhatsApp was chosen, failed to deliver, and SMS caught it.
      fellBackToSms: channel === 'whatsapp' && usedChannel === 'sms',
    },
  });

  return ok({
    sent: true,
    channel: usedChannel,
    conversationId: outcome.conversationId,
  });
};

export const sendLeadFirstTouch = (
  db: DbConnection,
  input: SendLeadFirstTouchInput
) =>
  trackedResult(
    'conversations.sendLeadFirstTouch',
    () => sendLeadFirstTouchImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        leadId: input.leadId,
      },
      // `ok({ sent: false, reason })` is a SUCCESSFUL result, so `.success`
      // fires whether or not a lead was messaged. Without these, "has anyone
      // actually received an opener?" is unanswerable from PostHog — it had to
      // be dug out of the production database during the rollout. `sent` makes
      // it a chart, and `reason` says which of the three skips it was.
      resultProperties: (data) => ({
        sent: data.sent,
        channel: data.sent ? data.channel : null,
        reason: data.sent ? null : data.reason,
      }),
    }
  );

export type SendLeadFirstTouchResult = Awaited<
  ReturnType<typeof sendLeadFirstTouch>
>;

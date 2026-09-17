import {
  assistantConversation,
  assistantMessage,
  assistantWhatsappLink,
  conversation,
} from '@borradh-workspace/database';
import type { WhatsAppCloudService } from '@borradh-workspace/integrations/whatsapp';
import { trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getSubscription } from '../../billing/index.js';
import {
  type ConversationIntentSignal,
  isHighIntentConversation,
} from '../../meta-campaigns/troubleshoot/index.js';
import type { DbConnection, Result } from '../../shared/index.js';
import { ok } from '../../shared/index.js';
import { getPlanAssistantLimits } from '../models/index.js';
import {
  DEFAULT_NUDGE_POLICY,
  type NudgeCandidate,
  type NudgeDecision,
  type NudgeOwnerSignals,
  type NudgePolicy,
  decideNudge,
} from './nudge-conditions.js';
import { isOptedOut, parseOptOutPhones } from './opt-out.js';
import { sendClaireNudge } from './send-nudge.service.js';

/**
 * WS-11 proactive-nudge runner. Mirrors the existing Claire trigger pattern
 * (`runFourDayNoLeadsTrigger` + the scheduler `run()` wrapper): a single
 * system-scoped pass that, for every org with at least one ACTIVE WhatsApp
 * link, evaluates the gating conditions (quiet hours, frequency cap, opt-out,
 * usage cap) via the PURE `decideNudge` and, when a nudge fires, sends the
 * approved template + bridges it into the inbound Claire thread.
 *
 * Candidate resolution (what to nudge about) is injectable so the orchestration
 * is testable without Meta/lead data; the default `defaultResolveCandidate`
 * implements the `daily_lead_recap` (high-intent leads today) signal from the
 * existing conversation data — no new aggregation table.
 */

export interface NudgeRunOutcome {
  sent: number;
  skipped: number;
  failed: number;
}

/** An active paired owner (one per active link row). */
interface ActiveOwner {
  organizationId: string;
  userId: string;
  phoneE164: string;
}

export interface RunNudgesDeps {
  /** Send service (dedicated Claire WABA creds in prod; stub in tests). */
  service: Pick<WhatsAppCloudService, 'sendTemplateMessage'>;
  /** Resolve the candidate nudge for one owner. Default: daily lead recap. */
  resolveCandidate?: (
    db: DbConnection,
    owner: ActiveOwner
  ) => Promise<NudgeCandidate | null>;
  /** Current time (injectable for tests). Default: new Date(). */
  now?: Date;
  /** Owner-local hour [0-23] used for quiet-hours. Default: now's UTC hour. */
  nowHourLocal?: number;
  /** Gating policy. Default: DEFAULT_NUDGE_POLICY. */
  policy?: NudgePolicy;
  /** Env-stub opt-out list (E.164 digits). Default: CLAIRE_WHATSAPP_OPTED_OUT. */
  optedOutPhonesRaw?: string;
}

/**
 * Default candidate resolver — `daily_lead_recap`. Counts the org's high-intent
 * lead conversations created today; nudges only when there is at least one
 * (a recap of zero leads is just noise — the `fourDayNoLeads` recommendation
 * handles the quiet-campaign case separately). Reuses the SHARED high-intent
 * predicate (one source of truth, plan / PRD-1).
 */
export async function defaultResolveCandidate(
  db: DbConnection,
  owner: ActiveOwner
): Promise<NudgeCandidate | null> {
  const rows = (await db.execute(sql<
    { stage: string | null; bookingInterest: string | null; cnt: number }[]
  >`
    SELECT
      ${conversation.metadata} ->> 'stage' AS "stage",
      ${conversation.metadata} ->> 'bookingInterest' AS "bookingInterest",
      (
        SELECT COUNT(*)::int FROM conversation_message cm
        WHERE cm.conversation_id = ${conversation.id} AND cm.role = 'user'
      ) AS "cnt"
    FROM ${conversation}
    WHERE ${conversation.organizationId} = ${owner.organizationId}
      AND ${conversation.createdAt} >= NOW() - INTERVAL '1 day'
  `)) as unknown as Array<{
    stage: string | null;
    bookingInterest: string | null;
    cnt: number | string;
  }>;

  let leadCount = 0;
  for (const row of rows ?? []) {
    const signal: ConversationIntentSignal = {
      stage: row.stage,
      bookingInterest: row.bookingInterest === 'true',
      userMessageCount: Number(row.cnt) || 0,
    };
    if (isHighIntentConversation(signal)) leadCount++;
  }

  if (leadCount === 0) return null;
  return { template: 'daily_lead_recap', params: [String(leadCount)] };
}

/** All active paired owners (one row per active link). */
async function listActiveOwners(db: DbConnection): Promise<ActiveOwner[]> {
  const rows = await db
    .select({
      organizationId: assistantWhatsappLink.organizationId,
      userId: assistantWhatsappLink.userId,
      phoneE164: assistantWhatsappLink.phoneE164,
    })
    .from(assistantWhatsappLink)
    .where(eq(assistantWhatsappLink.status, 'active'));

  return rows
    .filter(
      (r): r is ActiveOwner => r.phoneE164 != null && r.phoneE164.length > 0
    )
    .map((r) => ({
      organizationId: r.organizationId,
      userId: r.userId,
      phoneE164: r.phoneE164,
    }));
}

/** Most recent proactive nudge timestamp for an owner — derived from the
 *  whatsapp conversation's assistant messages (no new storage). */
async function getLastNudgeAt(
  db: DbConnection,
  owner: ActiveOwner
): Promise<Date | null> {
  const [conv] = await db
    .select({ id: assistantConversation.id })
    .from(assistantConversation)
    .where(
      and(
        eq(assistantConversation.organizationId, owner.organizationId),
        eq(assistantConversation.userId, owner.userId),
        eq(assistantConversation.channel, 'whatsapp')
      )
    )
    .limit(1);
  if (!conv) return null;

  const [msg] = await db
    .select({ createdAt: assistantMessage.createdAt })
    .from(assistantMessage)
    .where(
      and(
        eq(assistantMessage.conversationId, conv.id),
        eq(assistantMessage.role, 'assistant')
      )
    )
    .orderBy(desc(assistantMessage.createdAt))
    .limit(1);

  return msg?.createdAt ?? null;
}

/** Today's assistant message count for the org (the Q5 usage counter). */
async function getUsageToday(
  db: DbConnection,
  organizationId: string
): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const rows = (await db.execute<{ message_count: number }>(sql`
    SELECT message_count FROM assistant_usage
    WHERE organization_id = ${organizationId} AND date = ${today}
  `)) as unknown as Array<{ message_count: number }>;
  return rows?.[0]?.message_count ?? 0;
}

async function getUsageDailyCap(
  db: DbConnection,
  organizationId: string
): Promise<number> {
  const sub = await getSubscription(db, { organizationId });
  const planId = sub.success ? sub.data.planId : 'free';
  return getPlanAssistantLimits(planId).maxMessagesPerDay;
}

const runImpl = async (
  db: DbConnection,
  deps: RunNudgesDeps
): Promise<Result<NudgeRunOutcome>> => {
  const now = deps.now ?? new Date();
  const nowHourLocal = deps.nowHourLocal ?? now.getUTCHours();
  const policy = deps.policy ?? DEFAULT_NUDGE_POLICY;
  const resolveCandidate = deps.resolveCandidate ?? defaultResolveCandidate;
  const optedOut = parseOptOutPhones(deps.optedOutPhonesRaw);

  const owners = await listActiveOwners(db);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const owner of owners) {
    try {
      const candidate = await resolveCandidate(db, owner);
      const [lastNudgeAt, usageToday, usageDailyCap] = await Promise.all([
        getLastNudgeAt(db, owner),
        getUsageToday(db, owner.organizationId),
        getUsageDailyCap(db, owner.organizationId),
      ]);

      const signals: NudgeOwnerSignals = {
        organizationId: owner.organizationId,
        userId: owner.userId,
        phoneE164: owner.phoneE164,
        optedOut: isOptedOut(owner.phoneE164, optedOut),
        lastNudgeAt,
        usageToday,
        usageDailyCap,
        candidate,
      };

      const decision: NudgeDecision = decideNudge(
        signals,
        now,
        nowHourLocal,
        policy
      );
      if (!decision.send) {
        skipped++;
        continue;
      }

      const result = await sendClaireNudge(db, deps.service, {
        organizationId: owner.organizationId,
        userId: owner.userId,
        phoneE164: owner.phoneE164,
        template: decision.candidate.template,
        params: decision.candidate.params,
      });
      if (result.success) sent++;
      else failed++;
    } catch {
      // Per-owner failure shouldn't abort the whole run.
      failed++;
    }
  }

  return ok({ sent, skipped, failed });
};

/**
 * Run the proactive-nudge pass. Called from the scheduler (system-scoped db).
 */
export const runClaireWhatsappNudges = (
  db: DbConnection,
  deps: RunNudgesDeps
) =>
  trackedResult('assistant.runClaireWhatsappNudges', () => runImpl(db, deps));

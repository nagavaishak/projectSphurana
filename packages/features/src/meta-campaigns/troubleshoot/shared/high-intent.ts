import {
  conversation,
  conversationMessage,
  metaAd,
} from '@borradh-workspace/database';
// `sql` from drizzle-orm directly (the canonical source the database package
// re-exports). Importing from the package's barrel resolves to `undefined`
// under vitest's source-condition module resolution; the direct import is
// runtime-equivalent and keeps the helper unit-testable.
import { type SQL, sql } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';

/**
 * Shared high-intent predicate + attribution helpers (PRD-1, Task 3).
 *
 * This is the ONE source of truth for "did this campaign produce a high-intent
 * lead?" — consumed by both the reactive `diagnoseCampaign` service and the
 * proactive `fourDayNoLeads` trigger. Per the framework, the diagnostic is
 * conversation-based for everyone (even lead-form ads append a Messenger/
 * WhatsApp button), so a "lead" here means a conversation attributed to the
 * campaign that crossed the intent bar — NOT a Meta lead-form row.
 *
 * The predicate is derived entirely from existing `conversation.metadata`
 * (stage / bookingInterest) plus a message-count engagement signal. There is
 * deliberately no new lead-intent classifier (see "What NOT to build").
 */

/**
 * Conversation stages that, on their own, mark high intent. `qualified` and
 * `booking` are the late-funnel stages in `conversationStageLabels`.
 */
export const HIGH_INTENT_STAGES = ['qualified', 'booking'] as const;

/**
 * Engagement floor for the "multi-message engagement" arm of the predicate.
 * A contact who has sent ≥ 3 of their own messages has engaged beyond a
 * one-line drive-by, even if the bot never tagged a stage. Tuned to be
 * conservative — the stage / bookingInterest arms catch the obvious cases;
 * this arm only rescues genuinely engaged threads the tagger missed.
 */
export const MIN_ENGAGED_USER_MESSAGES = 3;

/**
 * €80 spend gate before any "no leads" diagnosis fires (framework Step 1).
 * `meta_campaign_daily_insights` stores a USD-normalized `spendUsd` precisely
 * for cross-currency comparison, so we judge every org on the same real-spend
 * bar regardless of their billing currency. €80 ≈ $87 at the ~1.08 EUR→USD
 * rate the insights sync uses.
 */
export const SPEND_THRESHOLD_EUR = 80;
export const SPEND_THRESHOLD_USD_CENTS = 8700;

export function hasSpentEnough(totalSpendUsdCents: number): boolean {
  return totalSpendUsdCents >= SPEND_THRESHOLD_USD_CENTS;
}

/**
 * The minimal signal the high-intent predicate needs. Kept framework-agnostic
 * (plain fields, no DB types) so it is trivially unit-testable.
 */
export interface ConversationIntentSignal {
  stage?: string | null;
  bookingInterest?: boolean | null;
  userMessageCount: number;
}

/**
 * Explain the high-intent verdict — which arm(s) of the predicate fired. Used
 * by the diagnostic / inspection surface so high vs low intent is auditable,
 * not a black box. `isHighIntentConversation` is the boolean shortcut over the
 * same logic.
 *
 * High intent ⇔ stage ∈ {qualified, booking}
 *            OR bookingInterest === true
 *            OR userMessageCount ≥ MIN_ENGAGED_USER_MESSAGES.
 */
export function describeHighIntent(signal: ConversationIntentSignal): {
  isHighIntent: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (
    signal.stage != null &&
    (HIGH_INTENT_STAGES as readonly string[]).includes(signal.stage)
  ) {
    reasons.push(`stage is "${signal.stage}"`);
  }
  if (signal.bookingInterest === true) {
    reasons.push('bookingInterest is true');
  }
  if (signal.userMessageCount >= MIN_ENGAGED_USER_MESSAGES) {
    reasons.push(
      `engaged (${signal.userMessageCount} user messages ≥ ${MIN_ENGAGED_USER_MESSAGES})`
    );
  }
  return { isHighIntent: reasons.length > 0, reasons };
}

/**
 * THE shared predicate — do not inline a second copy in the trigger.
 */
export function isHighIntentConversation(
  signal: ConversationIntentSignal
): boolean {
  return describeHighIntent(signal).isHighIntent;
}

export interface HighIntentStats {
  /** Count of campaign-attributed conversations that are high-intent. */
  highIntentCount: number;
  /** Most recent high-intent conversation's last activity, or null. */
  lastHighIntentAt: Date | null;
  /** Total conversations attributed to the campaign (intent-agnostic). */
  attributedConversations: number;
}

interface ConversationIntentRow {
  id: string;
  stage: string | null;
  bookingInterest: string | null;
  lastActivityAt: Date | string | null;
  userMessageCount: number | string;
  [key: string]: unknown;
}

export interface GetHighIntentConversationStatsInput {
  organizationId: string;
  metaCampaignId: string;
  /** When set, only count conversations active within the last N days. */
  withinDays?: number;
}

/**
 * Resolve the conversations attributed to a campaign and apply the
 * high-intent predicate, returning aggregate stats. Attribution mirrors
 * `resolve-ad-referral`: a conversation is attributed when its
 * `metadata.adInternalId` matches one of the campaign's internal ad ids, OR
 * its `metadata.adMetaId` matches one of the campaign's Meta ad ids (covers
 * conversations whose referral never resolved to an internal ad).
 *
 * The caller supplies a `DbConnection` already scoped to the org (reactive
 * path) or at system scope (proactive trigger) — this helper never opens its
 * own transaction.
 */
/** One campaign-attributed conversation, normalized for classification. */
export interface AttributedConversationSignal {
  conversationId: string;
  stage: string | null;
  bookingInterest: boolean;
  lastActivityAt: Date | null;
  userMessageCount: number;
}

/**
 * Fetch the conversations attributed to a campaign with the fields the
 * high-intent predicate needs. Attribution mirrors `resolve-ad-referral`: a
 * conversation matches when its `metadata.adInternalId` is one of the
 * campaign's internal ad ids, OR its `metadata.adMetaId` is one of the
 * campaign's Meta ad ids. THE shared attribution query — both the aggregate
 * stats and the per-conversation breakdown read through it.
 */
export async function getAttributedConversationSignals(
  db: DbConnection,
  input: GetHighIntentConversationStatsInput
): Promise<AttributedConversationSignal[]> {
  const { organizationId, metaCampaignId, withinDays } = input;

  // Internal + external ad ids for the campaign.
  const adRows = await db
    .select({ id: metaAd.id, metaAdId: metaAd.metaAdId })
    .from(metaAd)
    .where(
      sql`${metaAd.organizationId} = ${organizationId} AND ${metaAd.metaCampaignId} = ${metaCampaignId}`
    );

  const internalIds = adRows.map((r) => r.id);
  const externalIds = adRows
    .map((r) => r.metaAdId)
    .filter((v): v is string => v != null && v.length > 0);

  if (internalIds.length === 0 && externalIds.length === 0) {
    return [];
  }

  const attributionClauses: SQL[] = [];
  if (internalIds.length > 0) {
    attributionClauses.push(
      sql`(${conversation.metadata} ->> 'adInternalId') IN (${sql.join(
        internalIds.map((id) => sql`${id}`),
        sql`, `
      )})`
    );
  }
  if (externalIds.length > 0) {
    attributionClauses.push(
      sql`(${conversation.metadata} ->> 'adMetaId') IN (${sql.join(
        externalIds.map((id) => sql`${id}`),
        sql`, `
      )})`
    );
  }
  const attributionFilter =
    attributionClauses.length === 1
      ? attributionClauses[0]
      : sql`(${sql.join(attributionClauses, sql` OR `)})`;

  const withinFilter =
    withinDays != null
      ? sql` AND COALESCE(${conversation.lastMessageAt}, ${conversation.createdAt}) >= NOW() - INTERVAL '${sql.raw(
          String(Math.max(0, Math.floor(withinDays)))
        )} days'`
      : sql``;

  const result = await db.execute(sql<ConversationIntentRow[]>`
    SELECT
      ${conversation.id} AS "id",
      ${conversation.metadata} ->> 'stage' AS "stage",
      ${conversation.metadata} ->> 'bookingInterest' AS "bookingInterest",
      COALESCE(${conversation.lastMessageAt}, ${conversation.createdAt}) AS "lastActivityAt",
      (
        SELECT COUNT(*)
        FROM ${conversationMessage}
        WHERE ${conversationMessage.conversationId} = ${conversation.id}
          AND ${conversationMessage.role} = 'user'
      )::int AS "userMessageCount"
    FROM ${conversation}
    WHERE ${conversation.organizationId} = ${organizationId}
      AND ${attributionFilter}${withinFilter}
  `);

  const rows = (result as unknown as ConversationIntentRow[]) ?? [];

  return rows.map((row) => ({
    conversationId: row.id,
    stage: row.stage,
    bookingInterest: row.bookingInterest === 'true',
    lastActivityAt: row.lastActivityAt ? new Date(row.lastActivityAt) : null,
    userMessageCount: Number(row.userMessageCount) || 0,
  }));
}

export async function getHighIntentConversationStats(
  db: DbConnection,
  input: GetHighIntentConversationStatsInput
): Promise<HighIntentStats> {
  const signals = await getAttributedConversationSignals(db, input);

  let highIntentCount = 0;
  let lastHighIntentAt: Date | null = null;

  for (const signal of signals) {
    if (!isHighIntentConversation(signal)) continue;
    highIntentCount++;
    if (
      signal.lastActivityAt &&
      (!lastHighIntentAt || signal.lastActivityAt > lastHighIntentAt)
    ) {
      lastHighIntentAt = signal.lastActivityAt;
    }
  }

  return {
    highIntentCount,
    lastHighIntentAt,
    attributedConversations: signals.length,
  };
}

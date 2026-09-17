/**
 * `summariseConversationsThisWeek` — aggregation feed for the operator-facing
 * Claire-Owner skill `manage-customer-chats` (Phase 2 / Track C-09).
 *
 * Produces a structured rollup of customer-facing conversations over a
 * trailing window (default 7 days). The model formats prose; this service
 * stays deterministic.
 *
 * The brief's output shape (`docs/implementations/claire-briefs/window-c09-services.md`):
 *   counts.{totalThreads, openThreads, escalatedThreads, closedThreads}
 *   byChannel.{whatsapp, facebook_messenger, instagram_dm}
 *   topIntents: Array<{ intent, count }>      ← omitted (no intent tagging on messages)
 *   responseTime.{p50Ms, p95Ms}
 *   oldestPending: { conversationId, customerName, hoursPending } | null
 *
 * Performance: SQL-side aggregation only — no row-level loads into Node.
 * Four queries are dispatched in parallel. For a typical clinic
 * (≤100 active conversations / ≤5k messages per week) this is well under
 * 50ms. Larger orgs may eventually want a snapshot table — flagged in
 * handoff.
 *
 * @see docs/implementations/claire-briefs/window-c09-services.md
 * @see docs/implementations/claire-briefs/track-c09.md (§Step 2)
 */

import {
  conversation,
  conversationMessage,
  sql,
} from '@borradh-workspace/database';
import { withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  DEFAULT_SUMMARISE_WINDOW_DAYS,
  type SummariseConversationsThisWeekInput,
  summariseConversationsThisWeekSchema,
} from './summarise-this-week.schema.js';

export interface SummariseConversationsThisWeekOutput {
  /** Effective resolved window — both bounds reflected back so the model can
   *  cite "this past 7 days" or whatever the operator asked for. */
  timeframe: { since: string; until: string };
  counts: {
    totalThreads: number;
    /** active + bot_handling + agent_handling. */
    openThreads: number;
    /** agent_handling only — the v2 escalation status. */
    escalatedThreads: number;
    /** closed + expired. */
    closedThreads: number;
  };
  byChannel: {
    whatsapp: number;
    facebook_messenger: number;
    instagram_dm: number;
  };
  /**
   * Per-conversation intent tagging isn't currently captured on
   * `conversationMessage` rows. We return an empty list rather than
   * fabricating one — see brief discoveries protocol. Track C-13's
   * operational-snapshot work is the most natural place to add intent
   * tagging downstream; until then this stays empty.
   */
  topIntents: Array<{ intent: string; count: number }>;
  /** Bot/agent reply latency over user→reply pairs in the window. Returns
   *  zeros when the window has no qualifying pairs (cleaner than nulls for
   *  the model to format). */
  responseTime: { p50Ms: number; p95Ms: number };
  oldestPending: {
    conversationId: string;
    customerName: string | null;
    hoursPending: number;
  } | null;
}

interface CountsRow {
  total_threads: number;
  open_threads: number;
  escalated_threads: number;
  closed_threads: number;
}

interface ChannelRow {
  platform: string;
  count: number;
}

interface ResponseTimeRow {
  p50_ms: number | null;
  p95_ms: number | null;
}

interface OldestPendingRow {
  conversation_id: string;
  customer_name: string | null;
  hours_pending: number;
}

const summariseConversationsThisWeekImpl = async (
  db: DbConnection,
  input: SummariseConversationsThisWeekInput
): Promise<Result<SummariseConversationsThisWeekOutput>> => {
  const parsed = summariseConversationsThisWeekSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;
  const until = parsed.data.until ?? new Date();
  const since =
    parsed.data.since ??
    new Date(
      until.getTime() - DEFAULT_SUMMARISE_WINDOW_DAYS * 24 * 60 * 60 * 1000
    );
  // postgres-js can't bind JS `Date` objects to raw-SQL placeholders
  // (`db.execute(sql\`…${date}…\`)` calls `Buffer.byteLength(date)` which
  // throws `ERR_INVALID_ARG_TYPE`). Pre-format as ISO strings; the columns
  // we compare against are timestamps and the driver coerces ISO strings
  // server-side.
  const sinceParam = since.toISOString();
  const untilParam = until.toISOString();

  // Conversation activity-in-window predicate. Uses snake_case column names
  // bound to a table alias (`c`) — matches the established SQL-template
  // pattern in `packages/features/src/assistant/triggers/`.
  // last_message_at falls back to created_at when null (a freshly-created
  // conversation that hasn't received its first message yet).
  let countsRows: unknown;
  let channelRows: unknown;
  let responseTimeRows: unknown;
  let oldestPendingRows: unknown;
  try {
    [countsRows, channelRows, responseTimeRows, oldestPendingRows] =
      await Promise.all([
        db.execute(sql`
        SELECT
          COUNT(*)::int AS total_threads,
          COUNT(*) FILTER (WHERE c.status IN ('active', 'bot_handling', 'agent_handling'))::int AS open_threads,
          COUNT(*) FILTER (WHERE c.status = 'agent_handling')::int AS escalated_threads,
          COUNT(*) FILTER (WHERE c.status IN ('closed', 'expired'))::int AS closed_threads
        FROM ${conversation} c
        WHERE c.organization_id = ${organizationId}
          AND COALESCE(c.last_message_at, c.created_at) >= ${sinceParam}
          AND COALESCE(c.last_message_at, c.created_at) < ${untilParam}
      `),
        db.execute(sql`
        SELECT c.platform AS platform, COUNT(*)::int AS count
        FROM ${conversation} c
        WHERE c.organization_id = ${organizationId}
          AND COALESCE(c.last_message_at, c.created_at) >= ${sinceParam}
          AND COALESCE(c.last_message_at, c.created_at) < ${untilParam}
        GROUP BY c.platform
      `),
        // Response time: for each user message in the window, find the next
        // message in the same conversation. If that next message is from a
        // bot or agent, record the gap (ms). Compute percentiles across all
        // such gaps. Returns 0/0 when no qualifying pairs exist.
        db.execute(sql`
        WITH msg_with_next AS (
          SELECT
            cm.role AS role,
            COALESCE(cm.sent_at, cm.created_at) AS msg_at,
            LEAD(cm.role) OVER (
              PARTITION BY cm.conversation_id
              ORDER BY COALESCE(cm.sent_at, cm.created_at)
            ) AS next_role,
            LEAD(COALESCE(cm.sent_at, cm.created_at)) OVER (
              PARTITION BY cm.conversation_id
              ORDER BY COALESCE(cm.sent_at, cm.created_at)
            ) AS next_msg_at
          FROM ${conversationMessage} cm
          INNER JOIN ${conversation} c ON c.id = cm.conversation_id
          WHERE c.organization_id = ${organizationId}
            AND COALESCE(cm.sent_at, cm.created_at) >= ${sinceParam}
            AND COALESCE(cm.sent_at, cm.created_at) < ${untilParam}
        ),
        gaps AS (
          SELECT EXTRACT(EPOCH FROM (next_msg_at - msg_at)) * 1000 AS gap_ms
          FROM msg_with_next
          WHERE role = 'user'
            AND next_role IN ('bot', 'agent')
            AND next_msg_at IS NOT NULL
        )
        SELECT
          COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_ms), 0)::bigint::int AS p50_ms,
          COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY gap_ms), 0)::bigint::int AS p95_ms
        FROM gaps
      `),
        // Oldest pending: the open conversation whose most-recent message is
        // from the customer, with the earliest last_message_at. Not bound by
        // the time window (it's "what's still waiting", not "what came in
        // this week"). Returns at most one row.
        db.execute(sql`
        SELECT
          c.id AS conversation_id,
          c.external_user_name AS customer_name,
          EXTRACT(EPOCH FROM (NOW() - c.last_message_at)) / 3600 AS hours_pending
        FROM ${conversation} c
        WHERE c.organization_id = ${organizationId}
          AND c.status IN ('active', 'bot_handling')
          AND c.last_message_at IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM ${conversationMessage} cm
            WHERE cm.conversation_id = c.id
              AND cm.role = 'user'
              AND COALESCE(cm.sent_at, cm.created_at) = (
                SELECT MAX(COALESCE(cm2.sent_at, cm2.created_at))
                FROM ${conversationMessage} cm2
                WHERE cm2.conversation_id = c.id
              )
          )
        ORDER BY c.last_message_at ASC
        LIMIT 1
      `),
      ]);
  } catch (error) {
    logError('conversations.summariseThisWeek', error, {
      feature: 'conversations',
      extra: { organizationId, since, until },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        "Failed to summarise this week's conversations"
      )
    );
  }

  // drizzle's `db.execute()` returns rows directly (postgres-js driver). The
  // chained generic above types each row; we cast through unknown to keep
  // unit-test mock shapes flexible.
  const counts = (countsRows as unknown as CountsRow[])[0] ?? {
    total_threads: 0,
    open_threads: 0,
    escalated_threads: 0,
    closed_threads: 0,
  };
  const channels = (channelRows as unknown as ChannelRow[]) ?? [];
  const rt = (responseTimeRows as unknown as ResponseTimeRow[])[0] ?? {
    p50_ms: 0,
    p95_ms: 0,
  };
  const oldest = (oldestPendingRows as unknown as OldestPendingRow[])[0];

  // Channel rollup keyed by `messagingPlatformValues`. Unknown platforms
  // (legacy or new) are ignored at this aggregation layer — the model's
  // prose talks about the three channels we ship.
  const byChannel = {
    whatsapp: 0,
    facebook_messenger: 0,
    instagram_dm: 0,
  };
  for (const row of channels) {
    if (row.platform === 'whatsapp') byChannel.whatsapp = row.count;
    else if (row.platform === 'facebook_messenger') {
      byChannel.facebook_messenger = row.count;
    } else if (row.platform === 'instagram_dm') {
      byChannel.instagram_dm = row.count;
    }
  }

  return ok({
    timeframe: { since: since.toISOString(), until: until.toISOString() },
    counts: {
      totalThreads: counts.total_threads,
      openThreads: counts.open_threads,
      escalatedThreads: counts.escalated_threads,
      closedThreads: counts.closed_threads,
    },
    byChannel,
    topIntents: [],
    responseTime: {
      p50Ms: rt.p50_ms ?? 0,
      p95Ms: rt.p95_ms ?? 0,
    },
    oldestPending: oldest
      ? {
          conversationId: oldest.conversation_id,
          customerName: oldest.customer_name,
          // Postgres returns numeric for EXTRACT-based expressions; coerce
          // to a clean rounded integer so the model formats "12 hours" not
          // "12.0034 hours".
          hoursPending: Math.round(Number(oldest.hours_pending)),
        }
      : null,
  });
};

export const summariseConversationsThisWeek = (
  db: DbConnection,
  input: SummariseConversationsThisWeekInput
) =>
  trackedResult(
    'conversations.summariseThisWeek',
    () =>
      withOrgScope((tx) => summariseConversationsThisWeekImpl(tx, input), {
        db,
      }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type SummariseConversationsThisWeekResult = Awaited<
  ReturnType<typeof summariseConversationsThisWeek>
>;

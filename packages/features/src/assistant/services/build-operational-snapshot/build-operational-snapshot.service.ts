import {
  appointment,
  conversation,
  lead,
  metaCampaignDailyInsights,
  offer,
  socialPost,
  sql,
} from '@borradh-workspace/database';
import { activeAppointmentStatuses } from '@borradh-workspace/labels';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq, gte, lt } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { generateEmbedding } from '../../knowledge/embed.js';
import {
  type BuildOperationalSnapshotInput,
  type BuildOperationalSnapshotOutput,
  buildOperationalSnapshotSchema,
} from './build-operational-snapshot.schema.js';

/**
 * Nightly operational snapshot writer (W-C13-operational-snapshots).
 *
 * Produces one `knowledge_entry` row per org per day with
 * `type: 'operational_snapshot'`, scope `(orgId, null)` — org-wide, visible
 * to every user in the org via `queryKnowledge` (post-W-C13-schema).
 *
 * Five aggregation feeds are pulled in parallel from local tables (no
 * external API calls — the cron must complete fast for hundreds of orgs):
 *   - **Leads** — counts (this-week / prior-week) + by-status + by-source +
 *     top 5 most-recent.
 *   - **Appointments** — counts (today / this-week scheduled / cancelled /
 *     no-show), straight from `appointment` (no per-practitioner detail —
 *     that's the tool's job; the snapshot stays aggregate-only per
 *     window-c13 sub-decision 3).
 *   - **Customer chats** — open / escalated thread counts + oldest pending.
 *     Cheap version of `summariseConversationsThisWeek` — we don't need
 *     percentile latencies for the snapshot, just counts.
 *   - **Offers** — active offer count + soonest-to-expire.
 *   - **Ads (last 7d)** — spend (USD) + leads + impressions, summed across
 *     all `meta_campaign_daily_insights` rows for the org. Local-table read
 *     only; per sub-decision 4 the cron runs at 04:30 UTC after
 *     `handleCampaignInsightsSync` at 04:00.
 *
 * Prose is **deterministic templated** — no LLM. The window's gotcha calls
 * this out: structured templates keep snapshots cheap and replayable in
 * tests; the only OpenAI call is the embedding (one per org per day).
 *
 * Idempotent on rerun: same-day snapshots are deleted before insert, so
 * the cron firing twice on a given day produces exactly one row. Old
 * snapshots get a 7-day `expires_at` — `queryKnowledge` halves their
 * similarity score after expiry so they rank low without needing a
 * separate cleanup cron.
 */
const buildOperationalSnapshotImpl = async (
  db: DbConnection,
  input: BuildOperationalSnapshotInput
): Promise<Result<BuildOperationalSnapshotOutput>> => {
  const parsed = buildOperationalSnapshotSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;
  const now = parsed.data.now ?? new Date();
  const todayStart = startOfDayUtc(now);
  const todayEnd = addDays(todayStart, 1);
  const tomorrowEnd = addDays(todayStart, 2);
  const sevenDaysAgo = addDays(todayStart, -7);
  const fourteenDaysAgo = addDays(todayStart, -14);

  // All 5 reads in parallel — no cross-feed dependency. drizzle-orm's
  // postgres-js driver pipelines them on the same connection.
  let leadFeed: LeadFeed;
  let appointmentFeed: AppointmentFeed;
  let chatFeed: ChatFeed;
  let offerFeed: OfferFeed;
  let adFeed: AdFeed;
  try {
    [leadFeed, appointmentFeed, chatFeed, offerFeed, adFeed] =
      await Promise.all([
        readLeadFeed(db, organizationId, sevenDaysAgo, fourteenDaysAgo, now),
        readAppointmentFeed(db, organizationId, todayStart, tomorrowEnd, now),
        readChatFeed(db, organizationId, sevenDaysAgo, now),
        readOfferFeed(db, organizationId, now),
        readAdFeed(db, organizationId, sevenDaysAgo, todayEnd),
      ]);
  } catch (error) {
    logError('assistant.buildOperationalSnapshot.read', error, {
      feature: 'assistant',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to read operational data for snapshot'
      )
    );
  }

  const structured = {
    capturedAt: now.toISOString(),
    leads: leadFeed,
    appointments: appointmentFeed,
    customerChats: chatFeed,
    offers: offerFeed,
    ads: adFeed,
  };

  const prose = renderSnapshotProse(structured);

  let embeddingStr: string;
  try {
    const embedding = await generateEmbedding(prose);
    embeddingStr = `[${embedding.join(',')}]`;
  } catch (error) {
    logError('assistant.buildOperationalSnapshot.embed', error, {
      feature: 'assistant',
      extra: { organizationId },
    });
    return ok({ knowledgeEntryId: null, skipReason: 'embedding_failed' });
  }

  // 7-day expiry — `queryKnowledge` halves similarity for expired entries.
  // ISO-stringify all Date params below: raw `Date` values in a
  // `db.execute(sql\`…\`)` template make postgres-js call
  // `Buffer.byteLength(date)` and throw `ERR_INVALID_ARG_TYPE`. The target
  // columns are timestamps, so the driver coerces ISO strings server-side.
  const expiresAtParam = addDays(now, 7).toISOString();
  const todayStartParam = todayStart.toISOString();
  const todayEndParam = todayEnd.toISOString();

  // Delete same-day snapshots first so reruns produce exactly one row per
  // (org, day). We delete on `created_at::date = today` so multiple runs in
  // the same UTC day collapse — the brief's "Idempotent: replace if today's
  // exists" requirement.
  const metadataJson = JSON.stringify(structured);
  try {
    await db.execute(sql`
      DELETE FROM knowledge_entry
      WHERE organization_id = ${organizationId}
        AND user_id IS NULL
        AND type = 'operational_snapshot'
        AND created_at >= ${todayStartParam}
        AND created_at < ${todayEndParam}
    `);

    const inserted = await db.execute<{ id: string }>(sql`
      INSERT INTO knowledge_entry (
        id, organization_id, user_id, type, title, content,
        embedding, source, confidence, expires_at, metadata,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(),
        ${organizationId},
        NULL,
        'operational_snapshot',
        ${buildTitle(now)},
        ${prose},
        ${embeddingStr}::vector,
        'auto',
        1.0,
        ${expiresAtParam},
        ${metadataJson}::jsonb,
        NOW(),
        NOW()
      )
      RETURNING id
    `);

    const row = inserted[0];
    if (!row) {
      return ok({ knowledgeEntryId: null, skipReason: 'insert_failed' });
    }

    return ok({ knowledgeEntryId: row.id });
  } catch (error) {
    logError('assistant.buildOperationalSnapshot.write', error, {
      feature: 'assistant',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to write operational snapshot'
      )
    );
  }
};

export const buildOperationalSnapshot = (
  db: DbConnection,
  input: BuildOperationalSnapshotInput
) =>
  trackedResult(
    'assistant.buildOperationalSnapshot',
    () => buildOperationalSnapshotImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type BuildOperationalSnapshotResult = Awaited<
  ReturnType<typeof buildOperationalSnapshot>
>;

// ---------------------------------------------------------------------------
// Aggregation feeds (one read per feed; templated prose pulls from these)
// ---------------------------------------------------------------------------

interface LeadFeed {
  thisWeekTotal: number;
  priorWeekTotal: number;
  deltaPercent: number;
  byStatus: Record<string, number>;
  bySource: Record<string, number>;
  topRecent: Array<{
    firstName: string;
    lastName: string | null;
    status: string;
    source: string;
  }>;
}

const readLeadFeed = async (
  db: DbConnection,
  organizationId: string,
  sevenDaysAgo: Date,
  fourteenDaysAgo: Date,
  now: Date
): Promise<LeadFeed> => {
  const [thisWeekRows, priorWeekCountRow, topRecent] = await Promise.all([
    db
      .select({
        status: lead.status,
        source: lead.source,
        count: sql<number>`count(*)::int`.as('count'),
      })
      .from(lead)
      .where(
        and(
          eq(lead.organizationId, organizationId),
          notDeleted(lead),
          gte(lead.createdAt, sevenDaysAgo)
        )
      )
      .groupBy(lead.status, lead.source),
    db
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(lead)
      .where(
        and(
          eq(lead.organizationId, organizationId),
          notDeleted(lead),
          gte(lead.createdAt, fourteenDaysAgo),
          lt(lead.createdAt, sevenDaysAgo)
        )
      ),
    db.query.lead.findMany({
      where: and(
        eq(lead.organizationId, organizationId),
        notDeleted(lead),
        gte(lead.createdAt, sevenDaysAgo)
      ),
      orderBy: desc(lead.createdAt),
      limit: 5,
      columns: {
        firstName: true,
        lastName: true,
        status: true,
        source: true,
      },
    }),
  ]);

  const thisWeekTotal = thisWeekRows.reduce((sum, r) => sum + r.count, 0);
  const priorWeekTotal = priorWeekCountRow[0]?.count ?? 0;

  // We don't currently use `now` in the lead window — kept on the signature
  // so the cron can pass a deterministic clock and the test fixtures replay.
  void now;

  const byStatus: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  for (const row of thisWeekRows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + row.count;
    bySource[row.source] = (bySource[row.source] ?? 0) + row.count;
  }

  const deltaPercent =
    priorWeekTotal === 0
      ? thisWeekTotal > 0
        ? 100
        : 0
      : Math.round(((thisWeekTotal - priorWeekTotal) / priorWeekTotal) * 100);

  return {
    thisWeekTotal,
    priorWeekTotal,
    deltaPercent,
    byStatus,
    bySource,
    topRecent,
  };
};

interface AppointmentFeed {
  todayScheduled: number;
  todayCompleted: number;
  todayCancelled: number;
  todayNoShow: number;
  tomorrowScheduled: number;
}

const readAppointmentFeed = async (
  db: DbConnection,
  organizationId: string,
  todayStart: Date,
  tomorrowEnd: Date,
  now: Date
): Promise<AppointmentFeed> => {
  // Single grouped read across today + tomorrow; in-memory split.
  const rows = await db
    .select({
      day: sql<string>`date_trunc('day', ${appointment.startDate})::date`.as(
        'day'
      ),
      status: appointment.status,
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(appointment)
    .where(
      and(
        eq(appointment.organizationId, organizationId),
        notDeleted(appointment),
        gte(appointment.startDate, todayStart),
        lt(appointment.startDate, tomorrowEnd)
      )
    )
    .groupBy(
      sql`date_trunc('day', ${appointment.startDate})::date`,
      appointment.status
    );

  const todayKey = formatDateKey(todayStart);
  const tomorrowKey = formatDateKey(addDays(todayStart, 1));

  void now;

  const counts = {
    todayScheduled: 0,
    todayCompleted: 0,
    todayCancelled: 0,
    todayNoShow: 0,
    tomorrowScheduled: 0,
  };

  for (const row of rows) {
    // postgres-js returns date columns as `Date | string`; normalise.
    const dayKey = formatDateKey(new Date(row.day));
    if (dayKey === todayKey) {
      if ((activeAppointmentStatuses as readonly string[]).includes(row.status))
        counts.todayScheduled += row.count;
      else if (row.status === 'completed') counts.todayCompleted += row.count;
      else if (row.status === 'cancelled') counts.todayCancelled += row.count;
      else if (row.status === 'no_show') counts.todayNoShow += row.count;
    } else if (
      dayKey === tomorrowKey &&
      (activeAppointmentStatuses as readonly string[]).includes(row.status)
    ) {
      counts.tomorrowScheduled += row.count;
    }
  }

  return counts;
};

interface ChatFeed {
  totalThisWeek: number;
  openNow: number;
  escalatedNow: number;
  oldestPendingHours: number | null;
}

const readChatFeed = async (
  db: DbConnection,
  organizationId: string,
  sevenDaysAgo: Date,
  now: Date
): Promise<ChatFeed> => {
  // One scalar query — the snapshot only needs counts + oldest-pending-age.
  // We deliberately don't compute response-time percentiles (that's
  // `summariseConversationsThisWeek`'s job).
  //
  // Pre-format Date params as ISO strings: passing a raw `Date` into a
  // `db.execute(sql\`…\`)` template makes the postgres-js driver call
  // `Buffer.byteLength(date)`, which throws `ERR_INVALID_ARG_TYPE`
  // ("Received an instance of Date"). The columns compared against are
  // timestamps and the driver coerces ISO strings server-side.
  const sevenDaysAgoParam = sevenDaysAgo.toISOString();
  const nowParam = now.toISOString();
  const rows = await db.execute<{
    total_this_week: number;
    open_now: number;
    escalated_now: number;
    oldest_pending_hours: number | null;
  }>(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE COALESCE(c.last_message_at, c.created_at) >= ${sevenDaysAgoParam}
      )::int AS total_this_week,
      COUNT(*) FILTER (
        WHERE c.status IN ('active', 'bot_handling', 'agent_handling')
      )::int AS open_now,
      COUNT(*) FILTER (
        WHERE c.status = 'agent_handling'
      )::int AS escalated_now,
      MAX(EXTRACT(EPOCH FROM (${nowParam}::timestamptz - c.last_message_at)) / 3600)
        FILTER (
          WHERE c.status IN ('active', 'bot_handling')
            AND c.last_message_at IS NOT NULL
        )::float AS oldest_pending_hours
    FROM ${conversation} c
    WHERE c.organization_id = ${organizationId}
  `);

  const row = (
    rows as unknown as Array<{
      total_this_week: number;
      open_now: number;
      escalated_now: number;
      oldest_pending_hours: number | null;
    }>
  )[0];

  return {
    totalThisWeek: Number(row?.total_this_week ?? 0),
    openNow: Number(row?.open_now ?? 0),
    escalatedNow: Number(row?.escalated_now ?? 0),
    oldestPendingHours:
      row?.oldest_pending_hours == null
        ? null
        : Math.round(Number(row.oldest_pending_hours)),
  };
};

interface OfferFeed {
  activeCount: number;
  soonestExpiring: {
    name: string;
    daysUntilExpiry: number;
  } | null;
}

const readOfferFeed = async (
  db: DbConnection,
  organizationId: string,
  now: Date
): Promise<OfferFeed> => {
  const rows = await db.query.offer.findMany({
    where: and(
      eq(offer.organizationId, organizationId),
      eq(offer.state, 'active'),
      notDeleted(offer)
    ),
    columns: { name: true, validUntil: true },
  });

  let soonest: { name: string; validUntil: Date } | null = null;
  for (const row of rows) {
    if (!row.validUntil) continue;
    const candidate = { name: row.name, validUntil: row.validUntil };
    if (!soonest || candidate.validUntil < soonest.validUntil) {
      soonest = candidate;
    }
  }

  const soonestExpiring = soonest
    ? {
        name: soonest.name,
        daysUntilExpiry: Math.max(
          0,
          Math.round(
            (soonest.validUntil.getTime() - now.getTime()) /
              (24 * 60 * 60 * 1000)
          )
        ),
      }
    : null;

  return {
    activeCount: rows.length,
    soonestExpiring,
  };
};

interface AdFeed {
  spendUsdLast7d: number;
  leadsLast7d: number;
  impressionsLast7d: number;
  publishedPostsLast7d: number;
}

const readAdFeed = async (
  db: DbConnection,
  organizationId: string,
  sevenDaysAgo: Date,
  todayEnd: Date
): Promise<AdFeed> => {
  // `meta_campaign_daily_insights` is populated nightly at 04:00 UTC by the
  // existing scheduler; the snapshot cron runs at 04:30 UTC so the data is
  // fresh. spend_usd is in cents — divide once at the prose layer.
  const [adRow, postRow] = await Promise.all([
    db
      .select({
        spendUsdCents:
          sql<number>`COALESCE(SUM(${metaCampaignDailyInsights.spendUsd}), 0)::int`.as(
            'spend_usd_cents'
          ),
        leads:
          sql<number>`COALESCE(SUM(${metaCampaignDailyInsights.leads}), 0)::int`.as(
            'leads'
          ),
        impressions:
          sql<number>`COALESCE(SUM(${metaCampaignDailyInsights.impressions}), 0)::int`.as(
            'impressions'
          ),
      })
      .from(metaCampaignDailyInsights)
      .where(
        and(
          eq(metaCampaignDailyInsights.organizationId, organizationId),
          gte(metaCampaignDailyInsights.date, sevenDaysAgo),
          lt(metaCampaignDailyInsights.date, todayEnd)
        )
      ),
    db
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(socialPost)
      .where(
        and(
          eq(socialPost.organizationId, organizationId),
          eq(socialPost.status, 'published'),
          gte(socialPost.publishedAt, sevenDaysAgo)
        )
      ),
  ]);

  return {
    spendUsdLast7d: adRow[0]?.spendUsdCents ?? 0,
    leadsLast7d: adRow[0]?.leads ?? 0,
    impressionsLast7d: adRow[0]?.impressions ?? 0,
    publishedPostsLast7d: postRow[0]?.count ?? 0,
  };
};

// ---------------------------------------------------------------------------
// Templated prose (deterministic — no LLM)
// ---------------------------------------------------------------------------

interface SnapshotShape {
  capturedAt: string;
  leads: LeadFeed;
  appointments: AppointmentFeed;
  customerChats: ChatFeed;
  offers: OfferFeed;
  ads: AdFeed;
}

/**
 * Render the structured snapshot into ~300-word prose the embedder can
 * consume. Section order is locked: leads → ads → appointments → chats →
 * offers — same pattern the `weekly-marketing-review` skill uses (claire.md
 * §4 C-15) so retrieval surfaces consistent context regardless of which
 * skill called.
 *
 * Empty-state orgs (no leads, no ads, no posts) get a "Nothing to report"
 * snapshot rather than a row of zeros — the brief calls this out as a
 * valid path. Embeddings are cheap enough (one per org per day) that we
 * always write *something*; downstream retrieval ranks empty snapshots
 * naturally low because of the lower keyword density.
 */
function renderSnapshotProse(snap: SnapshotShape): string {
  const parts: string[] = [];

  parts.push('Operational snapshot — daily rollup of org activity.');

  // Leads
  if (snap.leads.thisWeekTotal === 0 && snap.leads.priorWeekTotal === 0) {
    parts.push('Leads (last 7 days): none.');
  } else {
    const delta = formatDelta(snap.leads.deltaPercent);
    const statusSummary = topThreeFrom(snap.leads.byStatus);
    const sourceSummary = topThreeFrom(snap.leads.bySource);
    const topNames = snap.leads.topRecent
      .map((l) => (l.lastName ? `${l.firstName} ${l.lastName}` : l.firstName))
      .join(', ');
    const leadParts: string[] = [
      `Leads (last 7 days): ${snap.leads.thisWeekTotal} new (${delta} vs prior week, was ${snap.leads.priorWeekTotal}).`,
    ];
    if (statusSummary) leadParts.push(`By status: ${statusSummary}.`);
    if (sourceSummary) leadParts.push(`By source: ${sourceSummary}.`);
    if (topNames) leadParts.push(`Most recent: ${topNames}.`);
    parts.push(leadParts.join(' '));
  }

  // Ads (last 7d)
  if (
    snap.ads.spendUsdLast7d === 0 &&
    snap.ads.leadsLast7d === 0 &&
    snap.ads.publishedPostsLast7d === 0
  ) {
    parts.push('Ads & content (last 7 days): no spend, no posts.');
  } else {
    const spendUsd = (snap.ads.spendUsdLast7d / 100).toFixed(2);
    parts.push(
      `Ads & content (last 7 days): $${spendUsd} spend, ${snap.ads.leadsLast7d} ad-attributed leads, ${formatCompactNumber(snap.ads.impressionsLast7d)} impressions, ${snap.ads.publishedPostsLast7d} posts published.`
    );
  }

  // Appointments
  const apptParts: string[] = [];
  if (snap.appointments.todayScheduled > 0) {
    apptParts.push(`${snap.appointments.todayScheduled} scheduled today`);
  }
  if (snap.appointments.todayCancelled > 0) {
    apptParts.push(`${snap.appointments.todayCancelled} cancelled today`);
  }
  if (snap.appointments.todayNoShow > 0) {
    apptParts.push(`${snap.appointments.todayNoShow} no-show today`);
  }
  if (snap.appointments.tomorrowScheduled > 0) {
    apptParts.push(`${snap.appointments.tomorrowScheduled} scheduled tomorrow`);
  }
  parts.push(
    apptParts.length === 0
      ? 'Appointments: nothing on the books for today or tomorrow.'
      : `Appointments: ${apptParts.join(', ')}.`
  );

  // Customer chats
  if (
    snap.customerChats.openNow === 0 &&
    snap.customerChats.totalThisWeek === 0
  ) {
    parts.push('Customer chats: no open threads.');
  } else {
    const escalatedClause =
      snap.customerChats.escalatedNow > 0
        ? `, ${snap.customerChats.escalatedNow} escalated`
        : '';
    const oldestClause =
      snap.customerChats.oldestPendingHours != null
        ? ` Oldest pending thread: ${snap.customerChats.oldestPendingHours}h.`
        : '';
    parts.push(
      `Customer chats: ${snap.customerChats.openNow} open${escalatedClause}; ${snap.customerChats.totalThisWeek} active in the last 7 days.${oldestClause}`
    );
  }

  // Offers
  if (snap.offers.activeCount === 0) {
    parts.push('Offers: none active.');
  } else {
    const expiringClause = snap.offers.soonestExpiring
      ? ` Soonest expiry: "${snap.offers.soonestExpiring.name}" in ${snap.offers.soonestExpiring.daysUntilExpiry} day${snap.offers.soonestExpiring.daysUntilExpiry === 1 ? '' : 's'}.`
      : '';
    parts.push(`Offers: ${snap.offers.activeCount} active.${expiringClause}`);
  }

  return parts.join(' ');
}

function buildTitle(now: Date): string {
  return `Operational snapshot — ${formatDateKey(now)}`;
}

function topThreeFrom(record: Record<string, number>): string {
  const sorted = Object.entries(record)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  return sorted.map(([k, v]) => `${k}: ${v}`).join(', ');
}

function formatDelta(deltaPercent: number): string {
  if (deltaPercent === 0) return 'flat';
  const sign = deltaPercent > 0 ? '+' : '';
  return `${sign}${deltaPercent}%`;
}

function formatCompactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ---------------------------------------------------------------------------
// Date helpers (UTC — the cron is fixed at 04:30 UTC per locked sub-decision 4)
// ---------------------------------------------------------------------------

function startOfDayUtc(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function formatDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

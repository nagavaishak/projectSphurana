import {
  conversation,
  conversationMessage,
  lead,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type SQL,
  and,
  arrayOverlaps,
  asc,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { leadAtBranch } from '../../shared/at-branch.js';
import { derivedLeadStage, derivedStageInTab } from '../lead-stage/index.js';
import { type ListLeadsInput, listLeadsSchema } from './list-leads.schema.js';

/**
 * Internal implementation of list leads
 */
const listLeadsImpl = async (db: DbConnection, input: ListLeadsInput) => {
  // Validate input
  const parsed = listLeadsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Build where conditions
  const conditions: SQL[] = [
    eq(lead.organizationId, parsed.data.organizationId),
    notDeleted(lead),
  ];

  if (parsed.data.status) {
    conditions.push(eq(lead.status, parsed.data.status));
  }

  // Tab filter, on the DERIVED stage (`derived-stage.ts`) — the same expression
  // the tab badges count. `all` (and omitted) means no stage filter: the "All"
  // tab must show every stage, including `lost`, which has no tab of its own.
  if (parsed.data.stageGroup && parsed.data.stageGroup !== 'all') {
    conditions.push(derivedStageInTab(parsed.data.stageGroup));
  }

  if (parsed.data.source) {
    conditions.push(eq(lead.source, parsed.data.source));
  }

  if (parsed.data.assignedToId) {
    conditions.push(eq(lead.assignedToId, parsed.data.assignedToId));
  }

  // Branch scoping — see `leadAtBranch` for why this is three-armed rather
  // than `primary_location_id = ?`. Shared with `get-lead-stage-counts` so the
  // tab badges and the rows under them cannot disagree.
  if (parsed.data.locationId) {
    conditions.push(leadAtBranch(db, parsed.data.locationId));
  }

  if (parsed.data.sequenceId) {
    conditions.push(eq(lead.sequenceId, parsed.data.sequenceId));
  }

  if (parsed.data.tags && parsed.data.tags.length > 0) {
    conditions.push(arrayOverlaps(lead.tags, parsed.data.tags));
  }

  // Treat empty string as "no email" too — imported rows commonly carry ''
  // rather than NULL, and those are just as unable to sign in.
  if (parsed.data.hasEmail !== undefined) {
    const emailCondition = parsed.data.hasEmail
      ? and(isNotNull(lead.email), ne(lead.email, ''))
      : or(isNull(lead.email), eq(lead.email, ''));
    if (emailCondition) {
      conditions.push(emailCondition);
    }
  }

  if (parsed.data.consentEmail !== undefined) {
    conditions.push(eq(lead.consentEmail, parsed.data.consentEmail));
  }

  if (parsed.data.consentSms !== undefined) {
    conditions.push(eq(lead.consentSms, parsed.data.consentSms));
  }

  if (parsed.data.consentVoice !== undefined) {
    conditions.push(eq(lead.consentVoice, parsed.data.consentVoice));
  }

  // Search across name, email, phone. Multi-word queries like
  // "Daniel Cerasi" must also match the concatenated full name — otherwise
  // OR-ing across single fields finds nothing because no single column
  // holds the full string.
  if (parsed.data.search) {
    const searchTerm = `%${parsed.data.search}%`;
    const fullName = sql`COALESCE(${lead.firstName}, '') || ' ' || COALESCE(${lead.lastName}, '')`;
    const searchCondition = or(
      ilike(lead.firstName, searchTerm),
      ilike(lead.lastName, searchTerm),
      ilike(lead.email, searchTerm),
      ilike(lead.phone, searchTerm),
      ilike(fullName, searchTerm)
    );
    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }

  if (parsed.data.createdFrom) {
    conditions.push(gte(lead.createdAt, new Date(parsed.data.createdFrom)));
  }
  if (parsed.data.createdTo) {
    conditions.push(lte(lead.createdAt, new Date(parsed.data.createdTo)));
  }
  if (parsed.data.lastContactedAfter) {
    conditions.push(
      gte(lead.lastContactedAt, new Date(parsed.data.lastContactedAfter))
    );
  }
  if (parsed.data.lastContactedBefore) {
    conditions.push(
      lte(lead.lastContactedAt, new Date(parsed.data.lastContactedBefore))
    );
  }

  const { limit, offset } = parsed.data;
  const whereClause = and(...conditions);

  // Default order: real records first (list_rank 0), newest first; message-only
  // (PSID-only) contacts fall to the tail (list_rank 1).
  //
  // WHEN SEARCHING, drop list_rank from the ORDER BY. Otherwise an exact name
  // match on a message-only contact sorts behind every other match, which reads
  // as "search is broken". A set `search` narrows the result enough that recency
  // alone is the right order.
  //
  // Otherwise the `sort` param picks the ordering (see the schema). The default
  // (unset) preserves the historical order so non-Clients callers are untouched.
  const recencyOrder: SQL[] = [asc(lead.listRank), desc(lead.createdAt)];
  let orderBy: SQL[];
  if (parsed.data.search) {
    orderBy = [desc(lead.createdAt)];
  } else {
    switch (parsed.data.sort) {
      case 'smart': {
        // A lead has an unread inbound message when a conversation linked to it
        // (via the indexed `conversation.lead_id` FK) holds a `user`-role
        // message we have not marked read.
        const hasUnreadInbound = sql`EXISTS (
          SELECT 1
          FROM ${conversation} c
          JOIN ${conversationMessage} m ON m."conversation_id" = c."id"
          WHERE c."lead_id" = ${lead.id}
            AND c."organization_id" = ${lead.organizationId}
            AND m."role" = 'user'
            AND m."read_at" IS NULL
        )`;
        // Buckets read the DERIVED stage, not `lead.status`. Ranking on the
        // stored column would sort a lead into a bucket that disagrees with the
        // stage badge rendered beside it, since the badge and the tab filter
        // both derive (see `derived-stage.ts`).
        orderBy = [
          sql`CASE
            WHEN ${derivedLeadStage()} = 'qualified' THEN 0
            WHEN ${derivedLeadStage()} = 'booked' THEN 1
            WHEN ${hasUnreadInbound} THEN 2
            ELSE 3
          END`,
          asc(lead.listRank),
          desc(lead.createdAt),
        ];
        break;
      }
      case 'oldest':
        orderBy = [asc(lead.listRank), asc(lead.createdAt)];
        break;
      case 'name':
        orderBy = [
          asc(
            sql`lower(coalesce(${lead.firstName}, '') || ' ' || coalesce(${lead.lastName}, ''))`
          ),
        ];
        break;
      case 'last_visit':
        orderBy = [
          sql`${lead.lastVisitAt} DESC NULLS LAST`,
          desc(lead.createdAt),
        ];
        break;
      default:
        orderBy = recencyOrder;
    }
  }

  // Fetch the current page of leads. `stage` is computed per row rather than
  // read from a column — see `derived-stage.ts` — so the value the list shows
  // and the value the tab filter matched on are always the same expression.
  const items = await db.query.lead.findMany({
    where: whereClause,
    orderBy,
    limit,
    offset,
    extras: { stage: sql<string>`${derivedLeadStage()}`.as('stage') },
  });

  // `total` MUST be a real COUNT(*) over the same filters, not `items.length`.
  // The latter can never exceed the page size, which stranded every lead past
  // the first page and made the UI report "page 1/1".
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(lead)
    .where(whereClause);

  return ok({ items, total, limit, offset });
};

/**
 * List leads for an organization
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Lead list input with filters
 * @returns Result with leads array or error
 *
 * @example
 * ```ts
 * const result = await listLeads(db, {
 *   organizationId: 'org_123',
 *   status: 'new',
 *   limit: 20,
 * });
 * ```
 */
export const listLeads = (db: DbConnection, input: ListLeadsInput) =>
  trackedResult(
    'leads.listLeads',
    () => withOrgScope((tx) => listLeadsImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

/**
 * Result type for listLeads
 */
export type ListLeadsResult = Awaited<ReturnType<typeof listLeads>>;

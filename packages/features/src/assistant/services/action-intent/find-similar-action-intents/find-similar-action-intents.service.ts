import {
  type ClaireActionIntentType,
  claireActionIntent,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq, gte } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../../shared/index.js';
import {
  jaccardSimilarity,
  normalizeActionKey,
  tokenize,
} from '../normalize.js';
import {
  type FindSimilarActionIntentsData,
  type FindSimilarActionIntentsInput,
  type SimilarActionIntentCandidate,
  findSimilarActionIntentsSchema,
} from './find-similar-action-intents.schema.js';

/** Similarity floor a name/objective/service match is boosted to. */
const OBJECTIVE_MATCH_FLOOR = 0.6;
/** Extra weight when the proposed and stored actions share a service. */
const SERVICE_OVERLAP_BOOST = 0.15;

const readMetaString = (
  metadata: Record<string, unknown> | null,
  key: string
): string | undefined => {
  const value = metadata?.[key];
  return typeof value === 'string' ? value : undefined;
};

const readMetaServiceIds = (
  metadata: Record<string, unknown> | null
): string[] => {
  const value = metadata?.serviceIds;
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
};

const findSimilarActionIntentsImpl = async (
  db: DbConnection,
  input: FindSimilarActionIntentsInput
): Promise<Result<FindSimilarActionIntentsData>> => {
  const parsed = findSimilarActionIntentsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    action,
    name,
    objective,
    serviceIds,
    windowDays,
    minSimilarity,
    limit,
  } = parsed.data;

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const proposedTokens = tokenize(name ?? '');
  const proposedServiceIds = new Set(serviceIds ?? []);

  const rows = await withOrgScope(
    (tx) =>
      tx.query.claireActionIntent.findMany({
        where: and(
          eq(claireActionIntent.organizationId, organizationId),
          eq(claireActionIntent.action, action as ClaireActionIntentType),
          gte(claireActionIntent.createdAt, since)
        ),
        orderBy: [desc(claireActionIntent.createdAt)],
        limit: 50,
      }),
    { db }
  );

  const candidates: SimilarActionIntentCandidate[] = [];

  for (const row of rows) {
    const matchReasons: string[] = [];
    let similarity = jaccardSimilarity(
      proposedTokens,
      tokenize(row.normalizedKey)
    );
    if (similarity > 0) {
      matchReasons.push('similar name');
    }

    const rowObjective = readMetaString(row.metadata, 'objective');
    const objectiveMatch = !!objective && rowObjective === objective;
    if (objectiveMatch) {
      similarity = Math.max(similarity, OBJECTIVE_MATCH_FLOOR);
      matchReasons.push('same objective');
    }

    const rowServiceIds = readMetaServiceIds(row.metadata);
    const serviceOverlap = rowServiceIds.some((id) =>
      proposedServiceIds.has(id)
    );
    if (serviceOverlap) {
      similarity = Math.min(1, similarity + SERVICE_OVERLAP_BOOST);
      matchReasons.push('same service');
    }

    // An exact normalised-name match is an unambiguous duplicate regardless of
    // the token-overlap floor — it supersedes the fuzzy "similar name" reason.
    if (
      name &&
      normalizeActionKey(name) === row.normalizedKey &&
      row.normalizedKey.length > 0
    ) {
      similarity = 1;
      const fuzzyIdx = matchReasons.indexOf('similar name');
      if (fuzzyIdx >= 0) matchReasons.splice(fuzzyIdx, 1);
      if (!matchReasons.includes('same name'))
        matchReasons.unshift('same name');
    }

    const qualifies =
      similarity >= minSimilarity || (objectiveMatch && serviceOverlap);
    if (!qualifies) continue;

    candidates.push({
      id: row.id,
      resourceId: row.resourceId,
      displayName: row.displayName,
      createdAt: row.createdAt.toISOString(),
      similarity,
      matchReasons,
    });
  }

  candidates.sort((a, b) => b.similarity - a.similarity);

  return ok({ candidates: candidates.slice(0, limit) });
};

/**
 * Find recent Claire action intents similar to a proposed create/launch, for
 * pre-create duplicate protection (Phase 4). Reads the normalised intent log,
 * NOT Meta — the log is the local, cheap source of truth for "did the owner
 * just ask for this?".
 */
export const findSimilarActionIntents = (
  db: DbConnection,
  input: FindSimilarActionIntentsInput
) =>
  trackedResult(
    'assistant.findSimilarActionIntents',
    () => findSimilarActionIntentsImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        action: input.action,
      },
    }
  );

export type FindSimilarActionIntentsResult = Awaited<
  ReturnType<typeof findSimilarActionIntents>
>;

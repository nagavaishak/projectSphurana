/**
 * `recordProvenance` — write down why a piece of content looks the way it does.
 *
 * Called at the point a selection decision is made (which asset, which logo,
 * stock or own footage). Two consumers:
 *   - a human diagnosing "this graphic used the wrong photo"
 *   - `listRecentlyUsedAssetIds`, which reads these rows to rotate assets
 *
 * FAILS SILENTLY BY DESIGN. Provenance is diagnostic; it must never break a
 * render. Callers use {@link recordProvenanceSafe}, which swallows everything.
 */

import { randomUUID } from 'node:crypto';
import { contentGenerationProvenance } from '@borradh-workspace/database';
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
  type RecordProvenanceInput,
  recordProvenanceSchema,
} from './record-provenance.schema.js';

const recordProvenanceImpl = async (
  db: DbConnection,
  input: RecordProvenanceInput
): Promise<Result<{ id: string }>> => {
  const parsed = recordProvenanceSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const data = parsed.data;
  const id = randomUUID();

  try {
    await db.insert(contentGenerationProvenance).values({
      id,
      organizationId: data.organizationId,
      subjectType: data.subjectType,
      subjectId: data.subjectId,
      batchId: data.batchId ?? null,
      batchItemId: data.batchItemId ?? null,
      serviceId: data.serviceId ?? null,
      chosenAssetId: data.chosenAssetId ?? null,
      mediaSource: data.mediaSource,
      logoOutcome: data.logoOutcome,
      candidatesConsidered: data.candidatesConsidered ?? null,
      rejectedCandidates: data.rejectedCandidates ?? null,
      templateSlug: data.templateSlug ?? null,
      model: data.model ?? null,
      detail: data.detail ?? null,
    });
    return ok({ id });
  } catch (error) {
    logError('contentProvenance.recordProvenance', error, {
      feature: 'content-provenance',
      extra: {
        organizationId: data.organizationId,
        subjectType: data.subjectType,
        subjectId: data.subjectId,
      },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to record provenance')
    );
  }
};

export const recordProvenance = (
  db: DbConnection,
  input: RecordProvenanceInput
) =>
  trackedResult(
    'contentProvenance.recordProvenance',
    () => recordProvenanceImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        subjectType: input.subjectType,
        mediaSource: input.mediaSource,
        logoOutcome: input.logoOutcome,
      },
    }
  );

/**
 * Record provenance without ever throwing or returning a failure.
 *
 * Use this from render paths. A provenance write failing is worth a log line
 * and nothing more — it must not turn a good render into a failed one.
 */
export const recordProvenanceSafe = async (
  db: DbConnection,
  input: RecordProvenanceInput
): Promise<void> => {
  try {
    await recordProvenance(db, input);
  } catch {
    // Already logged inside; swallow so the caller's render continues.
  }
};

export type RecordProvenanceResult = Awaited<
  ReturnType<typeof recordProvenance>
>;

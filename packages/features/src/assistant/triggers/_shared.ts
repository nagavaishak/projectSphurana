// NOTE (RLS W-SYS flag): all trigger functions in this file (createIfNotActive,
// runOrgLoop) are called from the scheduler (cron path). They scan multiple orgs
// and write assistant_recommendation rows across org boundaries.
// W-SYS must wrap the db connection passed to each trigger with withSystemScope
// at the call site in claire-triggers.scheduler.service.ts.
import type { AssistantRecommendationKind } from '@borradh-workspace/database';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../shared/index.js';
import {
  type CreateRecommendationInput,
  createRecommendation,
} from '../services/create-recommendation/index.js';
import { findActiveRecommendationByKind } from '../services/find-active-recommendation-by-kind/index.js';

export interface TriggerOutcome {
  created: number;
  skipped: number;
  failed: number;
}

/**
 * Every trigger writes at most one active recommendation per (org, kind) pair.
 * This helper checks for an existing active row and skips if one exists.
 *
 * Returns ok({ created: 1 }) if written, ok({ skipped: 1 }) if dedup hit,
 * err(...) if the underlying service failed.
 */
export async function createIfNotActive(
  db: DbConnection,
  input: CreateRecommendationInput
): Promise<Result<{ created: 0 | 1; skipped: 0 | 1 }>> {
  const dedup = await findActiveRecommendationByKind(db, {
    organizationId: input.organizationId,
    kind: input.kind,
  });
  if (!dedup.success) {
    // trackedResult downgrades FeatureError → plain { code, message, details };
    // re-wrap so the outer Result<FeatureError> stays well-typed.
    return err(
      new FeatureError(
        dedup.error.code as keyof typeof ErrorCodes,
        dedup.error.message,
        dedup.error.details
      )
    );
  }
  if (dedup.data) {
    return ok({ created: 0, skipped: 1 });
  }

  const created = await createRecommendation(db, input);
  if (!created.success) {
    return err(
      new FeatureError(
        created.error.code as keyof typeof ErrorCodes,
        created.error.message,
        created.error.details
      )
    );
  }
  return ok({ created: 1, skipped: 0 });
}

/**
 * Helper for the trigger's outer loop — call createIfNotActive for each
 * qualifying org, accumulate counts, swallow per-row errors (trigger should
 * continue rather than abort whole run if one org fails).
 */
export async function runOrgLoop(
  db: DbConnection,
  inputs: CreateRecommendationInput[]
): Promise<Result<TriggerOutcome>> {
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const input of inputs) {
    const result = await createIfNotActive(db, input);
    if (!result.success) {
      failed++;
      continue;
    }
    created += result.data.created;
    skipped += result.data.skipped;
  }

  return ok({ created, skipped, failed });
}

/**
 * Type-narrow helper — callers can build inputs with this rather than spread.
 */
export function recInput(
  organizationId: string,
  kind: AssistantRecommendationKind,
  rest: Omit<CreateRecommendationInput, 'organizationId' | 'kind'>
): CreateRecommendationInput {
  return { organizationId, kind, ...rest };
}

export const TriggerErrors = ErrorCodes;
export type { FeatureError };

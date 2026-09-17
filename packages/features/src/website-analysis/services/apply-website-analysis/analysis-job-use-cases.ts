import { trackedResult } from '@borradh-workspace/observability';
import { z } from 'zod';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { getAnalyzeWebsiteJobRecord } from '../analyze-website/analyze-website.service.js';
import {
  type ApplyWebsiteAnalysisOutput,
  type WebsiteAnalysisPlan,
  applyModesSchema,
} from './apply-website-analysis.schema.js';
import {
  applyWebsiteAnalysis,
  planWebsiteAnalysis,
} from './apply-website-analysis.service.js';

/**
 * `trackedResult` flattens its error to the structural `{ code, message,
 * details }` shape, so a delegating use case has to re-wrap it to keep
 * returning a `Result<T>` with a real `FeatureError`.
 */
const rewrap = <T>(
  result:
    | { success: true; data: T }
    | {
        success: false;
        error: { code: string; message: string; details?: unknown };
      }
): Result<T> =>
  result.success
    ? ok(result.data)
    : err(
        new FeatureError(
          result.error.code,
          result.error.message,
          result.error.details as Record<string, unknown> | undefined
        )
      );

const analysisJobSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  jobId: z.string().min(1, 'Job ID is required'),
});

export const previewAnalysisJobSchema = analysisJobSchema;
export type PreviewAnalysisJobInput = z.infer<typeof previewAnalysisJobSchema>;

export const applyAnalysisJobSchema = analysisJobSchema.extend({
  modes: applyModesSchema.partial().optional(),
  /**
   * Plan-row keys the owner un-ticked in the review step. Absent = apply the
   * whole plan, which is what the onboarding bootstrap does.
   */
  deselected: z.array(z.string().min(1)).max(5000).optional(),
});
export type ApplyAnalysisJobInput = z.infer<typeof applyAnalysisJobSchema>;

/**
 * Read a scan the SERVER ran, for this organization, that actually finished.
 *
 * The analysis is NEVER taken from the request — only a jobId is, and this
 * resolves it against the server's own copy. That is what stops a client
 * posting an arbitrary catalog into an organization, and
 * `getAnalyzeWebsiteJob` is what stops it reading another tenant's scan.
 */
const readFinishedJob = async (
  organizationId: string,
  jobId: string
): Promise<Result<{ analysis: unknown; scanFor?: string[] }>> => {
  const job = await getAnalyzeWebsiteJobRecord(jobId, organizationId);
  if (!job.success) {
    return err(
      new FeatureError(job.error.code, job.error.message, job.error.details)
    );
  }

  const { status, rawResult } = job.data;

  if (status.status === 'error') {
    return err(
      new FeatureError(ErrorCodes.CONFLICT, status.error ?? 'The scan failed')
    );
  }
  // Gate on the RAW result, not the strict-parsed one. A snapshot written by an
  // older deploy can fail the current response schema on a single field; the
  // poll view drops it wholesale (correctly — its consumer iterates those
  // arrays), but gating here on that view would turn one drifted section into
  // "the scan has not finished yet" and lose the whole catalog. What actually
  // consumes this is `websiteAnalysisSnapshotSchema`, whose every field is
  // `.catch()`-guarded precisely so the readable parts still land.
  if (status.status !== 'done' || rawResult === undefined) {
    return err(
      new FeatureError(ErrorCodes.CONFLICT, 'The scan has not finished yet')
    );
  }

  return ok({ analysis: rawResult, scanFor: status.scanFor });
};

const previewAnalysisJobImpl = async (
  db: DbConnection,
  input: PreviewAnalysisJobInput
): Promise<Result<WebsiteAnalysisPlan>> => {
  const parsed = previewAnalysisJobSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationId, jobId } = parsed.data;

  const job = await readFinishedJob(organizationId, jobId);
  if (!job.success) return job;

  return rewrap(
    await planWebsiteAnalysis(db, {
      organizationId,
      analysis: job.data.analysis,
      scanFor: job.data.scanFor as never,
    })
  );
};

/** Diff a finished scan against the organization, writing nothing (ENG-659). */
export const previewAnalysisJob = (
  db: DbConnection,
  input: PreviewAnalysisJobInput
) =>
  trackedResult(
    'websiteAnalysis.previewAnalysisJob',
    () => previewAnalysisJobImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

const applyAnalysisJobImpl = async (
  db: DbConnection,
  input: ApplyAnalysisJobInput
): Promise<Result<ApplyWebsiteAnalysisOutput>> => {
  const parsed = applyAnalysisJobSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationId, jobId, modes, deselected } = parsed.data;

  const job = await readFinishedJob(organizationId, jobId);
  if (!job.success) return job;

  return rewrap(
    await applyWebsiteAnalysis(db, {
      organizationId,
      analysis: job.data.analysis,
      scanFor: job.data.scanFor as never,
      modes,
      deselected,
    })
  );
};

/** Write a reviewed scan into the organization (ENG-659). */
export const applyAnalysisJob = (
  db: DbConnection,
  input: ApplyAnalysisJobInput
) =>
  trackedResult(
    'websiteAnalysis.applyAnalysisJob',
    () => applyAnalysisJobImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type PreviewAnalysisJobResult = Awaited<
  ReturnType<typeof previewAnalysisJob>
>;
export type ApplyAnalysisJobResult = Awaited<
  ReturnType<typeof applyAnalysisJob>
>;

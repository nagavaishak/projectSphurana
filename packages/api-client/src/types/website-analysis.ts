/**
 * @borradh-workspace/api-client - Website Analysis API Types
 *
 * Types for website analysis API endpoints.
 * Types are derived from backend features schemas.
 */

// Value import, so it must come from the frontend-safe barrel: the
// website-analysis barrel above is type-only (erased at build) but as a value
// import it would pull the scraping strategies into the browser bundle.
import { analysisSectionValues } from '@borradh-workspace/features/shared';
import type {
  AnalysisSection as BackendAnalysisSection,
  AnalyzeWebsiteInput as BackendAnalyzeInput,
  AnalyzeWebsiteJobStatus as BackendAnalyzeJobStatus,
  AnalyzeWebsitePhase as BackendAnalyzePhase,
  AnalyzeWebsiteResponse as BackendAnalyzeResponse,
  AnalyzedPackage as BackendAnalyzedPackage,
  AnalyzedPractitioner as BackendAnalyzedPractitioner,
  AnalyzedService as BackendAnalyzedService,
  ApplyModes as BackendApplyModes,
  ApplyWebsiteAnalysisOutput as BackendApplyOutput,
  ListSectionMode as BackendListSectionMode,
  WebsiteAnalysisPlan as BackendPlan,
  PlanRow as BackendPlanRow,
  ValueSectionMode as BackendValueSectionMode,
} from '@borradh-workspace/features/website-analysis';

/**
 * Analyze website input
 * Omits organizationId (added by controller from session)
 */
export type AnalyzeWebsiteInput = Omit<BackendAnalyzeInput, 'organizationId'>;

/**
 * Website analysis response
 * Contains extracted business information from the website
 */
export type AnalyzeWebsiteResponse = BackendAnalyzeResponse;

/** Phase the analyzer is currently in */
export type AnalyzeWebsitePhase = BackendAnalyzePhase;

/** Status payload returned by GET /website-analysis/analyze/:jobId */
export type AnalyzeWebsiteJobStatus = BackendAnalyzeJobStatus;

/** A single service the scan found, with its structured price anchor. */
export type AnalyzedService = BackendAnalyzedService;

/** A team member the scan found. */
export type AnalyzedPractitioner = BackendAnalyzedPractitioner;

/** A bundle/course the scan found. */
export type AnalyzedPackage = BackendAnalyzedPackage;

/** The sections a scan can cover — what to look for, and what to write. */
export type AnalysisSection = BackendAnalysisSection;

export { analysisSectionValues };

/** `add` | `replace` | `ignore` — for sections that are a list of rows. */
export type ListSectionMode = BackendListSectionMode;

/** `apply` | `ignore` — for sections that are a single value. */
export type ValueSectionMode = BackendValueSectionMode;

/** Per-section decisions for one apply. */
export type ApplyModes = BackendApplyModes;

/** Stable identity for one actionable row of the plan. */
export type PlanRow = BackendPlanRow;

/** The diff between a scan and the account, from `POST /website-analysis/preview`. */
export type WebsiteAnalysisPlan = BackendPlan;

/** `POST /website-analysis/preview` body. */
export interface PreviewAnalysisInput {
  jobId: string;
}

/** `POST /website-analysis/apply` body. */
export interface ApplyAnalysisInput {
  jobId: string;
  modes?: Partial<ApplyModes>;
  /**
   * Plan-row keys (`WebsiteAnalysisPlan` row `key`s) the owner un-ticked in
   * the review step. Absent applies the whole plan.
   */
  deselected?: string[];
}

/** What `POST /website-analysis/apply` actually wrote. */
export type ApplyAnalysisResponse = BackendApplyOutput;

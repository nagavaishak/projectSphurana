/**
 * Website Analysis types for the frontend
 *
 * Re-exports from @borradh-workspace/api-client/types following the type-sharing pattern.
 * See: .claude/rules/_patterns/type-sharing.md
 *
 * DO NOT define types here - import from api-client to ensure type consistency.
 */

// Input types
export type {
  AnalyzeWebsiteInput,
  ApplyAnalysisInput,
  PreviewAnalysisInput,
  ApplyModes,
  AnalysisSection,
  ListSectionMode,
  ValueSectionMode,
} from '@borradh-workspace/api-client/types';

// Runtime vocabulary (drives the "what should we look for?" checkboxes)
export { analysisSectionValues } from '@borradh-workspace/api-client/types';

// Response types
export type {
  AnalyzeWebsiteResponse,
  AnalyzeWebsiteJobStatus,
  AnalyzeWebsitePhase,
  AnalyzedService,
  AnalyzedPractitioner,
  AnalyzedPackage,
  ApplyAnalysisResponse,
  WebsiteAnalysisPlan,
} from '@borradh-workspace/api-client/types';

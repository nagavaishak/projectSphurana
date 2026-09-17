/**
 * Asset types for the frontend
 *
 * Re-exports from @borradh-workspace/api-client/types following the type-sharing pattern.
 * See: .claude/rules/_patterns/type-sharing.md
 *
 * DO NOT define types here - import from api-client to ensure type consistency.
 */

// Entity and enum types
export type {
  Asset,
  AssetSource,
  AssetType,
  AssetUploader,
} from '@borradh-workspace/api-client/types';

// Input types
export type { CreateAssetInput } from '@borradh-workspace/api-client/types';

// Response types
export type { ListAssetsResponse } from '@borradh-workspace/api-client/types';

// Labels and values for UI components (dropdowns, badges, etc.)
export {
  assetTypeLabels,
  assetTypeValues,
} from '@borradh-workspace/api-client/types';

// ============================================================================
// ASSET ANALYSIS TYPES
// ============================================================================

// Entity types
export type {
  AssetAnalysis,
  AssetAnalysisResult,
  AssetAnalysisStatus,
  AssetContentType,
  LinkedService,
  GetAssetAnalysisResponse,
} from '@borradh-workspace/api-client/types';

// Input types
export type {
  UpdateAssetServicesInput,
  UpdateAssetTagsInput,
} from '@borradh-workspace/api-client/types';

// Labels and values for UI components
export {
  assetAnalysisStatusLabels,
  assetAnalysisStatusValues,
  assetContentTypeLabels,
  assetContentTypeValues,
} from '@borradh-workspace/api-client/types';

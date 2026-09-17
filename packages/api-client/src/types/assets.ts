/**
 * @borradh-workspace/api-client - Assets API Types
 *
 * Types for the assets API endpoints.
 * Types are derived from backend packages - database enums and features schemas.
 */

// Import types from features/shared (isolatedModules compliant - separate imports)
import type {
  AssetAnalysisStatus,
  AssetContentType,
  AssetContentTypeTag,
  AssetSource,
  AssetType,
  Asset as BackendAsset,
  AssetAnalysis as BackendAssetAnalysis,
  AssetAnalysisResult as BackendAssetAnalysisResult,
} from '@borradh-workspace/features/shared';

// Import labels and values from features/shared (runtime values)
import {
  assetAnalysisStatusLabels,
  assetAnalysisStatusValues,
  assetContentTypeLabels,
  assetContentTypeTagLabels,
  assetContentTypeTagValues,
  assetContentTypeValues,
  assetSourceLabels,
  assetSourceValues,
  assetTypeLabels,
  assetTypeValues,
  contentTypeToTagMap,
} from '@borradh-workspace/features/shared';

// Import backend input types from features
import type { CreateAssetInput as BackendCreateAssetInput } from '@borradh-workspace/features/assets';

import type { Serialize } from './serialization.js';

// ============================================================================
// ENUM TYPES - Re-exported from database (Labels pattern)
// ============================================================================

/**
 * Asset type - re-exported from database
 */
export type { AssetType };

/**
 * Asset source (raw footage vs edited/polished) - re-exported from database
 */
export type { AssetSource };
export { assetSourceLabels, assetSourceValues };

/**
 * Labels and values for UI usage (dropdowns, badges, etc.)
 */
export { assetTypeLabels, assetTypeValues };

// ============================================================================
// ENTITY TYPES - Serialized for API responses (Date → string)
// ============================================================================

/**
 * Asset uploader info
 */
export interface AssetUploader {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

/**
 * Asset response type (API response - dates serialized to ISO strings)
 *
 * `uploader` is a joined team-member snapshot present only on the read
 * projections (`GET /assets`, `GET /assets/:id`, batch list). The write
 * endpoints (create, update-tags) return the bare row with no join, so the
 * key is optional here. The read-path contract (`assetSchema`) keeps it
 * required-nullable.
 */
/**
 * Matcher-internal columns, deliberately NOT part of the API surface.
 *
 * `embedding` is 1536 floats — shipping it on every tile of a gallery list
 * would dwarf the rest of the payload for no client benefit. The rest
 * (agent/technique/regions/visual_description) is footage-matching machinery
 * the frontend never reads; it is consumed server-side by the b-roll gate.
 * Add them back deliberately if a curation UI ever needs them, rather than
 * leaking them by default because `Serialize<BackendAsset>` is structural.
 */
type AssetMatcherInternalFields =
  | 'embedding'
  | 'agentSlug'
  | 'techniqueSlug'
  | 'regions'
  | 'agentSource'
  | 'visualDescription';

export type Asset = Omit<
  Serialize<BackendAsset>,
  AssetMatcherInternalFields
> & {
  uploader?: AssetUploader | null;
  /** Services this asset is linked to (via the asset_service junction).
   *  Populated by the list endpoint so the gallery can badge each tile with
   *  its assigned service. May be absent on asset shapes from other paths. */
  services?: { id: string; name: string }[];
};

// ============================================================================
// RESPONSE TYPES - API-specific shapes
// ============================================================================

/**
 * List assets response
 */
export interface ListAssetsResponse {
  items: Asset[];
  total: number;
  limit: number;
  offset: number;
}

// ============================================================================
// INPUT TYPES - Derived from backend, omitting server-side fields
// ============================================================================

/**
 * Create asset input
 * Omits organizationId, uploadedById (added by controller from session)
 */
export type CreateAssetInput = Omit<
  BackendCreateAssetInput,
  'organizationId' | 'uploadedById'
>;

// ============================================================================
// ASSET ANALYSIS TYPES - For AI-powered tagging
// ============================================================================

/**
 * Asset analysis status enum - re-exported from database
 */
export type { AssetAnalysisStatus };
export { assetAnalysisStatusLabels, assetAnalysisStatusValues };

/**
 * Asset content type enum (AI-classified content type) - re-exported from database
 */
export type { AssetContentType };
export { assetContentTypeLabels, assetContentTypeValues };

/**
 * Asset content type TAG values (what goes in asset.tags) - re-exported from database
 */
export type { AssetContentTypeTag };
export {
  assetContentTypeTagLabels,
  assetContentTypeTagValues,
  contentTypeToTagMap,
};

/**
 * Asset analysis result (AI-generated analysis data)
 */
export type AssetAnalysisResult = BackendAssetAnalysisResult;

/**
 * Asset analysis entity (serialized for API)
 */
export type AssetAnalysis = Serialize<BackendAssetAnalysis>;

/**
 * Linked service (from asset-service junction table)
 */
export interface LinkedService {
  id: string;
  serviceId: string;
  serviceName: string;
  serviceCategory: string;
  confidence: number | null;
  isAutoGenerated: boolean;
}

/**
 * Get asset analysis response
 */
export interface GetAssetAnalysisResponse {
  analysis: AssetAnalysis | null;
  linkedServices: LinkedService[];
}

/**
 * Per-asset row from `GET /assets/bulk-status`.
 *
 * `analysisStatus` is null when no analysis row exists yet (images, or a video
 * whose analysis has not been queued). `tags` is what the worker has persisted
 * so far, so a completed row carries its finished tags without a follow-up
 * request.
 */
export interface BulkAssetStatus {
  id: string;
  name: string;
  type: string;
  blobUrl: string;
  tags: string[];
  analysisStatus: AssetAnalysisStatus | null;
  analysisId: string | null;
}

/**
 * Counts across the videos in the queried set. `analysisPending` counts videos
 * with no analysis row at all, which is distinct from `analysisQueued`.
 */
export interface BulkAssetsStatusSummary {
  total: number;
  videosTotal: number;
  analysisQueued: number;
  analysisProcessing: number;
  analysisCompleted: number;
  analysisFailed: number;
  analysisPending: number;
}

/**
 * Response from `GET /assets/bulk-status`.
 *
 * The endpoint also returns the `batch` row when queried by `batchId`. It is
 * deliberately not declared here: the only client is the background analysis
 * tracker, which queries by `assetIds` (so the field is always null for it),
 * and describing the batch row would mean re-exporting a database type through
 * `features/shared` for a field nothing reads.
 */
export interface GetBulkAssetsStatusResponse {
  assets: BulkAssetStatus[];
  summary: BulkAssetsStatusSummary;
}

/**
 * Link/unlink services input
 */
export interface UpdateAssetServicesInput {
  serviceIds: string[];
}

/**
 * Update asset tags input
 */
export interface UpdateAssetTagsInput {
  tags: string[];
}

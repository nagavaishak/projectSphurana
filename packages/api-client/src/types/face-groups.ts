/**
 * @borradh-workspace/api-client - Face Groups API Types
 *
 * Types for the face groups API endpoints.
 * Types are derived from backend packages - database enums and features schemas.
 *
 * Face groups pair a client's before/after photos for video creation. They were
 * once populated by biometric face recognition; that processing was removed for
 * GDPR compliance and groups are now only created by manual before/after
 * pairing. No biometric data is exposed here.
 */

// Import types from features/shared (isolatedModules compliant)
import type {
  FaceGroup as BackendFaceGroup,
  FaceGroupAsset as BackendFaceGroupAsset,
  FaceGroupAssetRole,
} from '@borradh-workspace/features/shared';

// Import labels and values from features/shared (runtime values)
import {
  faceGroupAssetRoleLabels,
  faceGroupAssetRoleValues,
} from '@borradh-workspace/features/shared';

import type { Serialize } from './serialization.js';

// ============================================================================
// ENUM TYPES - Re-exported from database (Labels pattern)
// ============================================================================

export type { FaceGroupAssetRole };

// Re-export labels and values for frontend use
export { faceGroupAssetRoleLabels, faceGroupAssetRoleValues };

// ============================================================================
// ENTITY TYPES - Serialized for API responses
// ============================================================================

export type FaceGroup = Serialize<BackendFaceGroup>;
export type FaceGroupAsset = Serialize<BackendFaceGroupAsset>;

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface FaceGroupAssetWithDetails {
  id: string;
  assetId: string;
  role: FaceGroupAssetRole;
  asset: {
    id: string;
    name: string;
    blobUrl: string;
    type: string;
  };
}

export interface FaceGroupWithAssets {
  id: string;
  organizationId: string;
  clientName: string | null;
  serviceId: string | null;
  assets: FaceGroupAssetWithDetails[];
}

export interface BatchFaceGroupsResponse {
  faceGroups: FaceGroupWithAssets[];
  status: 'complete';
}

// ============================================================================
// INPUT TYPES
// ============================================================================

export interface UpdateFaceGroupInput {
  clientName?: string;
  serviceId?: string | null;
}

export interface UpdateFaceGroupAssetRoleInput {
  role: FaceGroupAssetRole;
}

/**
 * @borradh-workspace/api-client - AI Content API Types
 *
 * Types for the AI content generation API endpoints.
 * Types are derived from backend packages.
 */

// Import backend model types from features
import type {
  AdContent as BackendAdContent,
  GeneratedContent as BackendGeneratedContent,
  SocialPostContent as BackendSocialPostContent,
} from '@borradh-workspace/features/ai-content';

// Import backend input types from features
import type { GenerateContentInput as BackendGenerateContentInput } from '@borradh-workspace/features/ai-content';

// ============================================================================
// MODEL TYPES - Re-exported from backend
// ============================================================================

export type AdContent = BackendAdContent;
export type SocialPostContent = BackendSocialPostContent;
export type GeneratedContent = BackendGeneratedContent;

// ============================================================================
// INPUT TYPES - Derived from backend, omitting server-side fields
// ============================================================================

/**
 * Input for generating AI content
 * Omits organizationId (added by controller from session)
 */
export type GenerateContentInput = Omit<
  BackendGenerateContentInput,
  'organizationId'
>;

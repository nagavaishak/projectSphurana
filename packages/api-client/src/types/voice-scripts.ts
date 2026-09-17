/**
 * @borradh-workspace/api-client - Voice Scripts API Types
 *
 * Types for the voice scripts API endpoints.
 * Types are derived from backend packages - database types and features schemas.
 */

// Import backend entity types from features/shared
import type { VoiceScript as BackendVoiceScript } from '@borradh-workspace/features/shared';

// Import backend input types from features
import type {
  CreateVoiceScriptInput as BackendCreateVoiceScriptInput,
  ListVoiceScriptsInput as BackendListVoiceScriptsInput,
  UpdateVoiceScriptInput as BackendUpdateVoiceScriptInput,
} from '@borradh-workspace/features/voice-scripts';

import type { Serialize } from './serialization.js';

// ============================================================================
// SHARED TYPES - Re-exported from database
// ============================================================================

/**
 * Voice agent configuration
 */
export interface AgentConfig {
  voice?: string;
  language?: string;
  maxCallDuration?: number;
  endCallAfterSilence?: number;
  [key: string]: unknown;
}

// ============================================================================
// ENTITY TYPES - Serialized for API responses (Date → string)
// ============================================================================

/**
 * Voice script entity type (API response - dates serialized to ISO strings)
 * Override agentConfig to use clean AgentConfig (Drizzle jsonb adds 'string' union)
 */
export type VoiceScript = Omit<Serialize<BackendVoiceScript>, 'agentConfig'> & {
  agentConfig: AgentConfig | null;
};

// ============================================================================
// RESPONSE TYPES - API-specific shapes
// ============================================================================

/**
 * List voice scripts response
 */
export interface ListVoiceScriptsResponse {
  items: VoiceScript[];
  limit: number;
  offset: number;
}

// ============================================================================
// INPUT TYPES - Derived from backend, omitting server-side fields
// ============================================================================

/**
 * Create voice script input
 * Omits organizationId (added by controller from session)
 * Fields with server defaults (name, isDefault, qualificationQuestions, followUps) are optional for API input
 */
export type CreateVoiceScriptInput = Omit<
  BackendCreateVoiceScriptInput,
  | 'organizationId'
  | 'name'
  | 'isDefault'
  | 'qualificationQuestions'
  | 'followUps'
> &
  Partial<
    Pick<
      BackendCreateVoiceScriptInput,
      'name' | 'isDefault' | 'qualificationQuestions' | 'followUps'
    >
  >;

/**
 * Update voice script input
 * Omits id, organizationId (id from route param, organizationId from session)
 */
export type UpdateVoiceScriptInput = Omit<
  BackendUpdateVoiceScriptInput,
  'id' | 'organizationId'
>;

/**
 * Parameters for listing voice scripts
 * Omits organizationId (added by controller from session)
 */
export type ListVoiceScriptsParams = Omit<
  BackendListVoiceScriptsInput,
  'organizationId'
>;

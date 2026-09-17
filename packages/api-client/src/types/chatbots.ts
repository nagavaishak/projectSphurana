/**
 * @borradh-workspace/api-client - Chatbot Settings API Types
 *
 * The chatbot entity has been eliminated. Chatbot configuration now lives
 * on the organization table. These types support the settings update endpoint.
 */

// Import labels and values from features/shared (runtime values)
import {
  chatbotGoalLabels,
  chatbotGoalValues,
  chatbotToneLabels,
  chatbotToneValues,
} from '@borradh-workspace/features/shared';

// Import backend types
import type { UpdateChatbotSettingsInput as BackendUpdateChatbotSettingsInput } from '@borradh-workspace/features/organizations';
import type { UpdateChatbotSettingsResponse as BackendUpdateChatbotSettingsResponse } from '@borradh-workspace/features/organizations';

import type { Serialize } from './serialization.js';

// ============================================================================
// ENUM TYPES - Only goal and tone remain
// ============================================================================

export type ChatbotGoal = keyof typeof chatbotGoalLabels;
export type ChatbotTone = keyof typeof chatbotToneLabels;

// Re-export labels and values for frontend use
export {
  chatbotGoalLabels,
  chatbotGoalValues,
  chatbotToneLabels,
  chatbotToneValues,
};

// ============================================================================
// CHATBOT SETTINGS TYPES
// ============================================================================

export type UpdateChatbotSettingsInput = Omit<
  BackendUpdateChatbotSettingsInput,
  'organizationId'
>;

export type UpdateChatbotSettingsResponse =
  Serialize<BackendUpdateChatbotSettingsResponse>;

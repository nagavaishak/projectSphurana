// Re-export entity/response types from api-client (single source of truth).
// The create/update INPUT (intent) types are the local, builder-owned shapes
// exported from the create-/update-voice-script modules — they are the typed
// intent every surface passes, never the wire body.
export type {
  AgentConfig,
  ListVoiceScriptsParams,
  ListVoiceScriptsResponse,
  VoiceScript,
} from '@borradh-workspace/api-client/types';

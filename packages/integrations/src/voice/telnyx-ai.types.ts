/**
 * Telnyx AI Assistants Types
 *
 * Types for Telnyx AI-powered voice conversations.
 * Telnyx natively supports background audio and uses ElevenLabs as a TTS provider.
 *
 * @see https://developers.telnyx.com/api/ai-assistants
 */

// ============================================================================
// Provider-Agnostic Business Domain Types
// ============================================================================

/**
 * Simplified business type for voice call context.
 * Maps from the full database BusinessType enum to a category used in prompts.
 */
export type BusinessType =
  | 'clinic'
  | 'dental'
  | 'salon'
  | 'spa'
  | 'veterinary'
  | 'fitness'
  | 'consulting'
  | 'other';

/**
 * Business context for voice calls
 */
export interface BusinessContext {
  businessName: string;
  businessType: BusinessType;
  services: string[];
  currentOffers?: string[];
  operatingHours?: string;
  address?: string;
  specialInstructions?: string;
}

/**
 * Lead context for voice calls
 */
export interface LeadContext {
  leadId: string;
  firstName: string;
  lastName?: string;
  phoneNumber?: string;
  interestedService?: string;
  interestedOffer?: string;
  previousInteractions?: string;
  preferredTime?: string;
  notes?: string;
}

/**
 * Goal for a voice call
 */
export interface CallGoal {
  type: 'book_appointment' | 'qualify' | 'follow_up' | 'confirm' | 'survey';
  description: string;
  successCriteria?: string[];
  fallbackAction:
    | 'schedule_callback'
    | 'transfer_to_human'
    | 'send_sms'
    | 'end_call';
}

/**
 * Full configuration for initiating a voice call
 */
export interface VoiceCallConfig {
  business: BusinessContext;
  lead: LeadContext;
  goal: CallGoal;
  calendarProvider?: CalendarProvider;
  maxDurationSeconds?: number;
  language?: string;
}

// ============================================================================
// Calendar Provider Types
// ============================================================================

export type CalendarProviderType =
  | 'fresha'
  | 'phorest'
  | 'timely'
  | 'calendly'
  | 'cal_com';

export interface CalendarProvider {
  type: CalendarProviderType;
  apiKey?: string;
  apiSecret?: string;
  baseUrl?: string;
  businessId?: string;
  locationId?: string;
  eventTypeId?: string;
}

export interface TimeSlot {
  startTime: Date;
  endTime: Date;
  staffId?: string;
  staffName?: string;
  serviceId?: string;
}

export interface CheckAvailabilityRequest {
  dateFrom: Date;
  dateTo: Date;
  serviceId?: string;
  staffId?: string;
}

export interface CheckAvailabilityResult {
  success: boolean;
  slots: TimeSlot[];
  error?: string;
}

export interface BookAppointmentRequest {
  startTime: Date;
  serviceId?: string;
  staffId?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  notes?: string;
}

export interface BookAppointmentResult {
  success: boolean;
  appointmentId?: string;
  confirmationCode?: string;
  startTime?: Date;
  endTime?: Date;
  error?: string;
}

// ============================================================================
// Telnyx AI Assistant Types
// ============================================================================

/**
 * Background audio preset for Telnyx AI Assistants
 */
export type BackgroundAudioPreset = 'office' | 'cafe' | 'nature' | 'none';

/**
 * Background audio configuration (used within voice_settings)
 * Telnyx API expects { type: "preset"|"url", value: "<name-or-url>" }
 */
export interface BackgroundAudioConfig {
  /** Type of background audio source */
  type: 'predefined_media' | 'url';
  /** Preset name (e.g. "office", "silence") or custom audio URL */
  value: string;
}

/**
 * Voice settings for Telnyx AI Assistants.
 * Uses "ElevenLabs.<VoiceId>" format for ElevenLabs voices,
 * or "Telnyx.aura.<voice_name>" for native Telnyx voices.
 *
 * @see https://developers.telnyx.com/api/ai-assistants/create-assistant
 */
export interface TelnyxVoiceSettings {
  /** Voice identifier — e.g. "ElevenLabs.21m00Tcm4TlvDq8ikWAM" or "Telnyx.aura.asteria" */
  voice: string;
  /** Integration secret name for ElevenLabs API key (set in Telnyx portal) */
  api_key_ref?: string;
  /** Voice speed multiplier (0.25–2.0, Telnyx native voices only) */
  voice_speed?: number;
  /** Background audio during call */
  background_audio?: BackgroundAudioConfig;
}

/**
 * Telephony settings for Telnyx AI Assistants
 */
export interface TelnyxTelephonySettings {
  /** Default TeXML application ID for this assistant */
  default_texml_app_id?: string;
  /** Whether to support unauthenticated web calls */
  supports_unauthenticated_web_calls?: boolean;
}

/**
 * Transcription settings for Telnyx AI Assistants
 */
export interface TelnyxTranscriptionSettings {
  /** Language code for transcription (e.g. "en") */
  language?: string;
}

/**
 * Tool definition for Telnyx AI Assistant.
 * Uses the webhook tool type with body_parameters for structured input.
 *
 * @see https://developers.telnyx.com/api/ai-assistants/create-assistant
 */
export interface TelnyxToolDefinition {
  type: 'webhook';
  webhook: {
    name: string;
    description?: string;
    url: string;
    method: 'POST' | 'GET';
    body_parameters?: TelnyxJsonSchema;
  };
}

export interface TelnyxJsonSchema {
  type: 'object';
  properties: Record<string, TelnyxJsonSchemaProperty>;
  required?: string[];
  description?: string;
}

export interface TelnyxJsonSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[];
  items?: TelnyxJsonSchemaProperty;
}

/**
 * Options for creating a Telnyx AI Assistant.
 * Matches POST /v2/ai/assistants request body.
 *
 * @see https://developers.telnyx.com/api/ai-assistants/create-assistant
 */
export interface CreateAssistantOptions {
  name: string;
  instructions: string;
  model?: string;
  /** First message the assistant says when the call connects */
  greeting?: string;
  /** Reference to the LLM API key stored as a Telnyx integration secret (required for OpenAI models) */
  llm_api_key_ref?: string;
  /** Voice and audio configuration */
  voice_settings: TelnyxVoiceSettings;
  /** Telephony settings (time limit, etc.) */
  telephony_settings?: TelnyxTelephonySettings;
  /** Transcription settings */
  transcription?: TelnyxTranscriptionSettings;
  /** Features to enable (e.g. ['telephony']) */
  enabled_features?: string[];
  /** Dynamic variables available in the assistant's prompt */
  dynamic_variables?: Record<string, unknown>;
  tools?: TelnyxToolDefinition[];
  webhook_url?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Response from Telnyx AI Assistant create/update.
 * Top-level id or nested in data depending on API version.
 */
export interface TelnyxAssistantResponse {
  /** Top-level assistant ID (some API versions) */
  id?: string;
  /** Nested response (some API versions wrap in data) */
  data?: {
    id: string;
    name: string;
    instructions: string;
    model: string;
    greeting?: string;
    voice_settings?: TelnyxVoiceSettings;
    telephony_settings?: TelnyxTelephonySettings;
    enabled_features?: string[];
    tools?: TelnyxToolDefinition[];
    webhook_url?: string;
    metadata?: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  };
}

// ============================================================================
// Outbound Call Types (TeXML)
// ============================================================================

/**
 * Options for creating an outbound call via TeXML AI endpoint.
 * Uses POST /v2/texml/ai_calls/{texml_app_id}
 *
 * @see https://developers.telnyx.com/api/call-control/texml-ai-call
 */
export interface CreateTexmlCallOptions {
  /** Caller ID phone number (E.164 format) */
  From: string;
  /** Phone number to call (E.164 format) */
  To: string;
  /** Pre-created AI Assistant ID */
  AIAssistantId: string;
  /** Dynamic variables to pass to the assistant at call time */
  AIAssistantDynamicVariables?: Record<string, string>;
  /** Enable answering machine detection */
  MachineDetection?: string;
  /** Use async AMD */
  AsyncAmd?: boolean;
}

/**
 * Result of creating an outbound call
 */
export interface CreateOutboundCallResult {
  call_control_id: string;
  call_session_id: string;
}

// ============================================================================
// Webhook Types
// ============================================================================

/**
 * Telnyx webhook event types for AI conversations
 */
export type TelnyxWebhookEventType =
  | 'conversation.ended'
  | 'conversation_insights.generated'
  | 'call.initiation.failed';

/**
 * Transcript entry from a Telnyx conversation
 */
export interface TelnyxTranscriptEntry {
  role: 'assistant' | 'user';
  content: string;
  timestamp?: number;
  tool_calls?: TelnyxToolCallEntry[];
}

/**
 * Tool call within a transcript entry
 */
export interface TelnyxToolCallEntry {
  tool_name: string;
  arguments: Record<string, unknown>;
  result?: string;
}

/**
 * Conversation ended webhook payload
 */
export interface ConversationEndedWebhook {
  data: {
    event_type: 'conversation.ended';
    id: string;
    payload: {
      call_control_id: string;
      call_session_id: string;
      assistant_id: string;
      status: string;
      transcript: TelnyxTranscriptEntry[];
      start_time: string;
      end_time: string;
      duration_seconds: number;
      dynamic_variables?: Record<string, unknown>;
      analysis?: {
        call_successful: boolean;
        summary: string;
      };
    };
  };
  meta: {
    event_type: 'conversation.ended';
    attempt: number;
    delivered_to: string;
  };
}

/**
 * Call initiation failed webhook payload
 */
export interface CallInitiationFailedWebhook {
  data: {
    event_type: 'call.initiation.failed';
    id: string;
    payload: {
      call_control_id: string | null;
      call_session_id: string | null;
      error: string;
      dynamic_variables?: Record<string, unknown>;
    };
  };
  meta: {
    event_type: 'call.initiation.failed';
    attempt: number;
    delivered_to: string;
  };
}

export type TelnyxWebhookEvent =
  | ConversationEndedWebhook
  | CallInitiationFailedWebhook;

// ============================================================================
// Tool Call Types (incoming during call)
// ============================================================================

/**
 * Tool call request from Telnyx during a live call
 */
export interface TelnyxToolCallRequest {
  tool_call_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  call_control_id: string;
  call_session_id: string;
}

/**
 * Tool call response (returned to Telnyx)
 */
export interface TelnyxToolCallResponse {
  result: string;
}

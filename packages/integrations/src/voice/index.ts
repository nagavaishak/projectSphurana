// Telnyx AI Assistants Service
export {
  TelnyxAiService,
  TelnyxApiError,
  createTelnyxAiService,
} from './telnyx-ai.service.js';

// Telnyx AI Types
export type {
  // Assistant Types
  CreateAssistantOptions,
  TelnyxAssistantResponse,
  TelnyxVoiceSettings,
  TelnyxTelephonySettings,
  TelnyxTranscriptionSettings,
  TelnyxToolDefinition,
  TelnyxJsonSchema,
  TelnyxJsonSchemaProperty,
  BackgroundAudioPreset,
  BackgroundAudioConfig,
  // Outbound Call Types (TeXML)
  CreateTexmlCallOptions,
  CreateOutboundCallResult,
  // Webhook Types
  TelnyxWebhookEventType,
  TelnyxWebhookEvent,
  ConversationEndedWebhook,
  CallInitiationFailedWebhook as TelnyxCallInitiationFailedWebhook,
  TelnyxTranscriptEntry,
  TelnyxToolCallEntry,
  // Tool Call Types
  TelnyxToolCallRequest,
  TelnyxToolCallResponse,
  // Business Context Types (provider-agnostic)
  BusinessType,
  BusinessContext,
  LeadContext,
  CallGoal,
  VoiceCallConfig,
  // Calendar Provider Types (provider-agnostic)
  CalendarProviderType,
  CalendarProvider,
  TimeSlot,
  BookAppointmentRequest,
  BookAppointmentResult,
  CheckAvailabilityRequest,
  CheckAvailabilityResult,
} from './telnyx-ai.types.js';

// Calendar Providers
export {
  createCalendarProvider,
  FreshaProvider,
  PhorestProvider,
  TimelyProvider,
  CalendlyProvider,
  formatSlotsForVoice,
  parseTimePreference,
  filterSlotsByTimeOfDay,
} from './calendar-providers.js';
export type { CalendarProviderClient } from './calendar-providers.js';

// Telnyx Webhook Handlers
export {
  verifyTelnyxWebhookSignature,
  parseTelnyxWebhookEvent,
  processTelnyxWebhookEvent,
  analyzeCallOutcome,
  inferSentiment,
  createWebhookResponse,
  createWebhookErrorResponse,
  generateCallSummary,
  extractCrmUpdateData,
} from './telnyx-webhook-handler.js';
export type {
  TelnyxWebhookEventHandlers,
  CallOutcome,
  CallOutcomeResult,
  CrmUpdateData,
} from './telnyx-webhook-handler.js';

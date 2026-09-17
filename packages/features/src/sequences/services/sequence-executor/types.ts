import type { DbConnection, Result } from '../../../shared/index.js';

/**
 * Email step configuration
 */
export interface EmailNodeConfig {
  emailAccountId: string;
  subject: string;
  body: string;
  replyTo?: string;
  trackOpens?: boolean;
  trackClicks?: boolean;
}

/**
 * Email credentials stored in database
 */
export interface EmailCredentials {
  accessToken: string;
  refreshToken: string;
}

/**
 * SMS step configuration
 */
export interface SMSNodeConfig {
  message: string;
  templateId?: string;
  from?: string;
}

/**
 * WhatsApp step configuration
 */
export interface WhatsAppNodeConfig {
  message: string;
}

/**
 * Condition operators supported by the sequence builder
 */
export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'less_than'
  | 'greater_or_equal'
  | 'less_or_equal'
  | 'is_empty'
  | 'is_not_empty'
  | 'matches_regex';

/**
 * Condition step configuration
 */
export interface ConditionNodeConfig {
  field: string;
  operator: ConditionOperator;
  value: string;
  type?: 'string' | 'number' | 'boolean' | 'date';
  caseSensitive?: boolean;
  treatEmptyAsNull?: boolean;
  trueBranchNodeId?: string | null;
  falseBranchNodeId?: string | null;
}

/**
 * Webhook step configuration
 */
export interface WebhookNodeConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Voice call step configuration
 */
export interface VoiceCallNodeConfig {
  /** VoiceScript database ID (set by wizard/dialog) */
  agentConfigId?: string;
  /** @deprecated Legacy field — use agentConfigId instead */
  agentId?: string;
  fromNumber?: string;
  businessType?: string;
  businessName?: string;
  services?: string[];
  currentOffers?: string[];
  operatingHours?: string;
  address?: string;
  specialInstructions?: string;
  interestedService?: string;
  interestedOffer?: string;
  goalType?: string;
  goalDescription?: string;
  fallbackAction?: string;
  calendarProvider?: {
    type: string;
    apiKey?: string;
    apiSecret?: string;
    businessId?: string;
    locationId?: string;
    staffId?: string;
    eventTypeId?: string | number;
    timezone?: string;
  };
  maxDurationSeconds?: number;
  language?: string;
}

/**
 * Voice call data from the last call (for condition evaluation)
 */
export interface LastCallData {
  id: string;
  status: string | null;
  sentiment: string | null;
  callbackRequested: boolean | null;
  appointmentBooked: boolean | null;
  duration: number | null;
  summary: string | null;
  createdAt: Date;
}

/**
 * Lead data for sequence execution
 */
export interface LeadData {
  id: string;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  email?: string | null;
  interestedService?: string | null;
  interestedOffer?: string | null;
  notes?: string | null;
  status?: string | null;
  // Consent fields
  consentEmail?: boolean | null;
  consentSms?: boolean | null;
  consentVoice?: boolean | null;
  // Last voice call data for condition evaluation
  lastCall?: LastCallData | null;
  [key: string]: unknown;
}

/**
 * Sequence step data
 */
export interface SequenceStep {
  id: string;
  type: string;
  order: number;
  config: Record<string, unknown>;
}

/**
 * Execution result data
 */
export interface ExecutionResultData {
  type: string;
  sent?: boolean;
  messageId?: string;
  initiated?: boolean;
  callId?: string;
  agentId?: string;
  duration?: string;
  result?: boolean;
  called?: boolean;
  skippedReason?: string;
  // For condition branching
  nextBranchNodeId?: string | null;
  // For voice calls
  conversationId?: string;
}

/**
 * Step executor function signature
 */
export type StepExecutor = (
  db: DbConnection,
  leadData: LeadData,
  step: SequenceStep,
  organizationId: string
) => Promise<Result<ExecutionResultData>>;

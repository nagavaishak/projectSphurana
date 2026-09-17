import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { childOrgRlsPolicy, orgRlsPolicy } from '../rls-policy.js';
import { lead } from './leads.js';
import { organization } from './organization.js';
import { phoneNumber } from './phone-number.js';

// Import labels from enums (pure TypeScript)
import {
  voiceCallOutcomeLabels,
  voiceCallOutcomeValues,
  voiceCallStatusLabels,
  voiceCallStatusValues,
  voiceSentimentLabels,
  voiceSentimentValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export {
  voiceCallStatusLabels,
  voiceCallStatusValues,
  voiceCallOutcomeLabels,
  voiceCallOutcomeValues,
  voiceSentimentLabels,
  voiceSentimentValues,
};
export type {
  VoiceCallStatus,
  VoiceCallOutcome,
  VoiceSentiment,
} from '@borradh-workspace/labels';

// Database enums
export const voiceCallStatusEnum = pgEnum(
  'voice_call_status',
  voiceCallStatusValues
);

export const voiceCallOutcomeEnum = pgEnum(
  'voice_call_outcome',
  voiceCallOutcomeValues
);

export const voiceSentimentEnum = pgEnum(
  'voice_sentiment',
  voiceSentimentValues
);

/**
 * Voice Call - Records of AI voice calls made via ElevenLabs Conversational AI
 */
export const voiceCall = pgTable(
  'voice_call',
  {
    // ElevenLabs conversation_id is the primary key
    id: text('id').primaryKey(),

    // Lead reference (optional - some calls may not be associated with a lead)
    leadId: text('lead_id').references(() => lead.id, { onDelete: 'set null' }),

    // Voice provider agent that handled the call
    agentId: text('agent_id').notNull(),

    // Phone number used for this call (for lead-number affinity)
    phoneNumberId: text('phone_number_id').references(() => phoneNumber.id, {
      onDelete: 'set null',
    }),

    // Call status
    status: voiceCallStatusEnum('status').notNull().default('pending'),

    // Phone numbers
    fromNumber: text('from_number'),
    toNumber: text('to_number'),

    // Timing
    startedAt: timestamp('started_at'),
    endedAt: timestamp('ended_at'),
    durationMs: integer('duration_ms'),

    // Call outcome
    outcome: voiceCallOutcomeEnum('outcome'),
    disconnectionReason: text('disconnection_reason'),

    // Transcript and recording
    transcript: text('transcript'),
    recordingUrl: text('recording_url'),

    // AI analysis
    aiSummary: text('ai_summary'),
    sentiment: voiceSentimentEnum('sentiment'),

    // Appointment booking
    appointmentBooked: boolean('appointment_booked').default(false),
    appointmentDetails: jsonb('appointment_details').$type<{
      date?: string;
      time?: string;
      service?: string;
    }>(),

    // Callback scheduling
    callbackRequested: boolean('callback_requested').default(false),
    callbackTime: text('callback_time'),

    // Additional metadata
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_voice_call_lead_id').on(table.leadId),
    index('idx_voice_call_phone_number_id').on(table.phoneNumberId),
  ]
);

export type VoiceCall = typeof voiceCall.$inferSelect;
export type NewVoiceCall = typeof voiceCall.$inferInsert;

/**
 * Voice Script - AI voice caller script configuration for ElevenLabs agents
 * Stores the initial message, qualification questions, and follow-up messages
 */
export const voiceScript = pgTable(
  'voice_script',
  {
    id: text('id').primaryKey(),

    // Organization reference
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    // Script name/label (e.g., "Default Script", "Lead Qualification")
    name: text('name').notNull().default('Default Script'),

    // Whether this is the default script for the organization
    isDefault: boolean('is_default').notNull().default(true),

    // Initial message the AI says when the call connects
    // Supports template variables like {{contact.first_name}}
    initialMessage: text('initial_message').notNull(),

    // Full AI agent script/prompt that defines behavior and conversation flow
    // This is the main prompt given to the voice AI agent
    script: text('script'),

    // Qualification questions asked during the call
    // Ordered array of question strings
    qualificationQuestions: jsonb('qualification_questions')
      .$type<string[]>()
      .notNull()
      .default([]),

    // Follow-up messages for re-engagement
    // Ordered array of message strings
    followUps: jsonb('follow_ups').$type<string[]>().notNull().default([]),

    // Voice provider agent ID associated with this script (if deployed)
    voiceProviderAgentId: text('voice_provider_agent_id'),

    // Additional configuration for the voice agent
    agentConfig: jsonb('agent_config').$type<{
      voice?: string;
      language?: string;
      maxCallDuration?: number;
      endCallAfterSilence?: number;
      [key: string]: unknown;
    }>(),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('idx_voice_script_org_id').on(table.organizationId)]
);

export const voiceScriptRlsPolicy = orgRlsPolicy(voiceScript);

// Relations
export const voiceScriptRelations = relations(voiceScript, ({ one }) => ({
  organization: one(organization, {
    fields: [voiceScript.organizationId],
    references: [organization.id],
  }),
}));

export const voiceCallRelations = relations(voiceCall, ({ one }) => ({
  lead: one(lead, {
    fields: [voiceCall.leadId],
    references: [lead.id],
  }),
  phoneNumber: one(phoneNumber, {
    fields: [voiceCall.phoneNumberId],
    references: [phoneNumber.id],
  }),
}));

// Bucket B1: voice_call has no organization_id. The lead_id FK is nullable
// (some calls are not yet matched to a lead). The table inventory designates
// lead as the primary parent. Consequence: voice_call rows whose lead_id IS
// NULL are invisible to app_authenticated (EXISTS returns false for NULL FK).
// Workers that legitimately handle unmatched calls must use withSystemScope.
// This is intentionally restrictive — fail-closed is safer than fail-open.
export const voiceCallRlsPolicy = childOrgRlsPolicy(voiceCall, {
  parent: 'lead',
  fk: 'lead_id',
});

export type VoiceScript = typeof voiceScript.$inferSelect;
export type NewVoiceScript = typeof voiceScript.$inferInsert;

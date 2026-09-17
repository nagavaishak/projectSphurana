/**
 * Lead response PROJECTIONS — hand-composed from the generated `lead` atom.
 *
 * Atoms are 1:1 with a DB table (generated). Projections are the real API
 * contract: list wrappers, detail shapes with joined/computed fields, redacted
 * or renamed views. They live here, composed with `z.object` / `.extend` /
 * `z.array`, and are pure Zod.
 */
import {
  allLeadStatusValues,
  leadSourceValues,
  leadStatusValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';
import {
  leadActivityAtomSchema,
  leadAtomSchema,
  sequenceExecutionAtomSchema,
} from '../generated/index.js';

/**
 * The lead entity as returned by the list and detail endpoints — the atom,
 * verbatim. Exposed under a contract name so consumers depend on the contract,
 * not the generated file directly.
 */
export const leadSchema = leadAtomSchema;
export type Lead = z.infer<typeof leadSchema>;

/** The five stages the derived pipeline can produce. */
const pipelineStageValues = leadStatusValues;

/**
 * A lead as it appears in the LIST, i.e. the atom plus the derived pipeline
 * `stage`. Stage is not a column — it is computed per row from the conversion
 * memo, the linked conversation's messages and the explicit `lost` mark (see
 * `derived-stage.ts` in the leads feature) — so it lives on the projection,
 * never on the atom.
 */
export const leadListItemSchema = leadSchema.extend({
  stage: z.enum(pipelineStageValues),
});
export type LeadListItem = z.infer<typeof leadListItemSchema>;

/**
 * `GET /leads` — the list projection: an `{ items, total }` wrapper around the
 * list items.
 *
 * `limit`/`offset` are REQUIRED. An earlier version of this comment said they
 * were optional, which contradicted the schema three lines below it; the route
 * carries `@ResponseContract(listLeadsResponseSchema)` and the controller
 * defaults both (`limit ?? 50`, `offset ?? 0`) before the service echoes them,
 * so the schema was right and the prose was stale.
 */
export const listLeadsResponseSchema = z.object({
  items: z.array(leadListItemSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export type ListLeadsResponse = z.infer<typeof listLeadsResponseSchema>;

/**
 * The originating lead form, resolved server-side for `meta_lead_form` leads.
 * A computed/joined field that does not exist on the `lead` table.
 */
export const sourceLeadFormSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type SourceLeadForm = z.infer<typeof sourceLeadFormSchema>;

/**
 * `GET /leads/:id` — the detail projection: the lead atom extended with the
 * computed `sourceLeadForm` join.
 */
export const leadDetailSchema = leadAtomSchema.extend({
  sourceLeadForm: sourceLeadFormSchema.nullable(),
});
export type LeadDetail = z.infer<typeof leadDetailSchema>;

/**
 * `GET /leads/stats` — a fully computed analytics response (no backing table):
 * per-status counts plus a derived conversion rate. Hand-modelled since it maps
 * to no atom.
 */
export const leadStatsSchema = z.object({
  totalLeads: z.number(),
  newLeads: z.number(),
  contactedLeads: z.number(),
  bookedLeads: z.number(),
  lostLeads: z.number(),
  conversionRate: z.number(),
});
export type LeadStats = z.infer<typeof leadStatsSchema>;

/**
 * One lead in the summary's `topLeads` slice — a narrow column selection, not
 * a full lead atom (`summariseRecentLeads` selects 8 columns explicitly).
 */
export const summaryTopLeadSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  status: z.enum(allLeadStatusValues),
  source: z.enum(leadSourceValues),
  createdAt: z.string().datetime(),
});
export type SummaryTopLead = z.infer<typeof summaryTopLeadSchema>;

/**
 * `GET /leads/summary` — the time-windowed rollup.
 *
 * A computed projection backed by no table: counts for the current window and
 * the equal-duration prior window, a delta, by-status/by-source aggregates,
 * and a `limit` slice of the most recent leads.
 *
 * `byStatus`/`bySource` are open records rather than a fixed key set on
 * purpose: `aggregateByDimension` only emits keys that actually occurred, so a
 * status with no leads in the window is ABSENT, not zero. A caller must not
 * read a missing key as "none" without saying which it is.
 */
export const leadSummaryResponseSchema = z.object({
  timeframe: z.enum(['today', 'week', 'month']),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  totalLeads: z.number(),
  previousLeads: z.number(),
  deltaPercent: z.number(),
  byStatus: z.record(z.string(), z.number()),
  bySource: z.record(z.string(), z.number()),
  topLeads: z.array(summaryTopLeadSchema),
});
export type LeadSummaryResponse = z.infer<typeof leadSummaryResponseSchema>;

// ---------------------------------------------------------------------------
// `GET /leads/:id/history` — the activity/execution timeline.
//
// A computed, joined projection: sequence executions and lead-activity rows are
// merged, serialized (dates → ISO strings), and enriched with joined display
// fields (`sequenceName`, `performedByName`) that live on no single table. The
// `leadActivity` atom types `type`/`metadata` as `string`/`unknown`; the wire
// response narrows them, so the timeline shapes are hand-modelled here to the
// contract the frontend consumes.
// ---------------------------------------------------------------------------

/** A sequence step's delivery/branch result, surfaced in the timeline. */
export const leadHistoryExecutionResultSchema = z.object({
  messageId: z.string().optional(),
  delivered: z.boolean().optional(),
  opened: z.boolean().optional(),
  clicked: z.boolean().optional(),
  replied: z.boolean().optional(),
  callDuration: z.number().optional(),
  callOutcome: z.string().optional(),
  error: z.string().optional(),
});

/**
 * A sequence execution row, serialized and joined with sequence/step display.
 *
 * Extends the `sequence_execution` atom so nullability is inherited rather
 * than re-declared: `errorMessage` is a raw, unconverted DB column
 * (`list-lead-history.service.ts` passes `exec.errorMessage` straight
 * through — no `?? undefined`), so it MUST accept `null`, matching the atom.
 * `scheduledAt`/`executedAt`/`result` go through `?.toISOString()` /
 * `?? undefined` in the service and so never carry a raw `null` on the wire,
 * but are widened to accept it too (`.nullish()`) rather than re-diverging
 * from the atom for a distinction the service already collapses.
 * `sequenceName`/`stepType`/`stepConfig` are joined display fields with no
 * column on `sequence_execution` — the service converts their `null` join
 * result to `undefined`, so `.optional()` (no `null`) is correct.
 */
export const leadHistoryExecutionSchema = sequenceExecutionAtomSchema.extend({
  sequenceName: z.string().optional(),
  stepType: z
    .enum([
      'email',
      'sms',
      'whatsapp',
      'voice_call',
      'wait',
      'condition',
      'webhook',
    ])
    .optional(),
  stepConfig: z.record(z.string(), z.unknown()).optional(),
  result: leadHistoryExecutionResultSchema.nullish(),
  scheduledAt: z.string().nullish(),
  executedAt: z.string().nullish(),
  errorMessage: z.string().nullish(),
});
export type LeadHistoryExecution = z.infer<typeof leadHistoryExecutionSchema>;

/** Structured metadata attached to a lead-activity timeline entry. */
export const leadActivityMetadataSchema = z.object({
  previousValue: z.string().optional(),
  newValue: z.string().optional(),
  sequenceId: z.string().optional(),
  sequenceName: z.string().optional(),
  appointmentId: z.string().optional(),
  appointmentDate: z.string().optional(),
  messageContent: z.string().optional(),
  callDuration: z.number().optional(),
  tagName: z.string().optional(),
  amountCents: z.number().optional(),
  currency: z.string().optional(),
});

/**
 * A lead-activity row, serialized and joined with the actor's display name.
 *
 * Extends the `lead_activity` atom so `description` inherits the atom's
 * `.nullable()` — the service passes `activity.description` straight
 * through with no `?? undefined` fallback, and it is a required key on every
 * push (real DB rows AND every synthesized milestone always set it), so
 * `null` must round-trip.
 *
 * `performedById`/`performedByName` are `.nullish()` (optional AND
 * nullable): for a real DB row they come from a raw column / a `leftJoin` on
 * `user` with no conversion (`null` for system-generated activities with no
 * actor — the ENG-843 500), but every SYNTHESIZED milestone (lead-created,
 * appointment, deposit, message) omits both keys entirely, so the field must
 * also tolerate being absent.
 */
export const leadActivitySchema = leadActivityAtomSchema.extend({
  type: z.enum([
    'lead_created',
    'status_changed',
    'assigned_to_sequence',
    'removed_from_sequence',
    'email_sent',
    'email_opened',
    'email_clicked',
    'email_replied',
    'sms_sent',
    'sms_delivered',
    'whatsapp_sent',
    'whatsapp_delivered',
    'whatsapp_read',
    'message_received',
    'message_sent',
    'call_made',
    'call_answered',
    'call_completed',
    'appointment_booked',
    'appointment_cancelled',
    'appointment_completed',
    'deposit_paid',
    'note_added',
    'tag_added',
    'tag_removed',
  ]),
  metadata: leadActivityMetadataSchema.optional(),
  performedById: z.string().nullish(),
  performedByName: z.string().nullish(),
});
export type LeadActivity = z.infer<typeof leadActivitySchema>;

/** One merged timeline entry — either a sequence execution or an activity. */
export const leadHistoryItemSchema = z.object({
  id: z.string(),
  type: z.enum(['execution', 'activity']),
  timestamp: z.string(),
  execution: leadHistoryExecutionSchema.optional(),
  activity: leadActivitySchema.optional(),
});
export type LeadHistoryItem = z.infer<typeof leadHistoryItemSchema>;

/** `GET /leads/:id/history` — the `{ items, total }` timeline wrapper. */
export const leadHistoryResponseSchema = z.object({
  items: z.array(leadHistoryItemSchema),
  total: z.number(),
});
export type LeadHistoryResponse = z.infer<typeof leadHistoryResponseSchema>;

// ---------------------------------------------------------------------------
// Import — computed result summaries (no backing table).
// ---------------------------------------------------------------------------

/** A single rejected row from a bulk import. */
export const importErrorSchema = z.object({
  row: z.number(),
  message: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type ImportError = z.infer<typeof importErrorSchema>;

/** `POST /leads/import` — the import outcome summary. */
export const importLeadsResponseSchema = z.object({
  imported: z.number(),
  skipped: z.number(),
  updated: z.number(),
  errors: z.array(importErrorSchema),
});
export type ImportLeadsResponse = z.infer<typeof importLeadsResponseSchema>;

/**
 * `POST /leads/import-csv` — the spreadsheet import summary: the base import
 * result plus parsing/mapping counters.
 */
export const importLeadsCsvResponseSchema = importLeadsResponseSchema.extend({
  rowsInFile: z.number(),
  cleanedRows: z.number(),
  /** Data rows dropped for having no name and no contact detail. */
  skippedRows: z.number().optional(),
  /** Header → lead-field mapping the import used. */
  columnMapping: z.record(z.string(), z.string()).optional(),
  /** @deprecated always 0 since the deterministic parser. */
  failedChunks: z.number(),
});
export type ImportLeadsCsvResponse = z.infer<
  typeof importLeadsCsvResponseSchema
>;

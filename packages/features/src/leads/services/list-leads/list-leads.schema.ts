import {
  leadSourceValues,
  leadStageGroupValues,
  leadStatusValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';
import { queryBoolean } from '../../../shared/query-boolean.js';

/**
 * Schema for listing leads
 *
 * `status` / `source` are DERIVED from the labels vocabulary. They were
 * hand-typed and had fallen two values behind it (`booked`/`cold`,
 * `whatsapp`/`meta_lead_form`) — the same drift as the leads DTOs, and the
 * reason widening the DTO alone would not have made `GET /leads?status=booked`
 * work: this schema re-validates and would still have returned VALIDATION_ERROR.
 */
export const listLeadsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  status: z.enum(leadStatusValues).optional(),
  // Customers-surface tab filter. `all` (or omitted) applies no stage filter;
  // `leads`/`contacted`/`booked` each map to their active stage(s) via
  // `leadStageGroups`. Coexists with the finer-grained `status` filter.
  stageGroup: z.enum(leadStageGroupValues).optional(),
  source: z.enum(leadSourceValues).optional(),
  // Result ordering for the Clients surface. `smart` is the tiered default the
  // "All" tab requests: Qualified → Booked → leads with an unread inbound
  // message → everyone else, newest first within each tier. Omitted keeps the
  // historical order (real records first via `list_rank`, newest first) so every
  // other caller (assistant tools, campaign segments, the old list) is untouched.
  sort: z.enum(['smart', 'recent', 'oldest', 'name', 'last_visit']).optional(),
  /**
   * Branch filter, from the validated `X-Location-Id` header.
   *
   * DELIBERATELY NOT a plain `primary_location_id = ?`. A customer's "home
   * branch" is a convenience, not ownership — someone whose home branch is
   * Dublin but who was last seen in Cork must appear in Cork's list, or the
   * front desk cannot find the person standing in front of them. So the
   * predicate is: home branch is this branch, OR they have an appointment
   * here, OR they have no home branch at all (every customer, today).
   */
  locationId: z.string().min(1).optional(),
  sequenceId: z.string().optional(),
  assignedToId: z.string().optional(),
  search: z.string().optional(),
  tags: z.array(z.string()).optional(),
  // Portal-capable filter (ENG-647): the clinical "Clients" list only shows
  // people who could actually hold a portal account, and the portal is keyed
  // on email (OTP + magic link both address an inbox). Without this, records
  // with no email — dead leads, walk-in placeholders, practitioner rows —
  // filled a list whose whole purpose is portal customers.
  // `queryBoolean`, NOT `z.coerce.boolean()`: this filter reaches the service
  // from a query string, and coercion makes the string "false" truthy — so
  // `?hasEmail=false` would have filtered the wrong way round for any caller
  // that is not the DTO (an assistant tool, a worker, another service).
  hasEmail: queryBoolean(),
  // Consent filters
  consentEmail: z.coerce.boolean().optional(),
  consentSms: z.coerce.boolean().optional(),
  consentVoice: z.coerce.boolean().optional(),
  // Date-range + recency filters (used by campaign segments for
  // re-engagement windows).
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
  lastContactedBefore: z.string().datetime().optional(),
  lastContactedAfter: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

/**
 * Input type inferred from schema
 */
export type ListLeadsInput = z.infer<typeof listLeadsSchema>;

/**
 * leads request CONTRACTS — the canonical, strict Zod schema for the BODY of
 * each lead write endpoint.
 *
 * A request contract is the wire-shaped twin of a response projection: it
 * describes exactly what the client is allowed to POST/PUT, written here in
 * pure Zod so it stays frontend-safe (no drizzle / database in the runtime
 * graph — see index.ts).
 *
 * DIRECTION OF DERIVATION — wire -> server
 * ---------------------------------------
 * This file is the SOURCE. `packages/features/src/leads/services/create-lead/
 * create-lead.schema.ts` DERIVES from it by `.extend()`ing the server-injected
 * context fields onto the base:
 *
 *     createLeadSchema = createLeadRequestBase.extend({ organizationId })
 *
 * Because the server schema literally IS the wire schema plus fields, it can
 * never be laxer than the wire schema, and no drift is possible. Do NOT invert
 * this — a contract hand-copied from the feature schema is exactly the drift
 * this package exists to eliminate.
 *
 * BASE vs SCHEMA — why two exports
 * --------------------------------
 * `.refine()` returns a `ZodEffects`, which has NO `.extend()`. So every
 * contract file exports a matched pair:
 *
 *  - `<name>RequestBase`   — a plain `z.object({…})`. EXTENDABLE. This is what
 *    the backend feature schema extends with its context fields. It is NOT
 *    strict, because `.strict()` would reject the very fields being added.
 *  - `<name>RequestSchema` — `<name>RequestBase.strict()` (plus any `.refine()`).
 *    This is what VALIDATES a wire body: unknown fields are REJECTED, so a
 *    client sending a stale, renamed, or typo'd key fails loudly instead of
 *    having it silently stripped by a permissive `z.object`.
 *
 * Consumers that need to extend use the Base; consumers that validate use the
 * Schema.
 *
 * Context fields the SERVER injects are absent from the body contract:
 *  - `organizationId` — taken from the active-org session, never sent by the
 *    client. The feature schema adds it back via `.extend()`.
 */
import {
  consentSourceValues,
  leadSourceValues,
  leadStatusValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * `POST /leads` body — the EXTENDABLE half.
 *
 * Every field carries the exact validation the server enforces, including the
 * `.default(…)`s: because the feature schema is this object plus
 * `organizationId`, moving a default here does not change server behaviour, it
 * just makes the same default visible to the client. Note that `.default()`
 * means a parsed body CONTAINS these keys even when the caller omitted them —
 * `createLeadRequestSchema.parse({ firstName, source })` emits `status: 'new'`
 * and the three `consent*: false` flags.
 *
 * `email` is `.email()`-validated and OPTIONAL, which is precisely the pair
 * that bites: an optional email may be ABSENT, but it may not be the EMPTY
 * STRING. A form whose blank input defaults to `''` must normalise it to
 * `undefined` before building the body — see `buildCreateLeadPayload` in
 * apps/app. Sending `''` is a 400 from the server and is now a parse error on
 * the client too, which is the whole point.
 */
export const createLeadRequestBase = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().optional(),
  email: z.string().email('Invalid email format').optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  source: z.enum(leadSourceValues).optional().default('manual'),
  status: z.enum(leadStatusValues).optional().default('new'),
  facebookLeadId: z.string().optional(),
  formData: z.record(z.string(), z.any()).optional(),
  assignedToId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  // Consent fields
  consentEmail: z.boolean().optional().default(false),
  consentSms: z.boolean().optional().default(false),
  consentVoice: z.boolean().optional().default(false),
  consentSource: z.enum(consentSourceValues).optional(),
});

/**
 * `POST /leads` body — the VALIDATING half. Use this everywhere a body is
 * parsed (API DTO, frontend payload builder). Unknown keys are rejected, so
 * `organizationId` in a body is an error, not a silently-ignored field.
 */
export const createLeadRequestSchema = createLeadRequestBase.strict();

export type CreateLeadRequest = z.infer<typeof createLeadRequestSchema>;

/**
 * `PUT /leads/:id` body — the EXTENDABLE half.
 *
 * A PATCH-shaped update: EVERY field is optional and an absent key means "leave
 * unchanged". That is why `firstName` is `.min(1).optional()` rather than
 * required — you may omit it, but you may not blank it, because a lead with an
 * empty name is not a state the server will store. The same reasoning gives
 * `email` its `.email()`: optional-but-well-formed. Both are the pair that
 * bites a form whose blank input defaults to `''` — see `buildUpdateLeadPayload`
 * in apps/app, which drops empty/whitespace-only strings to `undefined` before
 * parsing. `''` was a live 400 ("Invalid email format") for a client who simply
 * has no email; it is now a parse error at the boundary instead.
 *
 * Unlike {@link createLeadRequestBase} there are NO `.default()`s here: a
 * default on an update would silently rewrite a field the caller never
 * mentioned, which is the opposite of what a partial update means. `source` and
 * `status` are therefore plain optionals, not `.default()`ed ones.
 *
 * The enums come from `@borradh-workspace/labels`, not from a hand-typed union.
 * They had drifted once already: `meta_lead_form` / `whatsapp` leads could not
 * be edited AT ALL (every edit surface echoes the lead's own `source` back on
 * save, and the API 400'd on a value its hand-written copy had never heard of),
 * and `booked` / `cold` were unsettable. Deriving from the vocabulary is what
 * makes that class of bug unrepresentable.
 *
 * Context fields the SERVER injects, absent here:
 *  - `id`             — the `:id` route param.
 *  - `organizationId` — from the active-org session.
 */
export const updateLeadRequestBase = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().optional(),
  email: z.string().email('Invalid email format').optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  source: z.enum(leadSourceValues).optional(),
  status: z.enum(leadStatusValues).optional(),
  assignedToId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  /** Staff-internal. Never rendered in the customer portal. */
  notes: z.string().optional(),
  /** Shown to the customer in their portal — a separate field from `notes`. */
  portalNote: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  // Consent fields
  consentEmail: z.boolean().optional(),
  consentSms: z.boolean().optional(),
  consentVoice: z.boolean().optional(),
});

/**
 * `PUT /leads/:id` body — the VALIDATING half. Unknown keys are rejected, so
 * `id` or `organizationId` in a body is an error rather than a silently-ignored
 * field that gives the caller the false impression it targeted another lead.
 */
export const updateLeadRequestSchema = updateLeadRequestBase.strict();

export type UpdateLeadRequest = z.infer<typeof updateLeadRequestSchema>;

/*
 * `DELETE /leads/:id` has NO request contract, deliberately.
 *
 * Its feature schema (`deleteLeadSchema`) is entirely server-injected context —
 * `id` from the route param, `organizationId` from the session, `actorId` from
 * the authenticated user — and the controller declares no `@Body()` at all. A
 * `deleteLeadRequestBase` would be an empty object that documents nothing and
 * that the endpoint would never consult. Leave `deleteLeadSchema` hand-declared
 * in packages/features; there is no wire body for it to drift from.
 */

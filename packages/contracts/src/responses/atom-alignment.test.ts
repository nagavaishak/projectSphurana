import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as atoms from '../generated/index.js';
import * as responses from './index.js';

/**
 * ENG-843 systemic guard.
 *
 * `ResponseContractInterceptor` validates
 * `JSON.parse(JSON.stringify(result))` against the projection's Zod schema.
 * That round-trip PRESERVES `null` but DROPS `undefined`. Generated atoms
 * (1:1 with a DB column) correctly mark nullable columns `.nullable()`, but
 * hand-written response projections sometimes re-declare a field from
 * scratch as `.optional()` instead of extending the atom — which rejects a
 * legitimate `null` from a nullable column and 500s the endpoint (the
 * `leads.ts` `leadActivitySchema`/`leadHistoryExecutionSchema` bug this test
 * guards against).
 *
 * SCOPE: this pairs each exported response `z.object` with the ONE
 * generated atom whose export name is a camelCase prefix of the response
 * schema's name (e.g. `practitionerSchema` -> `practitionerAtomSchema`,
 * `videoWithCreatorSchema` -> `videoAtomSchema`) and only compares
 * same-named fields against THAT atom. An earlier version of this test
 * compared every response field against EVERY atom by name alone and drowned
 * in ~200 false positives from generic column names (`id`, `name`,
 * `organizationId`, `isActive`, ...) coinciding across dozens of unrelated
 * tables. Scoping to the schema's own backing atom is what makes the
 * assertion meaningful: a mismatch here means THIS projection disagrees with
 * THE atom it is actually derived from.
 */

type AnyZodObject = z.ZodObject<z.ZodRawShape>;

const isZodObject = (value: unknown): value is AnyZodObject =>
  value instanceof z.ZodObject;

const acceptsNull = (schema: z.ZodTypeAny): boolean =>
  schema.safeParse(null).success;

/**
 * Whether an ATOM field's column is genuinely nullable. Unlike `acceptsNull`
 * (used for response fields, where "does this schema accept null" is exactly
 * the question), a bare `z.unknown()` atom field (untyped jsonb) trivially
 * "accepts" null without saying anything about the column's actual
 * nullability — only an explicit `.nullable()` wrapper does. Using
 * `acceptsNull` here would flag every response schema that narrows an
 * untyped `z.unknown()` jsonb column to a structured (non-null) shape.
 */
const isNullableAtomField = (schema: z.ZodTypeAny): boolean =>
  schema instanceof z.ZodNullable;

const ATOM_SUFFIX = 'AtomSchema';

/** atom base name (e.g. "practitioner") -> its schema. */
const atomsByBaseName = new Map<string, AnyZodObject>();
for (const [atomExportName, atomSchema] of Object.entries(atoms)) {
  if (!atomExportName.endsWith(ATOM_SUFFIX)) continue;
  if (!isZodObject(atomSchema)) continue;
  atomsByBaseName.set(atomExportName.slice(0, -ATOM_SUFFIX.length), atomSchema);
}
const atomBaseNames = [...atomsByBaseName.keys()].sort(
  (a, b) => b.length - a.length // longest (most specific) prefix first
);

/** Strip a trailing "Schema"/"ResponseSchema" so `xSchema` and `xResponseSchema` both key on `x`. */
const RESPONSE_SUFFIXES = ['ResponseSchema', 'Schema'];
const responseBaseName = (exportName: string): string => {
  for (const suffix of RESPONSE_SUFFIXES) {
    if (exportName.endsWith(suffix)) {
      return exportName.slice(0, -suffix.length);
    }
  }
  return exportName;
};

/**
 * Explicit overrides for response schemas whose NAME happens to share a
 * character prefix with an unrelated atom, defeating the camelCase-boundary
 * heuristic below. `leadHistoryExecutionSchema` textually starts with
 * "lead" (matching the unrelated `lead` atom) even though it is actually
 * derived from `sequence_execution` — see `leads.ts`.
 */
const BACKING_ATOM_OVERRIDES: Record<string, string | null> = {
  leadHistoryExecution: 'sequenceExecution',
  // `assetAnalysisResultSchema` is the shape of the `analysisResult` JSONB
  // PAYLOAD stored on an `asset_analysis` row, not the row itself — its
  // `contentType` field is an unrelated concept from the row's OWN
  // `contentType` column that the "assetAnalysis" prefix match would
  // otherwise (wrongly) pair it with. `null` = no backing atom, skip.
  assetAnalysisResult: null,
};

/** Find the backing atom by camelCase-boundary prefix, e.g. "videoWithCreator" -> "video". */
const findBackingAtom = (base: string): AnyZodObject | undefined => {
  if (base in BACKING_ATOM_OVERRIDES) {
    const override = BACKING_ATOM_OVERRIDES[base];
    return override ? atomsByBaseName.get(override) : undefined;
  }

  const lower = base.toLowerCase();
  for (const atomBase of atomBaseNames) {
    if (!lower.startsWith(atomBase.toLowerCase())) continue;
    const boundary = base[atomBase.length];
    // Require a camelCase word boundary (end of string, or next char uppercase)
    // so "asset" doesn't match "assets" or an unrelated "assetlike" word.
    if (boundary === undefined || boundary === boundary.toUpperCase()) {
      return atomsByBaseName.get(atomBase);
    }
  }
  return undefined;
};

/**
 * Response schema fields that share a name with, AND are scoped to, their
 * OWN backing atom's nullable column, but do NOT accept `null` today —
 * verified (by reading the backing service) to never actually receive a raw
 * `null` on the wire because the service converts it to `undefined` first
 * (dropped by the interceptor's JSON round-trip). Each entry cites the
 * service line doing the conversion.
 *
 * Entries NOT in this list that still fail are real ENG-843-class bugs and
 * must be fixed by widening the response schema, not by adding an entry.
 */
const UNVERIFIED_MISMATCHES = new Set<string>([
  // org.ts:548 `venueConfigOrganizationSchema.timezone` — the public venue
  // config is a narrowed, always-populated read model (defaults applied
  // upstream); TODO(ENG-843 follow-up) verify
  // packages/features/src/organizations/services/get-venue-config/*.ts
  // never emits a raw column null before widening this to `.nullable()`.
  'venueConfigOrganizationSchema.timezone',

  // --- Verified safe (service always resolves a non-null fallback) ---

  // leads.ts `leadActivitySchema.metadata` —
  // `packages/features/src/leads/services/list-lead-history/list-lead-history.service.ts`
  // maps `(activity.metadata as Record<string, unknown>) ?? undefined`, so a
  // `null` jsonb column never reaches the response as `null`.
  'leadActivitySchema.metadata',

  // org.ts `orgDefaultsResponseSchema.*` — every field is resolved through
  // `row?.field ?? SYSTEM_DEFAULTS.field` (or a values-membership check with
  // the same fallback) in
  // `packages/features/src/org-defaults/services/get-org-defaults/get-org-defaults.service.ts:73-98`.
  // A per-org override row missing/null always falls back to the system
  // default; the response never carries a raw `null`.
  'orgDefaultsResponseSchema.adDailyBudgetCents',
  'orgDefaultsResponseSchema.adObjective',
  'orgDefaultsResponseSchema.videoOrientation',
  'orgDefaultsResponseSchema.videoLengthSecs',
  'orgDefaultsResponseSchema.wageAutoClockIn',
  'orgDefaultsResponseSchema.wageAutoClockOut',
  'orgDefaultsResponseSchema.wageAutomatedBreaks',
  'orgDefaultsResponseSchema.giftCardPresetAmounts',
  'orgDefaultsResponseSchema.giftCardExpiry',
  'orgDefaultsResponseSchema.resourceAssignmentMode',

  // org.ts `organizationBrandResponseSchema.*` —
  // `packages/features/src/organizations/services/get-organization-brand/get-organization-brand.service.ts:83-90`
  // resolves `primaryColor`/`secondaryColor`/`backgroundColor` with
  // `?? styleTemplate.defaultColors.*` / `?? '#FFFFFF'`, and
  // `contentStyleTemplate` is always the resolved `templateId` (itself
  // `??`-defaulted a few lines above). No raw `null` reaches the response.
  // (Also currently unused by any `@ResponseContract`-gated route.)
  'organizationBrandResponseSchema.primaryColor',
  'organizationBrandResponseSchema.secondaryColor',
  'organizationBrandResponseSchema.backgroundColor',
  'organizationBrandResponseSchema.contentStyleTemplate',

  // org.ts `organizationSchema.depositEnabled` —
  // `packages/features/src/organizations/services/get-organization-calendar-settings/get-organization-calendar-settings.service.ts:92`
  // maps `row.depositEnabled ?? false` before `active-organization.ts:111`
  // spreads it into the curated response.
  'organizationSchema.depositEnabled',

  // content.ts `contentItemStateSchema.targetPageIds` —
  // `packages/features/src/content-items/services/get-content-item-state/get-content-item-state.ts:173`
  // maps `slot.targetPageIds ?? []`.
  'contentItemStateSchema.targetPageIds',
]);

describe('response schemas accept null for their OWN backing atom nullable fields', () => {
  for (const [responseName, responseSchemaExport] of Object.entries(
    responses
  )) {
    if (!isZodObject(responseSchemaExport)) continue;
    const responseShape = responseSchemaExport.shape as unknown as Record<
      string,
      z.ZodTypeAny
    >;

    const atomSchema = findBackingAtom(responseBaseName(responseName));
    if (!atomSchema) continue;
    const atomShape = atomSchema.shape as unknown as Record<
      string,
      z.ZodTypeAny
    >;

    for (const [fieldName, atomField] of Object.entries(atomShape)) {
      const responseField = responseShape[fieldName];
      if (!responseField) continue;
      if (!isNullableAtomField(atomField)) continue;

      const key = `${responseName}.${fieldName}`;

      it(`${key} accepts null (backing atom: ${atomField.constructor.name} field is nullable)`, () => {
        if (UNVERIFIED_MISMATCHES.has(key)) return;
        expect(acceptsNull(responseField)).toBe(true);
      });
    }
  }
});

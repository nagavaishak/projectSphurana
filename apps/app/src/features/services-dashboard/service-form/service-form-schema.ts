import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { centsToMajorString, parseMajorToCents } from '@/lib/org-currency';
import type {
  OrganizationService,
  PractitionerWithRelations,
  ServiceResourceRequirementView,
} from '@borradh-workspace/api-client/types';
import { depositBasisLabels } from '@borradh-workspace/api-client/types';
import type { ServiceVariantResponse } from '@borradh-workspace/contracts';
import {
  type ServicePriceType,
  servicePriceTypeValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * ONE declaration of the service form, shared by the desktop wizard
 * (`create-service-dialog` / `edit-service-dialog`), the mobile funnel
 * (`mobile/service-mobile-form-page`) and onboarding's service setup.
 *
 * Schema, defaults, labels and controls all live on the field's own line —
 * `service-form-fields.tsx` renders `serviceForm.labels.x`, so the label the
 * user reads and the label the contract harness locates by cannot drift.
 *
 * Aligned to the API contract in
 * `packages/features/src/organization-services/services/{create,update}-service`:
 *   name                 min(1).max(100)
 *   description          max(500)          <- NOT 1000
 *   appointmentDuration  int().min(5).max(480)
 *   priceText            max(200)
 */

export const SERVICE_NAME_MAX = 100;
export const SERVICE_DESCRIPTION_MAX = 500;
export const SERVICE_DURATION_MIN = 5;
export const SERVICE_DURATION_MAX = 480;

/**
 * The four structured price shapes (fixed | from | free | poa), the SOURCE OF
 * TRUTH from `@borradh-workspace/labels`. Replaces the old freeform `priceText`:
 * on save the form sends `(priceType, priceCents)`, never a display string.
 */
export const priceTypeValues = servicePriceTypeValues;
export type PriceType = ServicePriceType;

/** `fixed`/`from` carry an amount; `free`/`poa` do not. */
export function priceTypeHasAmount(priceType: PriceType): boolean {
  return priceType === 'fixed' || priceType === 'from';
}

/** The " (optional)" suffix `FieldShell` renders muted. It is part of the label. */
export const OPTIONAL_LABEL_SUFFIX = ' (optional)';

export const serviceForm = defineForm({
  fields: {
    name: {
      schema: z
        .string()
        .trim()
        .min(1, 'Service name is required')
        .max(
          SERVICE_NAME_MAX,
          `Name must be ${SERVICE_NAME_MAX} characters or fewer`
        ),
      label: 'Service Name',
      control: 'text',
      default: '',
      sample: 'Balayage',
    },
    /** Empty string = uncategorised (no `categoryId` sent). */
    categoryId: {
      schema: z.string(),
      label: 'Menu Category',
      control: 'select',
      default: '',
      sample: 'cat_skin',
      // The option shows the category's NAME; the form stores its id.
      sampleLabel: 'Skin',
    },
    description: {
      schema: z
        .string()
        .max(
          SERVICE_DESCRIPTION_MAX,
          `Description must be ${SERVICE_DESCRIPTION_MAX} characters or fewer`
        ),
      label: `Description${OPTIONAL_LABEL_SUFFIX}`,
      control: 'textarea',
      default: '',
      sample: 'A colour treatment',
    },
    /**
     * Whether a booking for this service takes an upfront deposit. Per-service
     * flag (reaches the wire 1:1 as `requiresDeposit`) that the chatbot and the
     * public booking config read. NOTE: the booking-form checkout currently
     * charges the deposit at the ORG level (`org.depositEnabled` /
     * `org.depositAmount`) — this per-service flag drives messaging/config, not
     * yet the checkout gate. Declared BEFORE `depositAmount` so a full-fill
     * turns the switch on (revealing the amount) before typing into it.
     */
    requiresDeposit: {
      schema: z.boolean(),
      label: 'Requires a deposit',
      control: 'switch',
      default: false,
      sample: true,
    },
    /**
     * The deposit amount as typed, in major units ("25" / "25.00"). Reaches the
     * wire as `depositAmountCents`; only meaningful when `requiresDeposit` is on.
     */
    depositAmount: {
      schema: z.string(),
      label: `Deposit amount${OPTIONAL_LABEL_SUFFIX}`,
      control: 'number',
      default: '',
      sample: '25',
      derived: true,
    },
    /**
     * Override the org's deposit basis for THIS service. `inherit` sends null,
     * meaning "whatever the clinic's default says" — the common case, and the
     * reason this is not a bare fixed/percent toggle.
     *
     * Declared AFTER `depositAmount` because only one amount input renders at a
     * time: switching to `percent` hides the fixed field, so a full-fill has to
     * reach the fixed amount first.
     */
    depositBasis: {
      schema: z.enum(['inherit', 'fixed', 'percent']),
      label: 'Deposit type',
      control: 'select',
      default: 'inherit' as const,
      sample: 'percent' as const,
      sampleLabel: depositBasisLabels.percent,
    },
    /** Whole percent of this service's price. Only used when basis = percent. */
    depositPercent: {
      schema: z.string(),
      label: `Deposit percentage${OPTIONAL_LABEL_SUFFIX}`,
      control: 'number',
      default: '',
      sample: '20',
      derived: true,
    },
    durationMinutes: {
      schema: z
        .number()
        .int('Duration must be a whole number of minutes')
        .min(
          SERVICE_DURATION_MIN,
          `Duration must be at least ${SERVICE_DURATION_MIN} minutes`
        )
        .max(
          SERVICE_DURATION_MAX,
          `Duration must be ${SERVICE_DURATION_MAX} minutes or less`
        ),
      label: 'Duration',
      control: 'select',
      default: 60,
      sample: 90,
      sampleLabel: '1hr 30',
      // Reaches the wire as `appointmentDuration`.
      derived: true,
    },
    priceType: {
      schema: z.enum(priceTypeValues),
      label: 'Price Type',
      control: 'select',
      default: 'fixed',
      sample: 'from',
      sampleLabel: 'From',
      // Reaches the wire as `priceType`; with `priceAmount` (→ `priceCents`)
      // these are the structured replacement for the dead `priceText` column.
      derived: true,
    },
    /** Raw amount as typed, e.g. "50" or "50.00". Empty = no price. */
    priceAmount: {
      schema: z.string(),
      label: `Price${OPTIONAL_LABEL_SUFFIX}`,
      control: 'number',
      default: '',
      sample: '75',
      derived: true,
    },
    /** Empty = use the connected Stripe account's preset product tax code. */
    taxCode: {
      schema: z.string(),
      label: 'Tax code',
      control: 'custom',
      default: '',
      sample: '',
      // The payload builder converts the form's empty string to null.
      derived: true,
    },
    /**
     * Practitioners that can perform this service (a service with none is
     * unbookable). `derived`, because it never reaches the organization-services
     * body: the surfaces reconcile it through `PUT practitioners/:id/services`,
     * its own registered operation.
     *
     * The label is the select-all checkbox the team step renders; the individual
     * practitioners are checkboxes named after them, so the contract drives it.
     */
    practitionerIds: {
      schema: z.array(z.string()),
      label: 'All team members',
      control: 'custom',
      default: [],
      sample: ['prac_1'],
      derived: true,
    },
  },
});

export const serviceFormSchema = serviceForm.schema;
export const serviceFormFields = serviceForm.fields;
export const emptyServiceForm = serviceForm.defaults;

export type ServiceFormValues = InferFormValues<typeof serviceForm>;

/**
 * Turn `(priceType, priceCents)` into the integer cents the wire wants.
 * `free`/`poa` never carry an amount → null; `fixed`/`from` parse the raw major
 * amount the user typed (empty/invalid → null, which the server reads as POA).
 */
export function priceAmountToCents(
  priceType: PriceType,
  rawValue: string
): number | null {
  if (!priceTypeHasAmount(priceType)) return null;
  return parseMajorToCents(rawValue);
}

/**
 * Derive the form's (priceType, priceAmount) from a saved service's STRUCTURED
 * fields — never from the dead `priceText`. A service with no `priceType`
 * (legacy / freshly seeded) infers `fixed` when it has a `priceCents`, else the
 * schema default.
 */
export function serviceToPrice(service: {
  priceType?: ServicePriceType | null;
  priceCents?: number | null;
}): { priceType: PriceType; priceAmount: string } {
  const priceType: PriceType = service.priceType ?? 'fixed';
  return {
    priceType,
    priceAmount: priceTypeHasAmount(priceType)
      ? centsToMajorString(service.priceCents ?? null)
      : '',
  };
}

/** Hydrate the form from a saved service + the practitioners assigned to it. */
export function serviceToFormValues(
  service: OrganizationService,
  practitioners: PractitionerWithRelations[] = []
): ServiceFormValues {
  const price = serviceToPrice(service);

  return {
    ...emptyServiceForm,
    name: service.name,
    categoryId: service.categoryId ?? '',
    description: service.description ?? '',
    requiresDeposit: service.requiresDeposit ?? false,
    depositAmount: centsToMajorString(service.depositAmountCents ?? null),
    depositBasis: service.depositBasis ?? 'inherit',
    depositPercent:
      service.depositPercent != null ? String(service.depositPercent) : '',
    durationMinutes:
      service.appointmentDuration != null
        ? Number(service.appointmentDuration)
        : emptyServiceForm.durationMinutes,
    priceType: price.priceType,
    priceAmount: price.priceAmount,
    taxCode: service.taxCode ?? '',
    practitionerIds: practitioners
      .filter((p) => p.services?.some((s) => s.serviceId === service.id))
      .map((p) => p.id),
  };
}

// ---------------------------------------------------------------------------
// Variant drafts — the collapsible variants editor's local state
// ---------------------------------------------------------------------------

/**
 * A row in the variants editor. `id` is present for a persisted variant, absent
 * for a freshly-added one. `priceAmount` is the raw major-unit string the user
 * typed (parsed to cents on save, mirroring the service-level amount).
 */
export interface VariantDraft {
  /** Stable React key — a persisted id, or a client-minted `new-*` token. */
  key: string;
  id?: string;
  name: string;
  priceAmount: string;
  durationMinutes: number | null;
}

let variantKeySeq = 0;
export function newVariantDraft(): VariantDraft {
  variantKeySeq += 1;
  return {
    key: `new-${variantKeySeq}`,
    name: '',
    priceAmount: '',
    durationMinutes: null,
  };
}

/** Persisted variants → editable drafts, by sortOrder (server already sorts). */
export function variantsToDrafts(
  variants: ServiceVariantResponse[]
): VariantDraft[] {
  return variants.map((v) => ({
    key: v.id,
    id: v.id,
    name: v.name,
    priceAmount: centsToMajorString(v.priceCents ?? null),
    durationMinutes: v.durationMinutes,
  }));
}

/** The floor price across the drafts, in cents — the "from" anchor. Null if none priced. */
export function minVariantPriceCents(drafts: VariantDraft[]): number | null {
  const priced = drafts
    .map((d) => parseMajorToCents(d.priceAmount))
    .filter((c): c is number => c != null);
  return priced.length ? Math.min(...priced) : null;
}

export interface ServiceFormErrors {
  name?: string;
  description?: string;
  durationMinutes?: string;
}

/** Validate through the shared zod schema; returns field-keyed messages. */
export function validateServiceForm(values: ServiceFormValues): {
  valid: boolean;
  errors: ServiceFormErrors;
} {
  const parsed = serviceFormSchema.safeParse(values);
  if (parsed.success) return { valid: true, errors: {} };

  const errors: ServiceFormErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (key === 'name' || key === 'description' || key === 'durationMinutes') {
      errors[key] ??= issue.message;
    }
  }
  return { valid: false, errors };
}

// ---------------------------------------------------------------------------
// Resource requirement drafts — the "Rooms & equipment" section's local state
// ---------------------------------------------------------------------------

/**
 * One "this service needs a resource from category X" rule, as the form holds
 * it before it is saved.
 *
 * `eligibleResourceIds` EMPTY means **any resource in the category qualifies**
 * — it is NOT "nothing qualifies". This is the org-wide-by-default convention
 * the backend uses (see `SetServiceResourceRequirementsInput` in api-client):
 * an empty list writes zero eligibility rows, so every resource in the category
 * stays eligible, including ones added later. Inverting this reading would make
 * every slot for the service unbookable.
 *
 * A category with NO draft in the array is not required at all.
 */
export interface ResourceRequirementDraft {
  categoryId: string;
  /** EMPTY = any resource in this category. A non-empty list narrows it. */
  eligibleResourceIds: string[];
}

/** Turnaround is a 0–240 minute buffer, stepped in 5s to match the calendar grid. */
export const TURNAROUND_MIN = 0;
export const TURNAROUND_MAX = 240;
export const TURNAROUND_STEP = 5;

/**
 * `0` and `null` both mean "no turnaround"; the wire carries `null` so the
 * column stays clean (and the calendar's "has a cleanup tail" check can stay a
 * plain null test).
 */
export function turnaroundToWire(minutes: number): number | null {
  return minutes > 0 ? Math.round(minutes) : null;
}

/** Clamp a typed/stepped turnaround into the accepted 0–240 range. */
export function clampTurnaround(minutes: number): number {
  if (!Number.isFinite(minutes)) return TURNAROUND_MIN;
  return Math.min(
    TURNAROUND_MAX,
    Math.max(TURNAROUND_MIN, Math.round(minutes))
  );
}

/** Saved requirements → editable drafts. The empty-means-any semantic rides through. */
export function requirementsToDrafts(
  views: ServiceResourceRequirementView[]
): ResourceRequirementDraft[] {
  return views.map((view) => ({
    categoryId: view.categoryId,
    eligibleResourceIds: [...view.eligibleResourceIds],
  }));
}

/** Order-insensitive comparison, so an untouched form doesn't re-write the set. */
export function sameRequirementDrafts(
  a: ResourceRequirementDraft[],
  b: ResourceRequirementDraft[]
): boolean {
  if (a.length !== b.length) return false;
  const key = (d: ResourceRequirementDraft) =>
    `${d.categoryId}:${[...d.eligibleResourceIds].sort().join(',')}`;
  const left = a.map(key).sort();
  const right = b.map(key).sort();
  return left.every((value, index) => value === right[index]);
}

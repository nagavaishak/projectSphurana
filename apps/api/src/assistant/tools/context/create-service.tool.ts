import { organizationServiceSchema } from '@borradh-workspace/contracts';
import {
  type ServiceCategory,
  serviceCategoryValues,
  servicePriceTypeValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const createServiceInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'Service name (e.g. "Lip Filler 0.5ml", "Anti-Wrinkle Treatment").'
    ),
  category: z
    .enum(serviceCategoryValues)
    .describe(
      'Service category. Must be one of: treatment, procedure, product, ' +
        'consultation, other. Used to group services in the UI and for ad ' +
        'targeting context.'
    ),
  description: z
    .string()
    .max(2000)
    .optional()
    .describe('Short public-facing description shown on the booking page.'),
  pricingDescription: z
    .string()
    .max(500)
    .optional()
    .describe(
      'Human-readable pricing note (e.g. "From €250 per session"). ' +
        'Do NOT include specific surgical pricing for cosmetic/hair-restoration clinics.'
    ),
  priceType: z
    .enum(servicePriceTypeValues)
    .optional()
    .describe(
      'Structured price shape. One of: "fixed" (one set price), "from" (a floor, ' +
        '"From €50"), "free" (no charge), "poa" (price on consultation — unknown ' +
        'or quoted in person). Set this whenever the price is stated. For "fixed"/' +
        '"from" also pass `priceCents`; for "free"/"poa" omit it. If unsure, use "poa".'
    ),
  priceCents: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'Structured list price in cents (e.g. 5000 = €50.00). The all-in, ' +
        'tax-inclusive anchor in the org currency. Only for priceType "fixed" ' +
        '(the price) or "from" (the floor). NEVER guess a number — omit it if unknown.'
    ),
  isActive: z
    .boolean()
    .default(true)
    .describe(
      'Whether the service is immediately visible and bookable. Default: true.'
    ),
  requiresDeposit: z
    .boolean()
    .optional()
    .describe(
      'Whether a deposit (or consultation fee) is required to book this service. ' +
        'If true, set `depositAmountCents` as well. A Stripe payment link is ' +
        'auto-generated on creation when both are provided.'
    ),
  depositAmountCents: z
    .number()
    .int()
    .min(100)
    .optional()
    .describe(
      'Deposit / consultation fee amount in cents (e.g. 5000 = €50.00). ' +
        'Minimum 100 (€1.00). Only used when `requiresDeposit` is true.'
    ),
  appointmentDurationMinutes: z
    .number()
    .int()
    .min(5)
    .max(480)
    .optional()
    .describe(
      'Default appointment duration for this service, in minutes (5–480). ' +
        'Used by the calendar/booking system to block out the right amount of time.'
    ),
  variants: z
    .array(
      z.object({
        name: z
          .string()
          .min(1)
          .max(100)
          .describe('Variant label, e.g. "1 Area", "Course of 3", "60 min".'),
        priceCents: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            'Variant price in cents (e.g. 12000 = €120). Omit if not yet priced.'
          ),
        durationMinutes: z
          .number()
          .int()
          .min(5)
          .max(480)
          .optional()
          .describe(
            'Variant-specific duration in minutes (5–480). Overrides the service default when set.'
          ),
      })
    )
    .optional()
    .describe(
      'Optional customer-chosen pricing options ("1 Area / 3 Areas", ' +
        '"single / course of 3"). When a service has priced variants it ' +
        'displays as "From {cheapest}", so set priceType "from" alongside. ' +
        'Each variant is created after the service.'
    ),
  confirmationToken: z
    .string()
    .optional()
    .describe(
      'Confirmation token from the first call. Pass back unchanged on execution.'
    ),
});

interface CreateServiceOutput {
  serviceId: string;
  name: string;
  /** Non-null enum column; the hand-written type this replaces said nullable. */
  category: ServiceCategory;
  isActive: boolean;
  variantsCreated: number;
}

/**
 * `context_createService` — create a new service for the organization.
 *
 * Destructive (creates a DB record visible to all users immediately if
 * `isActive: true`). Uses the factory two-call confirmation flow. The
 * operator reviews name, category, and active status before creation.
 *
 * After creation, operators can use `updateService` to set additional
 * details (pain points, process description, deposit, etc.) from the
 * Services dashboard.
 */
export const createServiceTool = defineTool<
  z.infer<typeof createServiceInputSchema>,
  CreateServiceOutput
>({
  feature: 'context',
  action: 'createService',
  description:
    'Create a new service for the organization. Requires operator confirmation. ' +
    'The service can be set as active immediately (visible to customers) or ' +
    'inactive (hidden until activated). After creation, further details ' +
    '(pain points, process, deposit) can be filled in from the Services dashboard.',
  inputSchema: createServiceInputSchema,
  destructive: true,
  destructiveAction: 'create_service',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Creating service' },
  additionalAllowedPaths: [
    /^organization-services$/,
    /^organization-services\/[a-zA-Z0-9_-]+$/,
    /^organization-services\/[a-zA-Z0-9_-]+\/variants$/,
  ],
  summarizeForConfirmation: async (input) => ({
    title: `Create service "${input.name}"`,
    fields: [
      { label: 'Service name', value: input.name },
      { label: 'Category', value: input.category },
      {
        label: 'Active immediately',
        value:
          input.isActive !== false
            ? 'Yes (visible to customers)'
            : 'No (hidden)',
      },
      ...(input.requiresDeposit
        ? [
            {
              label: 'Deposit',
              value: input.depositAmountCents
                ? `Required — €${(input.depositAmountCents / 100).toFixed(2)} (payment link generated).`
                : 'Required (payment link generated).',
            },
          ]
        : []),
      ...(input.variants && input.variants.length > 0
        ? [
            {
              label: 'Variants',
              value: input.variants.map((v) => v.name).join(', '),
            },
          ]
        : []),
      ...(input.description
        ? [
            {
              label: 'Description',
              value:
                input.description.slice(0, 100) +
                (input.description.length > 100 ? '…' : ''),
            },
          ]
        : []),
    ],
    resourceId: `service:${input.name}`,
    payload: {
      name: input.name,
      category: input.category,
      isActive: input.isActive,
    },
  }),
  execute: async (input, ctx) => {
    // `POST /organization-services` returns the created service row (or the
    // deposit-link-enriched row — same shape either way).
    const service = await ctx.apiFetch('organization-services', {
      schema: organizationServiceSchema,
      method: 'POST',
      body: {
        name: input.name,
        category: input.category,
        description: input.description,
        // The feature schema/DTO field is `priceText`, NOT `pricingDescription`
        // — the old name was silently dropped by validation (the field-name
        // bug). Send freeform pricing as priceText and the structured price
        // as priceType/priceCents.
        priceText: input.pricingDescription,
        priceType: input.priceType,
        priceCents: input.priceCents,
        isActive: input.isActive,
        requiresDeposit: input.requiresDeposit,
        depositAmountCents: input.depositAmountCents,
        // Feature service uses `appointmentDuration` (minutes); we expose
        // the field as `appointmentDurationMinutes` to the LLM for clarity.
        appointmentDuration: input.appointmentDurationMinutes,
      },
    });

    // Variants are a separate resource — create them one-per-call against the
    // new service. `organizationId` + `serviceId` are injected server-side
    // (active-org context + route param), so the body carries only the value
    // fields. `sortOrder` follows the array order the operator gave.
    let variantsCreated = 0;
    if (input.variants && input.variants.length > 0) {
      for (const [index, variant] of input.variants.entries()) {
        await ctx.apiFetch(`organization-services/${service.id}/variants`, {
          method: 'POST',
          body: {
            name: variant.name,
            priceCents: variant.priceCents,
            durationMinutes: variant.durationMinutes,
            sortOrder: index,
          },
        });
        variantsCreated += 1;
      }
    }

    return {
      data: {
        serviceId: service.id,
        name: service.name,
        category: service.category,
        isActive: service.isActive,
        variantsCreated,
      },
    };
  },
});

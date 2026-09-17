import {
  organizationServiceSchema,
  serviceVariantSchema,
} from '@borradh-workspace/contracts';
import {
  serviceCategoryValues,
  servicePriceTypeValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const updateServiceInputSchema = z.object({
  serviceId: z
    .string()
    .min(1)
    .describe(
      'ID of the service to update (cuid2 — not a UUID; values come from listServices).'
    ),
  name: z.string().min(1).max(200).optional().describe('New service name.'),
  category: z
    .enum(serviceCategoryValues)
    .optional()
    .describe(
      'New category. Must be one of: treatment, procedure, product, consultation, other.'
    ),
  description: z
    .string()
    .max(2000)
    .optional()
    .describe('Updated public-facing description.'),
  pricingDescription: z
    .string()
    .max(500)
    .optional()
    .describe('Updated freeform pricing note.'),
  priceType: z
    .enum(servicePriceTypeValues)
    .optional()
    .describe(
      'Updated structured price shape. One of: "fixed", "from", "free", "poa". ' +
        'For "fixed"/"from" also pass `priceCents`; for "free"/"poa" omit it.'
    ),
  priceCents: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'Updated structured list price in cents (e.g. 5000 = €50.00). Only for ' +
        'priceType "fixed" (the price) or "from" (the floor). NEVER guess — omit if unknown.'
    ),
  isActive: z
    .boolean()
    .optional()
    .describe(
      'Set to false to hide the service from customers without deleting it.'
    ),
  variants: z
    .array(
      z.object({
        name: z
          .string()
          .min(1)
          .max(100)
          .describe(
            'Variant label. Matched against existing variants by name — a ' +
              'match updates that variant, a new name adds one.'
          ),
        priceCents: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Variant price in cents (e.g. 12000 = €120).'),
        durationMinutes: z
          .number()
          .int()
          .min(5)
          .max(480)
          .optional()
          .describe('Variant-specific duration in minutes (5–480).'),
      })
    )
    .optional()
    .describe(
      'Add or update customer-chosen pricing options. Upserted by name: an ' +
        'existing variant with the same name is updated, a new name is added. ' +
        'This does not delete variants you omit.'
    ),
  confirmationToken: z
    .string()
    .optional()
    .describe(
      'Confirmation token from the first call. Pass back unchanged on execution.'
    ),
});

/**
 * The four columns this tool reads off `GET|PUT /organization-services/:id`.
 *
 * `.pick()`ed rather than parsed whole: both routes return the full row today
 * (`updateService` ends in a bare `.returning()`), but a whole-row parse throws
 * on ANY unrelated column drift, and this tool sits behind a confirmation the
 * operator has already approved — failing the write-back read is a worse
 * outcome than the drift it would report.
 */
const serviceLookupSchema = organizationServiceSchema.pick({
  id: true,
  name: true,
  category: true,
  isActive: true,
});

interface UpdateServiceOutput {
  serviceId: string;
  name: string;
  category: string | null;
  isActive: boolean;
  variantsUpserted: number;
}

/**
 * `GET /organization-services/:id/variants` returns `{ items }` — whole
 * `organization_service_variant` rows from a bare `findMany`. Narrowed to the
 * two fields the name-match below uses.
 */
const listVariantsResponseSchema = z.object({
  items: z.array(serviceVariantSchema.pick({ id: true, name: true })),
});

/**
 * `context_updateService` — update an existing service's details.
 *
 * Destructive (changes live booking content). Uses the factory two-call
 * confirmation flow. Only fields provided are updated (PATCH semantics).
 *
 * Toggling `isActive: false` is a soft-hide: the service stops appearing
 * in the booking widget but is not deleted. Useful when a treatment is
 * temporarily unavailable.
 */
export const updateServiceTool = defineTool<
  z.infer<typeof updateServiceInputSchema>,
  UpdateServiceOutput
>({
  feature: 'context',
  action: 'updateService',
  description:
    'Update an existing service. Only provided fields are changed (PATCH). ' +
    'Requires operator confirmation. To find the serviceId, call `listServices` ' +
    'or `getServiceDetails`. Setting `isActive: false` hides the service from ' +
    'the booking widget without deleting it.',
  inputSchema: updateServiceInputSchema,
  destructive: true,
  destructiveAction: 'update_service',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Updating service' },
  additionalAllowedPaths: [
    /^organization-services\/[a-zA-Z0-9_-]+$/,
    /^organization-services\/[a-zA-Z0-9_-]+\/variants$/,
    /^organization-services\/variants\/[a-zA-Z0-9_-]+$/,
  ],
  summarizeForConfirmation: async (input, ctx) => {
    const service = await ctx.apiFetch(
      `organization-services/${input.serviceId}`,
      { schema: serviceLookupSchema }
    );

    const changes: Array<{ label: string; value: string }> = [];
    if (input.name !== undefined)
      changes.push({ label: 'Name', value: input.name });
    if (input.category !== undefined)
      changes.push({ label: 'Category', value: input.category });
    if (input.description !== undefined)
      changes.push({
        label: 'Description',
        value:
          input.description.slice(0, 80) +
          (input.description.length > 80 ? '…' : ''),
      });
    if (input.isActive !== undefined)
      changes.push({
        label: 'Active',
        value: input.isActive ? 'Yes (visible)' : 'No (hidden)',
      });
    if (input.variants && input.variants.length > 0)
      changes.push({
        label: 'Variants',
        value: input.variants.map((v) => v.name).join(', '),
      });

    return {
      title: `Update service "${service.name}"`,
      fields: [{ label: 'Service', value: service.name }, ...changes],
      resourceId: input.serviceId,
      payload: {
        serviceId: input.serviceId,
        ...Object.fromEntries(
          Object.entries(input).filter(
            ([k, v]) =>
              k !== 'serviceId' && k !== 'confirmationToken' && v !== undefined
          )
        ),
      },
    };
  },
  execute: async (input, ctx) => {
    const updateBody: Record<string, unknown> = {};
    if (input.name !== undefined) updateBody.name = input.name;
    if (input.category !== undefined) updateBody.category = input.category;
    if (input.description !== undefined)
      updateBody.description = input.description;
    // The feature schema/DTO field is `priceText`, NOT `pricingDescription` —
    // the old name was silently dropped by validation (the field-name bug).
    if (input.pricingDescription !== undefined)
      updateBody.priceText = input.pricingDescription;
    if (input.priceType !== undefined) updateBody.priceType = input.priceType;
    if (input.priceCents !== undefined)
      updateBody.priceCents = input.priceCents;
    if (input.isActive !== undefined) updateBody.isActive = input.isActive;

    const service = await ctx.apiFetch(
      `organization-services/${input.serviceId}`,
      { schema: serviceLookupSchema, method: 'PUT', body: updateBody }
    );

    // Variants are upserted by name: fetch the current set once, then PUT a
    // matching name or POST a new one. We never delete — omitting a variant
    // leaves it untouched (the confirmation summary said as much).
    let variantsUpserted = 0;
    if (input.variants && input.variants.length > 0) {
      const existing = await ctx.apiFetch(
        `organization-services/${input.serviceId}/variants`,
        { schema: listVariantsResponseSchema }
      );
      const byName = new Map(
        existing.items.map((v) => [v.name.toLowerCase(), v.id])
      );
      for (const variant of input.variants) {
        const matchId = byName.get(variant.name.toLowerCase());
        const body = {
          name: variant.name,
          priceCents: variant.priceCents,
          durationMinutes: variant.durationMinutes,
        };
        if (matchId) {
          await ctx.apiFetch(`organization-services/variants/${matchId}`, {
            method: 'PUT',
            body,
          });
        } else {
          await ctx.apiFetch(
            `organization-services/${input.serviceId}/variants`,
            { method: 'POST', body }
          );
        }
        variantsUpserted += 1;
      }
    }

    return {
      data: {
        serviceId: service.id,
        name: service.name,
        category: service.category,
        isActive: service.isActive,
        variantsUpserted,
      },
    };
  },
});

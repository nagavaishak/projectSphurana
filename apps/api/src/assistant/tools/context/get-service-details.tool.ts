import {
  type OrganizationService,
  organizationServiceSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

/**
 * `context_getServiceDetails` — load full details for one service.
 *
 * Ported from the legacy `getServiceDetails` tool in `context-tools.ts`.
 *
 * The hand-written `ServiceDetailResponse` this replaces claimed a
 * `pricingDescription` field that `organization_service` does not have (the
 * real columns are `priceText` / `priceType` / `priceCents`) and typed
 * `category` as nullable when it is a non-null enum. Neither caused a runtime
 * defect HERE — this tool returns the response verbatim, so the real fields
 * always reached the model regardless of what the interface said. That is the
 * distinction worth keeping: the sibling `listServices` mapped field-by-field,
 * so the same wrong name silently dropped the price on every call. An asserted
 * type is only as harmful as the code that trusts it.
 *
 * `GET /organization-services/:id` returns the bare row (no `variants`, no
 * media-gating booleans), so the contract is `organizationServiceSchema`, not
 * `listedServiceSchema`.
 */
export const getServiceDetailsTool = defineTool<
  { serviceId: string },
  OrganizationService
>({
  feature: 'context',
  action: 'getServiceDetails',
  description:
    'Get full details for a specific service including pain points, ' +
    'expected results, process description, and pricing ' +
    '(priceType/priceCents, with priceText as legacy free text).',
  inputSchema: z.object({
    serviceId: z
      .string()
      .min(1)
      .describe('The service ID to look up (cuid2, from listServices).'),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Loading service details' },
  execute: async ({ serviceId }, ctx) => {
    const data = await ctx.apiFetch(`organization-services/${serviceId}`, {
      schema: organizationServiceSchema,
    });
    return { data };
  },
});

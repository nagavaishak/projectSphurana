import type {
  ServiceCategory,
  ServicePriceType,
} from '@borradh-workspace/labels';
import { z } from 'zod';
import { defineTool, fetchServiceCatalogue } from '../../tool-factory/index.js';

interface ServiceListEntry {
  id: string;
  name: string;
  category: ServiceCategory;
  description: string | null;
  isActive: boolean;
  /**
   * Structured price, replacing the freeform `pricingDescription` this tool
   * used to report. See the note on `execute` — that field never existed on
   * the wire, so it was `null` for every service on every call.
   */
  priceType: ServicePriceType;
  priceCents: number | null;
  /** Legacy free-text price. Still populated on older rows; may be null. */
  priceText: string | null;
  /** True when the service carries ≥1 pricing option, i.e. price is a "from". */
  hasVariants: boolean;
}

interface ListServicesOutput {
  services: ServiceListEntry[];
  total: number;
}

/**
 * `context_listServices` — list services offered by the organization.
 *
 * Fetches the WHOLE catalogue so Claire can look up a service by name without
 * paginating. Server-side default is `limit=10`, which previously caused
 * Claire to miss services past the first page when picking a default for
 * "create a video about X"; raising that to the endpoint's 100-item cap moved
 * the same cliff rather than removing it, so `fetchServiceCatalogue` now walks
 * every page.
 *
 * Ported from the legacy `listServices` tool in `context-tools.ts`.
 *
 * PRICING: this tool used to return `pricingDescription`, which is not a field
 * on `organization_service` and is not on the wire — so it read `undefined`
 * and reported `null` for every service, on every call, and Claire could never
 * quote a price from this tool. The write path already knew the real name
 * (`update-service.tool.ts` maps `pricingDescription` → `priceText` with a
 * comment saying so); only the read path was wrong. Its unit tests mocked
 * `pricingDescription`, so the suite stayed green over a dead field — the same
 * correlated-mock failure as `meta_ads_generateAdCopy`.
 *
 * The real pricing model is `priceType` + `priceCents` + variants (with
 * `priceText` surviving as legacy free text). All four are reported so the
 * caller can phrase a price without guessing; `formatServicePrice` in
 * `@borradh-workspace/labels` is the canonical renderer, but it needs a
 * currency symbol this endpoint does not return, so the raw fields are passed
 * through rather than a half-formatted string.
 */
export const listServicesTool = defineTool<
  Record<string, never>,
  ListServicesOutput
>({
  feature: 'context',
  action: 'listServices',
  description:
    'List all services offered by the organization. Returns service IDs, ' +
    'names, categories, active status and pricing (priceType/priceCents, ' +
    'plus hasVariants when the service has multiple priced options). ' +
    'Fetches the full catalogue — every service, however many there are — ' +
    'so service-name lookups never miss a hit on a later page.',
  inputSchema: z.object({}),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Listing services' },
  execute: async (_input, ctx) => {
    const data = await fetchServiceCatalogue(ctx.apiFetch);
    return {
      data: {
        services: data.items.map((s) => ({
          id: s.id,
          name: s.name,
          category: s.category,
          description: s.description,
          isActive: s.isActive,
          priceType: s.priceType,
          priceCents: s.priceCents,
          priceText: s.priceText,
          hasVariants: s.variants.length > 0,
        })),
        total: data.total,
      },
    };
  },
});

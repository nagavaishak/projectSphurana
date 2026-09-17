import { db } from '@borradh-workspace/database';
import {
  type SuggestIntroOfferOutput,
  suggestIntroOffer,
} from '@borradh-workspace/features/claire';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

/**
 * `offers_suggestIntroOffer` — the deterministic intro-offer backbone shared by
 * the offer-video flow and the create-campaign flow.
 *
 * Given a service, it returns one of:
 *   - a ready-to-create new-client intro offer (30–40% below the regular
 *     one-session price) with a plain-language "why" for Claire to relay,
 *   - the existing active offer that already works as an intro (so Claire
 *     reuses it instead of making a duplicate),
 *   - `needsPrice: true` when the one-session price can't be parsed — Claire
 *     asks the owner "what's a single session of X?" and re-calls with
 *     `oneSessionPrice`,
 *   - `advisable: false` for POM / surgical services, with the reason to relay
 *     (POM can't be advertised; surgical sells the consultation, not a price).
 *
 * Non-destructive: this only proposes. Claire still calls `createOffer` to
 * actually create the suggested offer once the owner confirms.
 */
export const suggestIntroOfferTool = defineTool<
  {
    serviceId: string;
    oneSessionPrice?: number;
    offerPrice?: number;
    targetDiscountPercent?: number;
  },
  SuggestIntroOfferOutput | { error: string }
>({
  feature: 'offers',
  action: 'suggestIntroOffer',
  description:
    'Build the get-in-the-door, new-client-only intro offer for a service ' +
    '(30–40% below the regular one-session price), or reuse an existing one ' +
    'that already fits. Call this when the owner wants an offer video or a ' +
    'campaign for a service, BEFORE createOffer. Returns: a `suggested` offer ' +
    'to create (with a `why` to explain to the owner), and/or an `existingFit` ' +
    "offer to reuse. The regular price is read from the service's pricing when " +
    "it's there: `priceSource: 'parsed'` means it came from the service " +
    '(present it for confirmation — "your regular price is X, so I\'d run the ' +
    'intro at Y — happy with that?", using the org\'s own currency symbol — the ' +
    'owner corrects if the parse is off). ' +
    "`priceSource: 'owner'` means the owner stated it. If `needsPrice` is true, " +
    "the price could not be read from the service's pricing AND the owner gave " +
    'none — ask the owner ONE thing only: what they NORMALLY charge for a ' +
    'single session. Do not ask what intro price they want. Call again with ' +
    '`oneSessionPrice`, then STATE the resulting 30–40%-below offer and ask for ' +
    'approval (not direction). `suggested.offerPriceCents` is a curated intro ' +
    'price (a charm price, deeper discount for pricier services) — state the ' +
    'regular price and propose that one price ("you normally charge X — I\'d ' +
    'run the intro at Y", in the org\'s own currency), then ask for a yes. Only pass `offerPrice` ' +
    'if the owner pushes back and names their own intro price. If `advisable` ' +
    'is false (POM/surgical), relay `advisoryReason` instead of making a price ' +
    'offer. serviceId is a cuid2 from listServices — pass it through verbatim.',
  inputSchema: z.object({
    serviceId: z
      .string()
      .min(1)
      .describe(
        'The service the intro offer is for (cuid2 from listServices).'
      ),
    oneSessionPrice: z
      .number()
      .positive()
      .optional()
      .describe(
        "The regular price for ONE session, in the org's currency as whole/" +
          'decimal major units (not cents). Pass this when the owner states a ' +
          'price in chat, or after a previous call returned needsPrice: true.'
      ),
    offerPrice: z
      .number()
      .positive()
      .optional()
      .describe(
        "The intro/first-visit price the owner wants, in the org's currency " +
          'as major units (not cents). Pass this when the owner sets the intro ' +
          'price themselves instead of taking the 30–40%-below suggestion.'
      ),
    targetDiscountPercent: z
      .number()
      .int()
      .min(30)
      .max(40)
      .optional()
      .describe(
        'Intro discount, 30–40%. Defaults to 35% (middle of the band). Only ' +
          'set if the owner asks for a specific depth within the band.'
      ),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Shaping the intro offer' },
  execute: async (input, ctx) => {
    const result = await suggestIntroOffer(db, {
      organizationId: ctx.organizationId,
      serviceId: input.serviceId,
      oneSessionPrice: input.oneSessionPrice,
      offerPrice: input.offerPrice,
      targetDiscountPercent: input.targetDiscountPercent,
    });

    if (!result.success) {
      return { data: { error: result.error.message } };
    }
    return { data: result.data };
  },
});

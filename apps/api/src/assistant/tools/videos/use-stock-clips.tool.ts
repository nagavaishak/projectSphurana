import { mintStockClipsResponseSchema } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

interface UseStockClipsOutput {
  /** `stockClipId -> assetId`, ready for clipOperations / bRollClips. */
  assetIds?: Record<string, string>;
  /** In the order the clips were requested, for a straight swap. */
  orderedAssetIds?: string[];
  count?: number;
  error?: string;
}

/**
 * `videos_useStockClips` — turn picked stock clips into usable org assets.
 *
 * Copy-on-attach: mints an org-owned `asset` row per stock clip, which from
 * then on behaves exactly like uploaded footage.
 *
 * Minting is the END of the chat-driven clip search: the owner described what
 * they wanted, this found it, and Claire says which clip she used. Placing it is
 * the card's job on web, and `patchContent` decides it on WhatsApp — there is no
 * tool here that takes an asset id and an index, deliberately, because that was
 * the shape Claire used to reorder videos she had never seen.
 *
 * This endpoint was previously marked notExposed on the grounds that it "mints
 * presigned preview URLs … useless to a model". That described the BROWSE
 * endpoint, not this one — it returns asset ids, and the mistake is why Claire
 * had no route to stock footage at all and told owners to go and upload clips
 * instead.
 *
 * Mint only what is being attached. Listing is free; this is not.
 */
export const useStockClipsTool = defineTool<
  { stockClipIds: string[] },
  UseStockClipsOutput
>({
  feature: 'videos',
  action: 'useStockClips',
  description:
    'Turn stock clips (from videos_listStockClips) into org-owned assets so ' +
    'they can be used as b-roll. Use this when the owner DESCRIBED the footage ' +
    'they want ("something with the treatment room") — searching is yours to ' +
    'do. Say which clip you picked so they can redirect you. ' +
    'Only mint the clips actually being attached.',
  inputSchema: z.object({
    stockClipIds: z
      .array(z.string().min(1))
      .min(1)
      .max(10)
      .describe(
        'The stockClipIds to attach, from videos_listStockClips. Pass them in ' +
          'the order they should appear.'
      ),
  }),
  // Attaching footage is ordinary content work for a team member. It spends
  // nothing: minting copies a curated clip into the org's library, and the
  // render it feeds is gated separately.
  policy: 'member',
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Adding stock footage' },
  execute: async (input, ctx) => {
    try {
      const data = await ctx.apiFetch('videos/stock-clips/mint', {
        schema: mintStockClipsResponseSchema,
        method: 'POST',
        body: { stockClipIds: input.stockClipIds },
      });

      // Requested order preserved: "swap the second clip" needs ONE id, and
      // the map's key order is not something to rely on.
      const orderedAssetIds = input.stockClipIds
        .map((id) => data.assetIds[id])
        .filter((id): id is string => Boolean(id));

      return {
        data: {
          assetIds: data.assetIds,
          orderedAssetIds,
          count: orderedAssetIds.length,
        },
      };
    } catch (error) {
      return {
        data: {
          error:
            error instanceof Error ? error.message : 'Failed to attach clips',
        },
      };
    }
  },
});

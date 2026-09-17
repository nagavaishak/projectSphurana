import { listStockClipsResponseSchema } from '@borradh-workspace/contracts';
import type { AvailableAsset } from '@borradh-workspace/contracts/ports';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

interface ListMediaOutput {
  /** Uploads. Carry an asset id and can be attached as they are. */
  assets?: AvailableAsset[];
  /**
   * Stock. Carry a `stockClipId` and NO asset id — stock is copy-on-attach, so
   * a clip becomes usable only when `useStockClips` mints it.
   */
  clips?: {
    stockClipId: string;
    description: string | null;
    durationSec: number | null;
    isGeneric: boolean;
  }[];
  total?: number;
  error?: string;
}

/**
 * `content_listMedia` — what the org can build a post out of.
 *
 * ONE TOOL over two sources. `listAvailableAssets` read uploads and
 * `listStockClips` read the curated bank, which is the same question — "what
 * footage is there?" — asked of two shelves. Two tools made that a decision
 * Claire had to get right before she could answer it, and getting it wrong had
 * a specific failure: reading only uploads, finding none, and telling the owner
 * to go and film something. Most orgs have no uploads for a given service and
 * their videos are already being built from stock, so that answer was both
 * wrong and discouraging.
 *
 * `listDraftClips` is deliberately NOT folded in. "What is already on this
 * draft" is a different question from "what could go on it" — it is the state
 * of one thing, not a catalogue — and merging them would mean a `source` that
 * sometimes means a shelf and sometimes means a specific video.
 *
 * Listing is free and claims nothing. Minting is not: `useStockClips` is what
 * turns a chosen stock clip into an org asset, and only what is being attached
 * should go through it.
 */
export const listMediaTool = defineTool<
  {
    source?: 'uploads' | 'stock';
    serviceId?: string;
    type?: 'video' | 'image';
  },
  ListMediaOutput
>({
  feature: 'content',
  action: 'listMedia',
  description:
    'List media the org has available — both what they can build a post out ' +
    'of and what is simply in their library. `source: "uploads"` (default) is ' +
    'their own uploaded footage and images; `source: "stock"` is the curated ' +
    'stock video bank. ALSO use this to answer standalone browse asks — ' +
    '"what have I uploaded", "show me my library / gallery / media", "list ' +
    'my photos / videos", "what pictures do I have on file" — the owner ' +
    'wanting to see what they have on file is a valid ask on its own, not ' +
    'only inside a creation flow. Pass serviceId to narrow to a treatment ' +
    'when the ask names one — recommended, since it puts relevant footage ' +
    'first; omit it for the general library view. STOCK IS A FIRST-CLASS ' +
    'SOURCE, not a fallback: an org with no uploads is the normal case, and ' +
    'telling someone to go and film footage they do not have is a dead end. ' +
    'Listing costs nothing; pass chosen stockClipIds to useStockClips to ' +
    'turn them into usable assets. To read what is already ON a draft, use ' +
    'listDraftClips instead — that is a different question.',
  inputSchema: z.object({
    source: z
      .enum(['uploads', 'stock'])
      .optional()
      .describe(
        'Which shelf. Defaults to uploads. Check stock whenever uploads come ' +
          'back empty or thin — it is where most videos are actually built from.'
      ),
    serviceId: z
      .string()
      .min(1)
      .optional()
      .describe('Narrow to a treatment. Recommended for relevant footage.'),
    type: z
      .enum(['video', 'image'])
      .optional()
      .describe('Uploads only — the stock bank listed here is video.'),
  }),
  destructive: false,
  // Browsing the library is org-scoped content work — any team member.
  policy: 'member',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Looking through the library' },
  execute: async (input, ctx) => {
    if (input.source === 'stock') {
      try {
        const qs = input.serviceId
          ? `?serviceId=${encodeURIComponent(input.serviceId)}&mediaType=video`
          : '?mediaType=video';
        const data = await ctx.apiFetch(`videos/stock-clips${qs}`, {
          schema: listStockClipsResponseSchema,
        });
        return {
          // No card. Stock tiles have no asset id yet, so a picker built from
          // them would hand back ids nothing can attach — the grid the owner
          // picks stock from is the one inside the clip editor, which mints on
          // confirm.
          data: {
            clips: data.items.map((clip) => ({
              stockClipId: clip.stockClipId,
              description: clip.description,
              durationSec: clip.durationSec,
              isGeneric: clip.isGeneric,
            })),
            total: data.items.length,
          },
        };
      } catch (error) {
        return {
          data: {
            error:
              error instanceof Error
                ? error.message
                : 'Failed to list stock clips',
          },
        };
      }
    }

    const { assets } = await ctx.ports.videos.listAvailableAssets({
      serviceId: input.serviceId,
      type: input.type,
    });

    return {
      // A grid the owner picks from by eye. Which shot is right is a judgement
      // made by looking; a list of sentences is a worse version of a UI that
      // already exists.
      presentation: {
        type: 'asset_picker' as const,
        assets,
        total: assets.length,
      },
      data: { assets, total: assets.length },
    };
  },
});

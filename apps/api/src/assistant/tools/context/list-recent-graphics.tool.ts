import { listGraphicsResponseSchema } from '@borradh-workspace/contracts';
import type { GraphicUsageType } from '@borradh-workspace/labels';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const GRAPHIC_STATUSES = ['draft', 'rendering', 'ready', 'failed'] as const;
type GraphicStatus = (typeof GRAPHIC_STATUSES)[number];

interface GraphicListItem {
  id: string;
  /**
   * The post this graphic belongs to — the id every EDIT takes.
   *
   * `id` addresses the image; `itemId` addresses the post, and `patchContent`
   * takes nothing but the item. Handing back only the graphic id is what left
   * Claire passing an asset id where an item id belonged, which returns a
   * not-found that reads exactly like "this post cannot be edited".
   */
  itemId: string | null;
  title: string;
  status: string;
  usageType: GraphicUsageType;
  kind: string;
  serviceId: string | null;
  topicSummary: string | null;
  /**
   * The words actually ON the image, as rendered.
   *
   * `topicSummary` is what we asked the model FOR; this is what it produced.
   * They differ, and the difference matters: an owner says "change the one that
   * says no mascara, no curler", quoting text off a slide. Matching that
   * against `topicSummary` picks whichever graphic was BRIEFED closest, which
   * can easily be a different graphic from the one showing the line.
   */
  renderedCopy: string | null;
  aspectRatio: string | null;
  /** Preview thumbnail for the first slide, when rendered. */
  thumbnailUrl: string | null;
  /** Full-res image for the first slide, when rendered. */
  imageUrl: string | null;
  /** Number of rendered slides (1 for single, N for carousel). */
  slideCount: number;
  createdAt: string;
}

interface ListRecentGraphicsInput {
  limit?: number;
  status?: GraphicStatus;
}

interface ListRecentGraphicsOutput {
  graphics: GraphicListItem[];
  total: number;
}

/**
 * `context_listRecentGraphics` — list recently created social graphics.
 *
 * Mirrors `listRecentVideos`: gives Claire a way to *find* an existing graphic
 * before acting on it (e.g. regenerating it with a change request). Without
 * this she can create graphics but has no way to target one to edit.
 *
 * Calls `GET /graphics?limit=&status=`. The list endpoint orders by newest
 * first and re-signs rendered output URLs, so `imageUrl`/`thumbnailUrl` are
 * directly loadable. Use `status="ready"` to find finished graphics; the
 * default returns the most recent regardless of render state.
 */
export const listRecentGraphicsTool = defineTool<
  ListRecentGraphicsInput,
  ListRecentGraphicsOutput
>({
  feature: 'context',
  action: 'listRecentGraphics',
  description:
    'List recently created social graphics for the organization. Shows ' +
    'title, status, kind (single/carousel), the service it promotes, a ' +
    'preview image once rendered, and renderedCopy — the words actually ON ' +
    'the image. Use this to FIND a graphic the user wants to edit: call it ' +
    'first, then match the one they mean. When the user QUOTES text ("change ' +
    'the no mascara no curler bit"), match against renderedCopy — that is the ' +
    'text they can see. topicSummary is only what the graphic was briefed ' +
    'from and often differs from what was produced, so matching on it picks ' +
    'the wrong graphic. Fall back to service/topic/recency only when nothing ' +
    'is quoted. Then pass the id to regenerateGraphic. Use status="ready" to ' +
    'list only finished graphics.',
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('Max graphics to return (default: 10)'),
    status: z
      .enum(GRAPHIC_STATUSES)
      .optional()
      .describe(
        'Filter by render status (e.g. "ready" for finished graphics).'
      ),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Listing recent graphics' },
  execute: async ({ limit, status }, ctx) => {
    const params = new URLSearchParams();
    params.set('limit', String(limit ?? 10));
    if (status) params.set('status', status);
    const qs = params.toString();

    const data = await ctx.apiFetch(`graphics${qs ? `?${qs}` : ''}`, {
      schema: listGraphicsResponseSchema,
    });

    // The list endpoint already filters by status when the query param is set
    // (`listGraphicsSchema` declares `status`), but re-filter client-side as a
    // defensive belt-and-braces.
    let items = data.items;
    if (status) {
      items = items.filter((g) => g.status === status);
    }

    return {
      data: {
        graphics: items.map((g) => {
          const outputs = g.outputs ?? [];
          const first =
            outputs.find((o) => (o.slideOrder ?? 0) === 0) ??
            outputs[0] ??
            null;
          return {
            id: g.id,
            // `?? null` because the wire field is optional as well as
            // nullable — an older API can omit it entirely.
            itemId: g.itemId ?? null,
            title: g.title ?? 'Graphic',
            status: g.status,
            usageType: g.usageType,
            kind: g.kind,
            serviceId: g.serviceId,
            topicSummary: g.topicSummary,
            renderedCopy: g.renderedCopy ?? null,
            aspectRatio: g.aspectRatio,
            thumbnailUrl: first?.thumbnailUrl ?? first?.url ?? null,
            imageUrl: first?.url ?? null,
            slideCount: outputs.length,
            createdAt: g.createdAt,
          };
        }),
        total: items.length,
      },
    };
  },
});

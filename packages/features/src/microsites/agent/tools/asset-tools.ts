/**
 * The imagery tools: `search_org_assets`, `generate_image`.
 *
 * Blocks reference an asset by ID (`imageAssetId`, `assetIds`), never by URL —
 * URLs here are signed and expire, and a page that stored one would break
 * silently weeks later. Both tools therefore return ids; the preview URL is
 * returned only so the model can describe what it found, never to be written
 * into a block.
 *
 * `search_org_assets` is preferred over `generate_image` and the description
 * says so: the business's real photographs are always a better website than
 * invented ones, and a generated image costs money per call.
 */

import {
  getOrgAssetsBucket,
  getPresignedDownloadUrl,
  getSignedCdnUrl,
  isCdnEnabled,
  upload,
} from '@borradh-workspace/storage';
import { z } from 'zod';
// Through the sibling context's PUBLIC barrel, not a deep path into its
// internals — the cross-context gate enforces this, and a deep import couples
// us to another domain's file layout.
import { createAsset, listAssets } from '../../../assets/index.js';
import { generateAiImage } from '../../../image-generation/index.js';
import { ok } from '../../../shared/index.js';
import { err } from '../../../shared/index.js';
import { toFeatureError } from '../../services/shared/errors.js';
import { defineMicrositeTool } from '../define-tool.js';

/** Bounding boxes the image model is cued with. Values are hints, not crops. */
const ASPECT_BBOX = {
  square: { w: 1024, h: 1024 },
  landscape: { w: 1536, h: 864 },
  portrait: { w: 864, h: 1536 },
} as const;

export const searchOrgAssetsTool = defineMicrositeTool({
  name: 'search_org_assets',
  description:
    "Search the business's own photo library by name. Always prefer a real photograph of the business over a generated image. Returns asset ids to put in a block's imageAssetId or assetIds.",
  inputSchema: z.object({
    query: z.string().trim().min(1).max(120),
    limit: z.number().int().min(1).max(20).default(8),
  }),
  mutating: false,
  execute: async (ctx, input) => {
    const result = await listAssets(ctx.db, {
      organizationId: ctx.session.organizationId,
      type: 'image',
      search: input.query,
      limit: input.limit,
      offset: 0,
    });
    if (!result.success) return err(toFeatureError(result.error));

    const items = result.data.items.map((item) => ({
      assetId: item.id,
      name: item.name,
      width: item.width,
      height: item.height,
    }));

    return ok({
      data: { assets: items, total: result.data.total },
      summary: `Searched the photo library for "${input.query}" (${items.length} match${items.length === 1 ? '' : 'es'})`,
      mutated: false,
    });
  },
});

export const generateImageTool = defineMicrositeTool({
  name: 'generate_image',
  description:
    'Generate a new image for the website when the photo library has nothing suitable. Describe the scene, not the business — never generate a picture of a real person or a claimed result. Returns an asset id.',
  inputSchema: z.object({
    prompt: z.string().trim().min(8).max(600),
    aspect: z.enum(['square', 'landscape', 'portrait']).default('landscape'),
  }),
  mutating: false,
  execute: async (ctx, input) => {
    const generated = await generateAiImage({
      prompt: input.prompt,
      bbox: ASPECT_BBOX[input.aspect],
    });
    if (!generated.success) return err(toFeatureError(generated.error));

    const bucket = getOrgAssetsBucket();
    const key = `${ctx.session.organizationId}/microsites/${ctx.session.micrositeId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.png`;
    await upload({
      bucket,
      key,
      body: generated.data.png,
      contentType: 'image/png',
    });
    const blobUrl = isCdnEnabled()
      ? getSignedCdnUrl(key)
      : await getPresignedDownloadUrl({ bucket, key });

    const asset = await createAsset(ctx.db, {
      organizationId: ctx.session.organizationId,
      // The staff member driving the turn owns what the agent made for them.
      uploadedById: ctx.session.userId,
      name: input.prompt.slice(0, 60),
      blobUrl,
      type: 'image',
      source: 'edited',
      tags: ['microsite', 'ai-generated'],
      placeholderTypes: [],
    });
    if (!asset.success) return err(toFeatureError(asset.error));

    return ok({
      data: {
        assetId: asset.data.id,
        orientation: generated.data.orientation,
      },
      summary: `Generated a ${input.aspect} image for the website`,
      mutated: false,
    });
  },
});

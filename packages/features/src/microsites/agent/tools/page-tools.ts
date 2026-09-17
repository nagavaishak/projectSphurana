/**
 * The page tools: `create_page`, `delete_page`, `update_seo`.
 *
 * `delete_page` is destructive: it returns a confirmation requirement the
 * SIDEBAR acts on (contract §3). The gate is a set supplied by the request —
 * the model has no field to set — so "the user said it was fine" is not
 * something the model can assert its way into.
 */

import { z } from 'zod';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import { defineMicrositeTool } from '../define-tool.js';
import {
  deleteDraftPage,
  insertDraftPage,
  loadDraft,
  requirePage,
  writePageSeo,
} from '../draft-writer.js';
import { confirmationKey } from '../guardrails.js';
import {
  blockTypeSchema,
  newBlockId,
  parseBlock,
  pathSchema,
  resolveRequestedVariant,
} from './shared.js';

export const createPageTool = defineMicrositeTool({
  name: 'create_page',
  description:
    'Create a new page with an initial set of blocks. The path must be url-safe and must not already exist.',
  inputSchema: z.object({
    path: pathSchema,
    title: z.string().trim().min(1).max(120),
    blocks: z
      .array(
        z.object({
          type: blockTypeSchema,
          variant: z.string().min(1).optional(),
          props: z.record(z.string(), z.unknown()),
        })
      )
      .max(20)
      .default([]),
  }),
  mutating: true,
  execute: async (ctx, input) => {
    const draft = await loadDraft(ctx.db, ctx.session);
    if (!draft.success) return draft;

    if (draft.data.pages.some((page) => page.path === input.path)) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          `There is already a page at ${input.path}. Edit it instead of creating a second one.`
        )
      );
    }

    const blocks = [];
    for (const candidate of input.blocks) {
      const parsed = parseBlock({
        id: newBlockId(),
        type: candidate.type,
        variant: resolveRequestedVariant(candidate.type, candidate.variant),
        props: candidate.props,
      });
      if (!parsed.success) return parsed;
      blocks.push(parsed.data);
    }

    const order =
      draft.data.pages.reduce((max, page) => Math.max(max, page.order), 0) + 1;

    const created = await insertDraftPage(ctx.db, ctx.session, {
      path: input.path,
      title: input.title,
      blocks,
      order,
    });
    if (!created.success) return created;

    return ok({
      data: {
        pageId: created.data.id,
        path: input.path,
        blocks: blocks.length,
      },
      summary: `Created the page ${input.path} ("${input.title}")`,
      mutated: true,
    });
  },
});

export const deletePageTool = defineMicrositeTool({
  name: 'delete_page',
  description:
    'Delete a page and everything on it. The user is asked to confirm before this runs. System pages (the home page) cannot be deleted.',
  inputSchema: z.object({ path: pathSchema }),
  mutating: true,
  destructive: true,
  confirmation: async (input) => ({
    action: confirmationKey('delete_page', input.path),
    prompt: `Delete the page ${input.path} and every block on it? This cannot be undone except by restoring an earlier version.`,
  }),
  execute: async (ctx, input) => {
    const draft = await loadDraft(ctx.db, ctx.session);
    if (!draft.success) return draft;

    const page = requirePage(draft.data, input.path);
    if (!page.success) return page;

    if (page.data.isSystem) {
      return err(
        new FeatureError(
          ErrorCodes.FORBIDDEN,
          `${input.path} is a system page and cannot be deleted. Offer to change what is on it instead.`,
          { guardrail: 'system_page' }
        )
      );
    }

    const deleted = await deleteDraftPage(ctx.db, ctx.session, page.data.id);
    if (!deleted.success) return deleted;

    return ok({
      data: { path: input.path, blocksRemoved: page.data.blocks.length },
      summary: `Deleted the page ${input.path}`,
      mutated: true,
    });
  },
});

export const updateSeoTool = defineMicrositeTool({
  name: 'update_seo',
  description:
    'Set the search-engine title and description for one page. Both are optional; pass null to clear one.',
  inputSchema: z.object({
    path: pathSchema,
    title: z.string().trim().max(70).nullable().optional(),
    description: z.string().trim().max(320).nullable().optional(),
  }),
  mutating: true,
  execute: async (ctx, input) => {
    const draft = await loadDraft(ctx.db, ctx.session);
    if (!draft.success) return draft;

    const page = requirePage(draft.data, input.path);
    if (!page.success) return page;

    // Absent = leave alone, null/empty = clear. Same convention as
    // `update_block`, and built by re-assembly rather than mutation so an
    // absent key really is absent in the stored jsonb.
    const seo = {
      ...page.data.seo,
      ...(input.title !== undefined ? { title: input.title || undefined } : {}),
      ...(input.description !== undefined
        ? { description: input.description || undefined }
        : {}),
    };
    for (const key of ['title', 'description'] as const) {
      if (seo[key] === undefined) delete seo[key];
    }

    const written = await writePageSeo(ctx.db, ctx.session, page.data.id, seo);
    if (!written.success) return written;

    return ok({
      data: { path: input.path, seo },
      summary: `Updated the search listing for ${input.path}`,
      mutated: true,
    });
  },
});

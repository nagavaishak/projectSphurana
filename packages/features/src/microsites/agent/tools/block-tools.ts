/**
 * The block tools: `add_block`, `update_block`, `move_block`, `delete_block`.
 *
 * `update_block` takes a PATCH (contract §2). The patch is merged onto the
 * CURRENT props and the merged object is re-validated against the block's own
 * schema, so the model can change one field without re-emitting the rest — and
 * cannot produce a shape the renderer chokes on either way.
 *
 * `delete_block` carries the conversion-path guardrail (contract §3): the
 * booking call-to-action cannot leave the home page. That is enforced against
 * the DOCUMENT — the block's type on the block's page — and not against the
 * model's stated intention.
 */

import { z } from 'zod';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import { defineMicrositeTool } from '../define-tool.js';
import { blockPrecis } from '../document-summary.js';
import {
  loadDraft,
  requireBlock,
  requirePage,
  writePageBlocks,
} from '../draft-writer.js';
import {
  conversionBlockRefusal,
  isProtectedConversionBlock,
} from '../guardrails.js';
import { applyPropsPatch, patchedKeys } from '../patch.js';
import {
  blockTypeSchema,
  newBlockId,
  parseBlock,
  pathSchema,
  resolveRequestedVariant,
} from './shared.js';

const propsRecord = z.record(z.string(), z.unknown());

export const addBlockTool = defineMicrositeTool({
  name: 'add_block',
  description:
    'Add a block to a page. `props` must match the block type (see the block catalogue in your instructions). Omit `afterBlockId` to append at the end of the page.',
  inputSchema: z.object({
    path: pathSchema,
    type: blockTypeSchema,
    variant: z.string().min(1).optional(),
    props: propsRecord,
    afterBlockId: z.string().min(1).optional(),
  }),
  mutating: true,
  execute: async (ctx, input) => {
    const draft = await loadDraft(ctx.db, ctx.session);
    if (!draft.success) return draft;

    const page = requirePage(draft.data, input.path);
    if (!page.success) return page;

    const candidate = parseBlock({
      id: newBlockId(),
      type: input.type,
      variant: resolveRequestedVariant(input.type, input.variant),
      props: input.props,
    });
    if (!candidate.success) return candidate;

    const blocks = [...page.data.blocks];
    const at = input.afterBlockId
      ? blocks.findIndex((block) => block.id === input.afterBlockId)
      : -1;
    if (input.afterBlockId && at === -1) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          `There is no block "${input.afterBlockId}" on ${input.path}.`
        )
      );
    }
    const index = at === -1 ? blocks.length : at + 1;
    blocks.splice(index, 0, candidate.data);

    const written = await writePageBlocks(
      ctx.db,
      ctx.session,
      page.data.id,
      blocks
    );
    if (!written.success) return written;

    return ok({
      data: {
        blockId: candidate.data.id,
        path: input.path,
        type: candidate.data.type,
        variant: candidate.data.variant,
        index,
      },
      summary: `Added a ${candidate.data.type.replace('_', ' ')} section to ${input.path}`,
      mutated: true,
    });
  },
});

export const updateBlockTool = defineMicrositeTool({
  name: 'update_block',
  description:
    'Change some of a block’s props. `propsPatch` is a PATCH: include only the fields you are changing, and they are merged onto the current props. Use null to clear an optional field. Arrays replace rather than append.',
  inputSchema: z.object({
    path: pathSchema,
    blockId: z.string().min(1),
    propsPatch: propsRecord,
  }),
  mutating: true,
  execute: async (ctx, input) => {
    const draft = await loadDraft(ctx.db, ctx.session);
    if (!draft.success) return draft;

    const page = requirePage(draft.data, input.path);
    if (!page.success) return page;

    const found = requireBlock(page.data, input.blockId);
    if (!found.success) return found;

    const merged = parseBlock({
      id: found.data.block.id,
      type: found.data.block.type,
      variant: found.data.block.variant,
      props: applyPropsPatch(
        found.data.block.props as unknown as Record<string, unknown>,
        input.propsPatch
      ),
    });
    if (!merged.success) return merged;

    const blocks = [...page.data.blocks];
    blocks[found.data.index] = merged.data;

    const written = await writePageBlocks(
      ctx.db,
      ctx.session,
      page.data.id,
      blocks
    );
    if (!written.success) return written;

    return ok({
      data: {
        blockId: merged.data.id,
        path: input.path,
        changed: patchedKeys(input.propsPatch),
        block: merged.data,
      },
      summary: `Updated the ${merged.data.type.replace('_', ' ')} section on ${input.path} (${patchedKeys(input.propsPatch).join(', ') || 'no fields'})`,
      mutated: true,
    });
  },
});

export const moveBlockTool = defineMicrositeTool({
  name: 'move_block',
  description:
    'Move a block to a new position on the same page. `toIndex` is zero-based; 0 puts the block first.',
  inputSchema: z.object({
    path: pathSchema,
    blockId: z.string().min(1),
    toIndex: z.number().int().min(0),
  }),
  mutating: true,
  execute: async (ctx, input) => {
    const draft = await loadDraft(ctx.db, ctx.session);
    if (!draft.success) return draft;

    const page = requirePage(draft.data, input.path);
    if (!page.success) return page;

    const found = requireBlock(page.data, input.blockId);
    if (!found.success) return found;

    const blocks = [...page.data.blocks];
    const [moved] = blocks.splice(found.data.index, 1);
    const target = Math.min(input.toIndex, blocks.length);
    blocks.splice(target, 0, moved);

    const written = await writePageBlocks(
      ctx.db,
      ctx.session,
      page.data.id,
      blocks
    );
    if (!written.success) return written;

    return ok({
      data: { blockId: moved.id, path: input.path, index: target },
      summary: `Moved the ${moved.type.replace('_', ' ')} section to position ${target + 1} on ${input.path}`,
      mutated: true,
    });
  },
});

export const deleteBlockTool = defineMicrositeTool({
  name: 'delete_block',
  description:
    'Remove a block from a page. The booking call-to-action on the home page cannot be removed.',
  inputSchema: z.object({
    path: pathSchema,
    blockId: z.string().min(1),
  }),
  mutating: true,
  execute: async (ctx, input) => {
    const draft = await loadDraft(ctx.db, ctx.session);
    if (!draft.success) return draft;

    const page = requirePage(draft.data, input.path);
    if (!page.success) return page;

    const found = requireBlock(page.data, input.blockId);
    if (!found.success) return found;

    // The conversion path is not the model's decision (contract §3).
    if (isProtectedConversionBlock(page.data.path, found.data.block.type)) {
      return err(conversionBlockRefusal());
    }

    const removed = found.data.block;
    const blocks = page.data.blocks.filter(
      (block) => block.id !== input.blockId
    );

    const written = await writePageBlocks(
      ctx.db,
      ctx.session,
      page.data.id,
      blocks
    );
    if (!written.success) return written;

    return ok({
      data: { blockId: removed.id, path: input.path, type: removed.type },
      summary: `Removed the ${removed.type.replace('_', ' ')} section from ${input.path} (${blockPrecis(removed)})`,
      mutated: true,
    });
  },
});

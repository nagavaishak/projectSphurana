/**
 * The read tools: `list_pages`, `read_page`, `preview`.
 *
 * Everything they return is the ORG'S OWN CONTENT, which is untrusted input to
 * the model — a service description is a prompt-injection path. They therefore
 * return DATA, never prose the model is invited to act on, and the turn's
 * system prompt states the rule once (see build-turn-context.ts).
 */

import { z } from 'zod';
import { ok } from '../../../shared/index.js';
import { defineMicrositeTool } from '../define-tool.js';
import { outlineDocument, outlinePage } from '../document-summary.js';
import { loadDraft, requirePage } from '../draft-writer.js';
import { pathSchema } from './shared.js';

export const listPagesTool = defineMicrositeTool({
  name: 'list_pages',
  description:
    'List every page of the website draft with its path, title and a one-line outline of each block. Use this before editing so you address blocks by their real ids.',
  // Anthropic requires an object schema even for a no-argument tool.
  inputSchema: z.object({}),
  mutating: false,
  execute: async (ctx) => {
    const draft = await loadDraft(ctx.db, ctx.session);
    if (!draft.success) return draft;

    const pages = outlineDocument(draft.data);
    return ok({
      data: { pages },
      summary: `Looked at the site structure (${pages.length} page${pages.length === 1 ? '' : 's'})`,
      mutated: false,
    });
  },
});

export const readPageTool = defineMicrositeTool({
  name: 'read_page',
  description:
    'Read one page in full: its title, SEO metadata and every block with its complete props. Call this when you need the current wording or settings of a block, not just its outline.',
  inputSchema: z.object({ path: pathSchema }),
  mutating: false,
  execute: async (ctx, input) => {
    const draft = await loadDraft(ctx.db, ctx.session);
    if (!draft.success) return draft;

    const page = requirePage(draft.data, input.path);
    if (!page.success) return page;

    return ok({
      data: {
        path: page.data.path,
        title: page.data.title,
        isSystem: page.data.isSystem,
        seo: page.data.seo,
        blocks: page.data.blocks,
      },
      summary: `Read ${page.data.path}`,
      mutated: false,
    });
  },
});

export const previewTool = defineMicrositeTool({
  name: 'preview',
  description:
    'Return the current draft outline and theme so you can check your work before telling the user you are done. The user sees the live preview in the canvas beside the chat.',
  inputSchema: z.object({}),
  mutating: false,
  execute: async (ctx) => {
    const draft = await loadDraft(ctx.db, ctx.session);
    if (!draft.success) return draft;

    return ok({
      data: {
        slug: draft.data.slug,
        theme: draft.data.theme,
        pages: draft.data.pages.map(outlinePage),
      },
      summary: 'Checked the draft preview',
      mutated: false,
    });
  },
});

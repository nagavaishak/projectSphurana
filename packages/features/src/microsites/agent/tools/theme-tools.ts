/**
 * `update_theme` — the site-wide look (contract §2).
 *
 * A PATCH, for the same reason `update_block` is: a full theme replace makes
 * the model re-emit four brand colours to change a corner radius, and one of
 * them comes back wrong.
 *
 * Changing `brand` requires explicit UI confirmation (contract §3). The brand
 * palette is the one theme field seeded from the org's real identity, and a
 * model repainting a business's colours on its own initiative is the failure
 * everyone remembers.
 */

import { z } from 'zod';
import { ok } from '../../../shared/index.js';
import { ErrorCodes, FeatureError, err } from '../../../shared/index.js';
import { micrositeThemeSchema } from '../../blocks/index.js';
import { defineMicrositeTool } from '../define-tool.js';
import { loadDraft, writeTheme } from '../draft-writer.js';
import { confirmationKey } from '../guardrails.js';
import { applyPropsPatch, patchedKeys } from '../patch.js';

const colour = z.string().trim().min(1).max(64);

const themePatchSchema = z
  .object({
    brand: z
      .object({
        primary: colour.optional(),
        accent: colour.optional(),
        neutral: colour.optional(),
        surface: colour.optional(),
      })
      .optional(),
    typography: z
      .object({ scale: z.enum(['compact', 'default', 'editorial']) })
      .optional(),
    radius: z.enum(['none', 'sm', 'md', 'full']).optional(),
    buttonStyle: z.enum(['solid', 'outline', 'pill']).optional(),
    density: z.enum(['tight', 'comfortable']).optional(),
  })
  // The logo is NOT patchable here: it is one mark, owned by the brand
  // pipeline, and there is no variant to choose between.
  .strict();

export const updateThemeTool = defineMicrositeTool({
  name: 'update_theme',
  description:
    'Change the site-wide look: brand colours, type scale, corner radius, button style, density. Send only the fields you are changing. Changing brand colours asks the user to confirm first.',
  inputSchema: z.object({ patch: themePatchSchema }),
  mutating: true,
  destructive: true,
  confirmation: async (input) => {
    // Only `brand` is gated — restyling buttons is not a brand decision.
    if (!input.patch.brand) return null;
    const changing = Object.entries(input.patch.brand)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key} → ${value as string}`)
      .join(', ');
    return {
      action: confirmationKey('update_theme', 'brand'),
      prompt: `Change the brand colours (${changing})? These are used across the whole website.`,
    };
  },
  execute: async (ctx, input) => {
    const draft = await loadDraft(ctx.db, ctx.session);
    if (!draft.success) return draft;

    const merged = micrositeThemeSchema.safeParse(
      applyPropsPatch(
        draft.data.theme as unknown as Record<string, unknown>,
        input.patch as Record<string, unknown>
      )
    );
    if (!merged.success) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          `That theme change is not valid: ${merged.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`,
          { issues: merged.error.issues }
        )
      );
    }

    const written = await writeTheme(ctx.db, ctx.session, merged.data);
    if (!written.success) return written;

    return ok({
      data: { theme: merged.data, changed: patchedKeys(input.patch) },
      summary: `Updated the site theme (${patchedKeys(input.patch).join(', ')})`,
      mutated: true,
    });
  },
});

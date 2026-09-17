import { updateMetaCampaignResponseSchema } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { ApiFetchError, defineTool } from '../../tool-factory/index.js';

const safeExternalId = z.string().regex(/^[\w-]+$/, 'Invalid ID format');

/**
 * Radius and audience only — no place, no coordinates. See the note on the
 * create tool's `targetingSchema`: the area a campaign covers is the saved
 * branch's geocoded address, and moving a campaign to a different area means
 * moving it to a different branch, not typing one in.
 */
const updateTargetingInput = z
  .object({
    distanceKm: z
      .number()
      .min(1)
      .max(500)
      .optional()
      .describe('Targeting radius in km, measured from the saved address.'),
    ageMin: z.number().min(18).max(65).optional(),
    ageMax: z.number().min(18).max(65).optional(),
  })
  .optional();

interface UpdateCampaignOutput {
  metaCampaignId: string;
  updated: string[];
  message: string;
  error?: string;
}

/**
 * `meta_ads_updateCampaign` — update a campaign's name and/or targeting.
 *
 * Non-destructive: name and targeting changes don't involve ad spend. Budget
 * changes have their own destructive tool pair (confirmUpdateBudget /
 * executeUpdateBudget) and should NOT be done here.
 */
export const updateCampaignTool = defineTool<
  {
    metaCampaignId: string;
    name?: string;
    targeting?: z.infer<typeof updateTargetingInput>;
  },
  UpdateCampaignOutput
>({
  feature: 'meta-ads',
  action: 'updateCampaign',
  description:
    'Update a campaign name and/or targeting (radius, age range). The area is ' +
    "always the business's saved address and cannot be changed here. " +
    'For budget changes use confirmUpdateBudget / executeUpdateBudget instead. ' +
    'Pass only the fields the user wants to change.',
  inputSchema: z
    .object({
      metaCampaignId: safeExternalId.describe('The campaign ID to update'),
      name: z
        .string()
        .min(1)
        .max(255)
        .optional()
        .describe('New campaign name.'),
      targeting: updateTargetingInput.describe(
        'New radius / age range. Only pass fields you want to change; the rest ' +
          'keep their current values, and the area never changes.'
      ),
    })
    .refine((d) => d.name || d.targeting, {
      message: 'Provide at least one field to update (name or targeting).',
    }),
  destructive: false,
  // Mirrors @RequireRole('admin') on PUT /meta-campaigns/:metaCampaignId. The
  // gate is currently enforced ONLY by the authenticated loopback hop; nothing
  // reads this field yet. It is declared so Gate 3 can count it, and so the
  // extraction that removes the hop has something to move enforcement TO.
  policy: 'admin',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Updating campaign' },
  additionalAllowedPaths: [/^meta-campaigns\/[a-zA-Z0-9_-]+$/],
  execute: async (input, ctx) => {
    const body: Record<string, unknown> = {};
    const updated: string[] = [];

    if (input.name) {
      body.name = input.name;
      updated.push('name');
    }

    if (input.targeting) {
      body.targeting = input.targeting;
      if (input.targeting.distanceKm !== undefined) {
        updated.push('radius');
      }
      if (
        input.targeting.ageMin !== undefined ||
        input.targeting.ageMax !== undefined
      ) {
        updated.push('age range');
      }
    }

    try {
      await ctx.apiFetch(`meta-campaigns/${input.metaCampaignId}`, {
        method: 'PUT',
        body,
        schema: updateMetaCampaignResponseSchema,
      });

      return {
        data: {
          metaCampaignId: input.metaCampaignId,
          updated,
          message: `Campaign updated: ${updated.join(', ')}.`,
        },
      };
    } catch (error) {
      // A failed budget/targeting change is spend-relevant — don't let it
      // vanish into the tool result. 4xx is an expected user-facing rejection
      // (bad budget, campaign gone); anything else is a real fault.
      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        ctx.reportIssue('Failed to update campaign', { error });
      }
      return {
        data: {
          metaCampaignId: input.metaCampaignId,
          updated: [],
          message: '',
          error:
            error instanceof Error
              ? error.message
              : 'Failed to update campaign.',
        },
      };
    }
  },
});

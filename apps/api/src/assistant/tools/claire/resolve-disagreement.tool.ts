import { db } from '@borradh-workspace/database';
import {
  getBusinessProfile,
  markDisagreementSurfaced,
  resolveDisagreement,
  trackDisagreementResolved,
} from '@borradh-workspace/features/claire';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

/**
 * `claire_resolveDisagreement` — call after Claire has raised the
 * classifier disagreement in chat. Captures the operator's resolution:
 *
 *   - `owner_held`: operator sticks with their override (we mark surfaced
 *      AND mark the disagreement as `owner_held`).
 *   - `owner_changed`: operator concedes, clear override + reclassify.
 *   - `dismissed`: operator doesn't engage; we mark surfaced so we don't
 *      keep asking, but leave the override + disagreement state untouched.
 *
 * The `dismissed` path uses `markDisagreementSurfaced` only; the other
 * two flow through the existing `resolveDisagreement` service.
 */
export const resolveDisagreementTool = defineTool<
  { resolution: 'owner_held' | 'owner_changed' | 'dismissed' },
  { resolved: boolean; reclassified: boolean }
>({
  feature: 'claire',
  action: 'resolveDisagreement',
  description:
    'Call after raising the classifier disagreement with the operator. Pass their answer: owner_held (stick with override), owner_changed (clear override + reclassify), or dismissed (operator ignored / changed topic — we will not raise it again).',
  inputSchema: z.object({
    resolution: z.enum(['owner_held', 'owner_changed', 'dismissed']),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Closing classifier disagreement' },
  execute: async (input, ctx) => {
    if (input.resolution === 'dismissed') {
      // Read the disagreement first so we can record the event with the
      // same axes/confidence the operator saw.
      const profileResult = await getBusinessProfile(db, {
        organizationId: ctx.organizationId,
      });
      const marked = await markDisagreementSurfaced(db, ctx.organizationId);
      if (!marked.success) {
        return { data: { resolved: false, reclassified: false } };
      }
      if (profileResult.success && profileResult.data.disagreement) {
        const disagreement = profileResult.data.disagreement;
        trackDisagreementResolved(ctx.organizationId, {
          surface: 'chat',
          axes: disagreement.axes,
          classifierConfidence: disagreement.classifierConfidence,
          resolution: 'dismissed',
        });
      }
      return { data: { resolved: true, reclassified: false } };
    }

    const resolved = await resolveDisagreement(db, {
      organizationId: ctx.organizationId,
      resolution: input.resolution,
      surface: 'chat',
    });
    if (!resolved.success) {
      return { data: { resolved: false, reclassified: false } };
    }
    // Mark surfaced too so subsequent conversations don't re-raise.
    await markDisagreementSurfaced(db, ctx.organizationId);
    return {
      data: {
        resolved: true,
        reclassified: input.resolution === 'owner_changed',
      },
    };
  },
});

import { randomBytes } from 'node:crypto';
import { db } from '@borradh-workspace/database';
import {
  getOrCreateDraftOffer,
  updateDraftOffer,
} from '@borradh-workspace/features/claire';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { offerToSnapshot } from './_helpers.js';
import type { DraftOfferSnapshot } from './types.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // skip 0/O/1/I to avoid confusion

function generateCode(length = 6): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    const byte = bytes[i] ?? 0;
    out += ALPHABET[byte % ALPHABET.length];
  }
  return out;
}

/**
 * `claire_setPendingOfferCode` — set or auto-generate the coupon code.
 *
 * Codes are case-insensitive unique within the org (enforced by the
 * partial unique index `idx_offer_org_code_unique`). On collision the
 * service layer surfaces ALREADY_EXISTS and the tool reports it back —
 * Claire can then offer to generate a new one.
 */
export const setPendingOfferCodeTool = defineTool<
  { code?: string | null },
  (DraftOfferSnapshot & { generated: boolean }) | { error: string }
>({
  feature: 'claire',
  action: 'setPendingOfferCode',
  description:
    'Set or generate a coupon code for the offer. If the user asks Claire to "generate one" or "make one up", omit `code` to have the server pick a 6-char code. Pass `code: null` to clear the code. Codes are case-insensitive unique within the org.',
  inputSchema: z.object({
    code: z.string().max(40).nullable().optional(),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Setting offer code' },
  execute: async (input, ctx) => {
    const draft = await getOrCreateDraftOffer(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
    });
    if (!draft.success) return { data: { error: draft.error.message } };

    let nextCode: string | null;
    let generated = false;
    if (input.code === null) {
      nextCode = null;
    } else if (input.code === undefined || input.code.trim() === '') {
      nextCode = generateCode();
      generated = true;
    } else {
      nextCode = input.code.trim();
    }

    const updated = await updateDraftOffer(db, {
      organizationId: ctx.organizationId,
      draftId: draft.data.offer.id,
      update: { code: nextCode },
    });
    if (!updated.success) return { data: { error: updated.error.message } };
    return {
      data: {
        ...offerToSnapshot(
          updated.data.offer,
          updated.data.serviceIds,
          updated.data.locationIds
        ),
        generated,
      },
    };
  },
});

import {
  type WhatsAppAccount,
  listWhatsAppAccountsResponseSchema,
} from '@borradh-workspace/contracts';
import { db } from '@borradh-workspace/database';
import {
  type NurtureChannel,
  resolveNurtureChannel,
} from '@borradh-workspace/features/meta-ads/nurture';
import { getPrimaryLocation } from '@borradh-workspace/features/organizations';
import type { AssistantToolsContext } from '../../tool-factory/index.js';

/**
 * Shared lead-form nurturing resolution. Centralises the "which chat channel
 * does the lead-form thank-you button point at, and what number" decision so
 * `previewCampaign` and the lead-form tools agree.
 *
 * Country (from the org primary location) drives the choice via the pure
 * `resolveNurtureChannel` helper; WhatsApp is only used when the org has a
 * usable WhatsApp account, in which case its number is returned for the CTA.
 */

/** The `integrations/whatsapp/accounts` path the helper hits — tools that use
 *  this helper must include it in their `additionalAllowedPaths`. */
export const WHATSAPP_ACCOUNTS_PATH = /^integrations\/whatsapp\/accounts$/;

/**
 * A WhatsApp account only counts as usable for ads/nurturing when it's active
 * AND its token is still valid. Mirrors the predicate in `preview-campaign`.
 */
function firstUsableWhatsApp(wa: {
  accounts: WhatsAppAccount[];
}): WhatsAppAccount | null {
  if (!Array.isArray(wa.accounts)) return null;
  return (
    wa.accounts.find(
      (a) => a.isActive !== false && a.tokenStatus !== 'needs_reconnect'
    ) ?? null
  );
}

export interface OrgNurtureContext {
  channel: NurtureChannel;
  /** True when the country prefers WhatsApp but it isn't usable (→ Messenger). */
  flagged: boolean;
  reason?: string;
  /** Display/E.164 number for the WhatsApp button; null when channel=messenger. */
  whatsappNumber: string | null;
  /** Org primary-location country code (lowercase ISO alpha-2), or null. */
  countryCode: string | null;
}

/**
 * Resolve the org's lead-form nurturing channel from its country + WhatsApp
 * connection. `ctx` only needs `organizationId` + `apiFetch`.
 */
export async function resolveOrgNurtureChannel(
  ctx: Pick<AssistantToolsContext, 'organizationId' | 'apiFetch'>
): Promise<OrgNurtureContext> {
  let countryCode: string | null = null;
  try {
    const loc = await getPrimaryLocation(db, {
      organizationId: ctx.organizationId,
    });
    if (loc.success && loc.data) {
      countryCode = loc.data.country ?? null;
    }
  } catch {
    // best-effort — fall through with null country
  }

  let usable: WhatsAppAccount | null = null;
  try {
    const wa = await ctx.apiFetch('integrations/whatsapp/accounts', {
      schema: listWhatsAppAccountsResponseSchema,
    });
    usable = firstUsableWhatsApp(wa);
  } catch {
    usable = null;
  }

  const resolved = resolveNurtureChannel({
    countryCode,
    hasUsableWhatsApp: usable !== null,
  });

  return {
    channel: resolved.channel,
    flagged: resolved.flagged,
    reason: resolved.reason,
    whatsappNumber:
      resolved.channel === 'whatsapp' ? (usable?.phoneNumber ?? null) : null,
    countryCode,
  };
}

import {
  getMetaIntegrationResponseSchema,
  listWhatsAppAccountsResponseSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { ApiFetchError, defineTool } from '../../tool-factory/index.js';
import type { AssistantToolsContext } from '../../tool-factory/types.js';

/**
 * The three channels a customer-facing chatbot runs on, each backed by its own
 * flag + toggle endpoint:
 *
 *   instagram          → `instagram_integration.chatbot_enabled`
 *                        (`PUT integrations/instagram/chatbot`; org-scoped,
 *                        no target id — one Instagram integration per org)
 *   facebook_messenger → `meta_ads_pages.is_chatbot_active`
 *                        (`PUT integrations/meta-ads-pages/:pageId/chatbot`)
 *   whatsapp           → `whatsapp_accounts.is_chatbot_active`
 *                        (`PUT integrations/whatsapp/:accountId/chatbot`)
 */
const chatbotChannelSchema = z.enum([
  'instagram',
  'facebook_messenger',
  'whatsapp',
]);
export type ChatbotChannel = z.infer<typeof chatbotChannelSchema>;

const setChatbotEnabledInputSchema = z.object({
  channel: chatbotChannelSchema.describe(
    'Which chatbot channel to turn on or off.'
  ),
  targetId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'The Facebook pageId (facebook_messenger) or WhatsApp account id ' +
        '(whatsapp). Omit for instagram, or when the org has exactly one ' +
        'connected page/account — the tool resolves it automatically.'
    ),
  enabled: z
    .boolean()
    .describe('true = turn the chatbot ON, false = turn it OFF.'),
  confirmationToken: z
    .string()
    .optional()
    .describe('Set on the second call only.'),
});

type SetChatbotEnabledInput = z.infer<typeof setChatbotEnabledInputSchema>;

interface SetChatbotEnabledOutput {
  channel: ChatbotChannel;
  /** null for instagram (org-scoped flag, no per-target id). */
  targetId: string | null;
  /** Human-readable target (page name, WhatsApp number, or "Instagram DMs"). */
  targetLabel: string;
  /**
   * The PERSISTED flag value read back from the toggle endpoint's response —
   * not an echo of the request. If this differs from what was asked, the
   * write did not land as requested and the model must say so.
   */
  enabled: boolean;
}

/** Instagram toggle response — `{ chatbotEnabled }`. */
const instagramToggleResponseSchema = z.object({ chatbotEnabled: z.boolean() });
/** Page + WhatsApp toggle response — `{ isChatbotActive }`. */
const activeToggleResponseSchema = z.object({ isChatbotActive: z.boolean() });

interface ResolvedTarget {
  /** API path for the PUT. */
  path: string;
  /** null for instagram. */
  targetId: string | null;
  targetLabel: string;
}

/**
 * Resolve `channel` + optional `targetId` to a concrete toggle endpoint.
 *
 * Auto-resolution rules (only when `targetId` is omitted):
 *   facebook_messenger → the integration's default Facebook page, else the
 *                        single connected Facebook page.
 *   whatsapp           → the single active WhatsApp account.
 *
 * Throws when the target is ambiguous (multiple candidates) or absent —
 * the factory surfaces that as a failed confirmation and the model should
 * ask the user which page/account they mean (or check the integration).
 */
async function resolveTarget(
  input: Pick<SetChatbotEnabledInput, 'channel' | 'targetId'>,
  ctx: AssistantToolsContext
): Promise<ResolvedTarget> {
  if (input.channel === 'instagram') {
    return {
      path: 'integrations/instagram/chatbot',
      targetId: null,
      targetLabel: 'Instagram DMs',
    };
  }

  if (input.channel === 'facebook_messenger') {
    const data = await ctx.apiFetch('integrations/meta-ads/integration', {
      schema: getMetaIntegrationResponseSchema,
    });
    const integration = data.integration;
    if (!integration) {
      throw new Error('Meta is not connected — no Facebook pages available.');
    }
    const facebookPages = integration.pages.filter(
      (p) => p.platform === 'facebook'
    );
    if (input.targetId) {
      const match = facebookPages.find((p) => p.pageId === input.targetId);
      return {
        path: `integrations/meta-ads-pages/${input.targetId}/chatbot`,
        targetId: input.targetId,
        targetLabel: match?.pageName
          ? `${match.pageName} (Messenger)`
          : `Facebook page ${input.targetId} (Messenger)`,
      };
    }
    const candidate =
      integration.defaultPage?.platform === 'facebook'
        ? integration.defaultPage
        : facebookPages.length === 1
          ? facebookPages[0]
          : null;
    if (!candidate) {
      throw new Error(
        'Multiple Facebook pages connected — a pageId is required.'
      );
    }
    return {
      path: `integrations/meta-ads-pages/${candidate.pageId}/chatbot`,
      targetId: candidate.pageId,
      targetLabel: candidate.pageName
        ? `${candidate.pageName} (Messenger)`
        : `Facebook page ${candidate.pageId} (Messenger)`,
    };
  }

  // whatsapp
  const wa = await ctx.apiFetch('integrations/whatsapp/accounts', {
    schema: listWhatsAppAccountsResponseSchema,
  });
  const active = wa.accounts.filter((a) => a.isActive);
  if (input.targetId) {
    const match = active.find((a) => a.id === input.targetId);
    return {
      path: `integrations/whatsapp/${input.targetId}/chatbot`,
      targetId: input.targetId,
      targetLabel: match
        ? `WhatsApp ${match.displayName ?? match.phoneNumber}`
        : `WhatsApp account ${input.targetId}`,
    };
  }
  if (active.length !== 1) {
    throw new Error(
      active.length === 0
        ? 'No active WhatsApp account is connected.'
        : 'Multiple WhatsApp accounts connected — an account id is required.'
    );
  }
  const only = active[0];
  return {
    path: `integrations/whatsapp/${only.id}/chatbot`,
    targetId: only.id,
    targetLabel: `WhatsApp ${only.displayName ?? only.phoneNumber}`,
  };
}

/**
 * `chatbots_setEnabled` — the chatbot kill switch (Claire reliability
 * overhaul Phase 8, register finding #65: an owner could not turn a
 * misbehaving chatbot off while it was live on customers).
 *
 * Exposed write, `confirm: true` per ADR-004: the factory's destructive flow
 * shows a confirmation card (channel, target, ON/OFF) and only executes after
 * the owner approves. The result's `enabled` field is the PERSISTED flag from
 * the toggle endpoint's response, not an echo of the request (ADR-005 /
 * Phase 1 truthful-state rule).
 */
export const setChatbotEnabledTool = defineTool<
  SetChatbotEnabledInput,
  SetChatbotEnabledOutput
>({
  feature: 'chatbots',
  action: 'setEnabled',
  description:
    'Turn the customer-facing chatbot ON or OFF for one channel: instagram ' +
    '(DMs), facebook_messenger (a Facebook page), or whatsapp (a WhatsApp ' +
    'account). Use this when the user wants the bot to stop or start ' +
    'replying to their customers — including urgent "turn it off now" ' +
    'requests. Requires the user to approve a confirmation before the ' +
    'switch is flipped. For facebook_messenger/whatsapp the tool resolves ' +
    'the target automatically when only one page/account is connected; ' +
    'otherwise pass targetId (pageId or WhatsApp account id). This controls ' +
    'the customer chatbot only — it does not affect Claire herself.',
  inputSchema: setChatbotEnabledInputSchema,
  destructive: true,
  destructiveAction: 'toggle_chatbot',
  // Turning the customer-facing chatbot on or off org-wide is an operational
  // control on the same footing as pausing/resuming an ad (both `admin`):
  // `destructive` gates the human confirmation, `policy` gates WHO may ask.
  policy: 'admin',
  preferredModel: 'sonnet',
  hardBlocks: [],
  presentation: {
    statusLabel: 'Updating chatbot',
    confirmationRenderer: 'ChatbotToggleConfirmation',
  },
  additionalAllowedPaths: [/^integrations\/whatsapp\/accounts$/],
  summarizeForConfirmation: async (input, ctx) => {
    const target = await resolveTarget(input, ctx);
    return {
      title: `Turn chatbot ${input.enabled ? 'ON' : 'OFF'}: ${target.targetLabel}`,
      fields: [
        { label: 'Channel', value: input.channel },
        { label: 'Target', value: target.targetLabel },
        { label: 'Action', value: input.enabled ? 'Turn ON' : 'Turn OFF' },
      ],
      resourceId: target.targetId ?? `instagram:${ctx.organizationId}`,
      // Bind channel + enabled so the model cannot flip the direction (or
      // channel) between the card the owner saw and the executed call.
      payload: {
        channel: input.channel,
        enabled: input.enabled,
        ...(target.targetId ? { targetId: target.targetId } : {}),
      },
    };
  },
  execute: async (input, ctx) => {
    const target = await resolveTarget(input, ctx);
    let persistedEnabled: boolean;
    try {
      if (input.channel === 'instagram') {
        const res = await ctx.apiFetch(target.path, {
          method: 'PUT',
          body: { enabled: input.enabled },
          schema: instagramToggleResponseSchema,
        });
        persistedEnabled = res.chatbotEnabled;
      } else {
        const res = await ctx.apiFetch(target.path, {
          method: 'PUT',
          body: { enabled: input.enabled },
          schema: activeToggleResponseSchema,
        });
        persistedEnabled = res.isChatbotActive;
      }
    } catch (error) {
      if (error instanceof ApiFetchError && error.status === 404) {
        throw new Error(
          input.channel === 'instagram'
            ? 'Instagram is not connected for this organization.'
            : `The ${input.channel === 'whatsapp' ? 'WhatsApp account' : 'Facebook page'} was not found.`
        );
      }
      throw error;
    }
    return {
      data: {
        channel: input.channel,
        targetId: target.targetId,
        targetLabel: target.targetLabel,
        enabled: persistedEnabled,
      },
    };
  },
});

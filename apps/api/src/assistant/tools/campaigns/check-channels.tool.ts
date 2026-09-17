import {
  channelEntitlementsResponseSchema,
  listWhatsAppAccountsResponseSchema,
  smsNumberOrNullSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const checkChannelsInputSchema = z.object({});

type Channel = 'email' | 'sms' | 'whatsapp';

interface ChannelReadiness {
  channel: Channel;
  /** Ready to send on right now (connected + included in the plan). */
  available: boolean;
  /** Why it isn't available (absent when available). */
  reason?: string;
}

interface CheckChannelsOutput {
  channels: ChannelReadiness[];
  /** The channels a campaign can be built on today. */
  availableChannels: Channel[];
}

/**
 * `campaigns_checkChannels` — which messaging channels this org can actually
 * send on right now.
 *
 * Read-only aggregation of plan entitlements + channel setup: email is always
 * deliverable, SMS needs a provisioned number, WhatsApp needs a linked
 * business account. The model calls this before building a campaign so it
 * proposes channels that will work instead of assuming.
 */
export const checkChannelsTool = defineTool<
  z.infer<typeof checkChannelsInputSchema>,
  CheckChannelsOutput
>({
  feature: 'campaigns',
  action: 'checkChannels',
  description:
    'Check which bulk-messaging channels the organization can send on right ' +
    'now, based on plan entitlements and setup. Email and WhatsApp are ' +
    'available; act on those results. Ignore any "sms" result — SMS bulk ' +
    'messaging is paused and must not be offered. Call BEFORE creating a bulk ' +
    'message so you know it will actually deliver. Read-only.',
  inputSchema: checkChannelsInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Checking channels' },
  additionalAllowedPaths: [
    /^campaigns\/entitlements$/,
    /^campaigns\/sms-number$/,
    /^integrations\/whatsapp\/accounts$/,
  ],
  execute: async (_input, ctx) => {
    const entitlements = await ctx.apiFetch('campaigns/entitlements', {
      schema: channelEntitlementsResponseSchema,
    });
    const planBlocked = new Map(
      entitlements.blocked.map((b) => [b.channel, b.reason])
    );

    // Setup checks are independent and non-fatal: a failed lookup reads as
    // "not set up" rather than sinking the whole readiness report.
    let smsNumber: z.infer<typeof smsNumberOrNullSchema> = null;
    try {
      smsNumber = await ctx.apiFetch('campaigns/sms-number', {
        schema: smsNumberOrNullSchema,
      });
    } catch {
      smsNumber = null;
    }

    let hasActiveWaba = false;
    try {
      const { accounts } = await ctx.apiFetch(
        'integrations/whatsapp/accounts',
        { schema: listWhatsAppAccountsResponseSchema }
      );
      hasActiveWaba = accounts.some((a) => a.isActive);
    } catch {
      hasActiveWaba = false;
    }

    const channels: ChannelReadiness[] = [
      planBlocked.has('email')
        ? {
            channel: 'email',
            available: false,
            reason: "The plan doesn't include email campaigns.",
          }
        : { channel: 'email', available: true },
      planBlocked.has('sms')
        ? {
            channel: 'sms',
            available: false,
            reason: "The plan doesn't include SMS campaigns (upgrade needed).",
          }
        : smsNumber && smsNumber.status === 'active'
          ? { channel: 'sms', available: true }
          : {
              channel: 'sms',
              available: false,
              reason:
                'No SMS number provisioned yet — set one up in the Campaigns area.',
            },
      planBlocked.has('whatsapp')
        ? {
            channel: 'whatsapp',
            available: false,
            reason:
              "The plan doesn't include WhatsApp campaigns (upgrade needed).",
          }
        : hasActiveWaba
          ? { channel: 'whatsapp', available: true }
          : {
              channel: 'whatsapp',
              available: false,
              reason:
                'No WhatsApp Business account connected — connect one in Settings → Integrations.',
            },
    ];

    return {
      data: {
        channels,
        availableChannels: channels
          .filter((c) => c.available)
          .map((c) => c.channel),
      },
    };
  },
});

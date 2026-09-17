import { upsertCampaignMessageRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';
import type { CampaignChannel } from './types';

/**
 * THE builder for the `POST campaigns/:id/messages` wire body. Centralises the
 * one rule that used to be duplicated in the composer and the campaign detail
 * editor: a subject line is sent only for the email channel.
 */

/** Typed intent: the raw per-channel editor state. */
export interface UpsertCampaignMessageIntent {
  channel: CampaignChannel;
  /** The composed subject; only emitted for the email channel. */
  subject?: string;
  body: string;
  whatsappTemplateId?: string;
  /** Ordered {{1}}..{{n}} values; each may contain merge tags ({{firstName|there}}). */
  whatsappTemplateParams?: string[];
  mediaUrl?: string;
}

/**
 * The exact `POST campaigns/:id/messages` wire body — the canonical contract
 * from `@borradh-workspace/contracts`, re-exported under its historical name.
 * `mediaUrl` is `.url()`-validated and `whatsappTemplateParams` is capped at
 * Meta's own 20-param ceiling, both of which the server has always enforced.
 */
export const upsertCampaignMessageBodySchema =
  upsertCampaignMessageRequestSchema;

export type UpsertCampaignMessageBody = z.infer<
  typeof upsertCampaignMessageBodySchema
>;

export function buildUpsertCampaignMessagePayload(
  input: UpsertCampaignMessageIntent
): UpsertCampaignMessageBody {
  return upsertCampaignMessageBodySchema.parse({
    channel: input.channel,
    body: input.body,
    // Subject is meaningful only on email — every other channel omits it.
    ...(input.channel === 'email' ? { subject: input.subject } : {}),
    ...(input.whatsappTemplateId !== undefined
      ? { whatsappTemplateId: input.whatsappTemplateId }
      : {}),
    ...(input.whatsappTemplateParams !== undefined
      ? { whatsappTemplateParams: input.whatsappTemplateParams }
      : {}),
    ...(input.mediaUrl !== undefined ? { mediaUrl: input.mediaUrl } : {}),
  });
}

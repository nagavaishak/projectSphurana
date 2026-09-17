'use client';

// Deep import, not the `@/features/organization` barrel: the barrel drags in the
// whole organization feature (components → router modules), which breaks this
// hook's consumers under test.
import { useActiveOrganization } from '@/features/organization/api/get-active-organization/get-active-organization.hook';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CampaignChannel, SegmentFilter } from './types';
import type { Campaign } from './types';
import { buildUpsertCampaignMessagePayload } from './upsert-campaign-message.payload';
import { useCreateCampaign } from './use-campaigns';
import { useLaunchCampaign } from './use-campaigns';
import { useCreateSegment } from './use-segments';

/**
 * The composer's one-tap send flow: reuse-or-create the audience segment, create
 * the campaign, write one message per active channel, then launch — behind a
 * single mutation with one success toast.
 *
 * Every write is owned by a hook + payload builder (create-segment,
 * create-campaign, upsert-message, launch), so the composer only ever passes
 * typed INTENT — it can never assemble a wire body of its own. The individual
 * hooks run `silent` here because this orchestrator owns the user-facing toast.
 */

/** Typed intent the composer hands to the send flow (never a wire body). */
export interface SendCampaignIntent {
  audience: {
    label: string;
    filter: SegmentFilter;
    /** Set for saved segments — reused instead of creating a new one. */
    segmentId?: string;
  };
  channels: CampaignChannel[];
  subject: string;
  body: string;
  /**
   * Set when the WhatsApp channel sends a pre-approved Meta template instead of
   * the free-form body. `body` is the template text with the params substituted
   * (stored as the message body); `params` are the raw ordered {{1}}..{{n}}
   * values, which may contain merge tags interpolated per lead at send time.
   */
  whatsappTemplate?: {
    id: string;
    params: string[];
    body: string;
  };
}

/**
 * The date stamped into the segment/campaign NAME. It labels a business record,
 * so it is the business's calendar date — a sender whose laptop is a day ahead
 * of (or behind) the business must not mint a campaign named for the wrong day.
 */
function dateLabel(timeZone: string): string {
  return new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  });
}

export const useSendCampaign = (options?: {
  onSuccess?: (c: Campaign) => void;
  onError?: (e: Error) => void;
}) => {
  const qc = useQueryClient();
  const { data: organization } = useActiveOrganization();
  const timeZone = organization?.timezone ?? 'UTC';
  const { createSegmentAsync } = useCreateSegment({ silent: true });
  const { createCampaignAsync } = useCreateCampaign({ silent: true });
  const { launchCampaignAsync } = useLaunchCampaign({ silent: true });

  const mutation = useMutation({
    mutationFn: async (input: SendCampaignIntent): Promise<Campaign> => {
      const label = dateLabel(timeZone);

      let segmentId = input.audience.segmentId;
      if (!segmentId) {
        const seg = await createSegmentAsync({
          name: `${input.audience.label} — ${label}`,
          filter: input.audience.filter,
        });
        segmentId = seg.id;
      }

      const campaign = await createCampaignAsync({
        name: `Message — ${label}`,
        type: 'custom',
        channels: input.channels,
        segmentId,
      });

      for (const channel of input.channels) {
        const template =
          channel === 'whatsapp' ? input.whatsappTemplate : undefined;
        await apiClient.post(
          `campaigns/${campaign.id}/messages`,
          buildUpsertCampaignMessagePayload({
            channel,
            subject: input.subject,
            body: template ? template.body : input.body,
            ...(template
              ? {
                  whatsappTemplateId: template.id,
                  whatsappTemplateParams: template.params,
                }
              : {}),
          })
        );
      }

      await launchCampaignAsync(campaign.id);
      return campaign;
    },
    onSuccess: (campaign) => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Your bulk message is sending');
      options?.onSuccess?.(campaign);
    },
    onError: (e: Error) => {
      toast.error(e.message || 'Failed to send');
      options?.onError?.(e);
    },
  });

  return { sendCampaign: mutation.mutate, isSending: mutation.isPending };
};

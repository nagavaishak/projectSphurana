import { Megaphone, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CampaignEmbedModal } from './campaign-embed-modal';

/**
 * Mirror of the backend `campaigns_showCampaignPreview` tool output
 * (`CampaignPreviewEmbedOutput` in
 * apps/api/src/assistant/tools/campaigns/show-campaign-preview.tool.ts).
 * Change the two in lockstep.
 */
export interface CampaignPreviewData {
  campaignId: string;
  name: string;
  status: string;
  type: string;
  channels: Array<'email' | 'sms' | 'whatsapp'>;
  scheduledAt: string | null;
  segment: { id: string; name: string; isDynamic: boolean } | null;
  audience: {
    total: number;
    reachable: number;
    perChannel: Record<string, number>;
  } | null;
  messages: Array<{
    channel: 'email' | 'sms' | 'whatsapp';
    subject: string | null;
    body: string;
    whatsappTemplate: { id: string; name: string; status: string } | null;
  }>;
  blockers: Array<{ channel: string | null; message: string }>;
  readyToLaunch: boolean;
}

export const CHANNEL_LABELS: Record<string, string> = {
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
};

interface CampaignPreviewCardProps {
  data: CampaignPreviewData;
  onSendMessage: (text: string) => void;
}

/**
 * Minimal in-chat review card for a messaging campaign (bulk email/SMS/
 * WhatsApp blast): name, one audience line, blockers if any, one button
 * that opens the review modal.
 */
export function CampaignPreviewCard({
  data,
  onSendMessage,
}: CampaignPreviewCardProps) {
  const [modalOpen, setModalOpen] = useState(false);

  const channelNames = data.channels
    .map((c) => CHANNEL_LABELS[c] ?? c)
    .join(', ');
  const summary = [
    channelNames,
    data.audience
      ? `reaches ${data.audience.reachable} of ${data.audience.total}`
      : null,
    data.segment?.name ?? null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="w-full space-y-2.5 rounded-md border bg-card p-3">
      <div className="flex items-center gap-2">
        <Megaphone className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {data.name}
        </span>
        <Badge variant="secondary">{data.status}</Badge>
      </div>

      <p className="text-muted-foreground text-xs">{summary}</p>

      {data.blockers.length > 0 && (
        <p className="flex items-start gap-1.5 text-amber-700 text-xs dark:text-amber-400">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" />
          {data.blockers.map((b) => b.message).join(' ')}
        </p>
      )}

      <Button
        size="sm"
        variant="outline"
        className="w-full"
        onClick={() => setModalOpen(true)}
      >
        Review
      </Button>

      <CampaignEmbedModal
        data={data}
        open={modalOpen}
        onOpenChange={setModalOpen}
        onLaunch={() => {
          setModalOpen(false);
          onSendMessage(
            `I've reviewed the campaign "${data.name}" (${data.campaignId}) — please launch it.`
          );
        }}
      />
    </div>
  );
}

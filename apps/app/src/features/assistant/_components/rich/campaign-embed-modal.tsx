import { Rocket, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  CHANNEL_LABELS,
  type CampaignPreviewData,
} from './campaign-preview-card';

interface CampaignEmbedModalProps {
  data: CampaignPreviewData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Hands the launch request back to the chat (Claire's confirmation flow). */
  onLaunch: () => void;
}

/**
 * Minimal review modal for a messaging campaign, opened from the in-chat
 * `CampaignPreviewCard`. One block per channel message; the Launch action
 * routes back through chat so `campaigns_launch` keeps its confirmation.
 */
export function CampaignEmbedModal({
  data,
  open,
  onOpenChange,
  onLaunch,
}: CampaignEmbedModalProps) {
  const audienceLine = [
    data.segment ? `To “${data.segment.name}”` : 'No audience selected',
    data.audience
      ? `reaches ${data.audience.reachable} of ${data.audience.total} contacts`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{data.name}</DialogTitle>
          <DialogDescription>{audienceLine}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[55vh]">
          <div className="space-y-4 pr-3">
            {data.messages.length === 0 && (
              <p className="text-muted-foreground text-sm italic">
                No messages written yet.
              </p>
            )}

            {data.messages.map((message) => (
              <div key={message.channel} className="space-y-1.5">
                <p className="font-medium text-muted-foreground text-xs">
                  {CHANNEL_LABELS[message.channel] ?? message.channel}
                  {message.channel === 'whatsapp' &&
                    (message.whatsappTemplate
                      ? ` · template “${message.whatsappTemplate.name}”`
                      : ' · free-form (24h window only)')}
                </p>
                {message.channel === 'email' && message.subject && (
                  <p className="font-medium text-sm">{message.subject}</p>
                )}
                <div className="rounded-md bg-muted p-3">
                  <p className="whitespace-pre-wrap text-sm">{message.body}</p>
                </div>
              </div>
            ))}

            {data.blockers.length > 0 && (
              <div className="space-y-1">
                {data.blockers.map((blocker) => (
                  <p
                    key={`${blocker.channel ?? 'campaign'}-${blocker.message}`}
                    className="flex items-start gap-1.5 text-amber-700 text-xs dark:text-amber-400"
                  >
                    <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                    {blocker.message}
                  </p>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            disabled={!data.readyToLaunch}
            onClick={onLaunch}
            className="gap-1.5"
          >
            <Rocket className="size-4" />
            Launch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

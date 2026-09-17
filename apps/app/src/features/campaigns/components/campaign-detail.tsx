'use client';

import { DashboardPage } from '@/components/app/dashboard-page';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CircleAlertIcon, TriangleAlertIcon } from 'lucide-react';
import {
  type CampaignAnalytics,
  type CampaignChannel,
  type CampaignMessage,
  type CampaignRecipientRow,
  campaignChannelLabels,
  campaignStatusLabels,
  useCampaignAnalytics,
  useCampaignRecipients,
  useCancelCampaign,
  useGetCampaign,
  useLaunchCampaign,
} from '../api';
import { CampaignComposer } from './campaign-composer';

/**
 * Only the two outcomes the send pipeline reports on its own.
 *
 * Delivered / Opened / Clicked all arrive via Resend webhooks, which need open
 * tracking enabled on the sending domain and an `email.opened` subscription.
 * Until those are configured they sit permanently at zero, which reads as
 * "nobody opened it" rather than "we aren't measuring it" — worse than showing
 * nothing. `get-campaign-analytics` still returns every field, so restoring a
 * tile is one line here.
 */
const STAT_LABELS: { key: keyof CampaignAnalytics; label: string }[] = [
  { key: 'sent', label: 'Sent' },
  { key: 'failed', label: 'Failed' },
];

export function CampaignStats({ campaignId }: { campaignId: string }) {
  const { analytics, isLoading } = useCampaignAnalytics(campaignId);
  if (isLoading) return <Skeleton className="h-20 w-full" />;
  if (!analytics) return null;
  return (
    <div className="grid grid-cols-2 gap-3">
      {STAT_LABELS.map(({ key, label }) => (
        <div key={key} className="rounded-lg border p-3 text-center">
          <div className="text-2xl font-bold">{analytics[key]}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      ))}
    </div>
  );
}

/** Map raw stored recipient error codes to something a human can act on. */
function humanizeRecipientError(error: string | null): string {
  if (!error) return 'Send failed';
  const map: Record<string, string> = {
    channel_not_configured: 'No message was set for this channel',
    insufficient_credits: 'Not enough credits to send',
    send_failed: 'The provider rejected the send',
  };
  return map[error] ?? error;
}

export function CampaignDelivery({ campaignId }: { campaignId: string }) {
  const { recipients, isLoading } = useCampaignRecipients(campaignId);
  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (recipients.length === 0) return null;

  const failed = recipients.filter(
    (r: CampaignRecipientRow) => r.status === 'failed' || r.status === 'bounced'
  );

  return (
    <div className="space-y-3 rounded-xl border p-5">
      <div className="flex items-center gap-2">
        <span className="font-semibold">Delivery</span>
        <span className="text-sm text-muted-foreground">
          {recipients.length} recipient{recipients.length === 1 ? '' : 's'}
        </span>
      </div>

      {failed.length === 0 ? (
        <p className="text-sm text-muted-foreground">No failures.</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-red-600">
            <TriangleAlertIcon className="size-4" />
            {failed.length} failed
          </div>
          <ul className="divide-y rounded-lg border text-sm">
            {failed.map((r: CampaignRecipientRow) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3"
              >
                <span className="flex items-center gap-2">
                  <Badge variant="outline">
                    {campaignChannelLabels[r.channel]}
                  </Badge>
                  <span className="text-muted-foreground">
                    {r.contact ?? r.name ?? '—'}
                  </span>
                </span>
                <span className="text-red-600">
                  {humanizeRecipientError(r.error)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Content readiness per selected channel. Deliverability (SMS number/credits,
 * WhatsApp account) is enforced server-side on launch and surfaced via toast —
 * here we just stop the obvious trap of launching a channel with no message.
 */
export function campaignMissingContent(
  channels: CampaignChannel[],
  byChannel: Map<string, CampaignMessage>
): { channel: CampaignChannel; message: string }[] {
  return channels.flatMap((ch) => {
    const m = byChannel.get(ch);
    if (!m || !m.body?.trim()) {
      return [
        {
          channel: ch,
          message: `Write the ${campaignChannelLabels[ch]} message`,
        },
      ];
    }
    if (ch === 'email' && !(m.subject ?? '').trim()) {
      return [{ channel: ch, message: 'Add an email subject line' }];
    }
    return [];
  });
}

/**
 * One bulk message, on the shared `DashboardPage`.
 *
 * The phone rendering used to be a second component (`CampaignDetailMobile`)
 * restating this whole tree in mobile chrome; the shared shell is responsive,
 * so there is one surface now — the launch/cancel actions live in the header's
 * action slot and the body stacks in a single column at every width.
 */
export function CampaignDetail({ campaignId }: { campaignId: string }) {
  const { campaign, isLoading, isError, error } = useGetCampaign(campaignId);
  const { launchCampaign, isLaunching } = useLaunchCampaign();
  const { cancelCampaign, isCancelling } = useCancelCampaign();

  if (isError) {
    return (
      <DashboardPage title="Bulk message">
        <p className="text-destructive text-sm" role="alert">
          {error?.message ?? 'Failed to load bulk message'}
        </p>
      </DashboardPage>
    );
  }

  if (isLoading || !campaign) {
    return (
      <DashboardPage title="Bulk message">
        <Skeleton className="h-64 w-full" />
      </DashboardPage>
    );
  }

  const byChannel = new Map(campaign.messages.map((m) => [m.channel, m]));
  const channels = campaign.channels as CampaignChannel[];
  const canLaunch =
    campaign.status === 'draft' || campaign.status === 'scheduled';
  const canCancel =
    campaign.status !== 'sent' && campaign.status !== 'cancelled';

  const missing = campaignMissingContent(channels, byChannel);
  const allReady = missing.length === 0;

  return (
    <DashboardPage
      actions={
        <>
          {canLaunch && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={isLaunching || !allReady}>
                  {isLaunching ? 'Launching…' : 'Launch'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Launch “{campaign.name}”?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This sends your messages to everyone in this audience across{' '}
                    <span className="font-medium">
                      {(campaign.channels as CampaignChannel[])
                        .map((c) => campaignChannelLabels[c])
                        .join(', ')}
                    </span>
                    . It can’t be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Not yet</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => launchCampaign(campaign.id)}
                  >
                    Launch now
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {canCancel && (
            <Button
              variant="outline"
              onClick={() => cancelCampaign(campaign.id)}
              disabled={isCancelling}
            >
              Cancel
            </Button>
          )}
        </>
      }
      description={
        <span className="flex flex-wrap items-center gap-2">
          <Badge>{campaignStatusLabels[campaign.status]}</Badge>
          {channels.map((c) => (
            <Badge key={c} variant="outline">
              {campaignChannelLabels[c]}
            </Badge>
          ))}
        </span>
      }
      title={campaign.name}
    >
      <div className="flex flex-col gap-6">
        {canLaunch && !allReady && (
          <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/20">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
              <CircleAlertIcon className="size-4" />
              Before you can launch
            </div>
            <ul className="ml-6 list-disc space-y-0.5 text-sm text-muted-foreground">
              {missing.map((m) => (
                <li key={`${m.channel}-${m.message}`}>{m.message}</li>
              ))}
            </ul>
          </div>
        )}

        {campaign.status !== 'draft' && (
          <>
            <CampaignStats campaignId={campaign.id} />
            <CampaignDelivery campaignId={campaign.id} />
          </>
        )}

        {/* The ONE composer, in edit mode — same per-channel compose UI, live
            preview, template-only WhatsApp and opt-out gates as create. */}
        <CampaignComposer
          campaignId={campaign.id}
          initialMessages={campaign.messages}
        />
      </div>
    </DashboardPage>
  );
}

'use client';

import { ListPage } from '@/components/app/list-page';
import type { ListColumn } from '@/components/app/list-page';
import { Badge } from '@/components/ui/badge';
import { useResolvedRoutes } from '@/lib/use-routes';
import { useNavigate } from '@tanstack/react-router';
import { CheckCircle2Icon, InboxIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  type CampaignChannel,
  type CampaignListItem,
  type CampaignStatus,
  campaignChannelLabels,
  campaignStatusLabels,
  useListCampaigns,
  useSmsNumber,
} from '../api';
import { isChannelEnabled } from '../channels';

const statusVariant: Record<
  CampaignStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  draft: 'outline',
  scheduled: 'secondary',
  sending: 'secondary',
  paused: 'secondary',
  sent: 'default',
  failed: 'destructive',
  cancelled: 'destructive',
};

function totalRecipients(campaign: CampaignListItem): number {
  const counts = campaign.recipientCounts ?? {};
  return Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
}

function audienceLine(campaign: CampaignListItem): string {
  const audience = campaign.segmentName ?? 'All leads';
  const total = totalRecipients(campaign);
  if (total === 0) return audience;
  return `${audience} · ${total} recipient${total === 1 ? '' : 's'}`;
}

/**
 * SMS sender status. Alpha orgs (the default) send from a branded sender ID
 * derived from the business name — there is nothing to set up, so nothing is
 * shown. Only an org with a dedicated two-way number (the future receptionist
 * path) gets a status line. No "buy a number" prompt — customers never have to
 * think about numbers.
 */
function SmsSetupChip() {
  const { smsNumber, isLoading } = useSmsNumber();
  // Bulk messaging is email-only for now, so don't show SMS sender status for
  // a channel the org cannot currently send on.
  if (!isChannelEnabled('sms')) return null;
  if (isLoading) return null;
  if (!smsNumber || smsNumber.status !== 'active') return null;

  return (
    <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
      <CheckCircle2Icon className="size-3.5 text-primary" />
      SMS sends from {smsNumber.phoneNumber}
    </span>
  );
}

/**
 * Bulk Messaging index, on the shared `ListPage`.
 *
 * Replaces the desktop card grid AND the hand-written `CampaignsMobileList`
 * that sat beside it: the phone rows now come from the SAME column config the
 * table renders, so a column added here reaches both.
 */
export function CampaignList() {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const { campaigns, isLoading, isError, error, refetch } = useListCampaigns();
  const [search, setSearch] = useState('');

  // Filtering stays HERE, not in the shell — what counts as a match differs
  // per list.
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return campaigns;
    return campaigns.filter(
      (campaign) =>
        campaign.name.toLowerCase().includes(term) ||
        (campaign.segmentName ?? '').toLowerCase().includes(term)
    );
  }, [campaigns, search]);

  const columns: ListColumn<CampaignListItem>[] = [
    {
      id: 'name',
      header: 'Message',
      mobile: 'primary',
      cell: (campaign) => <span className="font-medium">{campaign.name}</span>,
    },
    {
      id: 'audience',
      header: 'Audience',
      mobile: 'secondary',
      cell: (campaign) => audienceLine(campaign),
    },
    {
      id: 'channels',
      header: 'Channels',
      cell: (campaign) => {
        const counts = campaign.recipientCounts ?? {};
        return (
          <div className="flex flex-wrap gap-1">
            {(campaign.channels as CampaignChannel[]).map((channel) => {
              const count = counts[channel] ?? 0;
              return (
                <Badge key={channel} variant="outline">
                  {campaignChannelLabels[channel] ?? channel}
                  {count > 0 && ` · ${count}`}
                </Badge>
              );
            })}
          </div>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      align: 'right',
      // The status badge is what the phone row has always carried on its right
      // edge — the one value that decides whether this message still needs you.
      mobile: 'trailing',
      cell: (campaign) => (
        <Badge variant={statusVariant[campaign.status]}>
          {campaignStatusLabels[campaign.status]}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <title>Bulk Messaging | Borradh</title>

      <ListPage<CampaignListItem>
        config={{
          title: 'Bulk Messaging',
          description: 'Reach your leads by email.',
          columns,
          rows,
          rowKey: (campaign) => campaign.id,
          // Preserved from the deleted `CampaignsMobileList`, which emitted
          // this id on every phone row.
          rowTestId: (campaign) => `campaign-row-${campaign.id}`,
          onRowClick: (campaign) =>
            void navigate({
              to: routes.campaignDetail(campaign.id),
            }),
          searchPlaceholder: 'Search bulk messages',
          search,
          onSearchChange: setSearch,
          toolbar: <SmsSetupChip />,
          primaryAction: {
            label: 'New bulk message',
            mobileLabel: 'New',
            onClick: () => void navigate({ to: routes.campaignsNew }),
          },
          isLoading,
          isError,
          errorMessage: error?.message ?? 'Failed to load bulk messages',
          onRetry: () => void refetch(),
          empty: {
            icon: InboxIcon,
            title: search ? 'No matching messages' : 'No bulk messages yet',
            description: search
              ? 'No bulk message matches that search.'
              : 'Send your first message to reach your leads.',
          },
        }}
      />
    </>
  );
}

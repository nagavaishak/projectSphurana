import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { ListPage } from '@/components/app/list-page';
import type { ListColumn } from '@/components/app/list-page';
import { useSidePanel } from '@/components/app/side-panel';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  useDeleteAd,
  useDuplicateAd,
  useImportMetaAds,
  useListAds,
} from '@/features/meta-ads/api';
import type { Ad } from '@/features/meta-ads/api/types';
import { AdSidePanel } from '@/features/meta-ads/components/ad-side-panel';
import { useListCampaigns } from '@/features/meta-campaigns/api';
import type { Campaign } from '@/features/meta-campaigns/api/types';
import { EditCampaignDialog } from '@/features/meta-campaigns/components/edit-campaign-dialog';
import {
  Download,
  ExternalLink,
  Info,
  Loader2,
  Megaphone,
  MoreVertical,
} from 'lucide-react';
import * as React from 'react';

// ─── Delivery status mapping ────────────────────────────────────────────────

type DeliveryInfo = {
  label: string;
  dotColor: string;
};

function getDeliveryInfo(ad: Ad, campaign?: Campaign): DeliveryInfo {
  if (ad.status === 'draft') {
    return { label: 'In draft', dotColor: 'bg-gray-400' };
  }
  if (ad.status === 'launching') {
    return { label: 'Launching', dotColor: 'bg-blue-500 animate-pulse' };
  }
  if (ad.status === 'pending') {
    return { label: 'In review', dotColor: 'bg-yellow-500' };
  }
  if (campaign) {
    const campaignOff =
      campaign.effectiveStatus === 'PAUSED' ||
      campaign.effectiveStatus === 'CAMPAIGN_PAUSED' ||
      campaign.status === 'PAUSED';
    if (campaignOff && ad.status === 'active') {
      return { label: 'Campaign off', dotColor: 'bg-gray-400' };
    }
  }
  if (ad.status === 'active') {
    return { label: 'Active', dotColor: 'bg-green-500' };
  }
  if (ad.status === 'paused') {
    return { label: 'Off', dotColor: 'bg-gray-400' };
  }
  if (ad.status === 'rejected') {
    return { label: 'Rejected', dotColor: 'bg-red-500' };
  }
  if (ad.status === 'error') {
    return { label: 'Error', dotColor: 'bg-red-500' };
  }
  return { label: ad.status, dotColor: 'bg-gray-400' };
}

// ─── Actions (objective) mapping ────────────────────────────────────────────

const objectiveActionLabels: Record<string, string> = {
  OUTCOME_ENGAGEMENT: 'Messaging conversations',
  OUTCOME_LEADS: 'Leads',
  OUTCOME_SALES: 'Sales',
  OUTCOME_TRAFFIC: 'Link clicks',
  OUTCOME_AWARENESS: 'Impressions',
};

const objectiveResultLabels: Record<string, string> = {
  OUTCOME_ENGAGEMENT: 'Per messaging conversation',
  OUTCOME_LEADS: 'Per lead',
  OUTCOME_SALES: 'Per purchase',
  OUTCOME_TRAFFIC: 'Per link click',
  OUTCOME_AWARENESS: 'Per 1,000 impressions',
};

function getActionLabel(campaign?: Campaign): string | null {
  if (!campaign?.objective) return null;
  return objectiveActionLabels[campaign.objective] ?? null;
}

function getResultMetricLabel(campaign?: Campaign): string | null {
  if (!campaign?.objective) return null;
  return objectiveResultLabels[campaign.objective] ?? null;
}

// ─── Row actions ────────────────────────────────────────────────────────────

function AdActions({
  ad,
  onEdit,
  onDuplicate,
}: {
  ad: Ad;
  onEdit: (ad: Ad) => void;
  onDuplicate: (ad: Ad) => void;
}) {
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const { execute: deleteAd, isExecuting: isDeleting } = useDeleteAd();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={`Actions for ${ad.name}`}
            className="flex size-8 text-muted-foreground data-[state=open]:bg-muted"
            size="icon"
            variant="ghost"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            disabled={ad.isImported}
            onSelect={() => onEdit(ad)}
          >
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onDuplicate(ad)}>
            Duplicate
          </DropdownMenuItem>
          {ad.metaAdId && (
            <DropdownMenuItem
              onSelect={() => {
                const url =
                  ad.metaPermalink ||
                  `https://www.facebook.com/ads/library/?id=${ad.metaAdId}`;
                window.open(url, '_blank', 'noopener,noreferrer');
              }}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              View on Facebook
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive"
            onSelect={() => setDeleteDialogOpen(true)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDeleteDialog
        description="This action cannot be undone. If the ad has been published to Meta, it will also be removed from your Meta Ads account."
        isPending={isDeleting}
        onConfirm={() => {
          deleteAd(ad.id, {
            onSuccess: () => setDeleteDialogOpen(false),
          });
        }}
        onOpenChange={setDeleteDialogOpen}
        open={deleteDialogOpen}
        title={<>Delete &ldquo;{ad.name}&rdquo;?</>}
      />
    </>
  );
}

function AdThumbnail({ ad }: { ad: Ad }) {
  const thumbnailUrl = ad.video?.thumbnailUrl || ad.metaThumbnailUrl;
  if (thumbnailUrl) {
    return (
      <img
        alt={ad.name}
        className="size-10 shrink-0 rounded object-cover"
        src={thumbnailUrl}
      />
    );
  }
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded bg-muted">
      <span className="text-muted-foreground text-xs">No img</span>
    </div>
  );
}

// ─── Main list ──────────────────────────────────────────────────────────────

interface AdsTableProps {
  campaignId: string;
  onNewAd?: () => void;
  /**
   * Hide write controls (on/off toggle, row actions, Edit Campaign, Import
   * from Meta, New Ad). Used by the admin panel, where cross-org writes are
   * blocked by org-membership guards.
   */
  readOnly?: boolean;
}

/**
 * The ads inside one campaign, on the shared `ListPage`.
 *
 * This IS the campaign-detail surface: the shell supplies the page header (the
 * campaign name), the search row, the New Ad action and — from the SAME column
 * config — the phone rows that `CampaignMobileDetail` used to hand-write beside
 * this table.
 */
export function AdsTable({
  campaignId,
  onNewAd,
  readOnly = false,
}: AdsTableProps) {
  const [search, setSearch] = React.useState('');
  const [editCampaignDialogOpen, setEditCampaignDialogOpen] =
    React.useState(false);

  const { open: openPanel } = useSidePanel();

  const { ads, isLoading, isError, error, refetch } = useListAds({
    metaCampaignId: campaignId,
  });

  const { campaigns } = useListCampaigns();
  const campaign = campaigns.find((c) => c.id === campaignId);

  const { execute: duplicateAd } = useDuplicateAd();
  const { importAds, isImporting } = useImportMetaAds();

  // KEYED BY AD ID, and that is not cosmetic.
  //
  // `openPanel` does `setContent(node)` and the host renders `{content}`
  // unkeyed at a fixed position (`components/app/side-panel.tsx`), so swapping
  // one `<AdSidePanel>` for another reconciles as the SAME element: React
  // updates it in place and never remounts. Everything inside then survives
  // the switch — `useForm`'s `defaultValues` only apply on mount, so the panel
  // kept showing the PREVIOUS ad's copy under the new ad's name, and since the
  // creative picker landed it would also keep a STAGED creative. Open row A,
  // stage an image, click row B, save: A's media onto B.
  //
  // The key forces a remount per ad, which is what "open this ad" means.
  const handleEditAd = React.useCallback(
    (ad: Ad) => {
      openPanel(<AdSidePanel key={ad.id} ad={ad} />);
    },
    [openPanel]
  );

  const handleDuplicateAd = React.useCallback(
    (ad: Ad) => {
      // Launched ads (incl. imported/graphic) are copied server-side on Meta;
      // drafts are recreated as a fresh draft. Both handled by the API.
      duplicateAd(ad.id);
    },
    [duplicateAd]
  );

  // Filtering lives in the page, not the shell — see the list-page README.
  const rows = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return ads;
    return ads.filter((ad) => ad.name.toLowerCase().includes(term));
  }, [ads, search]);

  const actionLabel = getActionLabel(campaign);
  const metricLabel = getResultMetricLabel(campaign);

  const columns: ListColumn<Ad>[] = [
    {
      id: 'thumbnail',
      mobile: 'media',
      width: 'w-14',
      cell: (ad) => <AdThumbnail ad={ad} />,
    },
    {
      id: 'toggle',
      header: 'Off/On',
      width: 'w-20',
      hidden: readOnly,
      cell: (ad) => {
        const isOn = ad.status === 'active';
        // NOT A CONTROL, and it must not look like one.
        //
        // This switch was copied from the campaign table, where it is wired to
        // pause/resume (`campaign-list.tsx` → `onCheckedChange={handleToggle}`).
        // Here it never had a handler: clicking it did nothing, for EVERY
        // status, so the row offered an off switch for a live ad and then
        // ignored it. `disabled` also read as "not available for this ad",
        // which sent owners looking for the state that would enable it — there
        // isn't one. Per-ad delivery control does not exist in the API at all;
        // delivery is a CAMPAIGN-level switch today.
        //
        // So it is presented as what it is: a read-only delivery indicator,
        // pointing at the control that does work. Wiring it needs a real
        // `POST /meta-ads/:id/{pause,resume}` behind a port (the endpoint gate
        // refuses a new uncovered mutating route), and that is a capability
        // decision, not a rendering one.
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  // The row opens the side panel; this indicator is not part
                  // of that gesture either way.
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <Switch
                    checked={isOn}
                    aria-readonly
                    aria-label={
                      isOn ? 'Ad is delivering' : 'Ad is not delivering'
                    }
                    tabIndex={-1}
                    className="pointer-events-none opacity-70"
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>
                  {isOn
                    ? 'This ad is delivering.'
                    : 'This ad is not delivering.'}{' '}
                  Delivery is controlled for the whole campaign — use the
                  campaign&apos;s on/off switch on the Advertising page.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      },
    },
    {
      id: 'name',
      header: 'Ad',
      mobile: 'primary',
      cell: (ad) => (
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{ad.name}</span>
          {ad.isImported && (
            <span className="inline-flex shrink-0 items-center rounded-full bg-blue-50 px-1.5 py-0.5 font-medium text-[10px] text-blue-700 ring-1 ring-blue-600/20 ring-inset dark:bg-blue-900/30 dark:text-blue-300 dark:ring-blue-500/30">
              Imported
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'delivery',
      header: 'Delivery',
      // Whether this ad is running is the line that belongs under its name on a
      // phone.
      mobile: 'secondary',
      cell: (ad) => {
        const delivery = getDeliveryInfo(ad, campaign);
        return (
          <div className="flex items-center gap-2">
            <span
              className={`size-2 shrink-0 rounded-full ${delivery.dotColor}`}
            />
            <span className="text-sm">{delivery.label}</span>
            {(ad.status === 'error' || ad.status === 'rejected') &&
              ad.syncError && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3.5 w-3.5 text-red-500" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>{ad.syncError}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
          </div>
        );
      },
    },
    {
      id: 'actionsType',
      header: 'Actions',
      cell: () =>
        actionLabel ? (
          <span className="block max-w-[160px] truncate text-muted-foreground text-sm">
            {actionLabel}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'costPerResult',
      header: 'Cost per result',
      align: 'right',
      cell: () => (
        <div>
          <div className="text-sm">—</div>
          {metricLabel && (
            <div className="ml-auto max-w-[110px] truncate text-muted-foreground text-xs">
              {metricLabel}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'amountSpent',
      header: 'Amount spent',
      align: 'right',
      cell: () => <div className="text-sm">—</div>,
    },
    {
      id: 'impressions',
      header: 'Impressions',
      align: 'right',
      cell: () => <div className="text-sm">—</div>,
    },
    {
      id: 'results',
      header: 'Results',
      align: 'right',
      // Per-ad insights are not wired yet, but Results is still the value this
      // row exists to report — so it is what the phone keeps on the right.
      mobile: 'trailing',
      cell: () => (
        <div>
          <div className="text-sm">—</div>
          {metricLabel && (
            <div className="ml-auto max-w-[100px] truncate text-muted-foreground text-xs">
              {metricLabel}
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <ListPage<Ad>
        config={{
          title: campaign?.name ?? 'Campaign',
          description: 'Ads in this campaign.',
          columns,
          rows,
          rowKey: (ad) => ad.id,
          // Keyed per ad — see handleEditAd for why.
          onRowClick: (ad) => openPanel(<AdSidePanel key={ad.id} ad={ad} />),
          rowActions: readOnly
            ? undefined
            : (ad) => (
                <AdActions
                  ad={ad}
                  onDuplicate={handleDuplicateAd}
                  onEdit={handleEditAd}
                />
              ),
          searchPlaceholder: 'Search ads',
          search,
          onSearchChange: setSearch,
          toolbar: readOnly ? undefined : (
            <>
              <Button
                disabled={!campaign}
                onClick={() => setEditCampaignDialogOpen(true)}
                size="sm"
                variant="outline"
              >
                Edit Campaign
              </Button>
              <Button
                disabled={isImporting}
                onClick={() => importAds()}
                size="sm"
                variant="outline"
              >
                {isImporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                <span className="hidden lg:inline">
                  {isImporting ? 'Importing...' : 'Import from Meta'}
                </span>
              </Button>
            </>
          ),
          primaryAction:
            readOnly || !campaign?.followUpType
              ? undefined
              : {
                  label: 'New Ad',
                  mobileLabel: 'New',
                  onClick: () => onNewAd?.(),
                },
          isLoading,
          isError,
          errorMessage: `Failed to load ads: ${error?.message || 'Unknown error'}`,
          onRetry: () => void refetch(),
          footer: rows.length > 0 && (
            <div className="flex items-center gap-1 text-muted-foreground text-sm">
              Results from {rows.length} {rows.length === 1 ? 'ad' : 'ads'}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3.5 w-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Aggregated results from all ads in this campaign</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          ),
          empty: {
            icon: Megaphone,
            title: search ? 'No matching ads' : 'No ads yet',
            description: search
              ? 'No ad in this campaign matches that search.'
              : campaign?.followUpType
                ? 'Create an ad to start reaching your audience.'
                : 'Create a campaign in Borradh to run your ads.',
          },
        }}
      />

      {campaign && (
        <EditCampaignDialog
          campaign={campaign}
          onOpenChange={setEditCampaignDialogOpen}
          open={editCampaignDialogOpen}
        />
      )}
    </>
  );
}

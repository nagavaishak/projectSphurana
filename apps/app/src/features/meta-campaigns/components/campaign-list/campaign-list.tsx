import { ListPage, ListPagination } from '@/components/app/list-page';
import type { ListColumn } from '@/components/app/list-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useResolvedRoutes } from '@/lib/use-routes';
import { cn } from '@/lib/utils';
import { useNavigate } from '@tanstack/react-router';
import { format, startOfDay, subMonths } from 'date-fns';
import { CalendarIcon, Megaphone, MoreVertical } from 'lucide-react';
import * as React from 'react';
import type { DateRange } from 'react-day-picker';
import {
  useDeleteCampaign,
  useDuplicateCampaign,
  useListCampaignInsights,
  useListCampaigns,
  usePauseCampaign,
  useResumeCampaign,
} from '../../api';
import type {
  Campaign,
  CampaignInsightsParams,
  CampaignInsightsSummary,
} from '../../api/types';
import { campaignHasBudget } from '../../utils';
import {
  type CampaignStatusFilterValue,
  campaignMatchesStatusFilter,
} from '../campaign-mobile/campaign-mobile-utils';
import { CreateCampaignDialog } from '../create-campaign-modal';
import { DeleteCampaignDialog } from '../delete-campaign-dialog';
import { DuplicateCampaignDialog } from '../duplicate-campaign-dialog';
import { EditCampaignDialog } from '../edit-campaign-dialog';
import { NoBudgetDialog } from '../no-budget-dialog';

// --- Helpers ---

function formatCurrency(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

// --- Error badge (shown beside the campaign name) ---

function getCampaignErrorMessage(effectiveStatus: string): string | null {
  switch (effectiveStatus) {
    case 'WITH_ISSUES':
      return 'This campaign has issues and may not be delivering. Check Meta Ads Manager for details.';
    case 'DISAPPROVED':
      return "This campaign was rejected by Meta. Review Meta's advertising policies and resubmit.";
    case 'PENDING_BILLING_INFO':
      return 'This campaign is paused because billing information is missing or invalid.';
    default:
      return null;
  }
}

// --- Destination badges ---

type DestinationBadge = {
  label: string;
  className?: string;
  variant?: 'outline';
};

function getDestinationBadges(campaign: Campaign): DestinationBadge[] {
  // A lead-form follow-up is a form destination regardless of messaging config.
  if (campaign.followUpType === 'lead_form') {
    return [{ label: 'Form', variant: 'outline' }];
  }

  const badges: DestinationBadge[] = [];
  switch (campaign.conversionDestination) {
    case 'whatsapp':
      badges.push({
        label: 'WhatsApp',
        className:
          'border-transparent bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
      });
      break;
    case 'messenger':
      badges.push({
        label: 'Facebook',
        className:
          'border-transparent bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
      });
      break;
    case 'instagram_direct':
      badges.push({
        label: 'Instagram',
        className:
          'border-transparent bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
      });
      break;
    default:
      break;
  }
  return badges;
}

// --- Results (conversions + conversion-type label) ---

function pluralize(count: number, label: string): string {
  if (count === 1 && label.endsWith('s')) return label.slice(0, -1);
  return label;
}

function getResultConfig(campaign: Campaign): {
  label: string;
  pick: (totals: {
    leads: number;
    impressions: number;
    clicks: number;
    conversions: number;
  }) => number;
} {
  if (campaign.followUpType === 'lead_form') {
    return { label: 'submissions', pick: (t) => t.leads };
  }
  if (
    campaign.conversionDestination === 'whatsapp' ||
    campaign.conversionDestination === 'messenger' ||
    campaign.conversionDestination === 'instagram_direct'
  ) {
    return { label: 'messages', pick: (t) => t.conversions };
  }
  switch (campaign.objective) {
    case 'OUTCOME_LEADS':
      return { label: 'leads', pick: (t) => t.leads };
    case 'OUTCOME_SALES':
      return { label: 'purchases', pick: (t) => t.conversions };
    case 'OUTCOME_TRAFFIC':
      return { label: 'link clicks', pick: (t) => t.clicks };
    default:
      return { label: 'impressions', pick: (t) => t.impressions };
  }
}

// --- Insight Cell Components ---

function ResultsCell({
  campaign,
  summary,
  isLoading,
}: {
  campaign: Campaign;
  summary: CampaignInsightsSummary | undefined;
  isLoading: boolean;
}) {
  const { label, pick } = getResultConfig(campaign);

  if (isLoading) {
    return <div className="text-muted-foreground text-sm">...</div>;
  }

  const totals = summary?.totals;
  if (!totals) {
    return (
      <div className="text-muted-foreground text-sm">
        &mdash; <span className="text-xs">{label}</span>
      </div>
    );
  }

  const count = pick(totals);
  return (
    <div className="text-sm">
      <span className="font-medium tabular-nums">{formatNumber(count)}</span>{' '}
      <span className="text-muted-foreground text-xs">
        {pluralize(count, label)}
      </span>
    </div>
  );
}

function AmountSpentCell({
  summary,
  isLoading,
}: {
  summary: CampaignInsightsSummary | undefined;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <div className="text-muted-foreground text-sm">...</div>;
  }

  const spend = summary?.totals?.spend;
  return (
    <div className="text-sm">
      {spend ? formatCurrency(spend) : formatCurrency(0)}
    </div>
  );
}

// --- Campaign Sub-Components ---

function CampaignStatusSwitch({
  campaign,
  isActive,
}: {
  campaign: Campaign;
  isActive: boolean;
}) {
  const { execute: pauseCampaign, isExecuting: isPausing } = usePauseCampaign();
  const { execute: resumeCampaign, isExecuting: isResuming } =
    useResumeCampaign();
  const [showNoBudgetDialog, setShowNoBudgetDialog] = React.useState(false);

  const handleToggle = (checked: boolean) => {
    if (!checked) {
      pauseCampaign(campaign.id);
      return;
    }

    if (!campaignHasBudget(campaign)) {
      setShowNoBudgetDialog(true);
      return;
    }

    resumeCampaign(campaign.id);
  };

  return (
    <>
      <Switch
        aria-label={isActive ? 'Pause campaign' : 'Resume campaign'}
        checked={isActive}
        disabled={isPausing || isResuming}
        onCheckedChange={handleToggle}
        // Toggling delivery must not ALSO open the campaign behind the row.
        onClick={(event) => event.stopPropagation()}
      />
      <NoBudgetDialog
        campaignName={campaign.name}
        onOpenChange={setShowNoBudgetDialog}
        open={showNoBudgetDialog}
      />
    </>
  );
}

function CampaignActions({ campaign }: { campaign: Campaign }) {
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [editDialogOpen, setEditDialogOpen] = React.useState(false);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = React.useState(false);
  const {
    execute: deleteCampaign,
    isExecuting: isDeleting,
    isSuccess: isDeleteSuccess,
  } = useDeleteCampaign();
  const { execute: duplicateCampaign, isExecuting: isDuplicating } =
    useDuplicateCampaign();

  const handleDuplicateConfirm = () => {
    duplicateCampaign(campaign.id, {
      onSuccess: () => setDuplicateDialogOpen(false),
    });
  };

  React.useEffect(() => {
    if (isDeleteSuccess && deleteDialogOpen) {
      setDeleteDialogOpen(false);
    }
  }, [isDeleteSuccess, deleteDialogOpen]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={`Actions for ${campaign.name}`}
            className="flex size-8 text-muted-foreground data-[state=open]:bg-muted"
            size="icon"
            variant="ghost"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-32">
          <DropdownMenuItem onSelect={() => setEditDialogOpen(true)}>
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isDuplicating}
            onSelect={() => setDuplicateDialogOpen(true)}
          >
            {isDuplicating ? 'Duplicating...' : 'Duplicate'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            disabled={isDeleting}
            onSelect={() => setDeleteDialogOpen(true)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditCampaignDialog
        campaign={campaign}
        onOpenChange={setEditDialogOpen}
        open={editDialogOpen}
      />

      <DeleteCampaignDialog
        campaignName={campaign.name}
        isDeleting={isDeleting}
        onConfirm={() => deleteCampaign(campaign.id)}
        onOpenChange={setDeleteDialogOpen}
        open={deleteDialogOpen}
      />

      <DuplicateCampaignDialog
        campaignName={campaign.name}
        isDuplicating={isDuplicating}
        onConfirm={handleDuplicateConfirm}
        onOpenChange={setDuplicateDialogOpen}
        open={duplicateDialogOpen}
      />
    </>
  );
}

function BudgetCell({ campaign }: { campaign: Campaign }) {
  const dailyBudget = campaign.dailyBudget ? Number(campaign.dailyBudget) : 0;
  const lifetimeBudget = campaign.lifetimeBudget
    ? Number(campaign.lifetimeBudget)
    : 0;

  if (dailyBudget > 0) {
    return (
      <div>
        <div className="text-sm">{formatCurrency(dailyBudget)}</div>
        <div className="text-muted-foreground text-xs">Daily average</div>
      </div>
    );
  }

  if (lifetimeBudget > 0) {
    return (
      <div>
        <div className="text-sm">{formatCurrency(lifetimeBudget)}</div>
        <div className="text-muted-foreground text-xs">Lifetime</div>
      </div>
    );
  }

  return <div className="text-sm">&mdash;</div>;
}

// --- Main Component ---

/**
 * The advertising campaigns list, on the shared `ListPage`.
 *
 * Replaces a hand-rolled TanStack table AND the parallel `CampaignMobileList`
 * that restated the same fields as phone rows. Both layouts now render from the
 * one `columns` config, so a column added here cannot silently miss the phone.
 *
 * Search, the status filter, the insights date range and pagination stay HERE —
 * `rows` is simply what the shell renders (see the list-page README).
 */
export function CampaignList({
  readOnly = false,
  onCampaignSelect,
}: {
  /** Hide write controls (status toggle, New Campaign, edit/delete). */
  readOnly?: boolean;
  /**
   * When provided, clicking a campaign calls this instead of navigating to
   * `/dashboard/marketing/advertising/$id` — used by the admin panel for local
   * selection.
   */
  onCampaignSelect?: (id: string) => void;
} = {}) {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] =
    React.useState<CampaignStatusFilterValue>('all');
  const [pageIndex, setPageIndex] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(10);

  // Date range — defaults to the past month.
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>(
    () => ({
      from: startOfDay(subMonths(new Date(), 1)),
      to: new Date(),
    })
  );

  const insightsParams = React.useMemo<CampaignInsightsParams>(() => {
    if (dateRange?.from && dateRange?.to) {
      return {
        since: format(dateRange.from, 'yyyy-MM-dd'),
        until: format(dateRange.to, 'yyyy-MM-dd'),
      };
    }
    return {};
  }, [dateRange]);

  const dateRangeLabel = React.useMemo(() => {
    if (!dateRange?.from) return 'Select date range';
    if (!dateRange.to) return format(dateRange.from, 'd MMMM yyyy');
    return `${format(dateRange.from, 'd MMMM yyyy')} - ${format(
      dateRange.to,
      'd MMMM yyyy'
    )}`;
  }, [dateRange]);

  const { campaigns, isLoading, isError, error, refetch } = useListCampaigns();

  // One batched request fetches insights for every campaign at once — the
  // per-row fan-out it replaces tripped Meta's rate limit on page load.
  const { insightsByCampaignId, isLoading: isInsightsLoading } =
    useListCampaignInsights(insightsParams);

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    return campaigns.filter((campaign) => {
      if (!campaignMatchesStatusFilter(campaign, statusFilter)) return false;
      if (!term) return true;
      return (campaign.name ?? '').toLowerCase().includes(term);
    });
  }, [campaigns, search, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  // A filter that shortens the list must not strand the viewer on a page that
  // no longer exists.
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const rows = React.useMemo(
    () =>
      filtered.slice(safePageIndex * pageSize, (safePageIndex + 1) * pageSize),
    [filtered, safePageIndex, pageSize]
  );

  const columns: ListColumn<Campaign>[] = [
    {
      id: 'toggle',
      header: 'Off/On',
      width: 'w-20',
      // Write control — hidden in read-only (admin) mode, and dropped on the
      // phone, which has never carried it.
      hidden: readOnly,
      cell: (campaign) => (
        <CampaignStatusSwitch
          campaign={campaign}
          isActive={campaign.effectiveStatus === 'ACTIVE'}
        />
      ),
    },
    {
      id: 'name',
      header: 'Name',
      mobile: 'primary',
      cell: (campaign) => {
        const errorMessage = getCampaignErrorMessage(campaign.effectiveStatus);
        return (
          <div className="flex items-center gap-2">
            <span className="font-medium">{campaign.name}</span>
            {errorMessage && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge className="cursor-default" variant="destructive">
                      Error
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>{errorMessage}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        );
      },
    },
    {
      id: 'destination',
      header: 'Destination',
      cell: (campaign) => {
        const badges = getDestinationBadges(campaign);
        if (badges.length === 0) {
          return <span className="text-muted-foreground text-sm">&mdash;</span>;
        }
        return (
          <div className="flex flex-wrap items-center gap-1">
            {badges.map((badge) => (
              <Badge
                className={cn(badge.className)}
                key={badge.label}
                variant={badge.variant ?? 'default'}
              >
                {badge.label}
              </Badge>
            ))}
          </div>
        );
      },
    },
    {
      id: 'budget',
      header: 'Daily budget',
      cell: (campaign) => <BudgetCell campaign={campaign} />,
    },
    {
      id: 'amountSpent',
      header: 'Amount spent',
      // What this campaign has cost — the phone's muted line under the name.
      mobile: 'secondary',
      cell: (campaign) => (
        <AmountSpentCell
          isLoading={isInsightsLoading}
          summary={insightsByCampaignId.get(campaign.id)}
        />
      ),
    },
    {
      id: 'results',
      header: 'Results',
      align: 'right',
      // The one number the campaign exists to produce — the honest trailing
      // value on a phone row.
      mobile: 'trailing',
      cell: (campaign) => (
        <ResultsCell
          campaign={campaign}
          isLoading={isInsightsLoading}
          summary={insightsByCampaignId.get(campaign.id)}
        />
      ),
    },
  ];

  const openCampaign = (campaign: Campaign) => {
    if (onCampaignSelect) {
      onCampaignSelect(campaign.id);
      return;
    }
    void navigate({
      to: routes.advertisingCampaign(campaign.id),
    });
  };

  return (
    <>
      <ListPage<Campaign>
        config={{
          title: 'Campaigns',
          columns,
          rows,
          rowKey: (campaign) => campaign.id,
          onRowClick: openCampaign,
          rowActions: readOnly
            ? undefined
            : (campaign) => <CampaignActions campaign={campaign} />,
          searchPlaceholder: 'Search campaigns',
          search,
          onSearchChange: (value) => {
            setSearch(value);
            setPageIndex(0);
          },
          primaryAction: readOnly
            ? undefined
            : {
                label: 'New Campaign',
                mobileLabel: 'New',
                onClick: () => setIsCreateOpen(true),
              },
          // Full-width row above the search box: the status strip wants the
          // whole column, which the `toolbar` slot (inside the non-wrapping
          // search row) cannot give it.
          filters: (
            <Tabs
              onValueChange={(value) => {
                setStatusFilter(value as CampaignStatusFilterValue);
                setPageIndex(0);
              }}
              value={statusFilter}
            >
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="ACTIVE">Active</TabsTrigger>
                <TabsTrigger value="PAUSED">Paused</TabsTrigger>
              </TabsList>
            </Tabs>
          ),
          toolbar: (
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline">
                  <CalendarIcon className="size-4" />
                  <span className="hidden sm:inline">{dateRangeLabel}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto p-0">
                <Calendar
                  defaultMonth={dateRange?.from}
                  disabled={(date) =>
                    date > new Date() || date < new Date('1900-01-01')
                  }
                  mode="range"
                  numberOfMonths={2}
                  onSelect={setDateRange}
                  selected={dateRange}
                />
              </PopoverContent>
            </Popover>
          ),
          isLoading,
          isError,
          errorMessage: error?.message || 'Failed to load campaigns',
          onRetry: () => void refetch(),
          footer: filtered.length > 0 && (
            <ListPagination
              label="campaigns"
              onPageChange={setPageIndex}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPageIndex(0);
              }}
              pageIndex={safePageIndex}
              pageSize={pageSize}
              total={filtered.length}
            />
          ),
          empty: {
            icon: Megaphone,
            title:
              search || statusFilter !== 'all'
                ? 'No matching campaigns'
                : 'No campaigns yet',
            description:
              search || statusFilter !== 'all'
                ? 'No campaign matches that search or filter.'
                : readOnly
                  ? 'This organization has no campaigns yet.'
                  : 'Create your first campaign to start advertising and reaching your audience.',
            // No explicit action: the shell falls back to `primaryAction`,
            // which is itself absent in read-only mode — so an admin viewer is
            // never offered a write they cannot perform.
          },
        }}
      />

      {!readOnly && (
        <CreateCampaignDialog
          onOpenChange={setIsCreateOpen}
          open={isCreateOpen}
        />
      )}
    </>
  );
}

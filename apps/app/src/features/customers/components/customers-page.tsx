import { keepPreviousData } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  ArrowUpDown,
  ChevronDown,
  Eye,
  FileText,
  Globe,
  Mail,
  MessageCircle,
  MoreVertical,
  Phone,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import * as React from 'react';

import { ListPage, ListPagination } from '@/components/app/list-page';
import type { ListColumn } from '@/components/app/list-page';
import { FacebookLogo, InstagramLogo } from '@/components/global/brand-icons';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ImportDocumentsDialog } from '@/features/document-imports';
import {
  ImportLeadsCsvDialog,
  type LeadListItem,
  useDeleteLead,
  useListLeads,
} from '@/features/leads';
import { useResolvedRoutes } from '@/lib/use-routes';
import { cn } from '@/lib/utils';
import {
  leadSourceLabels,
  leadStatusLabels,
} from '@borradh-workspace/api-client/types';
import type { LeadStageGroup } from '@borradh-workspace/labels';

import { useLeadStageCounts } from '../api';
import { STAGE_GROUP_TABS } from '../constants';

const sourceIcons: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  facebook: FacebookLogo,
  instagram: InstagramLogo,
  whatsapp: MessageCircle,
  website: Globe,
  manual: Mail,
  referral: Phone,
  other: Globe,
  meta_lead_form: FileText,
};

type LeadSort = 'smart' | 'recent' | 'oldest' | 'name' | 'last_visit';

const SORT_OPTIONS: { value: LeadSort; label: string }[] = [
  { value: 'smart', label: 'Smart' },
  { value: 'recent', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'last_visit', label: 'Last visit' },
];

interface CustomersPageProps {
  /** Active tab; owned by the route via search params so it survives reload. */
  tab: LeadStageGroup;
  onTabChange: (tab: LeadStageGroup) => void;
}

/**
 * The unified Clients list, on the shared `ListPage`.
 *
 * This was the last page still driving TanStack `useReactTable` plus a parallel
 * hand-written `CustomersMobileList`. Both are gone: the desktop table and the
 * phone list now render from the SAME column config, so a column added here
 * cannot silently fail to reach the phone.
 *
 * Everything the shell does not own stays HERE, per the ListPage rules:
 * - the tab strip, Sort menu, Columns menu and import dialogs live in `toolbar`
 * - pagination lives in `footer`
 * - filtering/sorting/paging are resolved SERVER-side via `useListLeads` filters
 *
 * Column visibility is expressed with `ListColumn.hidden` rather than a table
 * instance — the menu simply toggles ids in a set.
 */
export function CustomersPage({ tab, onTabChange }: CustomersPageProps) {
  const { deleteLead, isDeleting } = useDeleteLead();
  const { counts } = useLeadStageCounts();
  const navigate = useNavigate();
  const routes = useResolvedRoutes();

  const [importOpen, setImportOpen] = React.useState<
    'leads' | 'documents' | null
  >(null);
  // The Columns menu is gone, so nothing toggles this any more. Kept as a
  // constant (rather than deleting the `hidden` wiring) because
  // `ListColumn.hidden` is how a column would be conditionally dropped again —
  // e.g. hiding price columns for an org that takes no payments.
  const [hiddenColumns] = React.useState<Set<string>>(() => new Set());
  const [pageIndex, setPageIndex] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(25);
  const [search, setSearch] = React.useState('');
  // Default to the "smart" tiered order (Qualified → Booked → unread inbound →
  // rest); the Sort menu lets the user override per view.
  const [sort, setSort] = React.useState<LeadSort>('smart');

  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  // Any change to what is being listed starts again from the first page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetting on the inputs is the point; `pageIndex` is the output.
  React.useEffect(() => {
    setPageIndex(0);
  }, [tab, debouncedSearch, sort]);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value);
  }, []);

  const handleTabChange = React.useCallback(
    (next: LeadStageGroup) => {
      onTabChange(next);
    },
    [onTabChange]
  );

  const handleSortChange = React.useCallback((next: LeadSort) => {
    setSort(next);
  }, []);

  // Pagination, search, sort and the tab (stageGroup) are all resolved
  // server-side.
  const filters = React.useMemo(
    () => ({
      stageGroup: tab,
      search: debouncedSearch.trim() || undefined,
      sort,
      limit: pageSize,
      offset: pageIndex * pageSize,
    }),
    [tab, debouncedSearch, sort, pageIndex, pageSize]
  );

  const { leads, total, isLoading, isError, refetch } = useListLeads({
    filters,
    queryConfig: { placeholderData: keepPreviousData },
  });

  const handleCreate = React.useCallback(() => {
    void navigate({ params: { entity: 'customer' }, to: '/create/$entity' });
  }, [navigate]);

  const handleViewDetails = React.useCallback(
    (leadId: string) => {
      void navigate({
        to: routes.customerDetail(leadId),
      });
    },
    [navigate, routes.customerDetail]
  );

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);

  // A deletion can remove the only row on the last page. Move back to the new
  // last page instead of leaving the customer on an empty, out-of-range slice.
  React.useEffect(() => {
    if (pageIndex !== safePageIndex) {
      setPageIndex(safePageIndex);
    }
  }, [pageIndex, safePageIndex]);

  const columns: ListColumn<LeadListItem>[] = React.useMemo(() => {
    const all: ListColumn<LeadListItem>[] = [
      {
        id: 'name',
        header: 'Name',
        // The phone row is avatar + name (the avatar lives INSIDE this cell
        // rather than in a `media` column, so the desktop table keeps one Name
        // column rather than gaining an empty-headed one).
        mobile: 'primary',
        cell: (lead) => {
          const fullName = `${lead.firstName} ${lead.lastName || ''}`.trim();
          const initials =
            `${lead.firstName.charAt(0)}${lead.lastName?.charAt(0) || ''}`.toUpperCase();
          return (
            <span className="flex min-w-0 items-center gap-3">
              <Avatar className="size-8 shrink-0">
                <AvatarFallback className="bg-muted font-medium text-xs">
                  {initials || '?'}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {fullName || 'Client'}
                </span>
                {lead.email && (
                  // Desktop only: the phone row shows the phone underneath
                  // instead. `md:block` alone does NOT hide it — it needs
                  // `hidden` first.
                  <span className="hidden truncate text-muted-foreground text-xs md:block">
                    {lead.email}
                  </span>
                )}
              </span>
            </span>
          );
        },
      },
      {
        id: 'stage',
        header: 'Stage',
        // Read-only: stage is DERIVED server-side from what has actually
        // happened to the person (messaged, replied, booked), so there is
        // nothing here for a user to set. `lost` is the one exception and is
        // marked from the row menu.
        //
        // It is also the one value worth carrying to the phone's trailing slot —
        // it is what the deleted mobile list showed there.
        mobile: 'trailing',
        cell: (lead) => (
          <Badge className="font-normal" variant="secondary">
            {leadStatusLabels[lead.stage]}
          </Badge>
        ),
      },
      {
        id: 'source',
        header: 'Source',
        cell: (lead) => {
          const SourceIcon = sourceIcons[lead.source] || Globe;
          return (
            <Badge
              className="gap-1.5 px-2 py-1 text-muted-foreground"
              variant="outline"
            >
              <SourceIcon className="size-3" />
              {leadSourceLabels[lead.source]}
            </Badge>
          );
        },
      },
      {
        id: 'lastVisit',
        header: 'Last visit',
        cell: (lead) => (
          <span className="text-muted-foreground text-sm">
            {lead.lastVisitAt
              ? new Date(lead.lastVisitAt).toLocaleDateString()
              : '-'}
          </span>
        ),
      },
      {
        id: 'phone',
        header: 'Phone',
        mobile: 'secondary',
        cell: (lead) => (
          <span className="text-muted-foreground text-sm">
            {lead.phone || '-'}
          </span>
        ),
      },
      {
        id: 'createdAt',
        header: 'Date added',
        cell: (lead) => (
          <span className="text-muted-foreground text-sm">
            {new Date(lead.createdAt).toLocaleDateString()}
          </span>
        ),
      },
    ];

    return all.map((column) => ({
      ...column,
      hidden: hiddenColumns.has(column.id),
    }));
  }, [hiddenColumns]);

  /*
    The stage tabs are a FILTER, not a toolbar button, and there are four of
    them: sharing one non-wrapping row with the search box, Sort, Import and the
    primary action is what made this toolbar overflow and collide. `filters` is
    the ListPage slot for exactly this — a full-width row above the search row.
  */
  const stageTabs = (
    <div className="min-w-0">
      <div className="inline-flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-muted p-1">
        {STAGE_GROUP_TABS.map((t) => {
          const isActive = t.value === tab;
          const count = counts?.tabs[t.value];
          return (
            <button
              aria-pressed={isActive}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 font-medium text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                isActive
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              key={t.value}
              onClick={() => handleTabChange(t.value)}
              type="button"
            >
              {t.label}
              {count !== undefined && (
                <span
                  className={cn(
                    'rounded-full px-1.5 font-semibold text-xs tabular-nums transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'bg-background/70 text-muted-foreground'
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  const toolbar = (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline">
            <ArrowUpDown />
            <span className="hidden sm:inline">Sort</span>
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            onValueChange={(value) => handleSortChange(value as LeadSort)}
            value={sort}
          >
            {SORT_OPTIONS.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/*
        One "Import" control instead of two competing buttons. The dialogs are
        driven by state rather than nested triggers — a dialog trigger inside a
        dropdown item does not fire reliably, because the menu closes and
        unmounts it on the same click.
      */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline">
            <Upload />
            <span className="hidden sm:inline">Import</span>
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => setImportOpen('documents')}>
            Import Documents
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setImportOpen('leads')}>
            Import Leads
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ImportLeadsCsvDialog
        onOpenChange={(next) => setImportOpen(next ? 'leads' : null)}
        open={importOpen === 'leads'}
        trigger={null}
      />
      <ImportDocumentsDialog
        onOpenChange={(next) => setImportOpen(next ? 'documents' : null)}
        open={importOpen === 'documents'}
        trigger={null}
      />
    </div>
  );

  const footer = (
    <ListPagination
      label="clients"
      onPageChange={setPageIndex}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPageIndex(0);
      }}
      pageIndex={safePageIndex}
      pageSize={pageSize}
      total={total}
    />
  );

  return (
    <ListPage<LeadListItem>
      config={{
        title: 'Customers',
        columns,
        rows: leads,
        rowKey: (lead) => lead.id,
        // The id the deleted CustomersMobileList emitted per row. Kept verbatim
        // so anything addressing rows by it keeps working — and it now applies
        // to the desktop table too.
        rowTestId: (lead) => `mobile-customer-row-${lead.id}`,
        onRowClick: (lead) => handleViewDetails(lead.id),
        rowActions: (lead) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="flex size-8 text-muted-foreground data-[state=open]:bg-muted"
                size="icon"
                variant="ghost"
              >
                <MoreVertical />
                <span className="sr-only">Open menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => handleViewDetails(lead.id)}>
                <Eye className="size-4" />
                View profile
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={isDeleting}
                onClick={() => deleteLead(lead.id)}
                variant="destructive"
              >
                <Trash2 className="size-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
        searchPlaceholder: 'Search clients',
        search,
        onSearchChange: handleSearchChange,
        filters: stageTabs,
        toolbar,
        // The page's primary action is a PAGE, like every other create surface.
        // `CreateLeadDialog` still exists, but only where a navigation would
        // lose work in progress (the till, the calendar).
        primaryAction: {
          label: 'Add Customer',
          mobileLabel: 'Add',
          onClick: handleCreate,
        },
        footer,
        isLoading,
        isError,
        errorMessage: 'Failed to load clients. Please try again.',
        onRetry: () => void refetch(),
        empty: {
          icon: Users,
          title: search ? 'No matches' : 'Nothing to see here',
          description: search
            ? 'No clients match your search.'
            : 'No clients match this view yet.',
          // No `action`: ListPage falls through to `primaryAction`, so the empty
          // state and the toolbar cannot offer two different "Add Customer"s.
        },
      }}
    />
  );
}

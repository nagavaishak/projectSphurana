'use client';

import { ChevronDownIcon, Loader2, PlusIcon, SearchIcon } from 'lucide-react';
import { useCallback, useRef } from 'react';

import { Button } from '@/components/ui/button';
import {
  ButtonGroup,
  ButtonGroupSeparator,
} from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  MobileRecordListEmpty,
  MobileRecordListSkeleton,
} from '@/features/mobile-ui';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

import { DashboardPage } from '../dashboard-page';
import { DataTable } from './data-table';
import type { ListPageConfig } from './list-page-types';
import { MobileList } from './mobile-list';

/**
 * The one list/table page.
 *
 * Replaces ~12 hand-rolled `<Table>` implementations plus their parallel
 * `mobile-record-list` variants. A feature supplies columns and rows; the
 * header, search, toolbar, desktop table, mobile list, and the loading / error /
 * empty states are shared and identical everywhere.
 *
 * Sibling of `EntityFormPage`: lists and editors are the two shapes nearly every
 * dashboard page takes, and both are now config over shared chrome rather than
 * bespoke markup per feature.
 *
 * Exactly ONE of the table and the phone list renders, chosen by `useIsMobile`.
 *
 * The editor is CSS-responsive because it has form state that must not be
 * duplicated; a list has no such state, and rendering both trees would put every
 * row in the DOM twice — wasteful on a long list, and it makes tests match each
 * row twice over. The anti-drift property does not come from rendering both at
 * once: it comes from both rendering from the SAME `columns` config.
 */
export function ListPage<TRow>({ config }: { config: ListPageConfig<TRow> }) {
  const {
    title,
    description,
    columns,
    rows,
    rowKey,
    onRowClick,
    rowActions,
    searchPlaceholder,
    search,
    onSearchChange,
    primaryAction,
    banner,
    toolbar,
    filters,
    isLoading,
    isError,
    errorMessage,
    onRetry,
    footer,
    rowTestId,
    sort,
    onSortChange,
    onLoadMore,
    hasMore,
    isLoadingMore,
    empty,
  } = config;

  const isMobile = useIsMobile();

  // Infinite scroll: a sentinel below the last row.
  //
  // A CALLBACK ref, not `useRef` + `useEffect`. With an effect, the sentinel is
  // still unmounted when the effect first runs (the rows render after), so
  // `ref.current` is null, the observer is never attached, and nothing re-runs
  // it — the list silently stops loading. A callback ref fires exactly when the
  // node appears and again when it goes away.
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef(onLoadMore);
  loadMoreRef.current = onLoadMore;

  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMoreRef.current?.();
        }
      },
      {
        // Watch within the scrolling rows container, not the viewport — the
        // page does not scroll, so a viewport-rooted observer would only ever
        // fire if the sentinel happened to start on screen.
        root: node.closest('[data-list-scroll]'),
        // Start fetching before the sentinel is actually visible, so the next
        // rows are usually there by the time the user reaches them.
        rootMargin: '400px',
      }
    );
    observer.observe(node);
    observerRef.current = observer;
  }, []);
  const visibleColumns = columns.filter((column) => !column.hidden);

  return (
    // The header, width and 16px rhythm come from DashboardPage — the SAME
    // shell the non-list pages use, so a page with a table and a page without
    // cannot drift apart.
    <DashboardPage
      // `data-list-page` lets the dashboard shell constrain itself to the
      // viewport via `:has()` — no hardcoded list of full-height route paths to
      // keep in step with 23 pages.
      // The phone's scroll region runs edge to edge by default (a chat
      // transcript wants that); a list's card needs the page's own gutter back,
      // or it butts against both bezels while the search field above it does
      // not.
      contentClassName={isMobile ? 'px-4 pb-4' : undefined}
      data-list-page=""
      description={description}
      fillHeight
      title={title}
      toolbar={
        (searchPlaceholder ||
          toolbar ||
          primaryAction ||
          filters ||
          banner) && (
          <div className="flex flex-col gap-4 max-md:gap-3">
            {banner}
            {/*
              Filters above the search row on desktop, below it on the phone.
              The phone's filters are a horizontally scrolling chip strip, and a
              strip directly under the floating header reads as part of the
              header rather than as controls on the list; the search field is
              what the screen should open with.
            */}
            {!isMobile && filters}
            <div className="flex items-center gap-2">
              {searchPlaceholder && (
                <div className="relative min-w-0 flex-1 md:max-w-xs">
                  <SearchIcon className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-muted-foreground" />
                  <Input
                    className="rounded-full pl-9"
                    onChange={(event) => onSearchChange?.(event.target.value)}
                    placeholder={searchPlaceholder}
                    value={search ?? ''}
                  />
                </div>
              )}

              {toolbar}

              {primaryAction && (
                <PrimaryAction
                  action={primaryAction}
                  className="ml-auto shrink-0"
                  compact={isMobile}
                />
              )}
            </div>
            {isMobile && filters}
          </div>
        )
      }
    >
      {isLoading &&
        (isMobile ? <MobileRecordListSkeleton /> : <ListSkeleton />)}

      {!isLoading && isError && (
        <div className="flex flex-col items-center gap-3 py-12">
          <p className="text-destructive text-sm" role="alert">
            {errorMessage ?? 'We could not load this list. Please try again.'}
          </p>
          {/* An error with no way out is a dead end — offer the retry when the
              caller can actually refetch. */}
          {onRetry && (
            <Button onClick={onRetry} variant="outline">
              Try again
            </Button>
          )}
        </div>
      )}

      {!(isLoading || isError) && rows.length === 0 && (
        <ListEmptyState
          empty={empty}
          isMobile={isMobile}
          primaryAction={primaryAction}
        />
      )}

      {/*
        The ONLY scrolling region: the header, toolbar and footer stay put while
        the rows move. `min-h-0` is what lets this flex child shrink below its
        content instead of growing the page.
      */}
      {!(isLoading || isError) && rows.length > 0 && (
        // On a phone `MobilePageShell` IS the scroll region (and carries the
        // same `data-list-scroll` marker the infinite-scroll observer roots on),
        // so this wrapper must not scroll as well — two nested scrollers means
        // the rows move inside a box that also moves.
        <div
          className={cn(isMobile ? 'flex-1' : 'min-h-0 flex-1 overflow-y-auto')}
          data-list-scroll={isMobile ? undefined : ''}
        >
          {isMobile ? (
            <MobileList
              columns={visibleColumns}
              onRowClick={onRowClick}
              rowActions={rowActions}
              rowKey={rowKey}
              rowTestId={rowTestId}
              rows={rows}
            />
          ) : (
            <DataTable
              columns={visibleColumns}
              onRowClick={onRowClick}
              onSortChange={onSortChange}
              rowActions={rowActions}
              rowKey={rowKey}
              rowTestId={rowTestId}
              rows={rows}
              sort={sort}
            />
          )}

          {onLoadMore && hasMore && (
            <div className="flex justify-center py-6" ref={sentinelRef}>
              {isLoadingMore && (
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              )}
            </div>
          )}
        </div>
      )}

      {!(isLoading || isError) && footer}
    </DashboardPage>
  );
}

/**
 * Nothing to show yet.
 *
 * The phone gets the house empty state — circle-backed icon, 17px title — so an
 * empty list and an empty inbox look like the same product. It needs an icon,
 * which `ListPageEmpty` treats as optional, so a list without one falls through
 * to the shadcn `Empty` rather than having one invented for it.
 */
function ListEmptyState<TRow>({
  empty,
  isMobile,
  primaryAction,
}: {
  empty: ListPageConfig<TRow>['empty'];
  isMobile: boolean;
  primaryAction: ListPageConfig<TRow>['primaryAction'];
}) {
  const EmptyIcon = empty.icon;
  // The full label on both viewports, never the phone's short one: an empty
  // page has the room, and "Add" alone reads as a dead end.
  const action =
    empty.action ??
    (primaryAction && <PrimaryAction action={primaryAction} alwaysFullLabel />);

  if (isMobile && EmptyIcon) {
    return (
      <MobileRecordListEmpty
        action={action}
        description={empty.description}
        icon={EmptyIcon}
        title={empty.title}
      />
    );
  }

  return (
    // `flex-none justify-start`: `Empty` defaults to `flex-1` + centred, which
    // on a `fillHeight` list page stretches it over the whole remaining
    // viewport and drops the message into the vertical middle — half a screen
    // below the toolbar it belongs to. An empty list has no content to centre
    // against, so it sits directly under the toolbar.
    <Empty className="flex-none justify-start">
      <EmptyHeader>
        {EmptyIcon && (
          <EmptyMedia variant="icon">
            <EmptyIcon />
          </EmptyMedia>
        )}
        <EmptyTitle>{empty.title}</EmptyTitle>
        {empty.description && (
          <EmptyDescription>{empty.description}</EmptyDescription>
        )}
      </EmptyHeader>
      {action}
    </Empty>
  );
}

/**
 * The create button — plain, or split when the caller supplies a `menu`.
 *
 * One component for both the header and the empty state so the two can never
 * offer different ways to create: an empty Services page that only knows how to
 * make a service from scratch, while the header also offers "import from
 * another location", is exactly the drift this shell exists to prevent.
 */
function PrimaryAction({
  action,
  className,
  alwaysFullLabel,
  compact,
}: {
  action: NonNullable<ListPageConfig<unknown>['primaryAction']>;
  className?: string;
  alwaysFullLabel?: boolean;
  /**
   * The phone's create control: a round icon button beside the search field,
   * matching Services and the rest of the phone chrome. A labelled button there
   * either crowds the search field down to a stub or wraps onto its own row.
   */
  compact?: boolean;
}) {
  if (compact) {
    const trigger = (
      <button
        aria-label={action.label}
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-full bg-[#0A0A0A] text-white',
          'active:scale-[0.97]',
          className
        )}
        // With a menu the button OPENS it rather than acting, because a round
        // icon has no room for the caret the desktop split button uses. That is
        // the trade Services already made: one tap to the menu where there are
        // two ways to create, one tap to create where there is only one.
        onClick={action.menu ? undefined : action.onClick}
        type="button"
      >
        <PlusIcon aria-hidden className="size-5" strokeWidth={2.25} />
      </button>
    );

    if (!action.menu) {
      return trigger;
    }

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          {action.menu.items.map((item) => (
            <DropdownMenuItem
              disabled={item.disabled}
              key={item.label}
              onSelect={item.onSelect}
            >
              {item.label}
            </DropdownMenuItem>
          ))}
          {action.menu.footer && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 pt-1 pb-1 text-muted-foreground text-xs">
                {action.menu.footer}
              </div>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  /*
    The phone shows the short label ("Add"); the desktop shows the full one
    ("Add Membership"). BOTH render so the accessible name is always present —
    only one is visible.
  */
  const label = alwaysFullLabel ? (
    action.label
  ) : (
    <>
      <span className="md:hidden">{action.mobileLabel ?? action.label}</span>
      <span className="hidden md:inline">{action.label}</span>
    </>
  );

  // Both label spans are in the DOM, so without this the accessible name is
  // the two concatenated ("AddAdd service"). The full label is the name in
  // every viewport; only what is PAINTED changes.
  const ariaLabel = action.label;

  if (!action.menu) {
    return (
      <Button
        aria-label={ariaLabel}
        className={className}
        onClick={action.onClick}
      >
        {label}
      </Button>
    );
  }

  return (
    <ButtonGroup className={className}>
      <Button aria-label={ariaLabel} onClick={action.onClick}>
        {label}
      </Button>
      {/* Against the solid primary fill the border colour is invisible, so the
          hairline borrows the foreground instead. */}
      <ButtonGroupSeparator className="bg-primary-foreground/25" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            // Narrower than a full icon button: the caret is a handle on the
            // button beside it, not a control competing with it.
            aria-label={`More ${action.label.toLowerCase()} options`}
            className="px-2"
          >
            <ChevronDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          {action.menu.items.map((item) => (
            <DropdownMenuItem
              disabled={item.disabled}
              key={item.label}
              onSelect={item.onSelect}
            >
              {item.label}
            </DropdownMenuItem>
          ))}
          {action.menu.footer && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 pt-1 pb-1 text-muted-foreground text-xs">
                {action.menu.footer}
              </div>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton className="h-14 w-full" key={index} />
      ))}
    </div>
  );
}

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The declarative shape behind every list/table page.
 *
 * Content-agnostic by construction: a feature supplies columns and rows, and
 * gets the same header, search, toolbar, table, mobile list, empty state,
 * loading state and row actions as every other list. Nothing here knows what a
 * membership or a stock order is.
 *
 * Sibling of `components/app/entity-editor` — lists and editors are the two
 * shapes almost every dashboard page takes.
 */

/**
 * Where a column appears on a phone.
 *
 * A phone cannot show six columns, so each column declares its mobile ROLE and
 * the same config renders both layouts. This is the whole reason the mobile
 * list is not a second component per feature: `mobile-record-list` exists today
 * as a parallel hand-written surface per page, which is how the two drift.
 *
 * - `media`     — leading thumbnail (Products)
 * - `primary`   — the row's title
 * - `secondary` — muted line under the title (a price, a code)
 * - `trailing`  — the one value that matters, right-aligned (Duration, Quantity)
 * - omitted     — desktop only; the phone drops it
 */
export type MobileRole = 'media' | 'primary' | 'secondary' | 'trailing';

export interface ListColumn<TRow> {
  id: string;
  /** Header text. Omit for the actions column. */
  header?: string;
  cell: (row: TRow) => ReactNode;
  mobile?: MobileRole;
  align?: 'left' | 'right';
  /** Tailwind width utility, e.g. `w-[120px]`. */
  width?: string;
  /**
   * Make the header a sort control. The shell does NOT sort — it reports the
   * click and renders the indicator; the page sorts `rows`, because most of
   * these lists sort server-side and a shell that quietly re-ordered a paged
   * result would be wrong.
   */
  sortable?: boolean;
  /** Hide entirely — e.g. a price column when the org takes no payments. */
  hidden?: boolean;
}

export interface ListPageEmpty {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Defaults to the page's primary action when omitted. */
  action?: ReactNode;
}

export interface ListPageConfig<TRow> {
  title: string;
  /** One line under the title explaining what the list is. */
  description?: ReactNode;
  columns: ListColumn<TRow>[];
  rows: TRow[];
  rowKey: (row: TRow) => string;
  /**
   * `data-testid` per row, applied to BOTH the table row and the phone row.
   * E2E fixtures address rows by a stable id; the hand-written mobile lists
   * emitted one and the shared list must too, or the mobile branch of those
   * helpers silently finds nothing.
   */
  rowTestId?: (row: TRow) => string;

  /** Opens the detail/editor. Rows are only clickable when set. */
  onRowClick?: (row: TRow) => void;
  /** Trailing `…` menu. Its cell stops propagation so it never triggers a row click. */
  rowActions?: (row: TRow) => ReactNode;

  /** Omit to hide the search box. Filtering is the caller's job — see `onSearchChange`. */
  searchPlaceholder?: string;
  search?: string;
  onSearchChange?: (value: string) => void;

  /** Primary button, top-right on desktop and beside search on mobile. */
  primaryAction?: {
    label: string;
    mobileLabel?: string;
    onClick: () => void;
    /**
     * Turns the button into a SPLIT button: a caret beside the primary opens
     * these. The primary action itself does not move into the menu — a second
     * way to create should never make the first one harder to reach — so the
     * menu repeats it ("New service") and adds the alternatives beneath.
     *
     * Omit it and the plain button renders, which is what every list that has
     * exactly one way to create should keep doing.
     */
    menu?: {
      items: {
        label: string;
        onSelect: () => void;
        disabled?: boolean;
      }[];
      /** Muted line under the items — e.g. "4 other locations to copy from". */
      footer?: ReactNode;
    };
  };
  /**
   * A full-width block directly UNDER the page header, above `filters` and the
   * search row — a status card the page leads with, e.g. timesheets' "clocked
   * in now" strip. Not a filter: it belongs to the header, not the list.
   */
  banner?: ReactNode;
  /** Extra controls beside search (a Sort By button, filter chips). */
  toolbar?: ReactNode;
  /**
   * A full-width row ABOVE the search row — a tab strip, a segmented filter.
   *
   * `toolbar` sits inside the search row, which does not wrap, so a wide
   * control there is cramped beside the search field on a phone. Anything that
   * wants the full width belongs here instead.
   */
  filters?: ReactNode;

  /** Column id + direction currently applied. Omit for an unsorted list. */
  sort?: { columnId: string; direction: 'asc' | 'desc' };
  /**
   * Called when a sortable header is clicked, with the direction the shell
   * suggests (flipping the current column, otherwise ascending). The page is
   * free to ignore the suggestion.
   */
  onSortChange?: (next: {
    columnId: string;
    direction: 'asc' | 'desc';
  }) => void;

  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
  /** Renders a Retry button on the error state. Omit for no retry. */
  onRetry?: () => void;
  /**
   * Below the rows — a "showing X of Y" line or a total. Pinned under the
   * scroll area, so it stays visible while the rows move.
   */
  footer?: ReactNode;

  /**
   * INFINITE SCROLL. Called when the rows are scrolled near the bottom and
   * `hasMore` is true. The page fetches the next slice and appends to `rows`;
   * the shell never fetches.
   *
   * Prefer this to a pager: eight migrated lists silently truncated at a
   * `limit` with no indication there was more, which is worse than either.
   */
  onLoadMore?: () => void;
  /** More rows exist beyond the ones passed. */
  hasMore?: boolean;
  /** A next-page request is in flight — shows a spinner under the rows. */
  isLoadingMore?: boolean;
  empty: ListPageEmpty;
}

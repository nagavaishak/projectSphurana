'use client';

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const PAGE_SIZES = [10, 25, 50, 100];

/**
 * The shared pager for `ListPage`'s `footer` slot.
 *
 * `ListPage` renders whatever rows it is given and does not page them — paging
 * is usually server-side, and a shell that silently sliced a page of results
 * would be wrong. So the footer is a slot, and this is what goes in it, rather
 * than each page hand-rolling the same row of buttons (which is what started
 * happening: two migrated lists had already written their own).
 *
 * Purely presentational — the page owns `pageIndex`/`pageSize` and refetches.
 */
export function ListPagination({
  pageIndex,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  /** Noun for the count, e.g. "clients". Singularised naively for 1. */
  label = 'results',
}: {
  /** Zero-based. */
  pageIndex: number;
  pageSize: number;
  total: number;
  onPageChange: (pageIndex: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  label?: string;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pageIndex, pageCount - 1);
  const first = total === 0 ? 0 : page * pageSize + 1;
  const last = Math.min(total, (page + 1) * pageSize);

  return (
    <div className="flex flex-col gap-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      {/*
        "Showing 1–10 of 240" rather than a bare total: on a paged list the
        number of rows on screen and the number of records are different facts,
        and only showing one of them is how "we only have 10 clients?" happens.
      */}
      <span className="text-muted-foreground">
        {total === 0
          ? `No ${label}`
          : `Showing ${first}–${last} of ${total} ${total === 1 ? label.replace(/s$/, '') : label}`}
      </span>

      <div className="flex items-center gap-4">
        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Rows per page</span>
            <Select
              onValueChange={(value) => onPageSizeChange(Number(value))}
              value={String(pageSize)}
            >
              <SelectTrigger
                aria-label="Rows per page"
                className="h-8 w-[72px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <span className="text-muted-foreground">
          Page {page + 1} of {pageCount}
        </span>

        <div className="flex items-center gap-1">
          <Button
            aria-label="First page"
            disabled={page === 0}
            onClick={() => onPageChange(0)}
            size="icon"
            variant="outline"
          >
            <ChevronsLeft className="size-4" />
          </Button>
          <Button
            aria-label="Previous page"
            disabled={page === 0}
            onClick={() => onPageChange(page - 1)}
            size="icon"
            variant="outline"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            aria-label="Next page"
            disabled={page >= pageCount - 1}
            onClick={() => onPageChange(page + 1)}
            size="icon"
            variant="outline"
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            aria-label="Last page"
            disabled={page >= pageCount - 1}
            onClick={() => onPageChange(pageCount - 1)}
            size="icon"
            variant="outline"
          >
            <ChevronsRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

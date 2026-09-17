import { SearchIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

export interface ContentSelectorFilter<K extends string> {
  key: K;
  label: string;
}

export interface ContentSelectorProps<K extends string> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Choose images", "Choose clips". */
  title: string;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filters: ContentSelectorFilter<K>[];
  filter: K;
  onFilterChange: (key: K) => void;
  filterLabel: string;
  /** Extra controls beside the filter — the clip picker's stock source tab. */
  sideControls?: ReactNode;
  isLoading: boolean;
  /** Shown when nothing matches. */
  empty: ReactNode;
  isEmpty: boolean;
  /** The tiles. Shape differs per medium, which is the point of the slot. */
  children: ReactNode;
  /** "3 selected · maximum 10". */
  footerNote: ReactNode;
  confirmLabel: string;
  confirmDisabled?: boolean;
  /** Why the confirm is disabled, on hover. */
  confirmTitle?: string;
  /** Tile aspect for the loading skeletons — clips are 16:9, images are 4:5. */
  skeletonClassName?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The dialog an owner picks media in.
 *
 * ONE SHELL, because the two pickers it replaces were the same dialog twice:
 * the same header, the same search-and-filter row, the same scrolling grid,
 * the same footer with a count and a confirm. What actually differs between
 * choosing a clip and choosing an image is the DATA and the TILE — a clip tile
 * plays on hover and can come from the stock bank, an image tile is a
 * thumbnail — so those stay with each picker and everything else lives here.
 *
 * The duplication was not theoretical. Safari refuses to paint a video frame
 * from a preload or a seek, so clip thumbnails render blank; that was found and
 * fixed in one grid and not the other, twice, because there was no shared place
 * for it to be fixed once. A slot for the tiles keeps that honest: the thing
 * that genuinely differs is visibly the only thing that differs.
 *
 * Cancel REVERTS. The selection each picker holds is local until Confirm, so an
 * owner who opens the dialog, changes their mind and closes it has changed
 * nothing — the alternative silently commits an edit made by browsing.
 */
export function ContentSelector<K extends string>({
  open,
  onOpenChange,
  title,
  search,
  onSearchChange,
  searchPlaceholder = 'Search by name or tag…',
  filters,
  filter,
  onFilterChange,
  filterLabel,
  sideControls,
  isLoading,
  empty,
  isEmpty,
  children,
  footerNote,
  confirmLabel,
  confirmDisabled,
  confirmTitle,
  skeletonClassName = 'aspect-[4/5]',
  onConfirm,
  onCancel,
}: ContentSelectorProps<K>) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else onCancel();
      }}
    >
      <DialogContent
        overlayClassName="z-[120]"
        className="z-[120] flex max-h-[min(88dvh,760px)] flex-col overflow-hidden p-0 sm:max-w-4xl"
      >
        <DialogHeader>
          <div className="border-b px-5 py-4 pr-12 sm:px-6">
            <DialogTitle>{title}</DialogTitle>
          </div>
        </DialogHeader>

        <div className="flex items-center gap-2 px-5 pt-4 sm:px-6">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              className="pl-8"
            />
          </div>
          {sideControls}
          <Select
            value={filter}
            onValueChange={(value) => onFilterChange(value as K)}
          >
            <SelectTrigger
              className="w-[150px] shrink-0 sm:w-[190px]"
              aria-label={filterLabel}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[130]">
              {filters.map((item) => (
                <SelectItem key={item.key} value={item.key}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {isLoading && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((item) => (
                <Skeleton
                  key={`selector-skeleton-${item}`}
                  className={`${skeletonClassName} rounded-lg`}
                />
              ))}
            </div>
          )}
          {!isLoading && isEmpty && empty}
          {!isLoading && !isEmpty && children}
        </div>

        <DialogFooter className="flex-col border-t px-5 py-4 sm:flex-row sm:px-6">
          <p className="mr-auto self-center text-xs text-muted-foreground">
            {footerNote}
          </p>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={confirmDisabled}
            title={confirmTitle}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

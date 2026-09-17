'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

export interface CatalogPickerItem {
  id: string;
  name: string;
}

/**
 * The picker behind every catalogue tab on the location editor.
 *
 * Ticking is ADDITIVE and nothing else — see `locationCatalogSeedRequestSchema`.
 * The copy that matters is the hint above the list: an unticked row does NOT
 * mean "not available here". Anything not explicitly restricted to other
 * branches is already available at every branch, this one included, and the
 * product has no way to say "everywhere except here". Saying that plainly is
 * the difference between a picker an owner reads correctly and one that looks
 * like it is showing them an empty branch.
 */
export function CatalogPicker({
  items,
  selectedIds,
  onChange,
  isLoading = false,
  disabled = false,
  emptyLabel,
  searchPlaceholder,
}: {
  items: CatalogPickerItem[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  isLoading?: boolean;
  disabled?: boolean;
  emptyLabel: string;
  searchPlaceholder: string;
}) {
  const [search, setSearch] = useState('');

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.name.toLowerCase().includes(q));
  }, [items, search]);

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggle = (id: string) =>
    onChange(
      selected.has(id)
        ? selectedIds.filter((s) => s !== id)
        : [...selectedIds, id]
    );

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          className="max-w-xs"
          disabled={disabled}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={searchPlaceholder}
          value={search}
        />
        <Button
          className="ml-auto"
          disabled={disabled || visible.length === 0}
          onClick={() =>
            onChange([
              ...new Set([...selectedIds, ...visible.map((i) => i.id)]),
            ])
          }
          size="sm"
          type="button"
          variant="outline"
        >
          Select all
        </Button>
        <Button
          disabled={disabled || selectedIds.length === 0}
          onClick={() => onChange([])}
          size="sm"
          type="button"
          variant="ghost"
        >
          Clear
        </Button>
      </div>

      <div className="divide-y rounded-md border">
        {visible.map((item) => {
          const id = `catalog-item-${item.id}`;
          return (
            <label
              className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50"
              htmlFor={id}
              key={item.id}
            >
              <Checkbox
                // Explicit: the row's <label> gives the click target, but a
                // Radix checkbox renders a <button> whose accessible name does
                // not come from that label — leaving assistive tech (and any
                // by-role query) with an unnamed control.
                aria-label={item.name}
                checked={selected.has(item.id)}
                disabled={disabled}
                id={id}
                onCheckedChange={() => toggle(item.id)}
              />
              {item.name}
            </label>
          );
        })}
        {visible.length === 0 && (
          <p className="px-3 py-6 text-center text-muted-foreground text-sm">
            Nothing matches “{search}”.
          </p>
        )}
      </div>
    </div>
  );
}

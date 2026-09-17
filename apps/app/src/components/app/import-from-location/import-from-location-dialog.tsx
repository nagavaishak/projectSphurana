'use client';

import { useMemo, useState } from 'react';

import {
  AppDialogBody,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogRoot,
} from '@/components/ui/app-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import type { ImportFromLocationDialogProps } from './import-from-location-types';

/**
 * "Import from another location…" — the shell, for every catalogue page.
 *
 * DELIBERATELY AGNOSTIC. It knows about locations, rows and a selection; it
 * knows nothing about services, products, memberships or promotions. Every page
 * that can copy records from a sibling branch renders THIS, passing rows and an
 * import mutation, so the five catalogue pages cannot drift into five subtly
 * different import experiences — which is what happened to the twelve
 * hand-rolled tables `ListPage` replaced.
 *
 * Import means DUPLICATE: a copy lands in the active branch and the two rows
 * diverge from then on. The header says so, because the alternative reading
 * ("the same record, shared") leads someone to expect a price edit here to
 * change the other branch too.
 */
export function ImportFromLocationDialog({
  open,
  onOpenChange,
  title,
  entityPlural,
  targetLocationName,
  description,
  confirmVerb = 'Import',
  sourceLocations,
  sourceLocationId,
  onSourceLocationChange,
  rows,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  isImporting,
  onImport,
}: ImportFromLocationDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // A selection belongs to ONE source branch AND to one visit. Carrying ids
  // across a source change would import rows the user can no longer see.
  //
  // Adjusted DURING render rather than in an effect: React re-runs this
  // component before touching the DOM, so the stale selection is never painted
  // (and the footer never flashes "2 selected" over a list that has none).
  //
  // The same reset runs on REOPEN. The dialog stays mounted while closed, so
  // without this a second visit reopens with the previous tick marks — on rows
  // that now read "Already here", against an enabled "Import 2" button that
  // would post ids the user did not choose this time.
  const [selectionKey, setSelectionKey] = useState(
    () => `${open}:${sourceLocationId}`
  );
  const currentKey = `${open}:${sourceLocationId}`;
  if (selectionKey !== currentKey) {
    setSelectionKey(currentKey);
    setSelected(new Set());
  }

  const importable = useMemo(
    () => rows.filter((row) => !row.alreadyHere),
    [rows]
  );
  const allSelected =
    importable.length > 0 && importable.every((row) => selected.has(row.id));

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const toggleAll = () =>
    setSelected(
      allSelected ? new Set() : new Set(importable.map((row) => row.id))
    );

  const count = selected.size;

  return (
    <AppDialogRoot onOpenChange={onOpenChange} open={open} size="lg">
      <AppDialogHeader
        description={
          description ??
          `Copies land in ${targetLocationName}. Edits afterwards are independent.`
        }
        title={title}
      />

      <AppDialogBody className="flex max-h-[60vh] flex-col gap-4 overflow-hidden p-0">
        <div className="flex items-center gap-3 px-6 pt-6">
          <span className="text-muted-foreground text-sm">Copy from</span>
          <Select
            onValueChange={onSourceLocationChange}
            value={sourceLocationId ?? undefined}
          >
            <SelectTrigger aria-label="Copy from" className="w-56">
              <SelectValue placeholder="Choose a location" />
            </SelectTrigger>
            <SelectContent>
              {sourceLocations.map((location) => (
                <SelectItem key={location.id} value={location.id}>
                  {location.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!(isLoading || isError) && (
            <span className="ml-auto text-muted-foreground text-sm">
              {importable.length} {plural(importable.length, entityPlural)}
            </span>
          )}
        </div>

        {importable.length > 0 && !(isLoading || isError) && (
          <div className="px-6">
            <Button
              className="h-auto p-0 text-sm"
              onClick={toggleAll}
              variant="link"
            >
              {allSelected ? 'Clear all' : 'Select all'}
            </Button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          {isLoading && (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton className="h-12 w-full" key={index} />
              ))}
            </div>
          )}

          {!isLoading && isError && (
            <div className="flex flex-col items-center gap-3 py-10">
              <p className="text-destructive text-sm" role="alert">
                {errorMessage ??
                  `We could not load the ${entityPlural} at that location.`}
              </p>
              {onRetry && (
                <Button onClick={onRetry} variant="outline">
                  Try again
                </Button>
              )}
            </div>
          )}

          {!(isLoading || isError) && rows.length === 0 && (
            <p className="py-10 text-center text-muted-foreground text-sm">
              That location has no {entityPlural} to copy.
            </p>
          )}

          {!(isLoading || isError) && rows.length > 0 && (
            <ul className="flex flex-col gap-1">
              {rows.map((row) => {
                const checked = selected.has(row.id);
                const inputId = `import-row-${row.id}`;

                return (
                  <li key={row.id}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-md px-2 py-2.5 hover:bg-muted/50',
                        // An already-copied row stays VISIBLE rather than being
                        // filtered out: "why is this one missing?" is a worse
                        // question than "why is this one greyed?", and seeing it
                        // is what tells the user the copy already happened.
                        row.alreadyHere && 'cursor-default hover:bg-transparent'
                      )}
                      htmlFor={inputId}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={row.alreadyHere}
                        id={inputId}
                        onCheckedChange={() => toggle(row.id)}
                      />
                      <span
                        className={cn(
                          'min-w-0 flex-1 truncate text-sm',
                          row.alreadyHere && 'text-muted-foreground'
                        )}
                      >
                        {row.name}
                        {row.meta && (
                          <span className="text-muted-foreground">
                            {' · '}
                            {row.meta}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-muted-foreground text-sm">
                        {row.alreadyHere ? 'Already here' : row.trailing}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </AppDialogBody>

      <AppDialogFooter className="sm:justify-between">
        <span className="text-muted-foreground text-sm">{count} selected</span>
        <div className="flex items-center gap-2">
          <Button
            disabled={isImporting}
            onClick={() => onOpenChange(false)}
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={count === 0 || isImporting}
            onClick={() => onImport([...selected])}
          >
            {isImporting ? 'Working…' : `${confirmVerb} ${count || ''}`.trim()}
          </Button>
        </div>
      </AppDialogFooter>
    </AppDialogRoot>
  );
}

/**
 * "1 service", "3 services".
 *
 * Naive de-pluralisation of the caller's plural noun: every entity this dialog
 * serves ("services", "products", "memberships", "promotions") is a regular
 * -s plural, and the alternative is making each caller pass both forms for one
 * word in one line of chrome.
 */
function plural(count: number, pluralNoun: string): string {
  if (count === 1 && pluralNoun.endsWith('s')) return pluralNoun.slice(0, -1);
  return pluralNoun;
}

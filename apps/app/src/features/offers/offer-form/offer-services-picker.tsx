'use client';

/**
 * The promotion editor's SERVICES section — its own step, grouped by branch.
 *
 * WHY BRANCH IS THE GROUPING, and why it also writes `locationIds`
 * ---------------------------------------------------------------
 * A promotion is scoped two ways at once: the services it discounts, and the
 * branches it runs at. Those were two disconnected controls (a tag popover and
 * a checkbox list), and nothing stopped an operator linking a Cork-only service
 * to a Dublin-only promotion — a combination that discounts nothing.
 *
 * Here the branch IS the outline. Ticking a service implies its branches, and
 * ticking a branch heading takes every service under it. `locationIds` is
 * therefore DERIVED from the picked services rather than answered separately:
 * the two can no longer disagree.
 *
 * The empty-junction convention survives intact. A service with no branch links
 * is offered EVERYWHERE, so it lands in the "All locations" group and
 * contributes no `locationIds` — which is exactly the behaviour every org has
 * today, since the join table is empty for all of them.
 */

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useOrgCurrency } from '@/hooks/use-org-currency';
import { formatServicePrice } from '@borradh-workspace/labels';
import { ArrowDownUp, SearchIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type Control, Controller, type UseFormReturn } from 'react-hook-form';

import type { OfferFormValues } from '../components/offer-form-schema';

/** Only what the picker reads — so tests and callers need not build a full row. */
export interface OfferPickerService {
  id: string;
  name: string;
  priceType?: string | null;
  priceCents?: number | null;
  /** Branches offering it. EMPTY = everywhere (empty-junction convention). */
  locationIds?: string[];
}

export interface OfferPickerLocation {
  id: string;
  name: string;
}

type SortKey = 'name' | 'price';

/** Services offered everywhere have no branch links to group under. */
const EVERYWHERE = '__everywhere__';

interface Group {
  /** Location id, or the `EVERYWHERE` sentinel. */
  id: string;
  name: string;
  items: OfferPickerService[];
}

/**
 * A service belongs under every branch that offers it, and appears once per
 * branch — a Botox offered at two of five branches is a decision the operator
 * makes per branch, so showing it twice is the point, not a duplicate.
 */
function groupByLocation(
  services: OfferPickerService[],
  locations: OfferPickerLocation[]
): Group[] {
  const groups: Group[] = [];

  for (const location of locations) {
    const items = services.filter((s) => s.locationIds?.includes(location.id));
    if (items.length > 0) {
      groups.push({ id: location.id, name: location.name, items });
    }
  }

  const everywhere = services.filter((s) => !s.locationIds?.length);
  if (everywhere.length > 0) {
    groups.push({
      id: EVERYWHERE,
      // With one branch (or none assigned) this is the only group, and calling
      // it "All locations" there would be noise about a choice that does not
      // exist.
      name: locations.length > 1 ? 'All locations' : 'Services',
      items: everywhere,
    });
  }

  return groups;
}

/**
 * The branches implied by a service selection — the value written to
 * `locationIds`.
 *
 * Returns `[]` (meaning "every branch") when any picked service is offered
 * everywhere, or when the picked services already cover every branch: an
 * exhaustive list and an empty one mean the same thing to the API, and the
 * empty one keeps working when a new branch is opened later.
 */
export function locationsForServices(
  serviceIds: string[],
  services: OfferPickerService[],
  locations: OfferPickerLocation[]
): string[] {
  const picked = services.filter((s) => serviceIds.includes(s.id));
  if (picked.some((s) => !s.locationIds?.length)) return [];

  const implied = new Set<string>();
  for (const service of picked) {
    for (const id of service.locationIds ?? []) implied.add(id);
  }

  if (locations.length > 0 && implied.size >= locations.length) return [];
  return locations.filter((l) => implied.has(l.id)).map((l) => l.id);
}

export function OfferServicesPicker({
  control,
  form,
  services,
  locations,
}: {
  control: Control<OfferFormValues>;
  form: UseFormReturn<OfferFormValues>;
  services: OfferPickerService[];
  locations: OfferPickerLocation[];
}) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const { currency } = useOrgCurrency();

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matched = query
      ? services.filter((s) => s.name.toLowerCase().includes(query))
      : services;

    return [...matched].sort((a, b) =>
      sort === 'price'
        ? (a.priceCents ?? 0) - (b.priceCents ?? 0)
        : a.name.localeCompare(b.name)
    );
  }, [services, search, sort]);

  const groups = useMemo(
    () => groupByLocation(visible, locations),
    [visible, locations]
  );

  return (
    <Controller
      control={control}
      name="serviceIds"
      render={({ field, fieldState }) => {
        const selected: string[] = field.value;

        /** Write the picked services AND the branches they imply, together. */
        const commit = (ids: string[]) => {
          const unique = Array.from(new Set(ids));
          field.onChange(unique);
          form.setValue(
            'locationIds',
            locationsForServices(unique, services, locations),
            { shouldDirty: true }
          );
        };

        const setMany = (ids: string[], checked: boolean) =>
          commit(
            checked
              ? [...selected, ...ids]
              : selected.filter((id) => !ids.includes(id))
          );

        // "All" and each branch heading reflect only what is CURRENTLY VISIBLE,
        // so a search that hides half the catalogue cannot make the box read
        // as covering services the operator can no longer see.
        const visibleIds = visible.map((s) => s.id);
        const allChecked =
          visibleIds.length > 0 &&
          visibleIds.every((id) => selected.includes(id));

        return (
          <Field data-invalid={fieldState.invalid}>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search services"
                  className="pl-9"
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search services"
                  value={search}
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline">
                    <ArrowDownUp className="size-4" />
                    Sort By
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuRadioGroup
                    onValueChange={(v) => setSort(v as SortKey)}
                    value={sort}
                  >
                    <DropdownMenuRadioItem value="name">
                      Name (A–Z)
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="price">
                      Price (low to high)
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {services.length === 0 ? (
              <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                Create a service first to link a promotion.
              </p>
            ) : visible.length === 0 ? (
              <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                No services match your search.
              </p>
            ) : (
              <div
                className="flex flex-col"
                data-claire-target="offer-services-picker"
              >
                {/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps a Radix Checkbox (renders a button, not a native input); it carries its own aria-label */}
                <label className="flex cursor-pointer items-center gap-3 py-3 text-sm font-medium">
                  <Checkbox
                    aria-label="All Services"
                    checked={allChecked}
                    onCheckedChange={(v) => setMany(visibleIds, v === true)}
                  />
                  All Services
                </label>

                {groups.map((group) => {
                  const ids = group.items.map((s) => s.id);
                  const groupChecked = ids.every((id) => selected.includes(id));
                  return (
                    <div className="flex flex-col" key={group.id}>
                      {/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps a Radix Checkbox (renders a button, not a native input); it carries its own aria-label */}
                      <label className="flex cursor-pointer items-center gap-3 border-t py-3 text-sm font-medium text-muted-foreground">
                        <Checkbox
                          aria-label={group.name}
                          checked={groupChecked}
                          onCheckedChange={(v) => setMany(ids, v === true)}
                        />
                        {group.name}
                      </label>
                      {group.items.map((service) => (
                        // biome-ignore lint/a11y/noLabelWithoutControl: label wraps a Radix Checkbox (renders a button, not a native input); it carries its own aria-label
                        <label
                          className="flex cursor-pointer items-center gap-3 border-t py-3 pl-6 text-sm"
                          key={`${group.id}:${service.id}`}
                        >
                          <Checkbox
                            aria-label={service.name}
                            checked={selected.includes(service.id)}
                            onCheckedChange={(v) =>
                              setMany([service.id], v === true)
                            }
                          />
                          <span className="flex flex-col">
                            <span className="font-medium">{service.name}</span>
                            <span className="text-muted-foreground">
                              {formatServicePrice({
                                priceType: service.priceType as never,
                                priceCents: service.priceCents ?? null,
                                currencySymbol: currency.symbol,
                              })}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
            {fieldState.error && <FieldError errors={[fieldState.error]} />}
          </Field>
        );
      }}
    />
  );
}

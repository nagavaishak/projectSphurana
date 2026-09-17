import { Loader2, SearchIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useListServices } from '@/features/organization-services';
import { useListCategories } from '@/features/service-categories';
import { useOrgCurrency } from '@/hooks/use-org-currency';
import { formatServicePrice } from '@borradh-workspace/labels';

import { type TeamMemberFormValues, teamMemberForm } from './types';

/** Labels come from the form declaration — see `profile-panel.tsx`. */
const L = teamMemberForm.labels;

interface ServicesPanelProps {
  form: UseFormReturn<TeamMemberFormValues>;
}

const UNCATEGORIZED = '__uncategorized__';

export function ServicesPanel({ form }: ServicesPanelProps) {
  const [search, setSearch] = useState('');
  const { services, isLoading: servicesLoading, isError } = useListServices();
  const { currency } = useOrgCurrency();
  const { categories, isLoading: categoriesLoading } = useListCategories();

  const selected = form.watch('serviceIds');

  const setSelected = (ids: string[]) =>
    form.setValue('serviceIds', ids, { shouldDirty: true });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return services;
    return services.filter((s) => s.name.toLowerCase().includes(q));
  }, [services, search]);

  const groups = useMemo(() => {
    const byId = new Map<string, typeof filtered>();
    for (const service of filtered) {
      const key = service.categoryId ?? UNCATEGORIZED;
      const list = byId.get(key) ?? [];
      list.push(service);
      byId.set(key, list);
    }
    const named = categories
      .filter((c) => byId.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, items: byId.get(c.id) ?? [] }));
    const uncategorized = byId.get(UNCATEGORIZED);
    if (uncategorized?.length) {
      named.push({
        id: UNCATEGORIZED,
        name: 'Uncategorized',
        items: uncategorized,
      });
    }
    return named;
  }, [filtered, categories]);

  const allIds = filtered.map((s) => s.id);
  const allSelected =
    allIds.length > 0 && allIds.every((id) => selected.includes(id));

  const toggleService = (id: string, checked: boolean) => {
    if (checked) {
      if (!selected.includes(id)) setSelected([...selected, id]);
    } else {
      setSelected(selected.filter((sid) => sid !== id));
    }
  };

  const toggleAll = (checked: boolean) => {
    if (checked) {
      setSelected(Array.from(new Set([...selected, ...allIds])));
    } else {
      setSelected(selected.filter((id) => !allIds.includes(id)));
    }
  };

  const toggleGroup = (items: typeof filtered, checked: boolean) => {
    const ids = items.map((s) => s.id);
    if (checked) {
      setSelected(Array.from(new Set([...selected, ...ids])));
    } else {
      setSelected(selected.filter((id) => !ids.includes(id)));
    }
  };

  const isLoading = servicesLoading || categoriesLoading;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <h3 className="text-lg font-semibold">{L.serviceIds}</h3>
        <p className="text-sm text-muted-foreground">
          Choose the services this team member provides.
        </p>
      </div>

      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search services..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center text-sm text-destructive">
          Failed to load services.
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No services match your search.
        </div>
      ) : (
        <div className="flex flex-col gap-1 rounded-lg border">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps a Radix Checkbox (renders a button, not a native input); it carries its own aria-label */}
          <label className="flex cursor-pointer items-center gap-3 border-b bg-muted/50 px-3 py-2.5 font-medium">
            <Checkbox
              checked={allSelected}
              onCheckedChange={(v) => toggleAll(v === true)}
              aria-label="All services"
            />
            All services
          </label>

          {groups.map((group) => {
            const groupChecked = group.items.every((s) =>
              selected.includes(s.id)
            );
            return (
              <div key={group.id} className="flex flex-col">
                {/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps a Radix Checkbox (renders a button, not a native input); it carries its own aria-label */}
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm font-medium text-muted-foreground">
                  <Checkbox
                    checked={groupChecked}
                    onCheckedChange={(v) =>
                      toggleGroup(group.items, v === true)
                    }
                    aria-label={group.name}
                  />
                  {group.name}
                </label>
                {group.items.map((service) => (
                  // biome-ignore lint/a11y/noLabelWithoutControl: label wraps a Radix Checkbox (renders a button, not a native input); it carries its own aria-label
                  <label
                    key={service.id}
                    className="flex cursor-pointer items-center gap-3 py-2 pl-9 pr-3 text-sm hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={selected.includes(service.id)}
                      onCheckedChange={(v) =>
                        toggleService(service.id, v === true)
                      }
                      aria-label={service.name}
                    />
                    <span className="flex-1">{service.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {service.appointmentDuration
                        ? `${service.appointmentDuration} min · `
                        : ''}
                      {formatServicePrice({
                        priceType: service.priceType,
                        priceCents: service.priceCents,
                        currencySymbol: currency.symbol,
                      })}
                    </span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

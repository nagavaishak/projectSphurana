'use client';

import { CheckIcon, PlusIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { serviceCategoryChips } from '@/lib/service-categories';
import { cn } from '@/lib/utils';

import {
  type WizardService,
  formatDuration,
  serviceHeadlinePrice,
  variantPrice,
} from './booking-cart';
import { RadioGroup, RadioGroupItem } from './radio-group';

interface WizardServicesStepProps {
  services: WizardService[];
  /** The org display currency symbol — every price renders via the formatter. */
  currencySymbol: string;
  /** Service ids currently in the cart. */
  selectedIds: string[];
  /** Add a service, optionally narrowed to a chosen variant. */
  onAdd: (serviceId: string, variantId: string | null) => void;
  /** Remove a service (and any chosen variant) from the cart. */
  onRemove: (serviceId: string) => void;
}

const FEATURED = '__featured__';

/**
 * The Services step: category chips across the top and a list of toggleable
 * service rows. A service WITHOUT variants adds straight to the cart; a service
 * WITH variants opens a chooser so the customer picks exactly one option (its
 * price is what lands in the cart).
 */
export function WizardServicesStep({
  services,
  currencySymbol,
  selectedIds,
  onAdd,
  onRemove,
}: WizardServicesStepProps) {
  // Empty when chips would not split the list — see serviceCategoryChips.
  const categories = useMemo(() => serviceCategoryChips(services), [services]);

  const [activeCategory, setActiveCategory] = useState<string>(FEATURED);
  const [variantPickerFor, setVariantPickerFor] =
    useState<WizardService | null>(null);

  const visibleServices = useMemo(() => {
    if (activeCategory === FEATURED) return services;
    return services.filter((s) => s.category === activeCategory);
  }, [services, activeCategory]);

  const selected = new Set(selectedIds);

  const handleToggle = (service: WizardService) => {
    if (selected.has(service.id)) {
      onRemove(service.id);
      return;
    }
    if (service.variants.length > 0) {
      setVariantPickerFor(service);
      return;
    }
    onAdd(service.id, null);
  };

  return (
    <div>
      <h1 className="font-bold text-3xl md:text-4xl">Select services</h1>

      {/* Category chips (only when they actually narrow the list) */}
      {categories.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          <CategoryChip
            label="Featured"
            active={activeCategory === FEATURED}
            onClick={() => setActiveCategory(FEATURED)}
          />
          {categories.map((cat) => (
            <CategoryChip
              key={cat}
              label={cat}
              active={activeCategory === cat}
              onClick={() => setActiveCategory(cat)}
            />
          ))}
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <h2 className="font-semibold text-lg">
          {activeCategory === FEATURED ? 'Featured' : activeCategory}
        </h2>
        {selectedIds.length > 0 && (
          <span className="rounded-full border border-primary px-3 py-1 text-sm text-primary">
            {selectedIds.length} selected service
            {selectedIds.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {/* An org with a published booking page and no bookable services is a
          real (if rare) state — say so rather than render an empty list that
          looks like a still-loading page. */}
      {visibleServices.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No services are available to book online right now.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Please contact us and we'll book you in.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-4">
          {visibleServices.map((service) => {
            const isSelected = selected.has(service.id);
            return (
              <li key={service.id}>
                <div
                  className={cn(
                    'flex items-center justify-between gap-4 rounded-xl border p-5 transition-colors',
                    isSelected
                      ? 'border-primary ring-1 ring-primary'
                      : 'border-border'
                  )}
                >
                  <div className="min-w-0">
                    <p className="font-medium">{service.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatDuration(service.appointmentDuration ?? 30)}
                    </p>
                    <p className="mt-2 font-semibold">
                      {serviceHeadlinePrice(service, currencySymbol)}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`${isSelected ? 'Remove' : 'Add'} ${service.name}`}
                    onClick={() => handleToggle(service)}
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-full border transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      isSelected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background hover:bg-accent'
                    )}
                  >
                    {isSelected ? (
                      <CheckIcon className="size-4" />
                    ) : (
                      <PlusIcon className="size-4" />
                    )}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <VariantChooser
        service={variantPickerFor}
        currencySymbol={currencySymbol}
        onOpenChange={(open) => {
          if (!open) setVariantPickerFor(null);
        }}
        onConfirm={(serviceId, variantId) => {
          onAdd(serviceId, variantId);
          setVariantPickerFor(null);
        }}
      />
    </div>
  );
}

function VariantChooser({
  service,
  currencySymbol,
  onOpenChange,
  onConfirm,
}: {
  service: WizardService | null;
  currencySymbol: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (serviceId: string, variantId: string) => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);

  // Reset the pending choice whenever a new service opens the chooser.
  const firstVariantId = service?.variants[0]?.id ?? null;
  const effectiveChosen = chosen ?? firstVariantId;

  return (
    <Dialog
      open={service !== null}
      onOpenChange={(open) => {
        if (!open) setChosen(null);
        onOpenChange(open);
      }}
    >
      <DialogContent>
        {service && (
          <>
            <DialogHeader>
              <DialogTitle>Choose an option — {service.name}</DialogTitle>
            </DialogHeader>

            <RadioGroup
              value={effectiveChosen ?? undefined}
              onValueChange={setChosen}
              className="gap-2"
            >
              {service.variants.map((variant) => (
                <label
                  key={variant.id}
                  htmlFor={`variant-${variant.id}`}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-4 rounded-lg border p-4 transition-colors',
                    effectiveChosen === variant.id
                      ? 'border-primary ring-1 ring-primary'
                      : 'border-border hover:bg-accent'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <RadioGroupItem
                      id={`variant-${variant.id}`}
                      value={variant.id}
                    />
                    <div>
                      <p className="font-medium">{variant.name}</p>
                      {variant.durationMinutes != null && (
                        <p className="text-muted-foreground text-sm">
                          {formatDuration(variant.durationMinutes)}
                        </p>
                      )}
                    </div>
                  </div>
                  <span className="font-semibold">
                    {variantPrice(variant, currencySymbol)}
                  </span>
                </label>
              ))}
            </RadioGroup>

            <DialogFooter>
              <Button
                type="button"
                disabled={!effectiveChosen}
                onClick={() =>
                  effectiveChosen && onConfirm(service.id, effectiveChosen)
                }
              >
                Add to booking
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-4 py-2 text-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border bg-background hover:bg-accent'
      )}
    >
      {label}
    </button>
  );
}

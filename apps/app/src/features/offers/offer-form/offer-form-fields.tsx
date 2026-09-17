'use client';

/**
 * Every promotion field, lifted out of `OfferFormDialog` UNCHANGED — same
 * markup, same `data-claire-target` tour hooks, same labels (which come from
 * the form declaration, so the label a user reads and the label the form
 * contract looks for cannot drift apart).
 *
 * Both surfaces render these: the dialog (still used inside the create-video
 * wizard) and the unified `/create/promotion` editor, where they arrive as
 * `kind: 'custom'` fields.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { SingleDayPicker } from '@/components/ui/single-day-picker';
import { Textarea } from '@/components/ui/textarea';
import type { OrganizationService } from '@/features/organization-services';
import { cn } from '@/lib/utils';
import type { OfferDiscountType } from '@borradh-workspace/api-client/types';
import { offerDiscountTypeLabels } from '@borradh-workspace/api-client/types';
import { RotateCcw, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type Control, Controller, type UseFormReturn } from 'react-hook-form';

import {
  type OfferFormValues,
  offerForm,
} from '../components/offer-form-schema';
import { generateCode } from './use-offer-form';

const L = offerForm.labels;

/**
 * What each discount shape actually does, in the operator's terms.
 *
 * The label alone ("Fixed Amount Discount") does not tell a receptionist which
 * of the two to pick, and the two legacy shapes are only ever seen while
 * editing an offer that already uses one — so they get the same one-liner
 * treatment rather than being left bare.
 */
const DISCOUNT_TYPE_DESCRIPTIONS: Record<OfferDiscountType, string> = {
  percentage: 'Take a percentage off the price of each linked service.',
  fixed_amount: 'Take a set amount off the price of each linked service.',
  fixed_price: 'Charge one flat price instead of the usual one.',
  buy_x_get_y: 'Give a number of free items once enough are bought.',
};

type OfferControl = Control<OfferFormValues>;

export function OfferNameField({
  control,
  autoFocus,
}: {
  control: OfferControl;
  autoFocus?: boolean;
}) {
  return (
    <Controller
      control={control}
      name="name"
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel className="text-muted-foreground" htmlFor={field.name}>
            {L.name}
          </FieldLabel>
          <Input
            {...field}
            aria-invalid={fieldState.invalid}
            autoFocus={autoFocus}
            data-claire-target="offer-name-input"
            id={field.name}
            placeholder="e.g. Christmas Sale"
          />
          {fieldState.error && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  );
}

export function OfferDescriptionField({ control }: { control: OfferControl }) {
  return (
    <Controller
      control={control}
      name="description"
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel className="text-muted-foreground" htmlFor={field.name}>
            {L.description}
          </FieldLabel>
          <Textarea
            {...field}
            aria-invalid={fieldState.invalid}
            data-claire-target="offer-description-input"
            id={field.name}
            placeholder="Add any additional comments"
            rows={3}
            value={field.value ?? ''}
          />
          {fieldState.error && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  );
}

export function OfferCodeField({ control }: { control: OfferControl }) {
  return (
    <Controller
      control={control}
      name="code"
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel className="text-muted-foreground" htmlFor={field.name}>
            {L.code}
          </FieldLabel>
          <div className="flex gap-2">
            <Input
              {...field}
              aria-invalid={fieldState.invalid}
              className="flex-1 font-mono uppercase"
              data-claire-target="offer-code-input"
              id={field.name}
              onChange={(e) => field.onChange(e.target.value.toUpperCase())}
              placeholder=""
            />
            <Button
              data-claire-target="offer-code-generate-button"
              onClick={() => field.onChange(generateCode())}
              size="icon"
              title="Generate a random code"
              type="button"
              variant="outline"
            >
              <RotateCcw className="size-4" />
            </Button>
          </div>
          {fieldState.error && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  );
}

export function OfferDiscountTypeField({
  form,
  visibleDiscountTypes,
}: {
  form: UseFormReturn<OfferFormValues>;
  visibleDiscountTypes: OfferDiscountType[];
}) {
  return (
    <Controller
      control={form.control}
      name="discountType"
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          {/*
            The heading is the radio group's ACCESSIBLE NAME, so it lives with
            the group rather than in whichever surface happens to render it —
            an `aria-labelledby` pointing at a heading the page next to it owns
            is a name that silently disappears when the surface changes.
          */}
          <h3 className="text-base font-medium" id="offer-discount-type-label">
            {L.discountType}
          </h3>
          <RadioGroup
            aria-labelledby="offer-discount-type-label"
            className="grid grid-cols-2 gap-3"
            data-claire-target="offer-discount-type-radio"
            onValueChange={(value) => {
              field.onChange(value as OfferDiscountType);
              // Clear discount fields so cross-type values don't leak.
              form.setValue('discountPercent', null);
              form.setValue('discountAmountEuros', null);
              form.setValue('originalPriceEuros', null);
              form.setValue('offerPriceEuros', null);
              form.setValue('buyQuantity', null);
              form.setValue('getQuantity', null);
            }}
            value={field.value}
          >
            {visibleDiscountTypes.map((value) => {
              const radioId = `discount-type-${value}`;
              const selected = field.value === value;
              return (
                <FieldLabel
                  className="cursor-pointer"
                  htmlFor={radioId}
                  key={value}
                >
                  <Field
                    // The selected card is outlined and tinted — in the design
                    // the radio dot alone is too small to read as the answer at
                    // a glance, and two side-by-side cards need the contrast.
                    className={cn(
                      'items-start rounded-lg border bg-background p-4 transition-colors',
                      selected && 'border-foreground bg-muted/50'
                    )}
                    orientation="horizontal"
                  >
                    <FieldContent>
                      <FieldTitle className="text-sm font-medium">
                        {offerDiscountTypeLabels[value]}
                      </FieldTitle>
                      <FieldDescription className="text-xs">
                        {DISCOUNT_TYPE_DESCRIPTIONS[value]}
                      </FieldDescription>
                    </FieldContent>
                    <RadioGroupItem id={radioId} value={value} />
                  </Field>
                </FieldLabel>
              );
            })}
          </RadioGroup>
          {fieldState.error && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  );
}

/** The prefixed numeric inputs the four discount shapes share. */
function OfferNumberField({
  control,
  name,
  label,
  prefix,
  claireTarget,
  min,
  max,
  step,
  placeholder,
}: {
  control: OfferControl;
  name:
    | 'discountPercent'
    | 'discountAmountEuros'
    | 'originalPriceEuros'
    | 'offerPriceEuros'
    | 'buyQuantity'
    | 'getQuantity'
    | 'redemptionLimit';
  label: string;
  prefix?: string;
  claireTarget: string;
  min?: number;
  max?: number;
  step?: string;
  placeholder: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const input = (
          <Input
            aria-invalid={fieldState.invalid}
            className={prefix ? 'pl-7' : undefined}
            data-claire-target={claireTarget}
            id={field.name}
            max={max}
            min={min}
            onChange={(e) =>
              field.onChange(e.target.value ? Number(e.target.value) : null)
            }
            placeholder={placeholder}
            step={step}
            type="number"
            value={field.value ?? ''}
          />
        );
        return (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel className="text-muted-foreground" htmlFor={field.name}>
              {label}
            </FieldLabel>
            {prefix ? (
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  {prefix}
                </span>
                {input}
              </div>
            ) : (
              input
            )}
            {fieldState.error && <FieldError errors={[fieldState.error]} />}
          </Field>
        );
      }}
    />
  );
}

/** The per-type discount inputs, discriminated by the selected shape. */
export function OfferDiscountValueFields({
  control,
  selectedDiscountType,
}: {
  control: OfferControl;
  selectedDiscountType: OfferFormValues['discountType'];
}) {
  return (
    <>
      {selectedDiscountType === 'percentage' && (
        <OfferNumberField
          claireTarget="offer-discount-percent-input"
          control={control}
          label={L.discountPercent}
          max={100}
          min={1}
          name="discountPercent"
          placeholder="10"
          prefix="%"
        />
      )}

      {selectedDiscountType === 'fixed_amount' && (
        <OfferNumberField
          claireTarget="offer-discount-amount-input"
          control={control}
          label={L.discountAmountEuros}
          min={0.01}
          name="discountAmountEuros"
          placeholder="10.00"
          prefix="€"
          step="0.01"
        />
      )}

      {selectedDiscountType === 'fixed_price' && (
        <>
          <OfferNumberField
            claireTarget="offer-original-price-input"
            control={control}
            label={L.originalPriceEuros}
            min={0}
            name="originalPriceEuros"
            placeholder="100.00"
            prefix="€"
            step="0.01"
          />
          <OfferNumberField
            claireTarget="offer-offer-price-input"
            control={control}
            label={L.offerPriceEuros}
            min={0}
            name="offerPriceEuros"
            placeholder="75.00"
            prefix="€"
            step="0.01"
          />
        </>
      )}

      {selectedDiscountType === 'buy_x_get_y' && (
        <>
          <OfferNumberField
            claireTarget="offer-buy-quantity-input"
            control={control}
            label={L.buyQuantity}
            min={1}
            name="buyQuantity"
            placeholder="2"
          />
          <OfferNumberField
            claireTarget="offer-get-quantity-input"
            control={control}
            label={L.getQuantity}
            min={1}
            name="getQuantity"
            placeholder="1"
          />
        </>
      )}
    </>
  );
}

export function OfferRedemptionLimitField({
  control,
}: {
  control: OfferControl;
}) {
  return (
    <OfferNumberField
      claireTarget="offer-redemption-limit-input"
      control={control}
      label={L.redemptionLimit}
      min={1}
      name="redemptionLimit"
      placeholder="200"
      prefix="#"
    />
  );
}

export function OfferServicesField({
  control,
  services,
}: {
  control: OfferControl;
  services: OrganizationService[];
}) {
  return (
    <Controller
      control={control}
      name="serviceIds"
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel className="text-base font-medium">
            {L.serviceIds}
          </FieldLabel>
          <ServiceTagPicker
            onChange={field.onChange}
            selectedIds={field.value}
            services={services}
          />
          {fieldState.error && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  );
}

export function OfferExpiryFields({ control }: { control: OfferControl }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {(
        [
          ['validFrom', L.validFrom, 'offer-valid-from-input'],
          ['validUntil', L.validUntil, 'offer-valid-until-input'],
        ] as const
      ).map(([name, label, target]) => (
        <Controller
          control={control}
          key={name}
          name={name}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="text-muted-foreground" htmlFor={target}>
                {label}
              </FieldLabel>
              <SingleDayPicker
                className="h-10 justify-between font-normal"
                data-claire-target={target}
                id={target}
                labelVariant="PPP"
                onSelect={(d) => field.onChange(d ?? null)}
                placeholder="Pick a date"
                value={field.value ?? undefined}
              />
              {fieldState.error && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      ))}
    </div>
  );
}

/**
 * Tag-style multi-select for linking services to the promotion. Selected
 * services appear as removable chips; the inline trigger opens a Command
 * popover for searching the rest.
 */
function ServiceTagPicker({
  services,
  selectedIds,
  onChange,
}: {
  services: OrganizationService[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () =>
      selectedIds
        .map((id) => services.find((s) => s.id === id))
        .filter((s): s is OrganizationService => !!s),
    [selectedIds, services]
  );

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  if (services.length === 0) {
    return (
      <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        Create a service first to link a promotion.
      </p>
    );
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          className="flex min-h-[48px] w-full flex-wrap items-center gap-2 rounded-md border bg-background p-2 text-left text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          data-claire-target="offer-services-picker"
          type="button"
        >
          {selected.length === 0 && (
            <span className="px-2 text-muted-foreground">
              Click to add services
            </span>
          )}
          {selected.map((service) => (
            <Badge
              className="bg-[#2563eb] px-2 py-1 text-xs font-normal text-white hover:bg-[#1d4ed8]"
              key={service.id}
            >
              {service.name}
              <span
                aria-label={`Remove ${service.name}`}
                className="ml-1 inline-flex cursor-pointer items-center"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggle(service.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    toggle(service.id);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <X className="size-3" />
              </span>
            </Badge>
          ))}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command>
          <CommandInput className="h-9" placeholder="Search services..." />
          <CommandList>
            <CommandEmpty>No services found.</CommandEmpty>
            <CommandGroup>
              {services.map((service) => {
                const checked = selectedIds.includes(service.id);
                return (
                  <CommandItem
                    className="flex items-center gap-2"
                    key={service.id}
                    onSelect={() => toggle(service.id)}
                    value={service.name}
                  >
                    <Checkbox
                      checked={checked}
                      className="pointer-events-none"
                    />
                    <span>{service.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

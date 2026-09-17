'use client';

/**
 * The rich membership fields, lifted out of the old dialog UNCHANGED.
 *
 * The unified editor renders these through `kind: 'custom'` — a searchable
 * service picker, a two-mode sessions control and a currency-prefixed price
 * input are not `text`/`select` fields, and rebuilding them as generic ones is
 * how a UI unification quietly becomes a behaviour change.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { OrganizationService } from '@borradh-workspace/api-client/types';
import type { MembershipPricingType } from '@borradh-workspace/api-client/types';
import { X } from 'lucide-react';
import { useId, useState } from 'react';

import { membershipPlanLabels as L } from './membership-plan.form';
import type { MembershipSessionsMode } from './use-membership-form';

export function MembershipServicesField({
  services,
  selectedIds,
  onToggle,
}: {
  services: OrganizationService[];
  selectedIds: string[];
  onToggle: (serviceId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = services.filter((s) => selectedIds.includes(s.id));

  return (
    <Field>
      <FieldLabel>{L.serviceIds}</FieldLabel>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <Button
            className="w-full justify-start font-normal"
            type="button"
            variant="outline"
          >
            {selectedIds.length > 0
              ? `${selectedIds.length} service${selectedIds.length === 1 ? '' : 's'} selected`
              : 'Select services'}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[320px] p-0">
          <Command>
            <CommandInput placeholder="Search services..." />
            <CommandList>
              <CommandEmpty>No services found.</CommandEmpty>
              <CommandGroup>
                {services.map((service) => (
                  <CommandItem
                    key={service.id}
                    onSelect={() => onToggle(service.id)}
                    value={service.name}
                  >
                    <span
                      className={
                        selectedIds.includes(service.id) ? 'font-medium' : ''
                      }
                    >
                      {service.name}
                    </span>
                    {selectedIds.includes(service.id) && (
                      <span className="ml-auto text-primary">✓</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {selected.map((service) => (
            <Badge key={service.id} variant="secondary">
              {service.name}
              <button
                aria-label={`Remove ${service.name}`}
                className="ml-1"
                onClick={() => onToggle(service.id)}
                type="button"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </Field>
  );
}

export function MembershipSessionsField({
  mode,
  sessionCount,
  onModeChange,
  onSessionCountChange,
}: {
  mode: MembershipSessionsMode;
  sessionCount: string;
  onModeChange: (mode: MembershipSessionsMode) => void;
  onSessionCountChange: (value: string) => void;
}) {
  const id = useId();

  return (
    <Field>
      <FieldLabel>{L.sessionsMode}</FieldLabel>
      <RadioGroup
        aria-label={L.sessionsMode}
        className="flex gap-6"
        onValueChange={(value) => onModeChange(value as MembershipSessionsMode)}
        value={mode}
      >
        <label
          className="flex items-center gap-2 text-sm"
          htmlFor={`${id}-limited`}
        >
          <RadioGroupItem id={`${id}-limited`} value="limited" /> Limited
        </label>
        <label
          className="flex items-center gap-2 text-sm"
          htmlFor={`${id}-unlimited`}
        >
          <RadioGroupItem id={`${id}-unlimited`} value="unlimited" /> Unlimited
        </label>
      </RadioGroup>
      {mode === 'limited' && (
        <Input
          aria-label={L.sessionCount}
          className="mt-2 w-32"
          min={1}
          onChange={(e) => onSessionCountChange(e.target.value)}
          type="number"
          value={sessionCount}
        />
      )}
    </Field>
  );
}

export function MembershipPricingTypeField({
  pricingType,
  onChange,
}: {
  pricingType: MembershipPricingType;
  onChange: (value: MembershipPricingType) => void;
}) {
  const id = useId();

  return (
    <Field>
      <FieldLabel>{L.pricingType}</FieldLabel>
      <RadioGroup
        aria-label={L.pricingType}
        className="flex gap-6"
        onValueChange={(value) => onChange(value as MembershipPricingType)}
        value={pricingType}
      >
        <label
          className="flex items-center gap-2 text-sm"
          htmlFor={`${id}-one-time`}
        >
          <RadioGroupItem id={`${id}-one-time`} value="one_time" /> One-time
        </label>
        <label
          className="flex items-center gap-2 text-sm"
          htmlFor={`${id}-recurring`}
        >
          <RadioGroupItem id={`${id}-recurring`} value="recurring" /> Recurring
        </label>
      </RadioGroup>
    </Field>
  );
}

export function MembershipPriceField({
  currencySymbol,
  value,
  onChange,
}: {
  currencySymbol: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();

  return (
    <Field>
      <FieldLabel htmlFor={`${id}-price`}>{L.priceRaw}</FieldLabel>
      <InputGroup>
        <InputGroupAddon>{currencySymbol}</InputGroupAddon>
        <InputGroupInput
          id={`${id}-price`}
          inputMode="decimal"
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.00"
          value={value}
        />
      </InputGroup>
    </Field>
  );
}

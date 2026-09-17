import { Button } from '@/components/ui/button';
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
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  businessTypeLabels,
  businessTypeValues,
} from '@borradh-workspace/api-client/types';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';

interface Step2BusinessTypeProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type flexibility needed
  form: UseFormReturn<any>;
}

export function Step2BusinessType({ form }: Step2BusinessTypeProps) {
  const [open, setOpen] = useState(false);

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          What type of business do you run?
        </h1>
        <p className="text-muted-foreground">
          This helps us tailor content and recommendations for your industry.
        </p>
      </div>

      <Controller
        name="businessType"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field
            className="flex flex-col gap-2"
            data-invalid={fieldState.invalid}
          >
            <FieldLabel
              className="text-secondary-foreground text-sm font-medium"
              htmlFor={field.name}
            >
              Business Type
            </FieldLabel>
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  id={field.name}
                  variant="outline"
                  aria-expanded={open}
                  aria-invalid={fieldState.invalid}
                  className={cn(
                    'w-full justify-between font-normal',
                    !field.value && 'text-muted-foreground'
                  )}
                >
                  {field.value
                    ? businessTypeLabels[
                        field.value as keyof typeof businessTypeLabels
                      ]
                    : 'Search business type...'}
                  <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[var(--radix-popover-trigger-width)] p-0"
                align="start"
              >
                <Command>
                  <CommandInput placeholder="Search business type..." />
                  <CommandList>
                    <CommandEmpty>No business type found.</CommandEmpty>
                    <CommandGroup>
                      {businessTypeValues.map((value) => (
                        <CommandItem
                          key={value}
                          value={businessTypeLabels[value]}
                          onSelect={() => {
                            field.onChange(value);
                            setOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              'mr-2 size-4',
                              field.value === value
                                ? 'opacity-100'
                                : 'opacity-0'
                            )}
                          />
                          {businessTypeLabels[value]}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />
    </FieldGroup>
  );
}

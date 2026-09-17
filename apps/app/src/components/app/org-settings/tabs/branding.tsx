'use client';

import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import {
  useActiveOrganization,
  useGetOrganizationBrand,
  useUpdateOrganization,
} from '@/features/organization';
import { updateOrganizationFields } from '@/features/organization/api/update-organization/update-organization.form';
import { cn } from '@/lib/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

// This tab OWNS the two brand colours — the same two the settings/style route
// owns. One declaration, so the label and the validation cannot fork.
const F = updateOrganizationFields;

const brandingSchema = z.object({
  primaryColor: F.primaryColor.schema,
  secondaryColor: F.secondaryColor.schema,
});

type BrandingFormValues = z.infer<typeof brandingSchema>;

function ColorInput({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
}) {
  const [inputValue, setInputValue] = useState(value);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    if (/^#[0-9A-Fa-f]{6}$/.test(newValue)) {
      onChange(newValue);
    }
  };

  return (
    <div className="relative flex items-center">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="absolute left-2 h-5 w-5 rounded border border-input"
            style={{ backgroundColor: value || '#000000' }}
            aria-label="Pick color"
          />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="start">
          <input
            type="color"
            value={value || '#000000'}
            onChange={(e) => {
              setInputValue(e.target.value.toUpperCase());
              onChange(e.target.value.toUpperCase());
            }}
            className="h-32 w-32 cursor-pointer border-0 p-0"
          />
        </PopoverContent>
      </Popover>
      <Input
        id={id}
        value={inputValue}
        onChange={handleChange}
        placeholder="#000000"
        className="pl-10"
      />
    </div>
  );
}

export function BrandingTab({
  className,
  onCancel,
  ...props
}: React.ComponentProps<'form'> & { onCancel?: () => void }) {
  // The two brand colours are the same fields the settings/style route owns, and
  // they carry that route's canonical labels. This dialog's copy for them is its
  // own ("Brand Primary Color"), so the contract reaches them here with a
  // surface-scoped `fills` override rather than restyling the dialog.
  const {
    data: organizationData,
    isPending: isOrganizationLoading,
    error: organizationError,
  } = useActiveOrganization();

  const { brand, isLoading: isBrandLoading } = useGetOrganizationBrand(
    organizationData?.id ?? ''
  );

  const { execute: updateOrganization, isExecuting: isUpdating } =
    useUpdateOrganization();

  const form = useForm<BrandingFormValues>({
    resolver: zodResolver(brandingSchema),
    defaultValues: {
      primaryColor: brand?.primaryColor ?? '#000000',
      secondaryColor: brand?.secondaryColor ?? '#FFCC00',
    },
  });

  useEffect(() => {
    if (brand) {
      form.reset({
        primaryColor: brand.primaryColor ?? '#000000',
        secondaryColor: brand.secondaryColor ?? '#FFCC00',
      });
    }
  }, [brand, form]);

  async function onSubmit(values: BrandingFormValues) {
    await updateOrganization({
      primaryColor: values.primaryColor,
      secondaryColor: values.secondaryColor,
    });
  }

  const isLoading = isOrganizationLoading || isBrandLoading;

  if (isLoading) {
    return (
      <div className={cn('flex flex-col px-6 py-4 gap-6', className)}>
        <div className="animate-pulse space-y-6">
          <div className="h-12 bg-muted rounded" />
          <div className="h-12 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (organizationError) {
    return (
      <div className={cn('flex flex-col px-6 py-4 gap-6', className)}>
        <div className="text-destructive">
          Error loading organization data: {organizationError.message}
        </div>
      </div>
    );
  }

  return (
    <form
      className={cn('flex flex-col px-6 py-4', className)}
      onSubmit={form.handleSubmit(onSubmit)}
      {...props}
    >
      <div className="space-y-0">
        {/* Brand Primary Color */}
        <Controller
          name="primaryColor"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field
              orientation="horizontal"
              className="py-4"
              data-invalid={fieldState.invalid}
            >
              <div className="flex-1">
                <FieldLabel htmlFor={field.name} className="font-medium">
                  Brand Primary Color
                </FieldLabel>
                <FieldDescription>
                  Used for headers, accents, and brand identity
                </FieldDescription>
              </div>
              <div className="w-48">
                <ColorInput
                  id={field.name}
                  value={field.value ?? '#000000'}
                  onChange={field.onChange}
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </div>
            </Field>
          )}
        />

        <Separator />

        {/* Brand Secondary Color */}
        <Controller
          name="secondaryColor"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field
              orientation="horizontal"
              className="py-4"
              data-invalid={fieldState.invalid}
            >
              <div className="flex-1">
                <FieldLabel htmlFor={field.name} className="font-medium">
                  Brand Secondary Color
                </FieldLabel>
                <FieldDescription>
                  Used for buttons, call-to-action elements
                </FieldDescription>
              </div>
              <div className="w-48">
                <ColorInput
                  id={field.name}
                  value={field.value ?? '#FFCC00'}
                  onChange={field.onChange}
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </div>
            </Field>
          )}
        />
      </div>

      <Separator className="my-4" />

      <div className="flex gap-2">
        <Button type="submit" disabled={isUpdating}>
          {isUpdating ? 'Saving...' : 'Submit'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

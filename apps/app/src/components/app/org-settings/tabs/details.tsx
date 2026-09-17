'use client';

import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  useActiveOrganization,
  useUpdateOrganization,
} from '@/features/organization';
import { updateOrganizationFields } from '@/features/organization/api/update-organization/update-organization.form';
import { cn } from '@/lib/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

// This tab OWNS name. It comes out of the one org-settings
// declaration, so `name` is validated and labelled exactly as it is on the
// settings/details route.
const F = updateOrganizationFields;

const detailsSchema = z.object({
  name: F.name.schema,
});

type DetailsFormValues = z.infer<typeof detailsSchema>;

export function DetailsTab({
  className,
  onCancel,
  ...props
}: React.ComponentProps<'form'> & { onCancel?: () => void }) {
  const {
    data: orgData,
    isPending: isOrganizationLoading,
    error: organizationError,
  } = useActiveOrganization();
  // The API returns the full DB record, but the Organization type is narrow
  const organizationData = orgData as (typeof orgData & {}) | null;
  const { execute: updateOrganization, isExecuting: isUpdating } =
    useUpdateOrganization();

  const form = useForm<DetailsFormValues>({
    resolver: zodResolver(detailsSchema),
    defaultValues: {
      name: organizationData?.name ?? '',
    },
  });

  useEffect(() => {
    if (organizationData) {
      form.reset({
        name: organizationData.name ?? '',
      });
    }
  }, [organizationData, form]);

  async function onSubmit(values: DetailsFormValues) {
    // Raw intent — the shared builder normalises the deposit link (empty →
    // null) and builds `name` identically to the details settings route.
    await updateOrganization({
      name: values.name,
    });
  }

  if (isOrganizationLoading) {
    return (
      <div className={cn('flex flex-col px-6 py-4 gap-6', className)}>
        <div className="animate-pulse space-y-6">
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
        <Controller
          name="name"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field
              orientation="horizontal"
              className="py-4"
              data-invalid={fieldState.invalid}
            >
              <div className="flex-1">
                <FieldLabel htmlFor={field.name} className="font-medium">
                  Organization Name
                </FieldLabel>
                <FieldDescription>
                  Provide your full name for identification
                </FieldDescription>
              </div>
              <div className="w-48">
                <Input
                  {...field}
                  id={field.name}
                  type="text"
                  placeholder="Organization name"
                  aria-invalid={fieldState.invalid}
                  autoComplete="organization"
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

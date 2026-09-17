'use client';

import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  useActiveOrganization,
  useUpdateOrganization,
} from '@/features/organization';
import { updateOrganizationForm } from '@/features/organization/api/update-organization/update-organization.form';
import { cn } from '@/lib/utils';

export function PrivacyTab({
  className,
}: {
  className?: string;
}) {
  // This tab OWNS one field, and it has no form: the switch writes on change.
  const L = updateOrganizationForm.labels;
  const {
    data: orgData,
    isPending: isOrganizationLoading,
    error: organizationError,
  } = useActiveOrganization();
  // The API returns the full DB record
  const organizationData = orgData as
    | (typeof orgData & {
        contributeToAggregateInsights?: boolean;
      })
    | null;
  const { execute: updateOrganization, isExecuting: isUpdating } =
    useUpdateOrganization();

  async function handleToggle(checked: boolean) {
    await updateOrganization({
      contributeToAggregateInsights: checked,
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
    <div className={cn('flex flex-col px-6 py-4', className)}>
      <div className="space-y-0">
        <Field orientation="horizontal" className="py-4">
          <div className="flex-1">
            <FieldLabel
              className="font-medium"
              htmlFor="contributeToAggregateInsights"
            >
              {L.contributeToAggregateInsights}
            </FieldLabel>
            <FieldDescription>
              Help improve AI recommendations for the community. Your data is
              fully anonymised and never shared individually.
            </FieldDescription>
          </div>
          <div className="flex items-center">
            <Switch
              id="contributeToAggregateInsights"
              checked={organizationData?.contributeToAggregateInsights ?? true}
              onCheckedChange={handleToggle}
              disabled={isUpdating}
              aria-label={L.contributeToAggregateInsights}
            />
          </div>
        </Field>

        <Separator />

        <div className="py-4 text-sm text-muted-foreground space-y-2">
          <p>
            When enabled, anonymised structural data from your ads, posts, and
            targeting is aggregated with at least 4 other businesses of the same
            type to generate industry benchmarks.
          </p>
          <p>
            No business names, ad copy, customer data, or revenue figures are
            ever included. Only aggregate counts and percentages are stored.
          </p>
        </div>
      </div>
    </div>
  );
}

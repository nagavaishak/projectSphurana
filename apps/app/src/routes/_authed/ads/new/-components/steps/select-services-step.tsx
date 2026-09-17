import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useListServices } from '@/features/organization-services';
import { useMemo } from 'react';
import { useFormContext } from 'react-hook-form';
import type { AdWizardFormData } from '../../-schema';

export function SelectServicesStep() {
  const { setValue, watch, formState } = useFormContext<AdWizardFormData>();
  const serviceIds = watch('serviceIds') ?? [];
  const { services, isLoading, isError, refetch } = useListServices({
    limit: 100,
  });

  const activeServices = useMemo(
    () => services.filter((s) => s.isActive),
    [services]
  );

  const toggleService = (id: string) => {
    const updated = serviceIds.includes(id)
      ? serviceIds.filter((sid) => sid !== id)
      : [...serviceIds, id];
    setValue('serviceIds', updated, { shouldValidate: true });
  };

  const error = formState.errors.serviceIds;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          Which service(s) is this ad for?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Select the services this ad promotes. This helps track which services
          generate leads from ads.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton
              key={`skeleton-${i}`}
              className="h-12 w-full rounded-lg"
            />
          ))}
        </div>
      ) : isError ? (
        // `services` defaults to [] on failure, so this used to tell a clinic
        // with a full catalogue to go and configure services.
        <div
          className="rounded-lg border border-dashed p-6 text-center"
          data-claire-target="ads-new-services-error"
        >
          <p className="text-sm text-destructive">
            Couldn't load your services.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => refetch()}
          >
            Try again
          </Button>
        </div>
      ) : activeServices.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No services configured yet. Add services in your organization
            settings first.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {activeServices.map((service) => {
            const isSelected = serviceIds.includes(service.id);
            return (
              <label
                key={service.id}
                htmlFor={`service-${service.id}`}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/50 ${
                  isSelected ? 'border-primary bg-primary/5' : 'border-border'
                }`}
              >
                <Checkbox
                  id={`service-${service.id}`}
                  checked={isSelected}
                  onCheckedChange={() => toggleService(service.id)}
                />
                <span className="text-sm font-medium">{service.name}</span>
              </label>
            );
          })}
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">
          {typeof error.message === 'string'
            ? error.message
            : 'Select at least one service'}
        </p>
      )}
    </div>
  );
}

import { FieldError, FieldGroup } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { useListServices } from '@/features/organization-services/api';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';
import { Controller, type UseFormReturn } from 'react-hook-form';

interface StepSelectServicesProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type flexibility needed
  form: UseFormReturn<any>;
}

export function StepSelectServices({ form }: StepSelectServicesProps) {
  const { services, isLoading } = useListServices({ limit: 100 });
  const selectedIds: string[] = form.watch('serviceIds') || [];

  const toggleService = (serviceId: string) => {
    const current = form.getValues('serviceIds') || [];
    const updated = current.includes(serviceId)
      ? current.filter((id: string) => id !== serviceId)
      : [...current, serviceId];
    form.setValue('serviceIds', updated, {
      shouldValidate: true,
      shouldDirty: true,
    });
  };

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Which services do you offer?</h1>
        <p className="text-muted-foreground">
          Select the services you personally provide. This helps match you with
          the right bookings.
        </p>
      </div>

      <Controller
        name="serviceIds"
        control={form.control}
        render={({ fieldState }) => (
          <>
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </>
        )}
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : services.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No services have been set up for this organization yet.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {services.map((service) => {
            const isSelected = selectedIds.includes(service.id);
            return (
              <button
                key={service.id}
                type="button"
                onClick={() => toggleService(service.id)}
                className={cn(
                  'relative flex items-center gap-3 rounded-lg border-2 px-4 py-3 text-left transition-all hover:border-primary/50',
                  isSelected ? 'border-primary bg-primary/5' : 'border-border'
                )}
              >
                {isSelected && (
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary">
                    <Check className="h-3 w-3 text-primary-foreground" />
                  </div>
                )}
                {!isSelected && (
                  <div className="h-5 w-5 shrink-0 rounded-full border-2 border-muted-foreground/30" />
                )}
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{service.name}</span>
                  {service.appointmentDuration && (
                    <span className="text-xs text-muted-foreground">
                      {service.appointmentDuration} min
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </FieldGroup>
  );
}

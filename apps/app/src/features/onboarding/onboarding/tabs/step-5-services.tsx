import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PlusIcon, ScissorsIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';

interface Step5ServicesProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type flexibility needed
  form: UseFormReturn<any>;
}

/**
 * Step 5: Services
 * Simple list for adding/removing services by name.
 * Service details can be configured later from the dashboard.
 */
export function Step5Services({ form }: Step5ServicesProps) {
  const [newServiceName, setNewServiceName] = useState('');

  const services: string[] = form.watch('services') || [];

  const addServiceToForm = useCallback(
    (name: string) => {
      const currentServices: string[] = form.getValues('services') || [];
      if (currentServices.includes(name)) return;

      const currentDetails = form.getValues('serviceDetails') || {};
      form.setValue(
        'serviceDetails',
        {
          ...currentDetails,
          [name]: {
            appointmentDuration: 30,
            requiresDeposit: false,
            pricingDescription: '',
          },
        },
        { shouldDirty: true }
      );
      form.setValue('services', [...currentServices, name], {
        shouldDirty: true,
      });
    },
    [form]
  );

  const removeServiceFromForm = useCallback(
    (name: string) => {
      const currentServices: string[] = form.getValues('services') || [];
      form.setValue(
        'services',
        currentServices.filter((s) => s !== name),
        { shouldDirty: true }
      );
      const currentDetails = form.getValues('serviceDetails') || {};
      const { [name]: _, ...rest } = currentDetails;
      form.setValue('serviceDetails', rest, { shouldDirty: true });
    },
    [form]
  );

  const addCustomService = useCallback(() => {
    const trimmed = newServiceName.trim();
    if (!trimmed || services.includes(trimmed)) return;

    addServiceToForm(trimmed);
    setNewServiceName('');
  }, [newServiceName, services, addServiceToForm]);

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Your Services</h1>
        <p className="text-muted-foreground">
          Add the services your business offers. You can configure details like
          pricing and duration anytime from the dashboard.
        </p>
      </div>

      {/* Add service input */}
      <div className="flex gap-2">
        <Input
          placeholder="Enter service name..."
          value={newServiceName}
          onChange={(e) => setNewServiceName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustomService();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={addCustomService}
          disabled={!newServiceName.trim()}
        >
          <PlusIcon className="h-4 w-4" />
          Add
        </Button>
      </div>

      {/* Services list */}
      {services.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {services.map((service) => (
            <li
              key={service}
              className="flex items-center justify-between rounded-lg border px-4 py-3"
            >
              <span className="font-medium">{service}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-destructive"
                onClick={() => removeServiceFromForm(service)}
              >
                <Trash2Icon className="size-4" />
                <span className="sr-only">Remove {service}</span>
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ScissorsIcon />
            </EmptyMedia>
            <EmptyTitle>No services yet</EmptyTitle>
            <EmptyDescription>
              Type a service name above and click Add to get started.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </FieldGroup>
  );
}

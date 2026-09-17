import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';

interface Step4ServicesProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type flexibility needed
  form: UseFormReturn<any>;
}

// Default services by business type
const DEFAULT_SERVICES: Record<string, string[]> = {
  hairdresser: [
    'Haircut',
    'Blow Dry',
    'Hair Coloring',
    'Balayage',
    'Highlights',
    'Extensions',
  ],
  barber: [
    'Haircut',
    'Beard Trim',
    'Hot Towel Shave',
    'Fade',
    'Hair & Beard Combo',
  ],
  salon: [
    'Haircut',
    'Hair Coloring',
    'Manicure',
    'Pedicure',
    'Facial',
    'Waxing',
  ],
  spa: ['Massage', 'Facial', 'Body Wrap', 'Aromatherapy', 'Hot Stone'],
  nail_salon: [
    'Manicure',
    'Pedicure',
    'Gel Nails',
    'Acrylic Nails',
    'Nail Art',
  ],
  tattoo_studio: [
    'Tattoo',
    'Cover Up',
    'Piercing',
    'Touch-Up',
    'Custom Design',
  ],
  other: ['Consultation', 'Treatment', 'Service'],
};

export function Step4Services({ form }: Step4ServicesProps) {
  const [customServiceInput, setCustomServiceInput] = useState('');
  const businessType = form.watch('businessType') || 'other';
  const defaultServices =
    DEFAULT_SERVICES[businessType] || DEFAULT_SERVICES.other;

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">What services do you offer?</h1>
        <p className="text-muted-foreground">
          Select the services you provide. You can add more or customize these
          later.
        </p>
      </div>

      <Controller
        name="selectedServices"
        control={form.control}
        render={({ field }) => {
          const selectedServices: string[] = field.value || [];
          const customServices: string[] = form.watch('customServices') || [];

          const toggleService = (serviceName: string) => {
            const isSelected = selectedServices.includes(serviceName);
            if (isSelected) {
              field.onChange(
                selectedServices.filter((s: string) => s !== serviceName)
              );
            } else {
              field.onChange([...selectedServices, serviceName]);
            }
          };

          const addCustomService = () => {
            const trimmed = customServiceInput.trim();
            if (
              trimmed &&
              !customServices.includes(trimmed) &&
              !defaultServices.includes(trimmed)
            ) {
              form.setValue('customServices', [...customServices, trimmed]);
              // Auto-select the newly added service
              field.onChange([...selectedServices, trimmed]);
              setCustomServiceInput('');
            }
          };

          const removeCustomService = (serviceName: string) => {
            form.setValue(
              'customServices',
              customServices.filter((s: string) => s !== serviceName)
            );
            field.onChange(
              selectedServices.filter((s: string) => s !== serviceName)
            );
          };

          const allServices = [...defaultServices, ...customServices];

          return (
            <div className="space-y-4">
              {/* Service selection grid */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {allServices.map((service) => {
                  const isSelected = selectedServices.includes(service);
                  const isCustom = customServices.includes(service);

                  return (
                    <Card
                      key={service}
                      className={cn(
                        'cursor-pointer p-3 transition-all hover:border-primary/50',
                        isSelected && 'border-primary bg-primary/5'
                      )}
                      onClick={() => toggleService(service)}
                    >
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleService(service)}
                        />
                        <FieldLabel className="flex-1 cursor-pointer text-sm">
                          {service}
                        </FieldLabel>
                        {isCustom && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeCustomService(service);
                            }}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <X className="size-4" />
                          </button>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>

              {/* Add custom service */}
              <div className="flex gap-2">
                <Input
                  placeholder="Add a custom service..."
                  value={customServiceInput}
                  onChange={(e) => setCustomServiceInput(e.target.value)}
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
                  disabled={!customServiceInput.trim()}
                >
                  <Plus className="size-4" />
                  Add
                </Button>
              </div>

              {/* Selected count */}
              <div className="flex items-center gap-2">
                <Badge variant="secondary">
                  {selectedServices.length} service
                  {selectedServices.length !== 1 ? 's' : ''} selected
                </Badge>
              </div>
            </div>
          );
        }}
      />

      <p className="text-center text-xs text-muted-foreground">
        You can manage your services anytime from the dashboard.
      </p>
    </FieldGroup>
  );
}

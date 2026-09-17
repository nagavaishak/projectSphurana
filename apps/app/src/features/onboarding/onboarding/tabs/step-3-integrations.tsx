import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldGroup, FieldLabel } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { Controller, type UseFormReturn } from 'react-hook-form';

interface Step3IntegrationsProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type flexibility needed
  form: UseFormReturn<any>;
}

const INTEGRATION_OPTIONS = [
  {
    id: 'gmail',
    label: 'Gmail',
    description: 'Send emails and manage communications',
    icon: '/gmail-icon.svg',
  },
  {
    id: 'facebook',
    label: 'Facebook & Instagram',
    description: 'Run ads and post to social media',
    icon: '/fb-icon.svg',
  },
  {
    id: 'google-calendar',
    label: 'Google Calendar',
    description: 'Sync appointments and availability',
    icon: '/google-calendar-icon.svg',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    description: 'Send messages to clients',
    icon: '/wa-icon.svg',
  },
] as const;

export function Step3Integrations({ form }: Step3IntegrationsProps) {
  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          What tools do you already use?
        </h1>
        <p className="text-muted-foreground">
          We can connect to these later to streamline your workflow.
        </p>
      </div>

      <Controller
        name="selectedIntegrations"
        control={form.control}
        render={({ field }) => {
          const selectedIntegrations = field.value || [];

          const toggleIntegration = (integrationId: string) => {
            const isSelected = selectedIntegrations.includes(integrationId);
            if (isSelected) {
              field.onChange(
                selectedIntegrations.filter(
                  (id: string) => id !== integrationId
                )
              );
            } else {
              field.onChange([...selectedIntegrations, integrationId]);
            }
          };

          return (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {INTEGRATION_OPTIONS.map((integration) => {
                const isSelected = selectedIntegrations.includes(
                  integration.id
                );

                return (
                  <Card
                    key={integration.id}
                    className={cn(
                      'cursor-pointer p-4 transition-all hover:border-primary/50',
                      isSelected && 'border-primary bg-primary/5'
                    )}
                    onClick={() => toggleIntegration(integration.id)}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() =>
                          toggleIntegration(integration.id)
                        }
                        className="mt-1"
                      />
                      <div className="flex flex-1 items-start gap-3">
                        <div className="relative flex size-10 items-center justify-center overflow-hidden rounded-lg bg-muted p-1.5">
                          <img
                            src={integration.icon}
                            alt={integration.label}
                            className="size-7 object-contain"
                          />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <FieldLabel className="cursor-pointer text-sm font-medium">
                            {integration.label}
                          </FieldLabel>
                          <p className="text-xs text-muted-foreground">
                            {integration.description}
                          </p>
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          );
        }}
      />

      <p className="text-center text-xs text-muted-foreground">
        You can connect integrations anytime from your dashboard settings.
      </p>
    </FieldGroup>
  );
}

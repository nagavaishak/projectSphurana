import { Checkbox } from '@/components/ui/checkbox';
import { FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { UseFormReturn } from 'react-hook-form';

interface Step7DepositsProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type flexibility needed
  form: UseFormReturn<any>;
}

/**
 * Step 7: Deposits
 * Per-service deposit configuration. Only shown if Stripe is connected.
 * Follows the credibility-step pattern (list of selectable items).
 */
export function Step7Deposits({ form }: Step7DepositsProps) {
  const services: string[] = form.watch('services') || [];
  const serviceDetails: Record<
    string,
    {
      appointmentDuration?: number;
      requiresDeposit?: boolean;
      depositAmountCents?: number;
    }
  > = form.watch('serviceDetails') || {};

  const updateServiceDetail = (
    serviceName: string,
    key: string,
    value: unknown
  ) => {
    const current = serviceDetails[serviceName] || {};
    const updated = {
      ...serviceDetails,
      [serviceName]: { ...current, [key]: value },
    };
    form.setValue('serviceDetails', updated, { shouldDirty: true });
  };

  const toggleDeposit = (serviceName: string, checked: boolean) => {
    updateServiceDetail(serviceName, 'requiresDeposit', checked);
    if (!checked) {
      updateServiceDetail(serviceName, 'depositAmountCents', undefined);
    }
  };

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          Which services require a deposit?
        </h1>
        <p className="text-muted-foreground">
          Select services that need a deposit when clients book. You can update
          these later in settings.
        </p>
      </div>

      {services.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          No services added yet. Go back to add services first.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {services.map((service) => {
            const details = serviceDetails[service] || {};
            const isChecked = details.requiresDeposit || false;
            const amountEuros = details.depositAmountCents
              ? Number(details.depositAmountCents) / 100
              : '';

            return (
              <div key={service} className="border-b last:border-b-0">
                <label
                  htmlFor={`deposit-${service}`}
                  className="flex cursor-pointer items-center gap-3 px-1 py-4 transition-colors hover:bg-muted/50"
                >
                  <Checkbox
                    id={`deposit-${service}`}
                    checked={isChecked}
                    onCheckedChange={(checked) =>
                      toggleDeposit(service, checked === true)
                    }
                    className="shrink-0"
                  />
                  <span className="text-sm font-medium">{service}</span>
                </label>

                {isChecked && (
                  <div className="flex flex-col gap-3 pb-4 pl-8">
                    <div className="flex items-center gap-2">
                      <FieldLabel
                        htmlFor={`deposit-amount-${service}`}
                        className="text-sm whitespace-nowrap"
                      >
                        Amount
                      </FieldLabel>
                      <div className="relative max-w-[140px]">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                          &euro;
                        </span>
                        <Input
                          id={`deposit-amount-${service}`}
                          type="number"
                          min="1"
                          step="1"
                          placeholder="50"
                          className="pl-7"
                          value={amountEuros}
                          onChange={(e) => {
                            const euros = Number.parseFloat(e.target.value);
                            updateServiceDetail(
                              service,
                              'depositAmountCents',
                              euros > 0 ? Math.round(euros * 100) : undefined
                            );
                          }}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      A payment link will be created automatically via Stripe.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </FieldGroup>
  );
}

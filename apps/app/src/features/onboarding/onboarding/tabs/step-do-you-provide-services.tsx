import { FieldGroup } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { Briefcase, UserCog } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';

interface StepDoYouProvideServicesProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type flexibility needed
  form: UseFormReturn<any>;
}

const OPTIONS = [
  {
    value: true,
    icon: UserCog,
    title: 'Yes, I provide services',
    description:
      'I personally see clients and want to set up my own profile, calendar, and working hours.',
  },
  {
    value: false,
    icon: Briefcase,
    title: 'No, I manage the business',
    description:
      "I handle the business side and won't be taking bookings myself.",
  },
] as const;

export function StepDoYouProvideServices({
  form,
}: StepDoYouProvideServicesProps) {
  const selected = form.watch('ownerProvidesServices') as boolean | undefined;

  const selectOption = (value: boolean) => {
    form.setValue('ownerProvidesServices', value, {
      shouldValidate: true,
      shouldDirty: true,
    });
  };

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">One last thing</h1>
        <p className="text-muted-foreground">
          Do you personally provide services to clients?
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((option) => {
          const isSelected = selected === option.value;
          const Icon = option.icon;

          return (
            <button
              key={String(option.value)}
              type="button"
              onClick={() => selectOption(option.value)}
              className={cn(
                'flex flex-col items-center gap-3 rounded-lg border-2 p-6 text-center transition-all hover:border-primary/50',
                isSelected ? 'border-primary bg-primary/5' : 'border-border'
              )}
            >
              <div
                className={cn(
                  'flex h-12 w-12 items-center justify-center rounded-full',
                  isSelected
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                <Icon className="h-6 w-6" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">{option.title}</span>
                <span className="text-xs text-muted-foreground">
                  {option.description}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </FieldGroup>
  );
}

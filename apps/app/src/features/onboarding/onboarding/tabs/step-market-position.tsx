import { FieldGroup } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { ArrowDown, ArrowRight, ArrowUp, HelpCircle } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';

interface StepMarketPositionProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type flexibility needed
  form: UseFormReturn<any>;
}

export type MarketPositionChoice = 'below' | 'at' | 'above' | 'unknown';

const OPTIONS: ReadonlyArray<{
  value: MarketPositionChoice;
  icon: typeof ArrowDown;
  title: string;
  description: string;
}> = [
  {
    value: 'below',
    icon: ArrowDown,
    title: 'Below market',
    description: 'You undercut most clinics nearby.',
  },
  {
    value: 'at',
    icon: ArrowRight,
    title: 'At market',
    description: 'Roughly in line with what nearby clinics charge.',
  },
  {
    value: 'above',
    icon: ArrowUp,
    title: 'Above market',
    description: 'Premium pricing — you charge more than most nearby.',
  },
  {
    value: 'unknown',
    icon: HelpCircle,
    title: "I'm not sure",
    description: "I'll figure this out later.",
  },
];

export function StepMarketPosition({ form }: StepMarketPositionProps) {
  const selected = form.watch('marketPosition') as
    | MarketPositionChoice
    | undefined;

  const selectOption = (value: MarketPositionChoice) => {
    form.setValue('marketPosition', value, {
      shouldValidate: true,
      shouldDirty: true,
    });
  };

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">One quick question</h1>
        <p className="text-muted-foreground">
          When clients compare your prices with other clinics nearby — how are
          you positioned?
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((option) => {
          const isSelected = selected === option.value;
          const Icon = option.icon;

          return (
            <button
              key={option.value}
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

      <p className="text-sm text-muted-foreground">
        <span className="font-medium">Why we&apos;re asking:</span> this shapes
        how Claire builds your intro offers. You can change this anytime in
        settings.
      </p>
    </FieldGroup>
  );
}

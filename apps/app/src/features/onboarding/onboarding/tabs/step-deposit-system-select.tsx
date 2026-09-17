import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { CreditCard, Link2 } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';

interface StepDepositSystemSelectProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type flexibility needed
  form: UseFormReturn<any>;
}

type DepositSystemChoice = 'stripe' | 'link' | 'none';

interface DepositOption {
  id: DepositSystemChoice;
  name: string;
  description: string;
  icon: typeof CreditCard;
  badge?: string;
}

const DEPOSIT_OPTIONS: DepositOption[] = [
  {
    id: 'stripe',
    name: 'Connect Stripe',
    description: 'Collect deposits & track payments automatically',
    icon: CreditCard,
    badge: 'Automatic',
  },
  {
    id: 'link',
    name: 'I have a payment link',
    description: 'Share your existing payment link with leads',
    icon: Link2,
  },
];

/**
 * Step: Deposit System Selection
 * Choose how to handle deposits: Stripe Connect, external payment link, or skip.
 */
export function StepDepositSystemSelect({
  form,
}: StepDepositSystemSelectProps) {
  const currentChoice: DepositSystemChoice =
    form.watch('depositSystemChoice') || 'none';

  const selectOption = (id: DepositSystemChoice) => {
    form.setValue('depositSystemChoice', id, { shouldDirty: true });

    // Clear deposit link when switching away from 'link'
    if (id !== 'link') {
      form.setValue('depositLink', '', { shouldDirty: true });
    }
  };

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">How do you collect deposits?</h1>
        <p className="text-muted-foreground">
          We can collect deposits automatically via Stripe, or share your
          existing payment link with leads.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {DEPOSIT_OPTIONS.map((option) => {
          const isSelected = currentChoice === option.id;

          return (
            <div
              key={option.id}
              role="button"
              tabIndex={0}
              className={`relative flex items-center gap-4 rounded-lg border p-4 transition-colors cursor-pointer ${
                isSelected
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-muted-foreground/30'
              }`}
              onClick={() => selectOption(option.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  selectOption(option.id);
                }
              }}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
                <option.icon className="h-5 w-5 text-muted-foreground" />
              </div>

              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{option.name}</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {option.description}
                </p>
              </div>

              {option.badge && (
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full shrink-0">
                  {option.badge}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Inline deposit link input for 'link' choice */}
      {currentChoice === 'link' && (
        <Field>
          <FieldLabel>Your payment link</FieldLabel>
          <Input
            type="url"
            placeholder="https://buy.stripe.com/..."
            value={form.watch('depositLink') || ''}
            onChange={(e) =>
              form.setValue('depositLink', e.target.value || '', {
                shouldDirty: true,
              })
            }
          />
        </Field>
      )}

      {/* "I don't collect deposits" option */}
      <button
        type="button"
        className={`text-sm text-muted-foreground hover:text-foreground transition-colors text-left ${
          currentChoice === 'none' ? 'text-primary font-medium' : ''
        }`}
        onClick={() => selectOption('none')}
      >
        I don&apos;t collect deposits — skip for now
      </button>
    </FieldGroup>
  );
}

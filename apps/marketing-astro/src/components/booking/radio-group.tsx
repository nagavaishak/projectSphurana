'use client';

/**
 * A minimal radio group, local to the booking wizard.
 *
 * apps/app uses `@/components/ui/radio-group`, a shadcn wrapper around
 * `@radix-ui/react-radio-group`. Neither exists here, and adding a Radix
 * dependency to a `package.json` another agent is concurrently editing is not
 * worth it for one variant chooser. Native `<input type="radio">` gives the
 * same accessibility contract for free — `role="radio"`, roving focus, grouped
 * by `name`, checked state exposed to assistive tech — which is what the Radix
 * version is emulating in the first place.
 *
 * The API is the subset the chooser uses (`value` / `onValueChange`), so the
 * ported call site is unchanged.
 */

import { type ReactNode, createContext, useContext, useId } from 'react';

import { cn } from '@/lib/utils';

interface RadioGroupContextValue {
  value?: string;
  onValueChange?: (value: string) => void;
  name: string;
}

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

interface RadioGroupProps {
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children: ReactNode;
  /** Groups the inputs; defaults to a stable generated name. */
  name?: string;
}

export function RadioGroup({
  value,
  onValueChange,
  className,
  children,
  name,
}: RadioGroupProps) {
  const generated = useId();
  return (
    <RadioGroupContext.Provider
      value={{ value, onValueChange, name: name ?? generated }}
    >
      <div role="radiogroup" className={cn('grid gap-2', className)}>
        {children}
      </div>
    </RadioGroupContext.Provider>
  );
}

interface RadioGroupItemProps {
  id?: string;
  value: string;
  className?: string;
}

export function RadioGroupItem({ id, value, className }: RadioGroupItemProps) {
  const ctx = useContext(RadioGroupContext);
  return (
    <input
      type="radio"
      id={id}
      name={ctx?.name ?? 'radio-group'}
      value={value}
      checked={ctx?.value === value}
      onChange={() => ctx?.onValueChange?.(value)}
      className={cn('size-4 shrink-0 accent-primary', className)}
    />
  );
}

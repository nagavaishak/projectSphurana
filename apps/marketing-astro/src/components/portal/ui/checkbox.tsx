'use client';

import { CheckIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Checkbox on a real `<input type="checkbox">`.
 *
 * apps/app used `@radix-ui/react-checkbox`, which is not installed here. On a
 * consent form the checkbox IS the legal attestation, so the native control —
 * which every assistive technology and every autofill path already understands
 * — is the right substrate anyway. The input is visually hidden but focusable;
 * the tick is drawn from its `:checked` state via peer classes.
 *
 * API matches the Radix call sites (`checked` / `onCheckedChange`) so the
 * consent-form code is unchanged by the swap.
 */
export function Checkbox({
  id,
  checked,
  onCheckedChange,
  disabled,
  className,
  'aria-describedby': ariaDescribedBy,
}: {
  id?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  'aria-describedby'?: string;
}) {
  return (
    <span className={cn('relative inline-flex size-4 shrink-0', className)}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={ariaDescribedBy}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="peer absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <span
        aria-hidden
        className={cn(
          'pointer-events-none flex size-4 items-center justify-center rounded-[4px] border shadow-xs transition-[color,box-shadow]',
          'peer-focus-visible:border-ring peer-focus-visible:ring-ring/50 peer-focus-visible:ring-[3px]',
          'peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground',
          'peer-disabled:opacity-50'
        )}
      >
        {checked && <CheckIcon className="size-3" strokeWidth={3} />}
      </span>
    </span>
  );
}

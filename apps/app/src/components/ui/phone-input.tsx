'use client';

import { isValidPhoneNumber } from 'libphonenumber-js';
import { forwardRef } from 'react';
import { z } from 'zod';

import { cn } from '@/lib/utils';

export const phoneSchema = z.string().refine((value) => {
  try {
    return isValidPhoneNumber(value);
  } catch {
    return false;
  }
}, 'Invalid phone number');

interface PhoneInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  /** The calling code prefix shown as static text, e.g. "+353" */
  callingCode: string;
  /** The local number (without prefix) */
  value?: string;
  onChange?: (localNumber: string) => void;
  placeholder?: string;
  className?: string;
}

export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ className, callingCode, onChange, value, placeholder, ...props }, ref) => {
    return (
      <div
        className={cn(
          'flex items-center bg-transparent transition-[color,box-shadow] text-base rounded-l-none rounded-r-md border border-input pl-3 h-9 shadow-xs disabled:opacity-50 disabled:cursor-not-allowed md:text-sm has-[input:focus]:border-ring has-[input:focus]:ring-ring/50 has-[input:focus]:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 w-full',
          className
        )}
        aria-invalid={props['aria-invalid']}
      >
        <span className="text-foreground select-none shrink-0 text-sm">
          {callingCode}
        </span>
        <input
          ref={ref}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder || 'Enter number'}
          type="tel"
          autoComplete="tel"
          className="flex w-full border-none bg-transparent text-base placeholder:text-muted-foreground outline-none h-9 py-1 pl-1 pr-3 leading-none md:text-sm"
          {...props}
        />
      </div>
    );
  }
);

PhoneInput.displayName = 'PhoneInput';

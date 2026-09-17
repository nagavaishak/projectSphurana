import { useId } from 'react';

import { cn } from '@/lib/utils';

export interface SlideInputProps {
  value: string;
  onChange: (value: string) => void;
  variant?: 'text' | 'url' | 'price';
  placeholder?: string;
  /** Accessible label; rendered visually hidden. Falls back to placeholder. */
  label?: string;
  id?: string;
  autoFocus?: boolean;
  /** Currency symbol prefix for the price variant. */
  currencySymbol?: string;
  className?: string;
}

/**
 * Borderless underline input: only a bottom border, large text, muted
 * placeholder. Focus is signalled by the border darkening, not a ring.
 */
export function SlideInput({
  value,
  onChange,
  variant = 'text',
  placeholder,
  label,
  id,
  autoFocus,
  currencySymbol = '€',
  className,
}: SlideInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  const resolvedPlaceholder =
    placeholder ?? (variant === 'url' ? 'https://' : undefined);

  const handleChange = (raw: string) => {
    onChange(variant === 'price' ? raw.replace(/[^\d.,]/g, '') : raw);
  };

  return (
    <div className={className}>
      <label htmlFor={inputId} className="sr-only">
        {label ?? resolvedPlaceholder ?? 'Answer'}
      </label>
      <div className="border-input focus-within:border-foreground flex items-end gap-2 border-b transition-colors">
        {variant === 'price' && (
          <span aria-hidden className="text-muted-foreground pb-2 text-2xl">
            {currencySymbol}
          </span>
        )}
        <input
          id={inputId}
          type={variant === 'url' ? 'url' : 'text'}
          inputMode={
            variant === 'price'
              ? 'decimal'
              : variant === 'url'
                ? 'url'
                : undefined
          }
          autoComplete={variant === 'url' ? 'url' : undefined}
          value={value}
          onChange={(event) => handleChange(event.target.value)}
          placeholder={resolvedPlaceholder}
          // biome-ignore lint/a11y/noAutofocus: Typeform-style slides focus their single input by design
          autoFocus={autoFocus}
          className={cn(
            'placeholder:text-muted-foreground/50 w-full bg-transparent pb-2 text-2xl outline-none',
            'focus-visible:ring-0 focus-visible:outline-none'
          )}
        />
      </div>
    </div>
  );
}

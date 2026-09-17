import { useEffect } from 'react';

import { cn } from '@/lib/utils';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export interface SlideOption {
  label: string;
  value: string;
  description?: string;
}

export interface SlideOptionsProps {
  options: SlideOption[];
  /** Selected value (single-select). */
  value?: string | null;
  /** Selected values (multi-select). */
  values?: string[];
  /** Called with the option value; the parent owns toggle semantics. */
  onSelect: (value: string) => void;
  multi?: boolean;
  /** Max selections in multi mode; unselected options disable at the cap. */
  max?: number;
  className?: string;
}

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
};

/**
 * Vertical list of bordered option rows with lettered A/B/C key chips.
 * Pressing an option's letter selects it (unless focus is in a text field).
 */
export function SlideOptions({
  options,
  value,
  values,
  onSelect,
  multi = false,
  max,
  className,
}: SlideOptionsProps) {
  const isSelected = (optionValue: string) =>
    multi ? (values ?? []).includes(optionValue) : value === optionValue;

  const atMax = multi && max !== undefined && (values ?? []).length >= max;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      const index = LETTERS.indexOf(event.key.toUpperCase());
      if (index === -1 || index >= options.length) return;
      const option = options[index];
      if (atMax && !isSelected(option.value)) return;
      event.preventDefault();
      onSelect(option.value);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  return (
    <div role="group" className={cn('flex flex-col gap-2', className)}>
      {options.map((option, index) => {
        const selected = isSelected(option.value);
        const disabled = atMax && !selected;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onSelect(option.value)}
            className={cn(
              'flex w-full items-center gap-3 rounded-sm border px-4 py-3 text-left text-base transition-colors',
              selected
                ? 'border-foreground bg-muted'
                : 'border-input hover:border-muted-foreground/50 hover:bg-muted/50',
              disabled && 'cursor-not-allowed opacity-40'
            )}
          >
            <span
              aria-hidden
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-sm border text-xs font-semibold',
                selected
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-input text-muted-foreground'
              )}
            >
              {LETTERS[index]}
            </span>
            <span className="flex min-w-0 flex-col">
              <span>{option.label}</span>
              {option.description && (
                <span className="text-muted-foreground text-sm">
                  {option.description}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

export const OTP_LENGTH = 6;

export interface OtpInputHandle {
  /** Move focus to the current (first empty) digit box. */
  focus: () => void;
}

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Fires once when the sixth digit lands (typed, pasted or autofilled). */
  onComplete?: (code: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  ref?: React.Ref<OtpInputHandle>;
}

/**
 * Segmented 6-digit code input: digits fill left to right, typing
 * auto-advances, backspace steps back, paste (and iOS one-time-code
 * autofill) distributes across the boxes. The value is digits-only and
 * hole-free — the "cursor" is always the first empty box.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  autoFocus,
  ref,
}: OtpInputProps) {
  const boxRefs = React.useRef<(HTMLInputElement | null)[]>([]);

  const activeIndex = Math.min(value.length, OTP_LENGTH - 1);

  const focusActive = React.useCallback(() => {
    boxRefs.current[Math.min(value.length, OTP_LENGTH - 1)]?.focus();
  }, [value.length]);

  React.useImperativeHandle(ref, () => ({ focus: focusActive }), [focusActive]);

  const commit = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (digits === value) return;
    onChange(digits);
    if (digits.length === OTP_LENGTH) onComplete?.(digits);
  };

  // Keep focus glued to the active box while the user is inside the group.
  React.useEffect(() => {
    if (boxRefs.current.some((el) => el === document.activeElement)) {
      boxRefs.current[activeIndex]?.focus();
    }
  }, [activeIndex]);

  // Mount-only, mirroring the native autofocus attribute.
  const autoFocusRef = React.useRef(autoFocus);
  React.useEffect(() => {
    if (autoFocusRef.current) boxRefs.current[0]?.focus();
  }, []);

  return (
    <div
      role="group"
      aria-label="6-digit code"
      className="flex justify-center gap-2"
      onPaste={(event) => {
        event.preventDefault();
        commit(event.clipboardData.getData('text'));
      }}
    >
      {Array.from({ length: OTP_LENGTH }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            boxRefs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          value={value[i] ?? ''}
          disabled={disabled}
          aria-label={`Digit ${i + 1} of ${OTP_LENGTH}`}
          aria-invalid={invalid || undefined}
          className={cn(
            'h-12 w-10 rounded-md border bg-transparent text-center text-lg font-semibold shadow-xs transition-[color,box-shadow] outline-none sm:w-11',
            'selection:bg-primary selection:text-primary-foreground',
            'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
            'aria-invalid:ring-destructive/20 aria-invalid:border-destructive',
            'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50'
          )}
          onFocus={(event) => {
            event.target.select();
            // Clicking a later box jumps back to the first empty one so the
            // hole-free model always holds.
            if (i !== activeIndex) boxRefs.current[activeIndex]?.focus();
          }}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, '');
            if (!digits) return; // Deletion is handled on keydown.
            // Multi-digit input = paste or platform autofill: treat as the
            // whole code. A single digit appends at the cursor.
            commit(digits.length > 1 ? digits : value.slice(0, i) + digits);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Backspace') {
              event.preventDefault();
              commit(value.slice(0, -1));
            } else if (
              event.key === 'ArrowLeft' ||
              event.key === 'ArrowRight'
            ) {
              // Arrow-editing would create holes; the model doesn't allow it.
              event.preventDefault();
            }
          }}
        />
      ))}
    </div>
  );
}

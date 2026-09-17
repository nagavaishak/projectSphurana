import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { DeleteIcon, Loader2Icon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { currencySymbol, formatMoney, toCents } from '../../lib/money';

interface AmountKeypadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dialog title, e.g. "Add cash amount". */
  title: string;
  currency: string;
  /** Outstanding balance in cents — seeds the amount and quick chips. */
  remaining: number;
  busy?: boolean;
  /** Extra gating beyond a positive amount (e.g. gift card not found). */
  disabled?: boolean;
  submitLabel?: string;
  /** Maps the typed amount to the amount actually charged (e.g. gift-card cap). */
  chargeFor?: (cents: number) => number;
  /** Method-specific controls rendered above the keypad. */
  extra?: ReactNode;
  /** Small note above the action row (e.g. "Cash received by · …"). */
  footerNote?: ReactNode;
  onSubmit: (cents: number) => void;
}

/** Convert integer cents to a clean editable decimal string ("2550" → "25.5"). */
function centsToInput(cents: number): string {
  if (cents <= 0) return '';
  const value = cents / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * Quick-amount suggestions: the exact balance plus a few round-ups so the
 * cashier can tender common note values without typing.
 */
function quickAmounts(remaining: number): number[] {
  const base = Math.max(remaining, 0);
  if (base === 0) return [];
  const euros = base / 100;
  const set = new Set<number>([base]);
  for (const step of [5, 10, 20, 50, 100]) {
    const up = Math.ceil((euros + 0.001) / step) * step;
    set.add(Math.round(up * 100));
  }
  return [...set].sort((a, b) => a - b).slice(0, 5);
}

/**
 * Fresha-style amount entry: a large running total, quick-tender chips and a
 * numeric keypad. The typed value seeds from the outstanding balance and the
 * first keypress replaces it (like the highlighted default in the reference).
 */
export function AmountKeypadDialog({
  open,
  onOpenChange,
  title,
  currency,
  remaining,
  busy = false,
  disabled = false,
  submitLabel = 'Add',
  chargeFor,
  extra,
  footerNote,
  onSubmit,
}: AmountKeypadDialogProps) {
  const [amount, setAmount] = useState('');
  // Whether the user has started editing; until then a keypress replaces the
  // seeded default rather than appending to it.
  const [dirty, setDirty] = useState(false);

  // Reseed each time the dialog opens.
  useEffect(() => {
    if (open) {
      setAmount(centsToInput(remaining));
      setDirty(false);
    }
  }, [open, remaining]);

  const amountCents = useMemo(() => {
    const parsed = Number.parseFloat(amount);
    return Number.isNaN(parsed) ? 0 : toCents(parsed);
  }, [amount]);

  const chargeCents = chargeFor ? chargeFor(amountCents) : amountCents;
  const leftToPay = Math.max(remaining - chargeCents, 0);
  // Cash can be tendered above the balance — surface the change owed rather
  // than a static "Left to pay · 0.00" once the entered amount covers the bill.
  const change = Math.max(chargeCents - remaining, 0);
  const symbol = currencySymbol(currency);

  const pressDigit = (digit: string) => {
    setAmount((prev) => {
      const current = dirty ? prev : '';
      // Cap at two decimal places.
      if (current.includes('.') && current.split('.')[1]?.length >= 2) {
        return current;
      }
      if (current === '0' && digit !== '.') return digit;
      return current + digit;
    });
    setDirty(true);
  };

  const pressDot = () => {
    setAmount((prev) => {
      const current = dirty ? prev : '';
      if (current.includes('.')) return current;
      return current === '' ? '0.' : `${current}.`;
    });
    setDirty(true);
  };

  const backspace = () => {
    setAmount((prev) => (dirty ? prev.slice(0, -1) : ''));
    setDirty(true);
  };

  const setChip = (cents: number) => {
    setAmount(centsToInput(cents));
    setDirty(true);
  };

  const canSubmit = !busy && !disabled && chargeCents > 0;

  // Physical-keyboard entry: type digits / "." / Backspace and Enter to submit,
  // mirroring the on-screen keypad. A ref keeps the handlers current so the
  // listener is only (re)subscribed when the dialog opens.
  const keyHandlersRef = useRef({
    pressDigit,
    pressDot,
    backspace,
    submit: () => {
      if (canSubmit) onSubmit(chargeCents);
    },
  });
  keyHandlersRef.current = {
    pressDigit,
    pressDot,
    backspace,
    submit: () => {
      if (canSubmit) onSubmit(chargeCents);
    },
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack keystrokes meant for a real field (e.g. gift-card code).
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      const h = keyHandlersRef.current;
      if (e.key >= '0' && e.key <= '9') {
        h.pressDigit(e.key);
        e.preventDefault();
      } else if (e.key === '.' || e.key === ',') {
        h.pressDot();
        e.preventDefault();
      } else if (e.key === 'Backspace') {
        h.backspace();
        e.preventDefault();
      } else if (e.key === 'Enter') {
        h.submit();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const keys: { label: ReactNode; onPress: () => void; key: string }[] = [
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => ({
      key: d,
      label: d,
      onPress: () => pressDigit(d),
    })),
    { key: '.', label: '.', onPress: pressDot },
    { key: '0', label: '0', onPress: () => pressDigit('0') },
    {
      key: 'back',
      label: <DeleteIcon className="size-5" />,
      onPress: backspace,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {/* Running total */}
        <div className="py-2 text-center">
          <span className="text-4xl font-bold tabular-nums">
            <span className="text-muted-foreground">{symbol} </span>
            {amount || '0'}
          </span>
          <div className="mx-auto mt-1 h-px w-24 bg-border" />
        </div>

        {/* Quick tenders */}
        {quickAmounts(remaining).length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {quickAmounts(remaining).map((cents) => (
              <button
                key={cents}
                type="button"
                onClick={() => setChip(cents)}
                className="rounded-full border px-4 py-1.5 text-sm font-medium transition-colors hover:bg-muted/60"
              >
                {formatMoney(cents, currency)}
              </button>
            ))}
          </div>
        )}

        {extra}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-2">
          {keys.map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={k.onPress}
              className={cn(
                'flex h-14 items-center justify-center rounded-xl border text-lg font-semibold transition-colors',
                'hover:bg-muted/60 active:bg-muted'
              )}
            >
              {k.label}
            </button>
          ))}
        </div>

        {footerNote && (
          <p className="text-center text-sm text-muted-foreground">
            {footerNote}
          </p>
        )}

        <div className="flex items-center justify-between gap-4 border-t pt-4">
          <div className="text-sm">
            {change > 0 ? (
              <>
                <span className="font-semibold">Change</span>
                <span className="text-muted-foreground">
                  {' '}
                  · {formatMoney(change, currency)}
                </span>
              </>
            ) : (
              <>
                <span className="font-semibold">Left to pay</span>
                <span className="text-muted-foreground">
                  {' '}
                  · {formatMoney(leftToPay, currency)}
                </span>
              </>
            )}
          </div>
          <Button
            type="button"
            className="min-w-24 rounded-full"
            disabled={!canSubmit}
            onClick={() => onSubmit(chargeCents)}
          >
            {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {submitLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

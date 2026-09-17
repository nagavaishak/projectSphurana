import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { SetSaleTipInput } from '@borradh-workspace/api-client/types';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { formatMoney, toCents } from '../../lib/money';

/** Preset tip percentages per the Fresha checkout contract (§1.2). */
const TIP_PRESETS = [10, 18, 25] as const;

interface TipSelectorProps {
  subtotalCents: number;
  currency: string;
  /** Current settled tip on the sale (source of truth). */
  tipCents: number;
  isSaving?: boolean;
  onApply: (input: SetSaleTipInput) => void;
}

type Selection = 'none' | number | 'custom';

/** A large, selectable tip card. */
function TipCard({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-28 flex-col items-center justify-center gap-1 rounded-xl border text-center transition-colors',
        'hover:bg-muted/40 disabled:pointer-events-none disabled:opacity-60',
        selected ? 'border-primary ring-1 ring-primary' : 'border-border'
      )}
    >
      {children}
    </button>
  );
}

/**
 * Tip step: No tip / 10% / 18% / 25% / custom (percentage or fixed amount).
 * Percent presets and custom percent are stored identically (tipType='percent').
 */
export function TipSelector({
  subtotalCents,
  currency,
  tipCents,
  isSaving,
  onApply,
}: TipSelectorProps) {
  const [selected, setSelected] = useState<Selection | null>(
    tipCents === 0 ? 'none' : null
  );
  const [customMode, setCustomMode] = useState<'percent' | 'amount'>('percent');
  const [customValue, setCustomValue] = useState('');

  const applyPercent = (percent: number) => {
    setSelected(percent);
    onApply({ tipType: 'percent', tipPercent: percent });
  };

  const applyNone = () => {
    setSelected('none');
    onApply({ tipType: 'none' });
  };

  const applyCustom = () => {
    const num = Number.parseFloat(customValue);
    if (Number.isNaN(num) || num < 0) return;
    if (customMode === 'percent') {
      onApply({ tipType: 'percent', tipPercent: num });
    } else {
      onApply({ tipType: 'amount', tipAmountCents: toCents(num) });
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <TipCard
          selected={selected === 'none'}
          disabled={isSaving}
          onClick={applyNone}
        >
          <span className="text-base font-semibold">No tip</span>
        </TipCard>

        {TIP_PRESETS.map((percent) => {
          const preview = Math.round((subtotalCents * percent) / 100);
          return (
            <TipCard
              key={percent}
              selected={selected === percent}
              disabled={isSaving}
              onClick={() => applyPercent(percent)}
            >
              <span className="text-lg font-semibold">{percent}%</span>
              <span className="text-sm text-muted-foreground">
                {formatMoney(preview, currency)}
              </span>
            </TipCard>
          );
        })}

        <TipCard
          selected={selected === 'custom'}
          disabled={isSaving}
          onClick={() => setSelected('custom')}
        >
          <PlusIcon className="size-5" />
          <span className="text-base font-semibold">Custom tip</span>
        </TipCard>
      </div>

      {selected === 'custom' && (
        <div className="space-y-3 rounded-xl border p-4">
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={customMode === 'percent' ? 'default' : 'outline'}
              onClick={() => setCustomMode('percent')}
            >
              Percentage
            </Button>
            <Button
              type="button"
              size="sm"
              variant={customMode === 'amount' ? 'default' : 'outline'}
              onClick={() => setCustomMode('amount')}
            >
              Fixed amount
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              step={customMode === 'percent' ? 1 : 0.01}
              placeholder={customMode === 'percent' ? 'e.g. 15' : 'e.g. 5.00'}
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              className="max-w-[160px]"
            />
            <span className="text-sm text-muted-foreground">
              {customMode === 'percent' ? '%' : currency.toUpperCase()}
            </span>
            <Button
              type="button"
              size="sm"
              disabled={isSaving || !customValue}
              onClick={applyCustom}
            >
              Apply
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
        <span className="text-muted-foreground">Tip</span>
        <span className="font-semibold">{formatMoney(tipCents, currency)}</span>
      </div>
    </div>
  );
}

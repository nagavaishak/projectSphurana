import type { MarketPosition } from '@borradh-workspace/api-client/types';
import { ArrowDown, ArrowRight, ArrowUp, HelpCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const OPTIONS: ReadonlyArray<{
  value: MarketPosition;
  icon: typeof ArrowDown;
  label: string;
}> = [
  { value: 'below', icon: ArrowDown, label: 'Below' },
  { value: 'at', icon: ArrowRight, label: 'At' },
  { value: 'above', icon: ArrowUp, label: 'Above' },
  { value: 'unknown', icon: HelpCircle, label: "I'm not sure" },
];

interface ClaireMarketPositionPrefixProps {
  isSaving?: boolean;
  onSelect: (value: MarketPosition) => void;
}

/**
 * Inline market-position picker shown to backfilled orgs that haven't answered
 * the onboarding question yet. Four buttons: Below / At / Above / Not sure.
 */
export function ClaireMarketPositionPrefix({
  isSaving,
  onSelect,
}: ClaireMarketPositionPrefixProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {OPTIONS.map((opt) => {
        const Icon = opt.icon;
        return (
          <Button
            key={opt.value}
            type="button"
            variant="outline"
            size="sm"
            disabled={isSaving}
            onClick={() => onSelect(opt.value)}
            className={cn('justify-start gap-2')}
          >
            <Icon className="size-3.5" aria-hidden />
            {opt.label}
          </Button>
        );
      })}
    </div>
  );
}

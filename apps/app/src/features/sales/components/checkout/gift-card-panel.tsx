import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useListPractitioners } from '@/features/practitioners/api';
import type { AddSaleItemInput } from '@borradh-workspace/api-client/types';
import { GiftIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { formatMoney } from '../../lib/money';
import { EditGiftCardDialog } from './edit-gift-card-dialog';

const PRESETS = [25, 50, 75, 100, 150];

interface GiftCardPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  onConfirm: (input: AddSaleItemInput) => void;
}

/** Tile in the gift-card selection grid (a preset value or the custom entry). */
function GiftCardTile({
  onClick,
  amountLabel,
  custom,
}: {
  onClick: () => void;
  amountLabel: string;
  custom?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-stretch overflow-hidden rounded-lg border text-left transition-colors hover:border-primary hover:bg-muted/40"
    >
      <div className="flex items-center justify-center bg-muted/50 px-6">
        {custom ? (
          <PlusIcon className="size-6 text-primary" />
        ) : (
          <GiftIcon className="size-6 text-primary" />
        )}
      </div>
      <div className="flex flex-col justify-center gap-0.5 px-4 py-5">
        <span className="font-medium">Gift card</span>
        <span className="text-sm text-muted-foreground">{amountLabel}</span>
      </div>
    </button>
  );
}

/**
 * Fresha-style gift-card selection grid: preset face values plus a custom
 * amount. Picking a tile opens the "Edit gift card" form to set price, expiry
 * and team member before adding it to the cart.
 */
export function GiftCardPanel({
  open,
  onOpenChange,
  currency,
  onConfirm,
}: GiftCardPanelProps) {
  const [editValue, setEditValue] = useState<number | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const { practitioners } = useListPractitioners({
    params: { isActive: true },
  });

  const teamMembers = practitioners.map((p) => ({ id: p.id, name: p.name }));

  const pick = (value: number | null) => {
    setEditValue(value);
    setEditOpen(true);
  };

  const handleConfirm = (input: AddSaleItemInput) => {
    onConfirm(input);
    setEditOpen(false);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Gift cards</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {PRESETS.map((preset) => (
              <GiftCardTile
                key={preset}
                amountLabel={formatMoney(preset * 100, currency)}
                onClick={() => pick(preset)}
              />
            ))}
            <GiftCardTile
              custom
              amountLabel="Custom amount"
              onClick={() => pick(null)}
            />
          </div>
        </DialogContent>
      </Dialog>

      <EditGiftCardDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        currency={currency}
        initialValue={editValue}
        teamMembers={teamMembers}
        onConfirm={handleConfirm}
      />
    </>
  );
}

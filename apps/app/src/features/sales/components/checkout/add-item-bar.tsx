import { Button } from '@/components/ui/button';
import type { AddSaleItemInput } from '@borradh-workspace/api-client/types';
import { GiftIcon, PackageIcon, SparklesIcon, TicketIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type CatalogMode, CatalogPickerDialog } from './catalog-picker-dialog';
import { GiftCardPanel } from './gift-card-panel';

interface AddItemBarProps {
  currency: string;
  disabled?: boolean;
  onAdd: (input: AddSaleItemInput) => void;
  /** Open the gift-card selection grid immediately ("Sell gift card"). */
  autoOpenGiftCard?: boolean;
}

/** Row of actions to add each supported cart line type. */
export function AddItemBar({
  currency,
  disabled,
  onAdd,
  autoOpenGiftCard = false,
}: AddItemBarProps) {
  const [catalogMode, setCatalogMode] = useState<CatalogMode | null>(null);
  const [giftCardOpen, setGiftCardOpen] = useState(autoOpenGiftCard);

  // "Sell gift card" entry point: surface the grid once as the bar mounts.
  useEffect(() => {
    if (autoOpenGiftCard) setGiftCardOpen(true);
  }, [autoOpenGiftCard]);

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Button
          type="button"
          variant="outline"
          className="h-auto flex-col gap-1 py-3"
          disabled={disabled}
          onClick={() => setCatalogMode('service')}
        >
          <SparklesIcon className="size-5" />
          <span className="text-xs">Service</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-auto flex-col gap-1 py-3"
          disabled={disabled}
          onClick={() => setCatalogMode('product')}
        >
          <PackageIcon className="size-5" />
          <span className="text-xs">Product</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-auto flex-col gap-1 py-3"
          disabled={disabled}
          onClick={() => setCatalogMode('membership')}
        >
          <TicketIcon className="size-5" />
          <span className="text-xs">Membership</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-auto flex-col gap-1 py-3"
          disabled={disabled}
          onClick={() => setGiftCardOpen(true)}
        >
          <GiftIcon className="size-5" />
          <span className="text-xs">Gift card</span>
        </Button>
      </div>

      {catalogMode && (
        <CatalogPickerDialog
          mode={catalogMode}
          open={catalogMode !== null}
          onOpenChange={(open) => !open && setCatalogMode(null)}
          currency={currency}
          onSelect={onAdd}
        />
      )}

      <GiftCardPanel
        open={giftCardOpen}
        onOpenChange={setGiftCardOpen}
        currency={currency}
        onConfirm={onAdd}
      />
    </>
  );
}

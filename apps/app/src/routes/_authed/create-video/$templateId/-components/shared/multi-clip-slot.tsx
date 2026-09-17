import { Label } from '@/components/ui/label';
import { VideoIcon } from 'lucide-react';
import { useState } from 'react';
import type { SlotConfig } from '../../data/-slot-config';
import { VideoSelectionDialog } from '../dialogs';

interface MultiClipSlotProps {
  slot: SlotConfig;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
}

export function MultiClipSlot({
  slot,
  selectedIds,
  onSelect,
}: MultiClipSlotProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleSelect = (ids: string[]) => {
    // Limit to maxCount
    const limitedIds = ids.slice(0, slot.maxCount);
    onSelect(limitedIds);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label>
          {slot.label}
          {slot.required && <span className="text-destructive ml-1">*</span>}
        </Label>
        {slot.maxCount > 1 && (
          <span className="text-xs text-muted-foreground">
            (up to {slot.maxCount})
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{slot.description}</p>

      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className="w-full flex items-center gap-3 px-3 py-2 h-10 rounded-md border border-input bg-transparent text-left text-sm hover:bg-muted/50 transition-colors"
      >
        <VideoIcon className="size-4 text-muted-foreground" />
        {selectedIds.length > 0 ? (
          <span className="flex-1">
            {selectedIds.length} video{selectedIds.length !== 1 ? 's' : ''}{' '}
            selected
          </span>
        ) : (
          <span className="flex-1 text-muted-foreground">
            Select {slot.label.toLowerCase()} videos
          </span>
        )}
      </button>

      <VideoSelectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        selectedIds={selectedIds}
        onSelect={handleSelect}
        title={`Select ${slot.label} Videos`}
        description={slot.description}
        maxCount={slot.maxCount}
      />
    </div>
  );
}

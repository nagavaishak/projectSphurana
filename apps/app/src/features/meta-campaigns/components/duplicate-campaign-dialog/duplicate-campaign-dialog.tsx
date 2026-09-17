import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Copy } from 'lucide-react';

interface DuplicateCampaignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignName: string;
  onConfirm: () => void;
  isDuplicating: boolean;
}

export function DuplicateCampaignDialog({
  open,
  onOpenChange,
  campaignName,
  onConfirm,
  isDuplicating,
}: DuplicateCampaignDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 flex h-10 w-10 items-center justify-center rounded-full">
              <Copy className="text-primary h-5 w-5" />
            </div>
            <DialogTitle>Duplicate Campaign</DialogTitle>
          </div>
          <DialogDescription className="pt-2 text-left">
            This creates a copy of{' '}
            <span className="text-foreground font-semibold">
              &quot;{campaignName}&quot;
            </span>{' '}
            and all of its ads on Meta. The copy is created{' '}
            <span className="text-foreground font-semibold">paused</span> so it
            won&apos;t spend until you review and turn it on.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDuplicating}
          >
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isDuplicating}>
            {isDuplicating ? 'Duplicating...' : 'Duplicate Campaign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

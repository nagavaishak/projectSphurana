import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';

interface DeleteCampaignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignName: string;
  onConfirm: () => void;
  isDeleting: boolean;
}

export function DeleteCampaignDialog({
  open,
  onOpenChange,
  campaignName,
  onConfirm,
  isDeleting,
}: DeleteCampaignDialogProps) {
  const [confirmText, setConfirmText] = useState('');

  const isConfirmEnabled = confirmText === campaignName;

  const handleConfirm = () => {
    if (isConfirmEnabled) {
      onConfirm();
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setConfirmText('');
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <DialogTitle>Delete Campaign</DialogTitle>
          </div>
          <DialogDescription className="pt-2 text-left">
            This action cannot be undone. This will permanently delete the
            campaign{' '}
            <span className="font-semibold text-foreground">
              &quot;{campaignName}&quot;
            </span>{' '}
            and all its ads.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
          <strong>Warning:</strong> If this campaign has been published to Meta,
          it will also be deleted from your Meta Ads account. This includes all
          associated ad sets and ads on Meta.
        </div>

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            To confirm, type{' '}
            <span className="font-mono font-semibold text-foreground">
              {campaignName}
            </span>{' '}
            below:
          </p>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type campaign name to confirm"
            disabled={isDeleting}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!isConfirmEnabled || isDeleting}
          >
            {isDeleting ? 'Deleting...' : 'Delete Campaign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

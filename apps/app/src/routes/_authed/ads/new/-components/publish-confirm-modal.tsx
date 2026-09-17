import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface PublishConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onSaveAsDraft?: () => void;
  onCancel?: () => void;
  isLoading?: boolean;
  isNewCampaign?: boolean;
  campaignName?: string;
  isCampaignPaused?: boolean;
}

/**
 * Publish confirmation modal for ad wizard
 */
export function PublishConfirmModal({
  open,
  onOpenChange,
  onConfirm,
  onSaveAsDraft,
  onCancel,
  isLoading,
  isNewCampaign,
  campaignName,
  isCampaignPaused,
}: PublishConfirmModalProps) {
  const handleCancel = () => {
    onCancel?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish Ad</DialogTitle>
          <DialogDescription>
            {isNewCampaign && campaignName ? (
              <>
                You are about to create a new campaign &quot;{campaignName}
                &quot; and publish your ad. This will make your ad live on Meta.
              </>
            ) : isCampaignPaused ? (
              <>
                The campaign{campaignName ? ` "${campaignName}"` : ''} is
                currently paused. Publishing this ad will also activate the
                campaign, making it live on Meta.
              </>
            ) : (
              <>
                Are you sure you want to publish this ad? This will make your ad
                live on Meta.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={handleCancel} disabled={isLoading}>
            Cancel
          </Button>
          {onSaveAsDraft && (
            <Button
              variant="secondary"
              onClick={onSaveAsDraft}
              disabled={isLoading}
            >
              Save as Draft
            </Button>
          )}
          <Button onClick={onConfirm} disabled={isLoading}>
            {isLoading ? 'Publishing...' : 'Publish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

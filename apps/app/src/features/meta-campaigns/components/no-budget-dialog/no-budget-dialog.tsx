import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle, ExternalLink } from 'lucide-react';

interface NoBudgetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignName: string;
}

const META_ADS_MANAGER_URL = 'https://adsmanager.facebook.com';

export function NoBudgetDialog({
  open,
  onOpenChange,
  campaignName,
}: NoBudgetDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <DialogTitle>Budget Required</DialogTitle>
          </div>
          <DialogDescription className="pt-2 text-left">
            The campaign{' '}
            <span className="font-semibold text-foreground">
              &quot;{campaignName}&quot;
            </span>{' '}
            has no budget set. A budget is required before you can publish ads
            or activate this campaign.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          You can add a budget to this campaign in Meta Ads Manager.
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button asChild>
            <a
              href={META_ADS_MANAGER_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Go to Meta Ads Manager
              <ExternalLink className="ml-2 h-4 w-4" />
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

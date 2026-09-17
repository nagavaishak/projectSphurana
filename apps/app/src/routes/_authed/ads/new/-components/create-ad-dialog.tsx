import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

import { AdWizardProvider } from '../-context';
import { AdWizardForm } from './ad-wizard-form';

interface CreateAdDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected campaign — skips the in-wizard campaign step. */
  campaignId?: string;
}

/**
 * Desktop ad-creation surface: the multi-step wizard inside a standard dialog.
 * Mobile keeps the full-page flow (`/ads/new` → AdMobileWizard); this is only
 * mounted on desktop.
 */
export function CreateAdDialog({
  open,
  onOpenChange,
  campaignId,
}: CreateAdDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        <DialogTitle className="sr-only">Create ad</DialogTitle>
        {/* Remount the wizard each time the dialog opens so state is fresh. */}
        {open && (
          <AdWizardProvider>
            <AdWizardForm
              preselectedCampaignId={campaignId}
              onComplete={() => onOpenChange(false)}
            />
          </AdWizardProvider>
        )}
      </DialogContent>
    </Dialog>
  );
}

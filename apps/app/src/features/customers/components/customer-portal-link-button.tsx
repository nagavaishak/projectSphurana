import { Link2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

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
import { useCopyPortalLink } from '@/features/patient-profile/api/copy-portal-link';

/**
 * The "Copy portal link" action, preserved from the ENG-647 patient header when
 * the clients and patients surfaces were unified (plan Phase 4: this action must
 * survive). Mints a 7-day magic sign-in link into the client's portal and copies
 * it, with a fallback dialog when the Clipboard API is unavailable.
 */
export function CustomerPortalLinkButton({
  leadId,
  firstName,
}: {
  leadId: string;
  firstName: string;
}) {
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);

  const copiedToast = () =>
    toast('Portal link copied', {
      description: `This link signs ${firstName} straight in — only share it with them. It expires in 7 days.`,
    });

  const { copyPortalLink, isCopying } = useCopyPortalLink(leadId, {
    onSuccess: async ({ url }) => {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(url);
          copiedToast();
          return;
        } catch {
          // Clipboard blocked (permissions/non-secure context) — fall through.
        }
      }
      setFallbackUrl(url);
    },
  });

  const copyFromFallbackInput = () => {
    const input = fallbackInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
    document.execCommand('copy');
    setFallbackUrl(null);
    copiedToast();
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        aria-label="Copy portal sign-in link for this client"
        disabled={isCopying}
        onClick={() => copyPortalLink()}
      >
        <Link2 />
        {isCopying ? 'Copying…' : 'Copy portal link'}
      </Button>

      <Dialog
        open={fallbackUrl !== null}
        onOpenChange={(open) => {
          if (!open) setFallbackUrl(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Copy portal link</DialogTitle>
            <DialogDescription>
              This link signs {firstName} straight in — only share it with them.
              It expires in 7 days.
            </DialogDescription>
          </DialogHeader>
          <Input
            ref={fallbackInputRef}
            readOnly
            value={fallbackUrl ?? ''}
            aria-label="Portal sign-in link"
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
          />
          <DialogFooter>
            <Button size="sm" onClick={copyFromFallbackInput}>
              Copy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

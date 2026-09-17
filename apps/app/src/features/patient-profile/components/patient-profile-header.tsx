import { format } from 'date-fns';
import { CalendarDays, Link2, Mail, Phone, ShieldCheck } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
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
import type { LeadProfileLead } from '../api';
import { useCopyPortalLink } from '../api/copy-portal-link';

/**
 * Identity header for the patient profile: name, contact details, portal
 * account status, "member since", and the staff "Copy portal link" action
 * (mints a 7-day magic sign-in link into the customer's portal).
 */
export function PatientProfileHeader({
  lead,
  hasPortalAccount,
}: {
  lead: LeadProfileLead;
  hasPortalAccount: boolean;
}) {
  const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(' ');

  /** When the Clipboard API is unavailable, we show the link in a tiny dialog. */
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);

  const copiedToast = () =>
    toast('Portal link copied', {
      description: `This link signs ${lead.firstName} straight in — only share it with them. It expires in 7 days.`,
    });

  const { copyPortalLink, isCopying } = useCopyPortalLink(lead.id, {
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
    <div className="rounded-xl border p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">{fullName}</h1>
            {hasPortalAccount && (
              <Badge className="border-transparent bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300">
                <ShieldCheck className="size-3" />
                Portal account
              </Badge>
            )}
          </div>
          <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            {lead.email && (
              <span className="flex items-center gap-1.5">
                <Mail className="size-4" />
                {lead.email}
              </span>
            )}
            {lead.phone && (
              <span className="flex items-center gap-1.5">
                <Phone className="size-4" />
                {lead.phone}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <CalendarDays className="size-4" />
              Member since {format(new Date(lead.createdAt), 'MMM yyyy')}
            </span>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full shrink-0 sm:w-auto"
          aria-label="Copy portal sign-in link for this customer"
          disabled={isCopying}
          onClick={() => copyPortalLink()}
        >
          <Link2 />
          {isCopying ? 'Copying…' : 'Copy portal link'}
        </Button>
      </div>

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
              This link signs {lead.firstName} straight in — only share it with
              them. It expires in 7 days.
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
    </div>
  );
}

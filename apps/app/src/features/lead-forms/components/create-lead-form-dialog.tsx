import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useListWhatsAppAccounts } from '@/features/integrations/api';
import {
  useActiveOrganization,
  useGetOrganization,
} from '@/features/organization';
import { useEffect, useMemo, useState } from 'react';
import { useCreateLeadForm } from '../api';
import {
  LeadFormBuilder,
  type LeadFormBuilderValue,
  emptyLeadFormBuilderValue,
  leadFormBuilderToInput,
} from './lead-form-builder';

interface CreateLeadFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateLeadFormDialog({
  open,
  onOpenChange,
}: CreateLeadFormDialogProps) {
  const [value, setValue] = useState<LeadFormBuilderValue>(
    emptyLeadFormBuilderValue
  );

  const { createLeadForm, isCreating } = useCreateLeadForm({
    onSuccess: () => onOpenChange(false),
  });

  const { data: activeOrg } = useActiveOrganization();
  const { organization } = useGetOrganization(activeOrg?.id ?? '');

  // A WhatsApp follow-up needs a connected, non-expired WhatsApp account.
  const { accounts: whatsappAccounts } = useListWhatsAppAccounts();
  const whatsapp = useMemo(() => {
    const valid = whatsappAccounts.find(
      (a) => a.isActive && a.tokenStatus === 'valid'
    );
    return { connected: !!valid, number: valid?.phoneNumber };
  }, [whatsappAccounts]);

  // Reset to a fresh form whenever the dialog opens, prefilling the privacy
  // policy URL from the org's setting when available.
  const orgPrivacyPolicyUrl = organization?.privacyPolicyUrl;
  useEffect(() => {
    if (open) {
      setValue({
        ...emptyLeadFormBuilderValue(),
        privacyPolicyUrl: orgPrivacyPolicyUrl ?? '',
      });
    }
  }, [open, orgPrivacyPolicyUrl]);

  const handleSubmit = () => {
    // Lead forms always sync to Meta on save.
    createLeadForm({ ...leadFormBuilderToInput(value), syncToMeta: true });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-x-hidden overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Create lead form</DialogTitle>
          <DialogDescription>
            Build the form people fill out when they click your Meta ad.
          </DialogDescription>
        </DialogHeader>

        <LeadFormBuilder
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          onCancel={() => onOpenChange(false)}
          submitLabel={isCreating ? 'Creating...' : 'Create form'}
          isSubmitting={isCreating}
          whatsapp={whatsapp}
        />
      </DialogContent>
    </Dialog>
  );
}

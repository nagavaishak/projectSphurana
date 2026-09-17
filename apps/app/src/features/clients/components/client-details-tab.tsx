import { useResolvedRoutes } from '@/lib/use-routes';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { useDeleteLead, useUpdateLead } from '@/features/leads';
import type { LeadDetail } from '@/features/leads';
// Reuse the existing lead edit fields + schema so nothing regresses from the
// old lead-management sheet. The leads feature is not part of this workstream's
// forbidden set; importing its edit fields keeps status/edit behaviour intact.
import { LeadEditFields } from '@/features/leads/components/lead-detail/lead-edit-fields';
import {
  type UpdateLeadFormValues,
  updateLeadFormSchema,
} from '@/features/leads/components/lead-detail/update-lead-schema';
import { normalizeLeadStage } from '@borradh-workspace/api-client/types';

interface ClientDetailsTabProps {
  lead: LeadDetail;
}

/**
 * Notes/details tab — ports the full edit experience from the old lead sheet:
 * all lead fields, status change, tags, consent, save, and delete. The form
 * owns its own `<form>` element (the profile is not one big form).
 */
export function ClientDetailsTab({ lead }: ClientDetailsTabProps) {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const { updateLead, isUpdating } = useUpdateLead();
  const { deleteLead, isDeleting } = useDeleteLead({
    onSuccess: () => navigate({ to: routes.customers }),
  });

  const form = useForm<UpdateLeadFormValues>({
    resolver: zodResolver(updateLeadFormSchema),
    defaultValues: toFormValues(lead),
  });

  // Re-sync when the saved data changes underneath us.
  useEffect(() => {
    form.reset(toFormValues(lead));
  }, [lead, form]);

  const onSubmit = (data: UpdateLeadFormValues) => {
    updateLead({ leadId: lead.id, input: data });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <LeadEditFields form={form} lead={lead} />

        <div className="flex items-center justify-between border-t pt-4">
          <ConfirmDeleteDialog
            confirmLabel="Delete client"
            description="This permanently removes them and all of their details. This can’t be undone."
            isPending={isDeleting}
            onConfirm={() => deleteLead(lead.id)}
            title={
              <>
                Delete {lead.firstName}
                {lead.lastName ? ` ${lead.lastName}` : ''}?
              </>
            }
            trigger={
              <Button
                className="text-destructive hover:text-destructive"
                disabled={isDeleting}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Trash2 className="size-4" />
                Delete client
              </Button>
            }
          />

          <Button type="submit" disabled={isUpdating}>
            {isUpdating ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save changes'
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function toFormValues(lead: LeadDetail): UpdateLeadFormValues {
  return {
    firstName: lead.firstName,
    lastName: lead.lastName || '',
    email: lead.email || '',
    phone: lead.phone || '',
    whatsapp: lead.whatsapp || '',
    source: lead.source,
    status: normalizeLeadStage(lead.status),
    tags: Array.isArray(lead.tags) ? lead.tags : [],
    notes: lead.notes || '',
    // `portalNote` is intentionally ABSENT — this form no longer edits the
    // published customer note, so it must not mention it on the wire either.
    // An absent key means "leave unchanged", which is what keeps a save here
    // from touching what the Notes tab published (ENG-791).
    consentEmail: lead.consentEmail ?? false,
    consentSms: lead.consentSms ?? false,
    consentVoice: lead.consentVoice ?? false,
  };
}

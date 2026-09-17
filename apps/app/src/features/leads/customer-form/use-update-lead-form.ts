'use client';

import type { Lead } from '@borradh-workspace/api-client/types';
import { normalizeLeadStage } from '@borradh-workspace/api-client/types';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';

import { useUpdateLead } from '../api';
import {
  type UpdateLeadFormValues,
  updateLeadDefaultValues,
  updateLeadFormSchema,
} from '../components/lead-detail/update-lead-schema';
import type { LeadDetail } from '../types';

/**
 * THE edit-client controller — form state, validation and submit, once.
 *
 * Lifted out of {@link LeadDetailPanel} UNCHANGED, including `toFormValues`,
 * which is the reason it moved: the docked panel and the `/edit/customer/:id`
 * editor must map a fetched lead onto the form the SAME way, and a second copy
 * of that mapping is precisely how `portalNote` came to be re-sent by a surface
 * that was not editing it (ENG-791).
 *
 * The submitted intent still goes through the one `buildUpdateLeadPayload`.
 */
export interface UseUpdateLeadFormOptions {
  /** Null while loading, or in create mode. */
  lead: LeadDetail | null;
  /** Runs after a successful save. */
  onDone?: (lead: Lead) => void;
}

export function useUpdateLeadForm({ lead, onDone }: UseUpdateLeadFormOptions) {
  const form = useForm<UpdateLeadFormValues>({
    resolver: zodResolver(updateLeadFormSchema),
    defaultValues: updateLeadDefaultValues,
  });

  const { updateLead, isUpdating } = useUpdateLead({
    onSuccess: (updated) => onDone?.(updated),
  });

  // Populate the form once the lead loads, and re-sync when the saved data
  // changes underneath us.
  useEffect(() => {
    if (lead) form.reset(toFormValues(lead));
  }, [lead, form]);

  const submit = form.handleSubmit((data) => {
    if (!lead) return;
    updateLead({ leadId: lead.id, input: data });
  });

  return { form, isUpdating, submit };
}

export function toFormValues(lead: LeadDetail): UpdateLeadFormValues {
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

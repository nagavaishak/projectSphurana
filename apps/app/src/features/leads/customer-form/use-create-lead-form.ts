'use client';

import type { Lead } from '@borradh-workspace/api-client/types';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { useCreateLead } from '../api';
import {
  type CreateLeadFormValues,
  createLeadDefaultValues,
  createLeadSchema,
} from '../components/create-lead-schema';

/**
 * THE create-client controller — form state, validation and submit, once.
 *
 * Lifted out of {@link CreateLeadDialog} UNCHANGED: the same
 * {@link createLeadSchema} resolver, the same {@link createLeadDefaultValues},
 * and the same `createLead(data)` call, which still routes the typed intent
 * through the one `buildCreateLeadPayload`. Nothing about what gets POSTed
 * moved or changed.
 *
 * Two surfaces call it and must not drift:
 *
 *  - the quick-add {@link CreateLeadDialog}, kept because it is fired from the
 *    till and the calendar, where a page navigation would lose a half-finished
 *    sale or booking;
 *  - the unified `/create/customer` editor, the Clients page's primary action.
 *
 * They differ only in what happens after a successful save (`onDone`) and in
 * how the shared field components are laid out.
 */
export interface UseCreateLeadFormOptions {
  /** Runs after a successful create. The form is reset first. */
  onDone?: (lead: Lead) => void;
}

export function useCreateLeadForm({ onDone }: UseCreateLeadFormOptions = {}) {
  const form = useForm<CreateLeadFormValues>({
    resolver: zodResolver(createLeadSchema),
    defaultValues: createLeadDefaultValues,
  });

  const { createLead, isCreating } = useCreateLead({
    onSuccess: (lead) => {
      form.reset(createLeadDefaultValues);
      onDone?.(lead);
    },
  });

  const submit = form.handleSubmit((data) => createLead(data));

  return { form, isCreating, submit };
}

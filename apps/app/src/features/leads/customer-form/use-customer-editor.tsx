'use client';

import { useResolvedRoutes } from '@/lib/use-routes';
import { useNavigate } from '@tanstack/react-router';
import { UserPlus } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import type {
  EntityFormConfig,
  EntityFormValues,
} from '@/components/app/entity-editor';
import { Form } from '@/components/ui/form';
import type { EntityEditorState } from '@/features/entity-editors/registry';

import { useLead } from '../api';
import {
  LeadConsentFields,
  LeadEmailField,
  LeadFirstNameField,
  LeadLastNameField,
  LeadNotesField,
  LeadPhoneField,
  LeadSourceField,
  LeadTagsField,
  LeadWhatsappField,
} from '../components/create-lead-form-fields';
import { LeadEditFields } from '../components/lead-detail/lead-edit-fields';
import { useCreateLeadForm } from './use-create-lead-form';
import { useUpdateLeadForm } from './use-update-lead-form';

/**
 * The customer editor — CONFIG AND STATE ONLY, no layout.
 *
 * "Add Customer" is the Clients page's PRIMARY action, so it is a page like
 * every other create surface. The dialog it replaced there is still alive for
 * the till and the calendar, where a navigation would lose a half-finished sale
 * or booking; both render {@link useCreateLeadForm} and the same field
 * components, so they cannot drift.
 *
 * Create and edit are two DECLARATIONS, not one:
 *
 *  - create renders `createLeadForm` field-by-field, so the page can lay the
 *    fields out in its own rows instead of the dialog's cramped grid;
 *  - edit renders `LeadEditFields` whole. That is the shared component behind
 *    the docked lead panel and the client-details tab, built from the separate
 *    `updateLeadForm` declaration (which adds `status` and deliberately omits
 *    `portalNote`). Splitting it here would give the PUT surfaces a second
 *    layout to drift from, which is the bug the shared component prevents.
 *
 * Both react-hook-form instances are created unconditionally — the mode is
 * fixed for the life of a mount (`/create/customer` and `/edit/customer/:id`
 * are different routes), and calling one hook conditionally is not an option.
 *
 * The shared `errors` channel is unused on purpose: react-hook-form's
 * `fieldState` renders each error next to its own control, exactly as it does
 * in the dialog and the panel.
 */
export function useCustomerEditor({ id }: { id?: string }): EntityEditorState {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const isEdit = Boolean(id);

  // Disabled when there is no id, so create mode never fetches.
  const { lead, isLoading, isError } = useLead({ leadId: id ?? '' });

  const goToList = useCallback(() => {
    void navigate({ to: routes.customers });
  }, [navigate, routes.customers]);

  const create = useCreateLeadForm({ onDone: goToList });
  const edit = useUpdateLeadForm({
    lead: isEdit ? (lead ?? null) : null,
    onDone: goToList,
  });

  const createForm = create.form;
  const editForm = edit.form;

  const createValues = createForm.watch();
  const editValues = editForm.watch();

  const setValue = useCallback(
    (name: string, value: unknown) => {
      if (isEdit) editForm.setValue(name as never, value as never);
      else createForm.setValue(name as never, value as never);
    },
    [isEdit, createForm, editForm]
  );

  const config: EntityFormConfig = useMemo(() => {
    const title = (edited: boolean) =>
      edited ? 'Edit Customer' : 'Add Customer';

    if (isEdit) {
      return {
        title,
        sections: [
          {
            id: 'details',
            label: 'Details',
            icon: UserPlus,
            blocks: [
              {
                title: 'Client Details',
                rows: [
                  [
                    {
                      kind: 'custom',
                      name: 'firstName',
                      render: () =>
                        lead ? (
                          <Form {...editForm}>
                            <LeadEditFields form={editForm} lead={lead} />
                          </Form>
                        ) : null,
                    },
                  ],
                ],
              },
            ],
          },
        ],
      };
    }

    // `Form` is react-hook-form's FormProvider, not a `<form>` element — the
    // shared editor owns the form element and the save bar. The lead fields are
    // built on shadcn's `FormField`/`FormItem`, which read that context, so each
    // block provides it.
    const withProvider = (node: React.ReactNode) => (
      <Form {...createForm}>{node}</Form>
    );

    return {
      title,
      sections: [
        {
          id: 'details',
          label: 'Details',
          icon: UserPlus,
          blocks: [
            {
              title: 'Client Details',
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'firstName',
                    render: () =>
                      withProvider(<LeadFirstNameField form={createForm} />),
                  },
                  {
                    kind: 'custom',
                    name: 'lastName',
                    render: () =>
                      withProvider(<LeadLastNameField form={createForm} />),
                  },
                ],
                [
                  {
                    kind: 'custom',
                    name: 'email',
                    render: () =>
                      withProvider(<LeadEmailField form={createForm} />),
                  },
                ],
                [
                  {
                    kind: 'custom',
                    name: 'phone',
                    render: () =>
                      withProvider(<LeadPhoneField form={createForm} />),
                  },
                  {
                    kind: 'custom',
                    name: 'whatsapp',
                    render: () =>
                      withProvider(<LeadWhatsappField form={createForm} />),
                  },
                ],
              ],
            },
            {
              title: 'Source & Tags',
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'source',
                    render: () =>
                      withProvider(<LeadSourceField form={createForm} />),
                  },
                  {
                    kind: 'custom',
                    name: 'tags',
                    render: () =>
                      withProvider(<LeadTagsField form={createForm} />),
                  },
                ],
              ],
            },
            {
              title: 'Notes',
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'notes',
                    render: () =>
                      withProvider(<LeadNotesField form={createForm} />),
                  },
                ],
              ],
            },
            {
              // No block title: the consent group renders its own heading and
              // the sentence that explains it.
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'consentEmail',
                    render: () =>
                      withProvider(<LeadConsentFields form={createForm} />),
                  },
                ],
              ],
            },
          ],
        },
      ],
    };
  }, [isEdit, createForm, editForm, lead]);

  return {
    config,
    values: (isEdit ? editValues : createValues) as unknown as EntityFormValues,
    setValue,
    isSaving: isEdit ? edit.isUpdating : create.isCreating,
    onSave: () => void (isEdit ? edit.submit() : create.submit()),
    onCancel: goToList,
    isLoading: isEdit && isLoading,
    notFound: isEdit && !isLoading && (isError || !lead),
  };
}

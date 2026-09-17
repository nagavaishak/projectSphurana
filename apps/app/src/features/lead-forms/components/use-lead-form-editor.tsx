'use client';

import { useResolvedRoutes } from '@/lib/use-routes';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  EntityFormConfig,
  EntityFormValues,
} from '@/components/app/entity-editor';
import type { EntityEditorState } from '@/features/entity-editors/registry';
import { useListWhatsAppAccounts } from '@/features/integrations/api';
import {
  useActiveOrganization,
  useGetOrganization,
} from '@/features/organization';

import { useCreateLeadForm, useUpdateLeadForm } from '../api';
import type { LeadForm } from '../api/types';
import {
  FieldsStep,
  FinishStep,
  type LeadFormBuilderErrors,
  type LeadFormBuilderValue,
  LeadNurturingSection,
  emptyLeadFormBuilderValue,
  leadFormBuilderToInput,
  leadFormToBuilderValue,
  validateLeadFormBuilder,
} from './lead-form-builder';

/**
 * The lead-form editor — CONFIG AND STATE ONLY, no layout.
 *
 * The dialog ran a three-step wizard because a 560px modal could not show the
 * question builder, the follow-up channel and the privacy/thank-you copy at
 * once. A page can, so the three steps collapse into ONE section of three
 * blocks — which also means every validation message is on screen wherever it
 * came from, instead of being hidden behind a step the user has to walk back to.
 *
 * The three step components, the validator and `leadFormBuilderToInput` are the
 * dialog's, unchanged, so what gets POSTed (and the `syncToMeta: true` that
 * always rides with it) is identical.
 */
export function useLeadFormEditor({
  leadForm,
  isEditing,
}: {
  /** Null → create mode, or edit mode still loading. */
  leadForm: LeadForm | null;
  isEditing: boolean;
}): EntityEditorState {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();

  const [value, setValue] = useState<LeadFormBuilderValue>(
    emptyLeadFormBuilderValue
  );
  const [errors, setErrors] = useState<LeadFormBuilderErrors>({});

  const goToList = useCallback(
    () => void navigate({ to: routes.marketingLeadForms }),
    [navigate, routes]
  );

  const { createLeadForm, isCreating } = useCreateLeadForm({
    onSuccess: goToList,
  });
  const { updateLeadForm, isUpdating } = useUpdateLeadForm({
    onSuccess: goToList,
  });

  const { data: activeOrg } = useActiveOrganization();
  const { organization } = useGetOrganization(activeOrg?.id ?? '');
  const orgPrivacyPolicyUrl = organization?.privacyPolicyUrl;

  // A WhatsApp follow-up needs a connected, non-expired WhatsApp account.
  const { accounts: whatsappAccounts } = useListWhatsAppAccounts();
  const whatsapp = useMemo(() => {
    const valid = whatsappAccounts.find(
      (a) => a.isActive && a.tokenStatus === 'valid'
    );
    return { connected: !!valid, number: valid?.phoneNumber };
  }, [whatsappAccounts]);

  // Hydrate once — in edit mode when the record lands, in create mode as soon
  // as the org's privacy policy URL is known (or immediately without one).
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    if (isEditing) {
      if (!leadForm) return;
      hydrated.current = true;
      setValue(leadFormToBuilderValue(leadForm));
      return;
    }
    hydrated.current = true;
    setValue({
      ...emptyLeadFormBuilderValue(),
      privacyPolicyUrl: orgPrivacyPolicyUrl ?? '',
    });
  }, [isEditing, leadForm, orgPrivacyPolicyUrl]);

  // The org setting can arrive after the create form was seeded; fill it in
  // only while the user has not typed a URL of their own.
  useEffect(() => {
    if (isEditing || !orgPrivacyPolicyUrl) return;
    setValue((current) =>
      current.privacyPolicyUrl
        ? current
        : { ...current, privacyPolicyUrl: orgPrivacyPolicyUrl }
    );
  }, [isEditing, orgPrivacyPolicyUrl]);

  const config: EntityFormConfig = useMemo(
    () => ({
      title: (isEdit) => (isEdit ? 'Edit lead form' : 'Create lead form'),
      sections: [
        {
          id: 'form',
          label: 'Form',
          blocks: [
            {
              title: 'Fields',
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'questions',
                    render: () => (
                      <FieldsStep
                        errors={errors}
                        onChange={setValue}
                        value={value}
                      />
                    ),
                  },
                ],
              ],
            },
            {
              title: 'Lead nurturing',
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'followUpChannel',
                    render: () => (
                      <LeadNurturingSection
                        channel={value.followUpChannel}
                        connectedWhatsappNumber={whatsapp.number ?? undefined}
                        onChannelChange={(followUpChannel) =>
                          setValue((c) => ({ ...c, followUpChannel }))
                        }
                        onWhatsappNumberChange={(whatsappNumber) =>
                          setValue((c) => ({ ...c, whatsappNumber }))
                        }
                        whatsappConnected={whatsapp.connected}
                        whatsappError={errors.whatsappNumber}
                        whatsappNumber={value.whatsappNumber}
                      />
                    ),
                  },
                ],
              ],
            },
            {
              title: 'Privacy & thanks',
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'privacyPolicyUrl',
                    render: () => (
                      <FinishStep
                        errors={errors}
                        onChange={setValue}
                        value={value}
                      />
                    ),
                  },
                ],
              ],
            },
          ],
        },
      ],
    }),
    [value, errors, whatsapp]
  );

  // Annotated rather than inferred: `EntityEditorState.onSave` may return the
  // id of a section to reveal, and a bare `return;` infers `void`, which is not
  // assignable to `string | undefined`. This editor has one section, so there
  // is never a section to name.
  const onSave = (): string | undefined => {
    const { firstInvalidStep, errors: allErrors } =
      validateLeadFormBuilder(value);
    if (firstInvalidStep !== -1) {
      setErrors(allErrors);
      return undefined;
    }
    setErrors({});

    // Lead forms always sync to Meta on save.
    if (isEditing && leadForm) {
      updateLeadForm({
        id: leadForm.id,
        ...leadFormBuilderToInput(value),
        syncToMeta: true,
      });
      return undefined;
    }
    createLeadForm({ ...leadFormBuilderToInput(value), syncToMeta: true });
    return undefined;
  };

  return {
    config,
    // The builder owns its own state shape; the shared field context is fed a
    // snapshot so `hidden` predicates and error lookup still work.
    values: value as unknown as EntityFormValues,
    errors,
    setValue: (name, next) =>
      setValue((current) => ({ ...current, [name]: next })),
    isSaving: isCreating || isUpdating,
    onSave,
    onCancel: goToList,
  };
}

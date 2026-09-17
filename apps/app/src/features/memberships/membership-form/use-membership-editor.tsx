'use client';

import { useResolvedRoutes } from '@/lib/use-routes';
import type {
  MembershipPlanWithServices,
  MembershipPricingType,
  MembershipValidFor,
} from '@borradh-workspace/api-client/types';
import {
  membershipValidForLabels,
  membershipValidForValues,
} from '@borradh-workspace/api-client/types';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';

import type {
  EntityFormConfig,
  EntityFormValues,
} from '@/components/app/entity-editor';
import type { EntityEditorState } from '@/features/entity-editors/registry';
import { useListServices } from '@/features/organization-services';

import {
  MembershipPriceField,
  MembershipPricingTypeField,
  MembershipServicesField,
  MembershipSessionsField,
} from './membership-form-fields';
import { membershipPlanLabels as L } from './membership-plan.form';
import {
  type MembershipFormValues,
  type MembershipSessionsMode,
  useMembershipForm,
} from './use-membership-form';

/**
 * The membership editor — CONFIG AND STATE ONLY, no layout.
 *
 * The dialog's single scrolling column becomes one section with two blocks;
 * validation, the payload and the mutations stay in `useMembershipForm`, so
 * this surface cannot drift from what the dialog sent.
 */
export function useMembershipEditor({
  plan,
}: {
  /** Null → create mode. */
  plan: MembershipPlanWithServices | null;
}): EntityEditorState {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const { services } = useListServices({ limit: 100 });

  const form = useMembershipForm({
    plan,
    onSuccess: () => navigate({ to: routes.catalogMemberships }),
  });

  const { values, patch } = form;

  const setValue = useCallback(
    (name: string, value: unknown) =>
      patch({ [name]: value } as Partial<MembershipFormValues>),
    [patch]
  );

  const config: EntityFormConfig = useMemo(
    () => ({
      title: (isEdit) => (isEdit ? 'Edit membership' : 'Add membership'),
      sections: [
        {
          id: 'details',
          label: 'Details',
          blocks: [
            {
              title: 'Membership Details',
              rows: [
                [
                  {
                    kind: 'text',
                    name: 'name',
                    label: L.name,
                    placeholder: 'e.g. Gold membership',
                  },
                ],
                [
                  {
                    kind: 'textarea',
                    name: 'description',
                    label: L.description,
                    placeholder: 'What does this membership include?',
                  },
                ],
                [
                  {
                    kind: 'custom',
                    name: 'serviceIds',
                    render: () => (
                      <MembershipServicesField
                        onToggle={form.toggleService}
                        selectedIds={values.serviceIds}
                        services={services}
                      />
                    ),
                  },
                ],
              ],
            },
            {
              title: 'Sessions and Pricing',
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'sessionsMode',
                    render: () => (
                      <MembershipSessionsField
                        mode={values.sessionsMode}
                        onModeChange={(sessionsMode: MembershipSessionsMode) =>
                          patch({ sessionsMode })
                        }
                        onSessionCountChange={(sessionCount) =>
                          patch({ sessionCount })
                        }
                        sessionCount={values.sessionCount}
                      />
                    ),
                  },
                ],
                [
                  {
                    kind: 'custom',
                    name: 'pricingType',
                    render: () => (
                      <MembershipPricingTypeField
                        onChange={(pricingType: MembershipPricingType) =>
                          patch({ pricingType })
                        }
                        pricingType={values.pricingType}
                      />
                    ),
                  },
                ],
                [
                  {
                    kind: 'select',
                    name: 'validFor',
                    label:
                      values.pricingType === 'recurring'
                        ? 'Billing period'
                        : L.validFor,
                    options: membershipValidForValues.map(
                      (value: MembershipValidFor) => ({
                        value,
                        label: membershipValidForLabels[value],
                      })
                    ),
                  },
                  {
                    kind: 'custom',
                    name: 'priceRaw',
                    render: () => (
                      <MembershipPriceField
                        currencySymbol={form.currencySymbol}
                        onChange={(priceRaw) => patch({ priceRaw })}
                        value={values.priceRaw}
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
    [form, values, patch, services]
  );

  return {
    config,
    values: values as unknown as EntityFormValues,
    setValue,
    isSaving: form.isSaving,
    onSave: () => void form.submit(),
    onCancel: () => navigate({ to: routes.catalogMemberships }),
  };
}

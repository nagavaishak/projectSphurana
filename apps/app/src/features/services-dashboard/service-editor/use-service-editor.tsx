'use client';

import { useResolvedRoutes } from '@/lib/use-routes';
import type { OrganizationService } from '@borradh-workspace/api-client/types';
import { useNavigate } from '@tanstack/react-router';
import { DoorOpen, ListTree, Users } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import type {
  EntityFormConfig,
  EntityFormValues,
} from '@/components/app/entity-editor';
import type { EntityEditorState } from '@/features/entity-editors/registry';
import { useGetStripeConnection } from '@/features/integrations/api';

import {
  ServiceDepositField,
  ServiceDurationField,
  ServicePriceFields,
  ServiceResourceRequirementsField,
  ServiceTaxCodeField,
  ServiceTeamMembersField,
  ServiceTurnaroundField,
  useServiceForm,
} from '../service-form';

/**
 * The service editor — CONFIG AND STATE ONLY, no layout.
 *
 * It declares sections, blocks and fields and returns them with the form state;
 * the shared `/create/$entity` and `/edit/$entity/$id` routes render them
 * exactly as they render every other entity. The
 * three wizard steps (desktop dialog) and three funnel steps (mobile) collapse
 * into two sections — splitting name from pricing was a dialog constraint, and
 * a page has the room.
 *
 * Rich fields that already exist — the variant editor, the conditional deposit
 * block, the practitioner picker — come in through `kind: 'custom'` rather than
 * being rebuilt as generic fields. Rewriting them is how a UI unification turns
 * into a behaviour change.
 *
 * State, validation and the API payload stay in the shared `useServiceForm`
 * controller, so this surface cannot drift from what the dialog sent.
 */
export function useServiceEditor({
  service,
  initialCategoryId,
}: {
  /** Null → create mode. */
  service: OrganizationService | null;
  initialCategoryId?: string | null;
}): EntityEditorState {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  // Deposits can only be required when Stripe Connect can actually charge.
  const { chargesEnabled } = useGetStripeConnection();

  const form = useServiceForm({
    service,
    initialCategoryId,
    onSuccess: () => navigate({ to: routes.services }),
  });

  const { values, patch, errors } = form;

  const setValue = useCallback(
    (name: string, value: unknown) => patch({ [name]: value }),
    [patch]
  );

  const config: EntityFormConfig = useMemo(
    () => ({
      title: (isEdit) => (isEdit ? 'Edit Service' : 'Create Service'),
      sections: [
        {
          id: 'details',
          label: 'Details',
          icon: ListTree,
          blocks: [
            {
              title: 'Service Details',
              rows: [
                [
                  {
                    kind: 'text',
                    name: 'name',
                    label: 'Service Name',
                    placeholder: 'Evil Rabbit',
                  },
                ],
                [
                  {
                    kind: 'textarea',
                    name: 'description',
                    label: 'Description',
                    placeholder: 'Add any additional comments',
                  },
                ],
                [
                  {
                    kind: 'select',
                    name: 'categoryId',
                    label: 'Category',
                    placeholder: 'Uncategorised',
                    options: form.categories.map((category) => ({
                      value: category.id,
                      label: category.name,
                    })),
                  },
                ],
              ],
            },
            {
              title: 'Pricing and Duration',
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'durationMinutes',
                    render: ({ errors: e }) => (
                      <ServiceDurationField
                        error={e.durationMinutes}
                        onChange={(durationMinutes) =>
                          patch({ durationMinutes })
                        }
                        value={values.durationMinutes}
                      />
                    ),
                  },
                ],
                [
                  {
                    kind: 'custom',
                    name: 'price',
                    render: () => (
                      <ServicePriceFields
                        currencySymbol={form.currencySymbol}
                        onPriceAmountChange={(priceAmount) =>
                          patch({ priceAmount })
                        }
                        onPriceTypeChange={(priceType) => patch({ priceType })}
                        priceAmount={values.priceAmount}
                        priceType={values.priceType}
                        variantEditor={{
                          variants: form.variants,
                          variantsError: form.variantsError,
                          onAddVariant: form.addVariant,
                          onVariantChange: form.changeVariant,
                          onRemoveVariant: form.removeVariant,
                          onMoveVariant: form.moveVariant,
                        }}
                      />
                    ),
                  },
                ],
                [
                  {
                    kind: 'custom',
                    name: 'taxCode',
                    render: () => (
                      <ServiceTaxCodeField
                        onChange={(taxCode) => patch({ taxCode })}
                        value={values.taxCode}
                      />
                    ),
                  },
                ],
              ],
            },
            {
              title: 'Online Booking',
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'requiresDeposit',
                    render: () => (
                      <ServiceDepositField
                        currencySymbol={form.currencySymbol}
                        depositAmount={values.depositAmount}
                        depositBasis={values.depositBasis}
                        depositPercent={values.depositPercent}
                        depositsAvailable={chargesEnabled}
                        onDepositAmountChange={(depositAmount) =>
                          patch({ depositAmount })
                        }
                        onDepositBasisChange={(depositBasis) =>
                          patch({ depositBasis })
                        }
                        onDepositPercentChange={(depositPercent) =>
                          patch({ depositPercent })
                        }
                        onRequiresDepositChange={form.setRequiresDeposit}
                        requiresDeposit={values.requiresDeposit}
                      />
                    ),
                  },
                ],
              ],
            },
          ],
        },
        {
          id: 'team',
          label: 'Team Members',
          icon: Users,
          blocks: [
            {
              title: 'Team Members',
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'practitionerIds',
                    render: () => (
                      <ServiceTeamMembersField
                        allSelected={form.allPractitionersSelected}
                        idPrefix="service-editor"
                        onToggle={form.togglePractitioner}
                        onToggleAll={form.toggleAllPractitioners}
                        practitioners={form.practitioners}
                        selectedIds={values.practitionerIds}
                      />
                    ),
                  },
                ],
              ],
            },
          ],
        },
        {
          // ROOMS & EQUIPMENT — restored.
          //
          // These two fields shipped in #917 and were rendered by
          // `services-page.tsx` via `EditServiceDialog`. This branch replaced
          // that page with the shared entity editor and the fields did not come
          // across, so nothing mounted them: `ServiceResourceRequirementsField`
          // and `ServiceTurnaroundField` had zero render sites and the dialogs
          // that held them became test-only.
          //
          // The consequence was that the whole rooms feature was INERT. With no
          // way to declare a requirement, `service_resource_requirement` stays
          // empty, `loadResourceGateContext` returns null, and the allocator
          // short-circuits — so nothing is ever assigned a room, the rooms
          // calendar can only ever show "Unassigned", utilisation is fixed at
          // 0%, and neither the online hard-block nor the staff warn-don't-block
          // can engage. You could create rooms; they could never be required.
          //
          // The state was already here — `useServiceForm` loads the groups, the
          // drafts and the handlers regardless of who renders them — so this is
          // purely the missing view.
          //
          // The section self-hides: `ServiceResourceRequirementsField` returns
          // null when the org has no categories, which is every clinic that has
          // not set a room up.
          id: 'resources',
          label: 'Rooms & equipment',
          icon: DoorOpen,
          hidden: form.resourceGroups.length === 0,
          blocks: [
            {
              title: 'Rooms & equipment',
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'resourceRequirements',
                    render: () => (
                      <ServiceResourceRequirementsField
                        drafts={form.resourceRequirements}
                        groups={form.resourceGroups}
                        idPrefix="service-editor"
                        onSelectAnyResource={form.selectAnyResource}
                        onToggleCategory={form.toggleResourceCategory}
                        onToggleResource={form.toggleResource}
                        requirementsError={form.requirementsError}
                      />
                    ),
                  },
                ],
                [
                  {
                    kind: 'custom',
                    name: 'turnaroundMinutes',
                    render: () => (
                      <ServiceTurnaroundField
                        onChange={form.setTurnaroundMinutes}
                        value={form.turnaroundMinutes}
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
    [form, values, patch, chargesEnabled]
  );

  return {
    config,
    values: values as unknown as EntityFormValues,
    errors: errors as Record<string, string | undefined>,
    setValue,
    isSaving: form.isSubmitting,
    onSave: () => void form.submit(),
    onCancel: () => navigate({ to: routes.services }),
  };
}

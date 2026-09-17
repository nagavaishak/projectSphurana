'use client';

import { useResolvedRoutes } from '@/lib/use-routes';
import { useNavigate } from '@tanstack/react-router';
import { BadgePercent, Sparkles } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import type {
  EntityFormConfig,
  EntityFormValues,
} from '@/components/app/entity-editor';
import type { EntityEditorState } from '@/features/entity-editors/registry';
import { useListLocations } from '@/features/organization-locations';
import { useListServices } from '@/features/organization-services';

import {
  OfferCodeField,
  OfferDescriptionField,
  OfferDiscountTypeField,
  OfferDiscountValueFields,
  OfferExpiryFields,
  OfferNameField,
  OfferRedemptionLimitField,
} from './offer-form-fields';
import { OfferServicesPicker } from './offer-services-picker';
import { type OfferRecord, useOfferForm } from './use-offer-form';

/**
 * The promotion editor — CONFIG AND STATE ONLY, no layout.
 *
 * TWO SECTIONS, matching the design: **Details** (what the promotion is and
 * what it takes off) and **Services** (what it applies to, and therefore
 * where). The split is not cosmetic — the service list is a full-height
 * browsable surface with its own search and sort, and sharing a scroll with
 * the discount inputs is what made it a cramped popover before.
 *
 * `locationIds` and `state` have NO control of their own. The branches come
 * from the picked services (see `offer-services-picker.tsx` for why a separate
 * branch checklist could contradict the service list), and a promotion is
 * always created ACTIVE — editing one carries its saved state through
 * untouched, so nothing here can silently reactivate a paused promotion.
 *
 * Everything else — the react-hook-form instance, the zod resolver, the
 * euro→cents / date→ISO payload builders — stays in `useOfferForm`, shared
 * with the dialog the create-video wizard still uses.
 *
 * Every field is `kind: 'custom'`: each one is a Controller-bound control that
 * already exists (a code generator, a discount-type radio that clears
 * cross-type values, two day pickers, the service picker). The shared errors
 * channel is unused on purpose — react-hook-form's `fieldState` renders each
 * error next to its own control.
 */
export function useOfferEditor({
  offer,
}: {
  /** Null → create mode. */
  offer: OfferRecord | null;
}): EntityEditorState {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const { services } = useListServices({ limit: 100 });
  const { locations } = useListLocations();

  const locationOptions = useMemo(
    () =>
      locations.map((l) => ({ id: l.id, name: l.name ?? 'Unnamed location' })),
    [locations]
  );

  const {
    form,
    isSubmitting,
    selectedDiscountType,
    visibleDiscountTypes,
    submit,
  } = useOfferForm({
    hasServicePicker: true,
    offer,
    onDone: () => navigate({ to: routes.offers }),
  });

  const values = form.watch();

  const setValue = useCallback(
    (name: string, value: unknown) =>
      form.setValue(name as keyof typeof values, value as never),
    [form]
  );

  const config: EntityFormConfig = useMemo(
    () => ({
      title: (isEdit) => (isEdit ? 'Edit Promotion' : 'Create Promotion'),
      sections: [
        {
          id: 'details',
          label: 'Details',
          icon: BadgePercent,
          blocks: [
            {
              title: 'Promotion Details',
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'name',
                    render: () => <OfferNameField control={form.control} />,
                  },
                ],
                [
                  {
                    kind: 'custom',
                    name: 'code',
                    render: () => <OfferCodeField control={form.control} />,
                  },
                ],
                [
                  {
                    kind: 'custom',
                    name: 'description',
                    render: () => (
                      <OfferDescriptionField control={form.control} />
                    ),
                  },
                ],
              ],
            },
            {
              // No block title: the discount-type control renders its own
              // heading, which is also its accessible name.
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'discountType',
                    render: () => (
                      <OfferDiscountTypeField
                        form={form}
                        visibleDiscountTypes={visibleDiscountTypes}
                      />
                    ),
                  },
                ],
                [
                  {
                    kind: 'custom',
                    name: 'discountValue',
                    render: () => (
                      <div className="flex flex-col gap-4">
                        <OfferDiscountValueFields
                          control={form.control}
                          selectedDiscountType={selectedDiscountType}
                        />
                      </div>
                    ),
                  },
                  {
                    kind: 'custom',
                    name: 'redemptionLimit',
                    render: () => (
                      <OfferRedemptionLimitField control={form.control} />
                    ),
                  },
                ],
              ],
            },
            {
              title: 'Expiry (optional)',
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'validFrom',
                    render: () => <OfferExpiryFields control={form.control} />,
                  },
                ],
              ],
            },
          ],
        },
        {
          id: 'services',
          label: 'Services',
          icon: Sparkles,
          blocks: [
            {
              title: 'Services',
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'serviceIds',
                    render: () => (
                      <OfferServicesPicker
                        control={form.control}
                        form={form}
                        locations={locationOptions}
                        services={services}
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
    [
      form,
      services,
      locationOptions,
      selectedDiscountType,
      visibleDiscountTypes,
    ]
  );

  return {
    config,
    values: values as unknown as EntityFormValues,
    setValue,
    isSaving: isSubmitting,
    // A failed save has to land on the section carrying the error. `submit`
    // reports it; everything it does not name is a zod failure in Details.
    // Bouncing an operator to Details after the "pick at least one service"
    // guard would show them a form with nothing visibly wrong with it.
    onSave: async () => (await submit()) ?? 'details',
    onCancel: () => navigate({ to: routes.offers }),
  };
}

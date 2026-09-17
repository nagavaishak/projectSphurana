'use client';

import type {
  Offer,
  OfferDiscountType,
} from '@borradh-workspace/api-client/types';
import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useForm } from 'react-hook-form';

import { type OfferFormIntent, useCreateOffer, useUpdateOffer } from '../api';
import {
  type OfferFormValues,
  offerFormDefaultValues,
  offerFormSchema,
} from '../components/offer-form-schema';

/**
 * Promotion form state, validation and payload — extracted VERBATIM from
 * `OfferFormDialog` so the dialog (still used inside the create-video wizard)
 * and the unified `/create/promotion` editor cannot drift.
 *
 * Nothing here decides layout: the two surfaces compose the same field
 * components (`offer-form-fields.tsx`) around this one controller.
 */

export type OfferRecord = Offer & {
  serviceIds?: string[];
  locationIds?: string[];
};

/** Minimal location shape needed by the picker. */
export interface OfferLocationOption {
  id: string;
  name: string;
}

// Types selectable when creating a brand-new offer. The schema still accepts
// legacy types for back-compat — they show up in the radio only when the
// operator is editing an existing legacy offer.
const NEW_DISCOUNT_TYPES: OfferDiscountType[] = ['percentage', 'fixed_amount'];

function toNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const numeric = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(numeric) ? numeric : null;
}

function centsToEuros(
  value: string | number | null | undefined
): number | null {
  const numeric = toNumber(value);
  return numeric != null ? numeric / 100 : null;
}

function parseDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function offerToForm(offer: OfferRecord): OfferFormValues {
  return {
    name: offer.name,
    description: offer.description ?? '',
    code: offer.code ?? '',
    state: (offer.state === 'expired' ? 'paused' : offer.state) as
      | 'draft'
      | 'active'
      | 'paused',
    discountType: offer.discountType,
    discountPercent: toNumber(offer.discountPercent),
    discountAmountEuros: centsToEuros(offer.discountAmountCents),
    originalPriceEuros: centsToEuros(offer.originalPriceCents),
    offerPriceEuros: centsToEuros(offer.offerPriceCents),
    buyQuantity: toNumber(offer.buyQuantity),
    getQuantity: toNumber(offer.getQuantity),
    redemptionLimit: toNumber(offer.redemptionLimit),
    validFrom: parseDate(offer.validFrom),
    validUntil: parseDate(offer.validUntil),
    serviceIds: offer.serviceIds ?? [],
    locationIds: offer.locationIds ?? [],
  };
}

/**
 * Random 8-character code from an unambiguous alphabet. Omits 0/O/1/I/L
 * to avoid confusion when the code is read out loud.
 */
export function generateCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

interface UseOfferFormOptions {
  /**
   * Whether the surface is currently live. The dialog passes its `open` flag
   * so the form re-hydrates each time it opens; the page editor leaves it true.
   */
  open?: boolean;
  /** If provided, edit mode. */
  offer?: OfferRecord | null;
  /** When set, the picker is hidden and these IDs are used verbatim. */
  lockedServiceIds?: string[];
  /** Pre-check these services when opening for create. */
  defaultServiceIds?: string[];
  /** Pre-check these locations when opening for create. */
  defaultLocationIds?: string[];
  /** Whether a service picker is rendered (drives the "pick one" guard). */
  hasServicePicker: boolean;
  onSaved?: (
    offer: Offer & { serviceIds: string[]; locationIds: string[] }
  ) => void;
  /** Called after a successful create/update — close the dialog, or navigate. */
  onDone?: () => void;
}

export function useOfferForm({
  open = true,
  offer,
  lockedServiceIds,
  defaultServiceIds,
  defaultLocationIds,
  hasServicePicker,
  onSaved,
  onDone,
}: UseOfferFormOptions) {
  const isEdit = !!offer;

  const form = useForm<OfferFormValues>({
    resolver: zodResolver(offerFormSchema),
    defaultValues: offerFormDefaultValues,
    mode: 'onSubmit',
  });

  useEffect(() => {
    if (!open) return;
    if (offer) {
      form.reset(offerToForm(offer));
    } else {
      form.reset({
        ...offerFormDefaultValues,
        serviceIds: lockedServiceIds ?? defaultServiceIds ?? [],
        locationIds: defaultLocationIds ?? [],
      });
    }
  }, [
    open,
    offer,
    lockedServiceIds,
    defaultServiceIds,
    defaultLocationIds,
    form,
  ]);

  const { createOffer, isCreating } = useCreateOffer({
    onSuccess: (created) => {
      const serviceIds = lockedServiceIds ?? form.getValues('serviceIds');
      const locationIds = form.getValues('locationIds');
      onSaved?.({ ...created, serviceIds, locationIds });
      onDone?.();
    },
  });
  const { updateOffer, isUpdating } = useUpdateOffer({
    onSuccess: (updated) => {
      onSaved?.({
        ...updated,
        serviceIds: form.getValues('serviceIds'),
        locationIds: form.getValues('locationIds'),
      });
      onDone?.();
    },
  });

  const isSubmitting = isCreating || isUpdating;
  const selectedDiscountType = form.watch('discountType');

  // Show legacy types in the radio only when editing an offer that already
  // uses one — keeps the create flow clean while preserving back-compat.
  const visibleDiscountTypes = useMemo<OfferDiscountType[]>(() => {
    if (
      isEdit &&
      offer &&
      (offer.discountType === 'fixed_price' ||
        offer.discountType === 'buy_x_get_y')
    ) {
      return ['percentage', 'fixed_amount', offer.discountType];
    }
    return NEW_DISCOUNT_TYPES;
  }, [isEdit, offer]);

  /**
   * Which SECTION the last submit failed in, for surfaces that spread the form
   * over more than one (the page editor's Details / Services split).
   *
   * A ref rather than a read of `formState.errors`: that object is a proxy that
   * only maintains the slices something has already read during render, so a
   * caller inspecting it after `await submit()` reliably sees `{}` — and
   * reveals the wrong section every time.
   */
  const failedSection = useRef<string | null>(null);

  const onSubmit = (values: OfferFormValues) => {
    const serviceIds = lockedServiceIds ?? values.serviceIds;
    if (hasServicePicker && serviceIds.length === 0) {
      form.setError('serviceIds', {
        message: 'Pick at least one service for this promotion',
      });
      failedSection.current = 'services';
      return;
    }

    // Pass typed intent (euros, Dates) — the shared builder owns euro→cents,
    // date→ISO, and the discount-type-conditional nulling.
    const intent: OfferFormIntent = {
      name: values.name,
      description: values.description ?? null,
      code: values.code ?? null,
      state: values.state,
      discountType: values.discountType as OfferDiscountType,
      discountPercent: values.discountPercent ?? null,
      discountAmountEuros: values.discountAmountEuros ?? null,
      originalPriceEuros: values.originalPriceEuros ?? null,
      offerPriceEuros: values.offerPriceEuros ?? null,
      buyQuantity: values.buyQuantity ?? null,
      getQuantity: values.getQuantity ?? null,
      redemptionLimit: values.redemptionLimit ?? null,
      validFrom: values.validFrom ?? null,
      validUntil: values.validUntil ?? null,
      serviceIds,
      locationIds: values.locationIds,
    };

    if (isEdit && offer) {
      updateOffer({ id: offer.id, ...intent });
    } else {
      createOffer(intent);
    }
  };

  const handleSubmit = form.handleSubmit(onSubmit);

  const submit = useCallback(
    async (event?: React.BaseSyntheticEvent) => {
      failedSection.current = null;
      await handleSubmit(event);
      return failedSection.current;
    },
    [handleSubmit]
  );

  return {
    form,
    isEdit,
    isSubmitting,
    selectedDiscountType,
    visibleDiscountTypes,
    /**
     * Bind to a <form onSubmit>, or call directly from a Save button. Resolves
     * to the section the submit failed in, or `null` when nothing did — a
     * zod-level failure is always in the main section, so it reports `null`.
     */
    submit,
  };
}

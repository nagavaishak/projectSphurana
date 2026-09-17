'use client';

import { useOrgCurrency } from '@/hooks/use-org-currency';
import { centsToMajorString } from '@/lib/org-currency';
import type { MembershipPlanWithServices } from '@borradh-workspace/api-client/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useCreateMembershipPlan, useUpdateMembershipPlan } from '../api';
import {
  type MembershipPlanFormValues,
  buildMembershipPlanPayload,
  membershipPlanFormDefaults,
} from './membership-plan.form';

/**
 * Membership plan form state — extracted from the old `MembershipPlanDialog`,
 * with its validation and its body moved INTACT into
 * `buildMembershipPlanPayload` so the unified editor sends exactly what the
 * dialog sent. Field layout moved; nothing about what reaches the wire did.
 */

export type MembershipSessionsMode = MembershipPlanFormValues['sessionsMode'];
export type MembershipFormValues = MembershipPlanFormValues;

export const blankMembershipForm = membershipPlanFormDefaults;

export function membershipFormFromPlan(
  plan: MembershipPlanWithServices
): MembershipFormValues {
  return {
    name: plan.name,
    description: plan.description ?? '',
    serviceIds: plan.serviceIds,
    sessionsMode: plan.sessionCount == null ? 'unlimited' : 'limited',
    sessionCount: plan.sessionCount == null ? '10' : String(plan.sessionCount),
    pricingType: plan.pricingType,
    validFor: plan.validFor,
    priceRaw: centsToMajorString(plan.priceCents),
  };
}

interface UseMembershipFormOptions {
  /** Null/undefined → create mode. */
  plan?: MembershipPlanWithServices | null;
  onSuccess?: () => void;
}

export function useMembershipForm({
  plan,
  onSuccess,
}: UseMembershipFormOptions) {
  const isEdit = !!plan;
  const { currency } = useOrgCurrency();
  const [values, setValues] = useState<MembershipFormValues>(() =>
    plan ? membershipFormFromPlan(plan) : blankMembershipForm
  );

  // Edit mode resolves its record asynchronously (the list query), so the form
  // hydrates when the plan ARRIVES, not only on mount. Keyed on the id so a
  // background refetch cannot clobber what the operator has typed.
  const planRef = useRef(plan);
  planRef.current = plan;
  const planId = plan?.id ?? null;
  //
  // `planId` is the deliberate TRIGGER, not an unused dependency. The effect
  // reads the plan through a ref precisely so it does NOT re-run on every
  // refetch — re-running would reset the form under whatever the operator has
  // typed. Removing the dep, as the rule suggests, would hydrate on mount only
  // and leave edit mode permanently blank, since the record arrives after the
  // first render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: planId is the intentional trigger; the plan itself is read via ref to avoid clobbering typed input.
  useEffect(() => {
    const current = planRef.current;
    setValues(current ? membershipFormFromPlan(current) : blankMembershipForm);
  }, [planId]);

  const { createMembershipPlanAsync, isCreating } = useCreateMembershipPlan();
  const { updateMembershipPlanAsync, isUpdating } = useUpdateMembershipPlan();
  const isSaving = isCreating || isUpdating;

  const patch = useCallback((next: Partial<MembershipFormValues>) => {
    setValues((prev) => ({ ...prev, ...next }));
  }, []);

  const toggleService = useCallback((serviceId: string) => {
    setValues((prev) => ({
      ...prev,
      serviceIds: prev.serviceIds.includes(serviceId)
        ? prev.serviceIds.filter((id) => id !== serviceId)
        : [...prev.serviceIds, serviceId],
    }));
  }, []);

  const submit = useCallback(async () => {
    let payload: ReturnType<typeof buildMembershipPlanPayload>;
    try {
      payload = buildMembershipPlanPayload(values, {
        isActive: plan?.isActive ?? true,
      });
    } catch (error) {
      // The builder's messages ARE the operator-facing ones.
      toast.error(
        error instanceof Error ? error.message : 'Check the form and try again'
      );
      return;
    }

    try {
      if (isEdit && plan) {
        await updateMembershipPlanAsync({ planId: plan.id, ...payload });
      } else {
        await createMembershipPlanAsync(payload);
      }
      onSuccess?.();
    } catch {
      // Hook already shows an error toast.
    }
  }, [
    values,
    plan,
    isEdit,
    createMembershipPlanAsync,
    updateMembershipPlanAsync,
    onSuccess,
  ]);

  return {
    isEdit,
    values,
    patch,
    toggleService,
    isSaving,
    submit,
    currencySymbol: currency.symbol,
  };
}

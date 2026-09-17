import {
  useCreateService,
  useCreateServiceVariant,
  useDeleteServiceVariant,
  useListServiceVariants,
  useListServices,
  useUpdateService,
  useUpdateServiceVariant,
} from '@/features/organization-services';
import {
  useAssignPractitionerServices,
  useListPractitioners,
} from '@/features/practitioners';
import {
  useListResourceCategories,
  useListResources,
  useServiceResourceRequirements,
  useSetServiceResourceRequirements,
} from '@/features/resources';
import { useListCategories } from '@/features/service-categories';
import { useOrgCurrency } from '@/hooks/use-org-currency';
import { centsToMajorString, parseMajorToCents } from '@/lib/org-currency';
import type { OrganizationService } from '@borradh-workspace/api-client/types';
import type { ServiceVariantResponse } from '@borradh-workspace/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { ResourceCategoryGroup } from './service-resource-fields';

import type { ServicePricePayload } from './service-form-payload';
import {
  buildCreateServicePayload,
  buildPractitionerAssignments,
  buildUpdateServicePayload,
} from './service-form-payload';
import {
  type ResourceRequirementDraft,
  type ServiceFormErrors,
  type ServiceFormValues,
  type VariantDraft,
  emptyServiceForm,
  minVariantPriceCents,
  newVariantDraft,
  requirementsToDrafts,
  sameRequirementDrafts,
  serviceToFormValues,
  turnaroundToWire,
  validateServiceForm,
  variantsToDrafts,
} from './service-form-schema';

interface UseServiceFormOptions {
  /** Null → create mode. */
  service?: OrganizationService | null;
  /** Pre-select a menu category (e.g. dialog opened from a category section). */
  initialCategoryId?: string | null;
  /** Skip hydration/reset while the surface is closed (dialogs). */
  enabled?: boolean;
  onSuccess?: () => void;
}

/** A draft is real once it has a name; blank rows are ignored on save. */
const isRealVariant = (draft: VariantDraft): boolean =>
  draft.name.trim().length > 0;

/**
 * The single controller behind every service form surface.
 *
 * Owns the form state, zod validation, the create/update payload, the
 * practitioner-assignment reconciliation AND the optional pricing-options
 * (variant) reconciliation. Surfaces (desktop dialogs, mobile funnel) only
 * decide how to lay the shared fields out.
 */
export function useServiceForm({
  service = null,
  initialCategoryId = null,
  enabled = true,
  onSuccess,
}: UseServiceFormOptions = {}) {
  const isEdit = Boolean(service);

  const { categories } = useListCategories();
  const { practitioners } = useListPractitioners();
  const { services: existingServices } = useListServices();
  const { currency } = useOrgCurrency();

  // "Remember the last deposit": the amount from the most recently updated
  // service that charges one, so turning the deposit switch on for a NEW service
  // pre-fills it — a clinic with one standard deposit types it once. Empty
  // string when no service has a deposit yet (the user sets the first).
  const rememberedDepositAmount = (() => {
    const withDeposit = existingServices
      .filter(
        (s) =>
          s.id !== service?.id &&
          s.requiresDeposit &&
          s.depositAmountCents != null
      )
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    const last = withDeposit[0];
    return last ? centsToMajorString(last.depositAmountCents ?? null) : '';
  })();

  // Existing variants (edit mode only; disabled query when no service id).
  const {
    variants: loadedVariants,
    isLoading: variantsLoading,
    isError: variantsError,
  } = useListServiceVariants(service?.id ?? '');

  // ── Rooms & equipment ─────────────────────────────────────────────────────
  // PROGRESSIVE DISCLOSURE. Every clinic starts with zero resource categories,
  // and for those `resourceGroups` is empty, the section never renders, and the
  // requirements endpoint is never called — the form behaves exactly as it did
  // before this feature existed.
  const { categories: resourceCategories } = useListResourceCategories();
  const { resources } = useListResources();

  const resourceGroups = useMemo<ResourceCategoryGroup[]>(
    () =>
      // Anything that isn't a list means we don't know what the org has set up,
      // and "unknown" resolves to HIDDEN — the safe default for a feature every
      // existing clinic is opted out of.
      (Array.isArray(resourceCategories) ? resourceCategories : [])
        .filter((category) => category.isActive)
        .map((category) => ({
          category: {
            id: category.id,
            name: category.name,
            kind: category.kind,
          },
          resources: (Array.isArray(resources) ? resources : [])
            .filter((resource) => resource.categoryId === category.id)
            .map((resource) => ({ id: resource.id, name: resource.name })),
        }))
        // A category with nothing in it can't be satisfied by any booking, so
        // offering it would only ever make the service unbookable.
        .filter((group) => group.resources.length > 0),
    [resourceCategories, resources]
  );

  // The service's saved requirements (edit mode only; disabled query when no id).
  const {
    requirements: loadedRequirements,
    isLoading: requirementsLoading,
    isError: requirementsError,
  } = useServiceResourceRequirements(service?.id ?? '');

  const [values, setValues] = useState<ServiceFormValues>(() => ({
    ...emptyServiceForm,
    categoryId: initialCategoryId ?? '',
  }));
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  const [resourceRequirements, setResourceRequirements] = useState<
    ResourceRequirementDraft[]
  >([]);
  /** Minutes the ROOM stays held after the appointment. 0 = none. */
  const [turnaroundMinutes, setTurnaroundMinutes] = useState(0);
  const [errors, setErrors] = useState<ServiceFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { createServiceAsync } = useCreateService();
  const { updateServiceAsync } = useUpdateService({ showSuccessToast: false });
  const { assignServicesAsync } = useAssignPractitionerServices();
  const { createVariantAsync } = useCreateServiceVariant();
  const { updateVariantAsync } = useUpdateServiceVariant();
  const { deleteVariantAsync } = useDeleteServiceVariant();
  const { setRequirementsAsync } = useSetServiceResourceRequirements();

  const hydratedRef = useRef<string | null>(null);
  const practitionersHydratedRef = useRef<string | null>(null);
  const variantsHydratedRef = useRef<string | null>(null);
  /** The persisted variants at hydration — the baseline for delete detection. */
  const originalVariantsRef = useRef<ServiceVariantResponse[]>([]);
  const requirementsHydratedRef = useRef<string | null>(null);
  /** The saved requirement set at hydration — the baseline for change detection. */
  const originalRequirementsRef = useRef<ResourceRequirementDraft[]>([]);
  const originalTurnaroundRef = useRef(0);
  /**
   * In CREATE mode, the id of the service this submit already created.
   *
   * The sub-resources (options, requirements, practitioners) can only be saved
   * once the service exists, so a failure there leaves a real service behind
   * with the user's selections still on screen. Remembering the id makes the
   * retry an UPDATE of that service rather than a second create — the user
   * presses Save again and nothing is lost or duplicated.
   */
  const createdServiceIdRef = useRef<string | null>(null);

  // Hydrate the scalar fields once per (surface open × service). Guarded by a
  // ref so a refetch of the services/practitioners queries can't wipe what the
  // user is typing.
  useEffect(() => {
    if (!enabled) {
      hydratedRef.current = null;
      practitionersHydratedRef.current = null;
      variantsHydratedRef.current = null;
      requirementsHydratedRef.current = null;
      createdServiceIdRef.current = null;
      return;
    }
    const key = service?.id ?? 'new';
    if (hydratedRef.current === key) return;
    hydratedRef.current = key;
    setErrors({});
    setValues(
      service
        ? serviceToFormValues(service, practitioners)
        : { ...emptyServiceForm, categoryId: initialCategoryId ?? '' }
    );
    if (!service) {
      // Create mode: no persisted variants or requirements to load.
      setVariants([]);
      originalVariantsRef.current = [];
      variantsHydratedRef.current = 'new';
      setResourceRequirements([]);
      setTurnaroundMinutes(0);
      originalRequirementsRef.current = [];
      originalTurnaroundRef.current = 0;
      requirementsHydratedRef.current = 'new';
      createdServiceIdRef.current = null;
    }
  }, [enabled, service, practitioners, initialCategoryId]);

  // The variants query resolves after the first hydration; fold the saved
  // options in once it does (edit mode only), guarded so a refetch cannot wipe
  // the user's in-progress edits.
  useEffect(() => {
    if (!enabled || !service || variantsLoading) return;
    // A failed request also leaves `variantsLoading` false with `loadedVariants`
    // defaulted to []. Hydrating from that shows a service with options as
    // having none: the reconcile then deletes nothing (the baseline is empty
    // too, so no data is lost), but the real options stay invisible and adding
    // one here creates a duplicate. Stay unhydrated instead, and leave the ref
    // unset so a later successful fetch still folds them in.
    if (variantsError) return;
    if (variantsHydratedRef.current === service.id) return;
    variantsHydratedRef.current = service.id;
    originalVariantsRef.current = loadedVariants;
    setVariants(variantsToDrafts(loadedVariants));
  }, [enabled, service, variantsLoading, variantsError, loadedVariants]);

  // Same shape as the variants hydration: fold the saved requirements in once
  // the query resolves, guarded so a refetch can't wipe in-progress edits.
  useEffect(() => {
    if (!enabled || !service || requirementsLoading) return;
    // A failed request leaves `loadedRequirements` null. Hydrating from that
    // would show a service with rules as having none — and because the save is
    // a full REPLACE, saving would then DELETE the real ones. Stay unhydrated
    // (the save is skipped too) and let a later successful fetch fold them in.
    if (requirementsError || !Array.isArray(loadedRequirements?.requirements)) {
      return;
    }
    if (requirementsHydratedRef.current === service.id) return;
    requirementsHydratedRef.current = service.id;
    const drafts = requirementsToDrafts(loadedRequirements.requirements);
    const turnaround = loadedRequirements.turnaroundMinutes ?? 0;
    originalRequirementsRef.current = drafts;
    originalTurnaroundRef.current = turnaround;
    setResourceRequirements(drafts);
    setTurnaroundMinutes(turnaround);
  }, [
    enabled,
    service,
    requirementsLoading,
    requirementsError,
    loadedRequirements,
  ]);

  // The practitioners query usually resolves after the first hydration; fold
  // the saved assignments in once it does (edit mode only).
  useEffect(() => {
    if (!enabled || !service) return;
    const key = `${service.id}:${practitioners.length}`;
    if (practitionersHydratedRef.current === key) return;
    practitionersHydratedRef.current = key;
    setValues((current) => ({
      ...current,
      practitionerIds: practitioners
        .filter((p) => p.services?.some((s) => s.serviceId === service.id))
        .map((p) => p.id),
    }));
  }, [enabled, service, practitioners]);

  const patch = useCallback((next: Partial<ServiceFormValues>) => {
    setValues((current) => ({ ...current, ...next }));
  }, []);

  // Toggling the deposit switch. Turning it ON with no amount yet seeds the
  // remembered last-used deposit (so it isn't re-typed every time); an amount
  // the user already entered is never overwritten.
  const setRequiresDeposit = useCallback(
    (requiresDeposit: boolean) => {
      setValues((current) => ({
        ...current,
        requiresDeposit,
        depositAmount:
          requiresDeposit && current.depositAmount.trim() === ''
            ? rememberedDepositAmount
            : current.depositAmount,
      }));
    },
    [rememberedDepositAmount]
  );

  // ── Variant editor handlers ────────────────────────────────────────────────
  const addVariant = useCallback(() => {
    setVariants((current) => [...current, newVariantDraft()]);
  }, []);

  const changeVariant = useCallback(
    (index: number, patchDraft: Partial<VariantDraft>) => {
      setVariants((current) =>
        current.map((v, i) => (i === index ? { ...v, ...patchDraft } : v))
      );
    },
    []
  );

  const removeVariant = useCallback((index: number) => {
    setVariants((current) => current.filter((_, i) => i !== index));
  }, []);

  const moveVariant = useCallback((index: number, direction: -1 | 1) => {
    setVariants((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  // ── Rooms & equipment handlers ────────────────────────────────────────────
  /**
   * Turn a category requirement on/off.
   *
   * Switching it ON seeds `eligibleResourceIds: []`, i.e. "ANY resource in this
   * category". An EMPTY array is the WIDEST eligibility, not the narrowest —
   * see `ResourceRequirementDraft`.
   */
  const toggleResourceCategory = useCallback((categoryId: string) => {
    setResourceRequirements((current) =>
      current.some((requirement) => requirement.categoryId === categoryId)
        ? current.filter((requirement) => requirement.categoryId !== categoryId)
        : [...current, { categoryId, eligibleResourceIds: [] }]
    );
  }, []);

  /** Narrow a category to specific resources (or widen by unticking them). */
  const toggleResource = useCallback(
    (categoryId: string, resourceId: string) => {
      setResourceRequirements((current) =>
        current.map((requirement) =>
          requirement.categoryId !== categoryId
            ? requirement
            : {
                ...requirement,
                eligibleResourceIds: requirement.eligibleResourceIds.includes(
                  resourceId
                )
                  ? requirement.eligibleResourceIds.filter(
                      (id) => id !== resourceId
                    )
                  : [...requirement.eligibleResourceIds, resourceId],
              }
        )
      );
    },
    []
  );

  /** Back to "any resource in this category" — an EMPTY eligible list. */
  const selectAnyResource = useCallback((categoryId: string) => {
    setResourceRequirements((current) =>
      current.map((requirement) =>
        requirement.categoryId === categoryId
          ? { ...requirement, eligibleResourceIds: [] }
          : requirement
      )
    );
  }, []);

  const togglePractitioner = useCallback((practitionerId: string) => {
    setValues((current) => ({
      ...current,
      practitionerIds: current.practitionerIds.includes(practitionerId)
        ? current.practitionerIds.filter((id) => id !== practitionerId)
        : [...current.practitionerIds, practitionerId],
    }));
  }, []);

  const allPractitionersSelected =
    practitioners.length > 0 &&
    practitioners.every((p) => values.practitionerIds.includes(p.id));

  const toggleAllPractitioners = useCallback(() => {
    setValues((current) => {
      const all = practitioners.map((p) => p.id);
      const isAll =
        all.length > 0 &&
        all.every((id) => current.practitionerIds.includes(id));
      return { ...current, practitionerIds: isAll ? [] : all };
    });
  }, [practitioners]);

  const reset = useCallback(() => {
    setErrors({});
    setValues({ ...emptyServiceForm, categoryId: initialCategoryId ?? '' });
    setVariants([]);
    originalVariantsRef.current = [];
    setResourceRequirements([]);
    setTurnaroundMinutes(0);
    originalRequirementsRef.current = [];
    originalTurnaroundRef.current = 0;
    createdServiceIdRef.current = null;
  }, [initialCategoryId]);

  const validation = validateServiceForm(values);

  /**
   * Reconcile the persisted variants against the current drafts: delete the
   * removed, upsert the rest with `sortOrder = array index` so the editor's
   * order becomes the saved order (no separate reorder call needed).
   */
  const reconcileVariants = useCallback(
    async (serviceId: string) => {
      const drafts = variants.filter(isRealVariant);
      const keptIds = new Set(
        drafts.filter((d) => d.id).map((d) => d.id as string)
      );

      await Promise.all(
        originalVariantsRef.current
          .filter((v) => !keptIds.has(v.id))
          .map((v) => deleteVariantAsync(v.id))
      );

      await Promise.all(
        drafts.map((draft, index) => {
          const priceCents = parseMajorToCents(draft.priceAmount);
          const durationMinutes = draft.durationMinutes ?? null;
          const name = draft.name.trim();
          return draft.id
            ? updateVariantAsync({
                id: draft.id,
                name,
                priceCents,
                durationMinutes,
                sortOrder: index,
              })
            : createVariantAsync({
                serviceId,
                name,
                priceCents,
                durationMinutes,
                sortOrder: index,
              });
        })
      );
    },
    [variants, createVariantAsync, updateVariantAsync, deleteVariantAsync]
  );

  /**
   * Persist the rooms & equipment rules. Runs AFTER the service exists, because
   * the endpoint is keyed by service id — on a create there is no id until the
   * POST has come back.
   *
   * The PUT REPLACES the whole set, so this bails out rather than writing a set
   * it isn't sure about.
   */
  const saveResourceRequirements = useCallback(
    async (serviceId: string) => {
      // The org has no rooms/equipment: the section never rendered, so there is
      // nothing to save and nothing the user could have changed.
      if (resourceGroups.length === 0) return;
      // Edit mode where the saved set never loaded: the drafts are not this
      // service's rules and a REPLACE would delete the real ones.
      if (service && requirementsHydratedRef.current !== service.id) return;

      const unchanged =
        turnaroundMinutes === originalTurnaroundRef.current &&
        sameRequirementDrafts(
          resourceRequirements,
          originalRequirementsRef.current
        );
      if (unchanged) return;

      await setRequirementsAsync({
        serviceId,
        // 0 and null both mean "no turnaround"; the wire carries null.
        turnaroundMinutes: turnaroundToWire(turnaroundMinutes),
        requirements: resourceRequirements.map((requirement) => ({
          categoryId: requirement.categoryId,
          // ── THE CRITICAL SEMANTIC ─────────────────────────────────────────
          // `eligibleResourceIds` rides through VERBATIM. An EMPTY array means
          // "ANY resource in this category qualifies" and writes zero
          // eligibility rows. It does NOT mean "no resource qualifies", and it
          // must never be "helpfully" expanded to every id in the category —
          // that would silently exclude resources added later. Inverting this
          // makes every slot for the service unbookable.
          eligibleResourceIds: requirement.eligibleResourceIds,
        })),
      });

      // Committed — a later save in the same session compares against this.
      originalRequirementsRef.current = resourceRequirements;
      originalTurnaroundRef.current = turnaroundMinutes;
    },
    [
      service,
      resourceGroups,
      resourceRequirements,
      turnaroundMinutes,
      setRequirementsAsync,
    ]
  );

  const submit = useCallback(async (): Promise<boolean> => {
    const { valid, errors: nextErrors } = validateServiceForm(values);
    setErrors(nextErrors);
    if (!valid) {
      const first =
        nextErrors.name ?? nextErrors.durationMinutes ?? nextErrors.description;
      if (first) toast.error(first);
      return false;
    }

    setIsSubmitting(true);
    try {
      // With ≥1 real variant, the service price is the "from" floor across the
      // options — computed, not the form's own type/amount.
      const realVariants = variants.filter(isRealVariant);
      const priceOverride: ServicePricePayload | undefined =
        realVariants.length > 0
          ? {
              priceType: 'from',
              priceCents: minVariantPriceCents(realVariants),
            }
          : undefined;

      // A create that already succeeded on an earlier attempt (a sub-resource
      // step failed after it) must be UPDATED, never created a second time.
      const existingId = service?.id ?? createdServiceIdRef.current;

      const serviceId = existingId
        ? (
            await updateServiceAsync(
              buildUpdateServicePayload(existingId, values, priceOverride)
            )
          ).id
        : (
            await createServiceAsync(
              buildCreateServicePayload(values, priceOverride)
            )
          ).id;

      // Remember it BEFORE the sub-resources run: if one of them throws, the
      // form stays open with the user's selections and the retry updates this
      // service instead of creating a duplicate.
      if (!service) createdServiceIdRef.current = serviceId;

      await reconcileVariants(serviceId);

      // Requirements are keyed by service id — necessarily after the create.
      await saveResourceRequirements(serviceId);

      const assignments = buildPractitionerAssignments({
        serviceId,
        practitioners,
        selectedPractitionerIds: values.practitionerIds,
      });
      await Promise.all(
        assignments.map((assignment) => assignServicesAsync(assignment))
      );

      // Create toasts from useCreateService.onSuccess; update is silenced there
      // so the toast lands after the assignments have settled.
      if (service) toast.success('Service updated');

      onSuccess?.();
      return true;
    } catch {
      // toasts already shown by the underlying hooks
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, [
    values,
    variants,
    service,
    practitioners,
    createServiceAsync,
    updateServiceAsync,
    assignServicesAsync,
    reconcileVariants,
    saveResourceRequirements,
    onSuccess,
  ]);

  return {
    values,
    setValues,
    patch,
    errors,
    isValid: validation.valid,
    isEdit,
    isSubmitting,
    submit,
    reset,
    setRequiresDeposit,
    categories,
    practitioners,
    togglePractitioner,
    toggleAllPractitioners,
    allPractitionersSelected,
    // Variant editor
    variants,
    /**
     * The saved options could not be loaded, so the editor below is NOT this
     * service's option list. Surfaces must say so — an empty editor is
     * otherwise indistinguishable from a service that has no options.
     */
    variantsError,
    addVariant,
    changeVariant,
    removeVariant,
    moveVariant,
    // Rooms & equipment. `resourceGroups` is EMPTY for an org that has set none
    // up — surfaces render the section only when it isn't, so the form looks
    // untouched for every clinic that hasn't opted in.
    resourceGroups,
    resourceRequirements,
    /**
     * The saved requirements could not be loaded, so the section below is NOT
     * this service's rule set. Surfaces must say so — and the save is skipped,
     * because the endpoint replaces the whole set.
     */
    requirementsError,
    toggleResourceCategory,
    toggleResource,
    selectAnyResource,
    turnaroundMinutes,
    setTurnaroundMinutes,
    currencySymbol: currency.symbol,
  };
}

export type ServiceFormController = ReturnType<typeof useServiceForm>;

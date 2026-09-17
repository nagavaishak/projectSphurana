import { useMobileDashboardHeaderContent } from '@/features/mobile-dashboard-header';
import type { OrganizationService } from '@/features/organization-services';
import { useResolvedRoutes } from '@/lib/use-routes';
import { cn } from '@/lib/utils';
import { useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import {
  ServiceCategoryField,
  ServiceDepositField,
  ServiceDescriptionField,
  ServiceDurationField,
  ServiceNameField,
  ServicePriceFields,
  ServiceResourceRequirementsField,
  ServiceTaxCodeField,
  ServiceTeamMembersField,
  ServiceTurnaroundField,
  useServiceForm,
} from '../service-form';

interface ServiceMobileFormPageProps {
  editingService: OrganizationService | null;
}

const STEP_COUNT = 3;

const stepHeadings = [
  'Basic Details',
  'Pricing and Duration',
  'Team Members',
] as const;

/**
 * Mobile full-screen funnel. Same 3 steps and the SAME shared fields +
 * `useServiceForm` controller as the desktop wizard — the payload it POSTs is
 * built by the shared payload builder, so the surfaces cannot drift.
 */
export function ServiceMobileFormPage({
  editingService,
}: ServiceMobileFormPageProps) {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const isEdit = Boolean(editingService);
  const [step, setStep] = useState(0);

  const handleSuccess = useCallback(() => {
    void navigate({ to: routes.services, replace: true });
  }, [navigate, routes.services]);

  const {
    values,
    patch,
    errors,
    isSubmitting,
    submit,
    categories,
    practitioners,
    togglePractitioner,
    toggleAllPractitioners,
    allPractitionersSelected,
    setRequiresDeposit,
    variants,
    variantsError,
    addVariant,
    changeVariant,
    removeVariant,
    moveVariant,
    resourceGroups,
    resourceRequirements,
    requirementsError,
    toggleResourceCategory,
    toggleResource,
    selectAnyResource,
    turnaroundMinutes,
    setTurnaroundMinutes,
    currencySymbol,
  } = useServiceForm({
    service: editingService,
    onSuccess: handleSuccess,
  });

  const handleBack = useCallback(() => {
    if (step > 0) {
      setStep((current) => current - 1);
      return;
    }
    // Pop the form route; navigating to services would push another entry and
    // leave /new in history so the list page's default back returns to /new.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
      return;
    }
    void navigate({ to: routes.services });
  }, [navigate, step, routes.services]);

  useMobileDashboardHeaderContent({
    heading: isEdit ? 'Edit Service' : 'Add Service',
    subheading: stepHeadings[step],
    showBack: true,
    centerTitle: true,
    compactTitle: true,
    hideTrailing: true,
    onBack: handleBack,
  });

  const canContinueStep0 = !errors.description && values.name.trim().length > 0;
  const canContinueStep1 = !errors.durationMinutes;

  // Mobile parity with the desktop wizard: the rooms & equipment section is
  // rendered on exactly the same condition — the org has ≥1 category with ≥1
  // resource in it. A control that only exists on desktop is a bug here.
  const hasResourceSetup = resourceGroups.length > 0;
  const isLastStep = step === STEP_COUNT - 1;

  const canAdvance =
    (step === 0 && canContinueStep0) ||
    (step === 1 && canContinueStep1) ||
    isLastStep;

  const handleContinue = async () => {
    if (step === 0 && canContinueStep0) {
      setStep(1);
      return;
    }
    if (step === 1 && canContinueStep1) {
      setStep(2);
      return;
    }
    if (isLastStep) await submit();
  };

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col')}>
      <div className="flex shrink-0 items-center justify-center gap-1.5 px-4 pb-1 pt-2">
        {Array.from({ length: STEP_COUNT }).map((_, index) => (
          <span
            key={`service-step-${index}`}
            className={cn(
              'h-1.5 rounded-full transition-all',
              index === step ? 'w-6 bg-[#0A0A0A]' : 'w-1.5 bg-[#D4D4D4]'
            )}
            aria-hidden
          />
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-2">
        <div className="flex flex-col gap-5">
          {step === 0 && (
            <>
              <ServiceNameField
                variant="mobile"
                value={values.name}
                onChange={(name) => patch({ name })}
                error={errors.name}
                autoFocus={!isEdit}
              />
              <ServiceCategoryField
                variant="mobile"
                value={values.categoryId}
                onChange={(categoryId) => patch({ categoryId })}
                categories={categories}
              />
              <ServiceDescriptionField
                variant="mobile"
                value={values.description}
                onChange={(description) => patch({ description })}
                error={errors.description}
              />
            </>
          )}

          {step === 1 && (
            <>
              {hasResourceSetup ? (
                <div className="flex flex-col gap-5">
                  <ServiceDurationField
                    variant="mobile"
                    value={values.durationMinutes}
                    onChange={(durationMinutes) => patch({ durationMinutes })}
                    error={errors.durationMinutes}
                  />
                  <ServiceTurnaroundField
                    variant="mobile"
                    value={turnaroundMinutes}
                    onChange={setTurnaroundMinutes}
                  />
                </div>
              ) : (
                <ServiceDurationField
                  variant="mobile"
                  value={values.durationMinutes}
                  onChange={(durationMinutes) => patch({ durationMinutes })}
                  error={errors.durationMinutes}
                />
              )}
              <ServicePriceFields
                variant="mobile"
                priceType={values.priceType}
                priceAmount={values.priceAmount}
                onPriceTypeChange={(priceType) => patch({ priceType })}
                onPriceAmountChange={(priceAmount) => patch({ priceAmount })}
                currencySymbol={currencySymbol}
                variantEditor={{
                  variants,
                  variantsError,
                  onAddVariant: addVariant,
                  onVariantChange: changeVariant,
                  onRemoveVariant: removeVariant,
                  onMoveVariant: moveVariant,
                }}
              />
              <ServiceTaxCodeField
                variant="mobile"
                value={values.taxCode}
                onChange={(taxCode) => patch({ taxCode })}
              />
              <ServiceDepositField
                variant="mobile"
                requiresDeposit={values.requiresDeposit}
                depositAmount={values.depositAmount}
                onRequiresDepositChange={setRequiresDeposit}
                onDepositAmountChange={(depositAmount) =>
                  patch({ depositAmount })
                }
                depositBasis={values.depositBasis}
                onDepositBasisChange={(depositBasis) => patch({ depositBasis })}
                depositPercent={values.depositPercent}
                onDepositPercentChange={(depositPercent) =>
                  patch({ depositPercent })
                }
                currencySymbol={currencySymbol}
              />
              <ServiceResourceRequirementsField
                variant="mobile"
                groups={resourceGroups}
                drafts={resourceRequirements}
                requirementsError={requirementsError}
                onToggleCategory={toggleResourceCategory}
                onToggleResource={toggleResource}
                onSelectAnyResource={selectAnyResource}
                idPrefix="mobile-service"
              />
            </>
          )}

          {step === 2 && (
            <ServiceTeamMembersField
              practitioners={practitioners}
              selectedIds={values.practitionerIds}
              onToggle={togglePractitioner}
              onToggleAll={toggleAllPractitioners}
              allSelected={allPractitionersSelected}
              idPrefix="mobile-service"
            />
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-[#EBEBEB] bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <button
          type="button"
          onClick={handleContinue}
          disabled={!canAdvance || isSubmitting}
          className={cn(
            'flex h-12 w-full items-center justify-center rounded-full text-[16px] font-semibold text-white',
            'bg-[#0A0A0A] active:scale-[0.98] disabled:opacity-50'
          )}
        >
          {isSubmitting ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : isLastStep ? (
            isEdit ? (
              'Save changes'
            ) : (
              'Add service'
            )
          ) : (
            'Continue'
          )}
        </button>
      </div>
    </div>
  );
}

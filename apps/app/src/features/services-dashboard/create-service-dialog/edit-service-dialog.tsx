import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useGetStripeConnection } from '@/features/integrations/api';
import type { OrganizationService } from '@borradh-workspace/api-client/types';
import { useState } from 'react';

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
import { StepPills } from './step-pills';

interface EditServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: OrganizationService | null;
  onSuccess?: () => void;
}

const stepTitles = [
  '1. Basic Details',
  '2. Pricing and Duration',
  '3. Team Members',
] as const;

/**
 * Desktop edit wizard. Same shared fields + `useServiceForm` controller as the
 * create dialog and the mobile funnel — only the chrome differs.
 */
export function EditServiceDialog({
  open,
  onOpenChange,
  service,
  onSuccess,
}: EditServiceDialogProps) {
  const [step, setStep] = useState(0);
  // Deposits can only be required when Stripe Connect can actually charge.
  const { chargesEnabled } = useGetStripeConnection();

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
    service,
    enabled: open,
    onSuccess: () => {
      setStep(0);
      onOpenChange(false);
      onSuccess?.();
    },
  });

  const handleOpenChange = (next: boolean) => {
    if (!next && !isSubmitting) setStep(0);
    onOpenChange(next);
  };

  const canContinueStep0 = !errors.description && values.name.trim().length > 0;
  const canContinueStep1 = !errors.durationMinutes;

  // The whole rooms & equipment feature stays invisible until the org has set
  // up at least one category with at least one resource in it.
  const hasResourceSetup = resourceGroups.length > 0;

  const isLastStep = step === 2;

  const handleContinue = async () => {
    if (step === 0) {
      if (canContinueStep0) setStep(1);
      return;
    }
    if (step === 1) {
      if (canContinueStep1) setStep(2);
      return;
    }
    await submit();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="gap-0 p-0 sm:max-w-[640px]"
      >
        <div className="flex items-center justify-center pt-5">
          <StepPills totalSteps={3} currentStep={step} />
        </div>

        <div className="flex items-start justify-between px-6 pb-2 pt-4">
          <DialogTitle className="text-xl font-semibold">
            {stepTitles[step]}
          </DialogTitle>
          <button
            type="button"
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => handleOpenChange(false)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-5 px-6 pb-2 pt-2">
          {step === 0 && (
            <>
              <ServiceNameField
                value={values.name}
                onChange={(name) => patch({ name })}
                error={errors.name}
              />
              <ServiceCategoryField
                value={values.categoryId}
                onChange={(categoryId) => patch({ categoryId })}
                categories={categories}
              />
              <ServiceDescriptionField
                value={values.description}
                onChange={(description) => patch({ description })}
                error={errors.description}
              />
            </>
          )}

          {step === 1 && (
            <>
              {hasResourceSetup ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <ServiceDurationField
                    value={values.durationMinutes}
                    onChange={(durationMinutes) => patch({ durationMinutes })}
                    error={errors.durationMinutes}
                  />
                  <ServiceTurnaroundField
                    value={turnaroundMinutes}
                    onChange={setTurnaroundMinutes}
                  />
                </div>
              ) : (
                <ServiceDurationField
                  value={values.durationMinutes}
                  onChange={(durationMinutes) => patch({ durationMinutes })}
                  error={errors.durationMinutes}
                />
              )}
              <ServicePriceFields
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
                value={values.taxCode}
                onChange={(taxCode) => patch({ taxCode })}
              />
              <ServiceDepositField
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
                depositsAvailable={chargesEnabled}
              />
              <ServiceResourceRequirementsField
                groups={resourceGroups}
                drafts={resourceRequirements}
                requirementsError={requirementsError}
                onToggleCategory={toggleResourceCategory}
                onToggleResource={toggleResource}
                onSelectAnyResource={selectAnyResource}
                idPrefix="edit-service"
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
              idPrefix="edit-service"
            />
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-5">
          {step > 0 && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStep(step - 1)}
              disabled={isSubmitting}
              className="mr-auto"
            >
              Back
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleContinue}
            disabled={
              isSubmitting ||
              (step === 0 && !canContinueStep0) ||
              (step === 1 && !canContinueStep1)
            }
            className={isLastStep ? 'bg-blue-600 hover:bg-blue-700' : ''}
          >
            {isLastStep
              ? isSubmitting
                ? 'Saving...'
                : 'Save changes'
              : 'Continue'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

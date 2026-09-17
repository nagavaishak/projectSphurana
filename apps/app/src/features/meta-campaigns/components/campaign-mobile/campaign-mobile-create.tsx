import { CreateLeadFormDialog } from '@/features/lead-forms';
import {
  FOLLOW_UP_OPTIONS,
  createCampaignFormLabels as L,
  OptimizationModeField,
  getLeadFormFieldsPreview,
  useCreateCampaignForm,
} from '@/features/meta-campaigns/components/create-campaign-form';
import { MetaErrorDialog } from '@/features/meta-campaigns/components/meta-error-dialog';
import { useMobileDashboardHeaderContent } from '@/features/mobile-dashboard-header';
import { MobileSegmentedTabs } from '@/features/mobile-ui';
import { useResolvedRoutes } from '@/lib/use-routes';
import { cn } from '@/lib/utils';
import type { MessagingDestination } from '@borradh-workspace/api-client/types';
import { useNavigate } from '@tanstack/react-router';
import { AlertCircle, ChevronRight, Loader2, MapPin, Plus } from 'lucide-react';
import { type ReactNode, useCallback, useId, useMemo, useState } from 'react';
import { Controller } from 'react-hook-form';

import { CampaignMobileCreateLeadFormSheet } from './campaign-mobile-create-lead-form-sheet';
import { CampaignMobileCreateLocationSheet } from './campaign-mobile-create-location-sheet';
import { CAMPAIGN_MOBILE_DESTINATION_TABS } from './campaign-mobile-platform-tabs';

const MOBILE_INPUT_CLASS =
  'h-[44px] w-full rounded-lg border border-[#E5E5EA] bg-white px-3 text-[15px] text-black placeholder:text-[#C7C7CC] focus:border-[#2E65F3] focus:outline-none focus:ring-1 focus:ring-[#2E65F3]';

const MOBILE_OPTION_BTN_CLASS =
  'rounded-lg border px-3 py-2 text-left text-[15px] font-medium leading-snug transition-colors';

const MOBILE_PRIMARY_BTN_CLASS =
  'flex h-[44px] w-full items-center justify-center rounded-lg bg-[#2E65F3] text-[15px] font-medium text-white active:opacity-90 disabled:opacity-60';

function MobileFormLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1.5 text-[13px] font-medium text-[#8E8E93]">{children}</p>
  );
}

interface CampaignMobileCreateProps {
  onBack?: () => void;
}

export function CampaignMobileCreate({ onBack }: CampaignMobileCreateProps) {
  const formId = useId();
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const [locationSheetOpen, setLocationSheetOpen] = useState(false);
  const [leadFormSheetOpen, setLeadFormSheetOpen] = useState(false);
  const [createLeadFormOpen, setCreateLeadFormOpen] = useState(false);

  const handleBack = useCallback(() => {
    if (onBack) {
      onBack();
      return;
    }
    void navigate({ to: routes.advertising });
  }, [navigate, onBack, routes.advertising]);

  useMobileDashboardHeaderContent({
    heading: 'Create a Campaign',
    showBack: true,
    centerTitle: true,
    compactTitle: true,
    hideTrailing: true,
    onBack: handleBack,
  });

  const {
    form,
    onSubmit,
    isExecuting,
    isMetaNotConfigured,
    currencySymbol,
    hasLocation,
    targetingLocation,
    targetingDistanceKm,
    clearLocation,
    setLocation,
    isChatbot,
    followUpType,
    destinations,
    optimizationMode,
    showOptimization,
    setOptimizationMode,
    toggleDestination,
    isDestinationDisabled,
    syncedLeadForms,
    selectedLeadForm,
    hasNoLeadForms,
    isLoadingLeadForms,
    metaError,
    showMetaErrorDialog,
    setShowMetaErrorDialog,
  } = useCreateCampaignForm();

  const destinationTabs = useMemo(
    () =>
      CAMPAIGN_MOBILE_DESTINATION_TABS.map((tab) => ({
        ...tab,
        disabled: isDestinationDisabled(tab.value as MessagingDestination),
      })),
    [isDestinationDisabled]
  );

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
        {isMetaNotConfigured ? (
          <div className="flex flex-1 items-center gap-3 px-4 py-8">
            <AlertCircle className="size-5 shrink-0 text-destructive" />
            <p className="text-[15px] text-destructive">
              Connect your Meta Ads account in Integrations before creating
              campaigns.
            </p>
          </div>
        ) : (
          <form
            id={formId}
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 [-webkit-overflow-scrolling:touch]">
              <Controller
                control={form.control}
                name="name"
                render={({ field, fieldState }) => (
                  <div>
                    <MobileFormLabel>Campaign Name</MobileFormLabel>
                    <input
                      {...field}
                      type="text"
                      aria-label={L.name}
                      placeholder="Lipo Campaign"
                      className={cn(
                        MOBILE_INPUT_CLASS,
                        fieldState.error && 'border-destructive'
                      )}
                      autoComplete="off"
                    />
                    {fieldState.error ? (
                      <p className="mt-1 text-[13px] text-destructive">
                        {fieldState.error.message}
                      </p>
                    ) : null}
                  </div>
                )}
              />

              <Controller
                control={form.control}
                name="dailyBudget"
                render={({ field, fieldState }) => (
                  <div>
                    <MobileFormLabel>Daily Budget</MobileFormLabel>
                    <div className="relative">
                      <span
                        className="pointer-events-none absolute left-3 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full bg-[#2E65F3] text-[11px] font-semibold text-white"
                        aria-hidden
                      >
                        {currencySymbol}
                      </span>
                      <input
                        {...field}
                        type="number"
                        aria-label={L.dailyBudget}
                        inputMode="decimal"
                        step="0.01"
                        min="1"
                        placeholder="0.00"
                        className={cn(
                          MOBILE_INPUT_CLASS,
                          'pl-10',
                          fieldState.error && 'border-destructive'
                        )}
                      />
                    </div>
                    {fieldState.error ? (
                      <p className="mt-1 text-[13px] text-destructive">
                        {fieldState.error.message}
                      </p>
                    ) : null}
                  </div>
                )}
              />

              <div>
                <MobileFormLabel>{L.followUpType}</MobileFormLabel>
                <div className="grid grid-cols-1 gap-2">
                  {FOLLOW_UP_OPTIONS.map((option) => {
                    const selected = followUpType === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() =>
                          form.setValue('followUpType', option.value, {
                            shouldDirty: true,
                            shouldValidate: true,
                          })
                        }
                        className={cn(
                          MOBILE_OPTION_BTN_CLASS,
                          selected
                            ? 'border-[#2E65F3] bg-[#2E65F3]/5 text-[#2E65F3]'
                            : 'border-[#E5E5EA] bg-white text-black'
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {!isChatbot ? (
                <div>
                  <MobileFormLabel>{L.leadFormId}</MobileFormLabel>
                  {hasNoLeadForms ? (
                    <button
                      type="button"
                      onClick={() => setCreateLeadFormOpen(true)}
                      className={cn(
                        MOBILE_OPTION_BTN_CLASS,
                        'flex h-[44px] w-full items-center justify-center gap-2 border-dashed text-[#2E65F3]'
                      )}
                    >
                      <Plus className="size-4" strokeWidth={2.25} />
                      Create a lead form
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setLeadFormSheetOpen(true)}
                      disabled={isLoadingLeadForms}
                      className={cn(
                        MOBILE_OPTION_BTN_CLASS,
                        'flex h-[44px] w-full items-center gap-2 active:bg-[#F2F2F7]'
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        {selectedLeadForm ? (
                          <>
                            <span className="block truncate text-[15px] text-black">
                              {selectedLeadForm.name}
                            </span>
                            <span className="block truncate text-[12px] text-[#8E8E93]">
                              {getLeadFormFieldsPreview(selectedLeadForm)}
                            </span>
                          </>
                        ) : (
                          <span className="text-[15px] text-[#C7C7CC]">
                            Select a lead form
                          </span>
                        )}
                      </span>
                      <ChevronRight
                        className="size-4 shrink-0 text-[#C7C7CC]"
                        strokeWidth={2}
                        aria-hidden
                      />
                    </button>
                  )}
                  {form.formState.errors.leadFormId ||
                  (form.formState.isSubmitted && !form.watch('leadFormId')) ? (
                    <p className="mt-1 text-[13px] text-destructive">
                      Select a lead form
                    </p>
                  ) : null}
                </div>
              ) : (
                <div>
                  <MobileFormLabel>Platforms</MobileFormLabel>
                  <MobileSegmentedTabs
                    selectedValues={destinations}
                    onToggle={(value) =>
                      toggleDestination(value as MessagingDestination)
                    }
                    tabs={destinationTabs}
                    aria-label={L.destinations}
                  />
                  {destinations.length === 0 ? (
                    <p className="mt-1.5 text-[13px] text-destructive">
                      Select at least one platform.
                    </p>
                  ) : null}
                </div>
              )}

              {/* Optimization — same chatbot-only rule as desktop's "Advanced
                  settings" (hidden for WhatsApp, which Meta forces to
                  Engagement). Rendered inline so the funnel stays one scroll. */}
              {showOptimization ? (
                <OptimizationModeField
                  layout="mobile"
                  value={optimizationMode}
                  onChange={setOptimizationMode}
                />
              ) : null}

              <div>
                <MobileFormLabel>{L.targetingLocation}</MobileFormLabel>
                <button
                  type="button"
                  aria-label={L.targetingLocation}
                  onClick={() => setLocationSheetOpen(true)}
                  className={cn(
                    MOBILE_OPTION_BTN_CLASS,
                    'flex h-[44px] w-full items-center gap-2 active:bg-[#F2F2F7]'
                  )}
                >
                  <MapPin
                    className="size-4 shrink-0 text-[#8E8E93]"
                    strokeWidth={2}
                    aria-hidden
                  />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-[15px]',
                      hasLocation ? 'text-black' : 'text-[#C7C7CC]'
                    )}
                  >
                    {hasLocation
                      ? targetingLocation
                      : 'Search for a city, town or area...'}
                  </span>
                  <ChevronRight
                    className="size-4 shrink-0 text-[#C7C7CC]"
                    strokeWidth={2}
                    aria-hidden
                  />
                </button>
                {hasLocation ? (
                  <p className="mt-1.5 text-[12px] text-[#8E8E93]">
                    {targetingDistanceKm}km radius
                  </p>
                ) : null}
                {form.formState.errors.targetingLocation ? (
                  <p className="mt-1 text-[13px] text-destructive">
                    {form.formState.errors.targetingLocation.message}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="shrink-0 border-t border-[#F2F2F7] bg-white px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
              <button
                type="submit"
                disabled={isExecuting}
                className={MOBILE_PRIMARY_BTN_CLASS}
              >
                {isExecuting ? (
                  <Loader2 className="size-5 animate-spin" aria-hidden />
                ) : (
                  'Publish Campaign'
                )}
              </button>
            </div>
          </form>
        )}
      </div>

      <CampaignMobileCreateLocationSheet
        open={locationSheetOpen}
        onOpenChange={setLocationSheetOpen}
        locationName={targetingLocation}
        distanceKm={targetingDistanceKm}
        onDistanceKmChange={(value) =>
          form.setValue('targetingDistanceKm', value, { shouldValidate: true })
        }
        onLocationSelect={setLocation}
        onClearLocation={clearLocation}
      />

      <CampaignMobileCreateLeadFormSheet
        open={leadFormSheetOpen}
        onOpenChange={setLeadFormSheetOpen}
        leadForms={syncedLeadForms}
        selectedId={form.watch('leadFormId')}
        onSelect={(id) =>
          form.setValue('leadFormId', id, { shouldValidate: true })
        }
      />

      <MetaErrorDialog
        open={showMetaErrorDialog}
        onOpenChange={setShowMetaErrorDialog}
        error={metaError}
      />
      <CreateLeadFormDialog
        open={createLeadFormOpen}
        onOpenChange={setCreateLeadFormOpen}
      />
    </>
  );
}

import { Button } from '@/components/ui/button';
import {
  MobileDashboardHeader,
  MobileDashboardHeaderProvider,
  useMobileDashboardHeaderContent,
} from '@/features/mobile-dashboard-header';
import { MOBILE_DASHBOARD_HEADER_CLEARANCE_CLASS } from '@/features/mobile-dashboard-header/mobile-dashboard-header-layout';
import { useCreateSocialPost } from '@/features/social-posts';
import { useBranchRoutes } from '@/lib/use-routes';
import { useNavigate } from '@tanstack/react-router';
import { format } from 'date-fns';
import { CalendarClock, Loader2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';

import {
  CONTENT_WIZARD_STEPS,
  type ContentWizardFormData,
  contentWizardSchema,
  defaultContentWizardValues,
} from '../-schema';
import { ContentCaptionProvider } from './content-caption-context';
import { ContentMobileDetailsStep } from './content-mobile-details-step';
import { ContentMobileMediaStep } from './content-mobile-media-step';
import { ContentMobilePagesStep } from './content-mobile-pages-step';
import { ContentMobileScheduleStep } from './content-mobile-schedule-step';

function ContentMobileWizardInner() {
  const navigate = useNavigate();
  const routes = useBranchRoutes();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const now = useMemo(() => new Date(), []);
  const form = useForm<ContentWizardFormData>({
    mode: 'onBlur',
    defaultValues: {
      ...defaultContentWizardValues,
      date: format(now, 'yyyy-MM-dd'),
      time: format(now, 'HH:mm'),
    },
  });

  const { createSocialPostAsync, isCreating } = useCreateSocialPost({
    onSuccess: () => {
      void navigate({ to: routes.socials });
    },
  });

  const steps = CONTENT_WIZARD_STEPS;
  const currentStep = steps[currentStepIndex];
  const isLastStep = currentStepIndex === steps.length - 1;

  const handleBack = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((i) => i - 1);
      return;
    }
    void navigate({ to: routes.socials });
  }, [currentStepIndex, navigate, routes]);

  useMobileDashboardHeaderContent({
    heading: 'Create Content',
    showBack: true,
    centerTitle: true,
    compactTitle: true,
    hideNotifications: true,
    hideTrailing: true,
    onBack: handleBack,
  });

  const validateCurrentStep = useCallback(async (): Promise<boolean> => {
    const values = form.getValues();
    const schema = currentStep?.schema;
    if (!schema) return false;

    const result = await schema.safeParseAsync(values);
    if (result.success) return true;

    for (const issue of result.error.issues) {
      const field = issue.path[0] as keyof ContentWizardFormData;
      if (field) form.setError(field, { message: issue.message });
    }
    return false;
  }, [currentStep, form]);

  const handleContinue = useCallback(async () => {
    const isValid = await validateCurrentStep();
    if (!isValid) return;
    if (!isLastStep) setCurrentStepIndex((i) => i + 1);
  }, [validateCurrentStep, isLastStep]);

  const handleSubmit = useCallback(async () => {
    const data = form.getValues();
    const result = contentWizardSchema.safeParse(data);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof ContentWizardFormData;
        if (field) form.setError(field, { message: issue.message });
      }
      return;
    }

    await createSocialPostAsync({
      title: data.title,
      caption: data.caption,
      mediaType: data.mediaType,
      mediaUrl: data.mediaUrl,
      thumbnailUrl: data.thumbnailUrl || undefined,
      pageIds: data.pageIds,
      schedule: { mode: 'schedule', date: data.date, time: data.time },
    });
  }, [form, createSocialPostAsync]);

  return (
    <FormProvider {...form}>
      <ContentCaptionProvider>
        <div
          className={`flex min-h-dvh flex-col bg-white ${MOBILE_DASHBOARD_HEADER_CLEARANCE_CLASS}`}
        >
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              if (!isLastStep) void handleContinue();
            }}
          >
            <div className="min-h-0 flex-1 overflow-y-auto pt-2">
              {currentStep?.id === 'select-media' ? (
                <ContentMobileMediaStep />
              ) : currentStep?.id === 'details' ? (
                <ContentMobileDetailsStep />
              ) : currentStep?.id === 'pages' ? (
                <ContentMobilePagesStep />
              ) : currentStep?.id === 'schedule' ? (
                <ContentMobileScheduleStep />
              ) : null}
            </div>

            <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#E5E5EA] bg-white px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
              {!isLastStep ? (
                <Button
                  type="submit"
                  size="lg"
                  className="h-12 w-full rounded-xl text-[17px] font-semibold"
                >
                  Continue
                </Button>
              ) : (
                <Button
                  type="button"
                  size="lg"
                  className="h-12 w-full rounded-xl text-[17px] font-semibold"
                  disabled={isCreating}
                  onClick={() => void handleSubmit()}
                >
                  {isCreating ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <CalendarClock className="mr-2 size-4" />
                  )}
                  {isCreating ? 'Scheduling…' : 'Schedule Content'}
                </Button>
              )}
            </div>
          </form>
        </div>
      </ContentCaptionProvider>
    </FormProvider>
  );
}

export function ContentMobileWizard() {
  return (
    <MobileDashboardHeaderProvider>
      <ContentMobileWizardInner />
      <MobileDashboardHeader />
    </MobileDashboardHeaderProvider>
  );
}

import {
  MobileDashboardHeader,
  MobileDashboardHeaderProvider,
  useMobileDashboardHeaderContent,
} from '@/features/mobile-dashboard-header';
import { MOBILE_DASHBOARD_HEADER_CLEARANCE_CLASS } from '@/features/mobile-dashboard-header/mobile-dashboard-header-layout';
import { GenerateGraphicDialog } from '@/features/socials/components/generate-graphic-dialog';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback, useState } from 'react';

import { ContentCreateGraphicTemplateStep } from './content-create-graphic-template-step';
import { ContentCreateTemplateStep } from './content-create-template-step';
import {
  ContentCreateTypeStep,
  type ContentType,
} from './content-create-type-step';

type WizardStep = 'type' | 'template' | 'graphic-template';

function ContentCreateMobileWizardInner() {
  const navigate = useNavigate();
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>('type');
  const [graphicOpen, setGraphicOpen] = useState(false);
  // Style pinned by the graphic-template step (null = "Surprise me").
  const [graphicTemplateSlug, setGraphicTemplateSlug] = useState<string | null>(
    null
  );

  const handleBack = useCallback(() => {
    if (step === 'template' || step === 'graphic-template') {
      setStep('type');
      return;
    }
    router.history.back();
  }, [step, router]);

  useMobileDashboardHeaderContent({
    heading: 'Create Content',
    showBack: true,
    centerTitle: true,
    compactTitle: true,
    hideNotifications: true,
    hideTrailing: true,
    onBack: handleBack,
  });

  const handleSelectType = useCallback((type: ContentType) => {
    setStep(type === 'video' ? 'template' : 'graphic-template');
  }, []);

  const handleSelectTemplate = useCallback(
    (templateId: string) => {
      void navigate({
        to: '/create-video/$templateId',
        params: { templateId },
        search: {},
      });
    },
    [navigate]
  );

  const handleSelectGraphicTemplate = useCallback(
    (templateSlug: string | null) => {
      setGraphicTemplateSlug(templateSlug);
      setGraphicOpen(true);
    },
    []
  );

  return (
    <>
      <div
        className={`flex min-h-dvh flex-col bg-white ${MOBILE_DASHBOARD_HEADER_CLEARANCE_CLASS}`}
      >
        <div className="min-h-0 flex-1 overflow-y-auto pt-2">
          {step === 'type' && (
            <ContentCreateTypeStep onSelect={handleSelectType} />
          )}
          {step === 'template' && (
            <ContentCreateTemplateStep onSelect={handleSelectTemplate} />
          )}
          {step === 'graphic-template' && (
            <ContentCreateGraphicTemplateStep
              onSelect={handleSelectGraphicTemplate}
            />
          )}
        </div>
      </div>

      <GenerateGraphicDialog
        open={graphicOpen}
        onOpenChange={setGraphicOpen}
        initialTemplateSlug={graphicTemplateSlug}
      />
    </>
  );
}

export function ContentCreateMobileWizard() {
  return (
    <MobileDashboardHeaderProvider>
      <ContentCreateMobileWizardInner />
      <MobileDashboardHeader />
    </MobileDashboardHeaderProvider>
  );
}

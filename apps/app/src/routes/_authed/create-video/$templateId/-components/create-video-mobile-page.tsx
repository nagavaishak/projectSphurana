import {
  MobileDashboardHeader,
  MobileDashboardHeaderProvider,
  useMobileDashboardHeaderContent,
} from '@/features/mobile-dashboard-header';
import { MOBILE_DASHBOARD_HEADER_CLEARANCE_CLASS } from '@/features/mobile-dashboard-header/mobile-dashboard-header-layout';
import { ROUTES } from '@/lib/route-paths';
import { useResolvedRoutes } from '@/lib/use-routes';
import { cn } from '@/lib/utils';
import { VIDEO_FORMAT_IDEAS } from '@/lib/video-format-ideas';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useRef, useState } from 'react';

import { VideoCreationForm } from './video-creation-form';

interface CreateVideoMobilePageProps {
  templateId: string;
  adsReturnContext?: { campaignId: string };
  initialAllowStockFootage?: boolean;
}

function CreateVideoMobilePageInner({
  templateId,
  adsReturnContext,
  initialAllowStockFootage,
}: CreateVideoMobilePageProps) {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const goBackRef = useRef<(() => void) | null>(null);

  const templateTitle = useMemo(() => {
    const idea = VIDEO_FORMAT_IDEAS.find((f) => f.id === templateId);
    return idea?.title ?? 'Create video';
  }, [templateId]);

  const exitWizard = useCallback(() => {
    if (adsReturnContext?.campaignId) {
      void navigate({
        to: ROUTES.adsNewVideoFormat,
        search: { campaignId: adsReturnContext.campaignId },
      });
      return;
    }
    void navigate({ to: routes.contentGallery });
  }, [navigate, adsReturnContext?.campaignId, routes.contentGallery]);

  const handleBack = useCallback(() => {
    if (currentStepIndex > 0 && goBackRef.current) {
      goBackRef.current();
      return;
    }
    exitWizard();
  }, [currentStepIndex, exitWizard]);

  const registerGoBack = useCallback((goBack: (() => void) | null) => {
    goBackRef.current = goBack;
  }, []);

  useMobileDashboardHeaderContent({
    heading: templateTitle,
    showBack: true,
    centerTitle: true,
    compactTitle: true,
    hideNotifications: true,
    hideTrailing: true,
    onBack: handleBack,
  });

  return (
    <div
      className={cn(
        'flex min-h-dvh flex-col bg-white',
        MOBILE_DASHBOARD_HEADER_CLEARANCE_CLASS
      )}
    >
      <div className="min-h-0 flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]">
        <VideoCreationForm
          layout="mobile"
          adsReturnContext={adsReturnContext}
          initialAllowStockFootage={initialAllowStockFootage}
          onMobileStepIndexChange={setCurrentStepIndex}
          registerGoBack={registerGoBack}
        />
      </div>
    </div>
  );
}

export function CreateVideoMobilePage({
  templateId,
  adsReturnContext,
  initialAllowStockFootage,
}: CreateVideoMobilePageProps) {
  return (
    <MobileDashboardHeaderProvider>
      <CreateVideoMobilePageInner
        templateId={templateId}
        adsReturnContext={adsReturnContext}
        initialAllowStockFootage={initialAllowStockFootage}
      />
      <MobileDashboardHeader />
    </MobileDashboardHeaderProvider>
  );
}

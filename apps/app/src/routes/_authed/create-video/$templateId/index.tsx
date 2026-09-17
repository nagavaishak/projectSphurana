import { createFileRoute } from '@tanstack/react-router';
import { AudioLinesIcon } from 'lucide-react';
import { useState } from 'react';

import { Logo } from '@/components/global/logo';
import { useIsMobile } from '@/hooks/use-mobile';
import { createVideoSearchSchema } from '../../ads/new/-components/ad-new-search';
import { CreateVideoMobilePage } from './-components/create-video-mobile-page';
import {
  CustomiseQRPreview,
  UploadTalkingHeadQRPreview,
} from './-components/preview-panes';
import { VideoCreationForm } from './-components/video-creation-form';
import { VideoCreationProvider, useVideoCreation } from './-context';

export const Route = createFileRoute('/_authed/create-video/$templateId/')({
  component: CreateVideoPage,
  validateSearch: createVideoSearchSchema,
});

function AiVoicePreviewPane() {
  return (
    <div className="flex max-w-sm flex-col items-center justify-center gap-6 text-center">
      <div className="rounded-full bg-primary/10 p-6">
        <AudioLinesIcon className="h-12 w-12 text-primary" />
      </div>
      <div>
        <h3 className="text-lg font-semibold">AI Voiceover</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Your script will be read by the AI voice you selected. Edit the script
          on the left to match what you want said.
        </p>
      </div>
    </div>
  );
}

function CreateVideoPageContent({
  adsReturnContext,
  initialAllowStockFootage,
}: {
  adsReturnContext?: { campaignId: string };
  initialAllowStockFootage?: boolean;
}) {
  const [currentStepId, setCurrentStepId] = useState('service');
  const { narrationMode } = useVideoCreation();

  const handleStepChange = (_stepIndex: number, stepId: string) => {
    setCurrentStepId(stepId);
  };

  const getPreviewPane = () => {
    if (currentStepId.startsWith('media-')) {
      return null;
    }
    if (currentStepId === 'script') {
      return narrationMode === 'ai_voiceover' ? (
        <AiVoicePreviewPane />
      ) : (
        <UploadTalkingHeadQRPreview />
      );
    }
    if (currentStepId === 'customization') {
      return <CustomiseQRPreview />;
    }
    return null;
  };

  return (
    <div
      className="grid min-h-svh"
      data-claire-target={
        currentStepId === 'service'
          ? 'create-video-service-full-step'
          : currentStepId === 'script'
            ? 'create-video-script-full-step'
            : undefined
      }
      style={{ gridTemplateColumns: '800px 1fr' }}
    >
      <div className="flex w-full flex-col gap-4 px-8">
        <div className="flex w-full py-8">
          <Logo />
        </div>
        <div className="flex flex-1 justify-center">
          <div className="w-full">
            <VideoCreationForm
              onStepChange={handleStepChange}
              adsReturnContext={adsReturnContext}
              initialAllowStockFootage={initialAllowStockFootage}
            />
          </div>
        </div>
      </div>
      <div className="relative hidden w-full items-center justify-center bg-muted px-10 pb-20 lg:flex">
        {getPreviewPane()}
      </div>
    </div>
  );
}

function CreateVideoPage() {
  const { templateId } = Route.useParams();
  const { source, campaignId, allowStockFootage } = Route.useSearch();
  const isMobile = useIsMobile();
  const adsReturnContext =
    source === 'ads' && campaignId ? { campaignId } : undefined;

  return (
    <>
      <title>Create Video | Borradh</title>
      <VideoCreationProvider templateId={templateId}>
        {isMobile ? (
          <CreateVideoMobilePage
            templateId={templateId}
            adsReturnContext={adsReturnContext}
            initialAllowStockFootage={allowStockFootage}
          />
        ) : (
          <CreateVideoPageContent
            adsReturnContext={adsReturnContext}
            initialAllowStockFootage={allowStockFootage}
          />
        )}
      </VideoCreationProvider>
    </>
  );
}

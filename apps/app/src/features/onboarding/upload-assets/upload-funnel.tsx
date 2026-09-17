import {
  MultiStepForm,
  type StepConfig,
} from '@/components/ui/multi-step-form';
import { useResolvedRoutes } from '@/lib/use-routes';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';

import { z } from 'zod';
import { StepReviewBroll } from './steps/step-review-broll';
import { StepReviewTalkingHead } from './steps/step-review-talking-head';
import { StepUpload } from './steps/step-upload';
import { UploadProvider, useUploadContext } from './upload-context';

// All steps use passthrough schemas - state lives in UploadContext, not form
const passthroughSchema = z.object({});

type FormData = z.infer<typeof passthroughSchema>;

// All review steps are always shown — each handles its own empty state
const steps: StepConfig<FormData>[] = [
  {
    id: 'upload',
    schema: passthroughSchema,
    component: () => <StepUpload />,
    continueButtonText: 'Continue to Review',
    processingButtonText: 'Uploading...',
  },
  {
    id: 'review-supplementary',
    schema: passthroughSchema,
    component: () => <StepReviewBroll />,
    continueButtonText: 'Continue',
  },
  {
    id: 'review-talking-head',
    schema: passthroughSchema,
    component: () => <StepReviewTalkingHead />,
    continueButtonText: 'Continue',
  },
  // The 'before-after' step is REMOVED — the before/after video format is
  // retired (see RETIRED_TEMPLATE_IDS in the features package). Asking owners
  // to pair before/after media during onboarding implied we could publish it
  // honestly; we can't confirm two photos are the same client and treatment,
  // so we no longer collect the pairing or generate the format.
];

function UploadFunnelInner() {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const { isAllUploadsComplete, totalCount } = useUploadContext();
  const [currentStep, setCurrentStep] = useState(0);

  const handleStepChange = useCallback((stepIndex: number) => {
    setCurrentStep(stepIndex);
  }, []);

  // Only gate step 0 (Upload) — at least one asset, and every file finished
  // UPLOADING. AI tagging is deliberately NOT part of this gate: it runs in the
  // background now, so waiting on it here would hold the user on this step for
  // as long as the analysis queue is deep. Untagged assets still appear in the
  // review steps (under "Other Assets") and reclassify themselves live as
  // tagging lands.
  const canContinue =
    currentStep === 0 ? isAllUploadsComplete && totalCount > 0 : true;

  const handleSubmit = async () => {
    navigate({ to: routes.content });
  };

  return (
    <MultiStepForm
      steps={steps}
      defaultValues={{}}
      fullSchema={passthroughSchema}
      onSubmit={handleSubmit}
      submitButtonText="Complete"
      canContinue={canContinue}
      onStepChange={handleStepChange}
      onClose={() => navigate({ to: routes.content })}
      contentClassName="max-w-[720px]"
    />
  );
}

export function UploadFunnel() {
  return (
    <UploadProvider>
      <UploadFunnelInner />
    </UploadProvider>
  );
}

import { createFileRoute } from '@tanstack/react-router';

import { StepConfigure } from './-components/step-configure';
import { StepReviewMedia } from './-components/step-review-media';
import { StepSelectClient } from './-components/step-select-client';
import { WizardProvider, useWizard } from './-components/wizard-context';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/videos/create-from-client/'
)({
  component: CreateFromClientPage,
});

function WizardContent() {
  const { step } = useWizard();

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-8">
      {step === 'select-client' && <StepSelectClient />}
      {step === 'review-media' && <StepReviewMedia />}
      {step === 'configure' && <StepConfigure />}
    </div>
  );
}

function CreateFromClientPage() {
  return (
    <WizardProvider>
      <WizardContent />
    </WizardProvider>
  );
}

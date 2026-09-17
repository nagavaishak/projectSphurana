import { createFileRoute } from '@tanstack/react-router';

import { OnboardingForm } from '@/features/onboarding/onboarding/onboarding-form';

export const Route = createFileRoute('/_onboarding/onboarding')({
  component: OnboardingPage,
});

function OnboardingPage() {
  return (
    <>
      <title>Onboarding | Borradh</title>
      <OnboardingForm />
    </>
  );
}

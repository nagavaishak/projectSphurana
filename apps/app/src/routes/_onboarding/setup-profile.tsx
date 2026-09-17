import { createFileRoute } from '@tanstack/react-router';

import { SetupProfileForm } from '@/features/onboarding/setup-profile/setup-profile-form';

export const Route = createFileRoute('/_onboarding/setup-profile')({
  component: SetupProfilePage,
});

function SetupProfilePage() {
  return (
    <>
      <title>Set Up Your Profile | Borradh</title>
      <SetupProfileForm />
    </>
  );
}

import { useResolvedRoutes } from '@/lib/use-routes';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Suspense, useState } from 'react';

import { Logo } from '@/components/global/logo';
import { useListLocations } from '@/features/organization-locations';
import { useIsMobile } from '@/hooks/use-mobile';

import { AdMobileWizard } from './-components/ad-mobile';
import { newAdSearchSchema } from './-components/ad-new-search';
import { AdWizardForm } from './-components/ad-wizard-form';
import { AdPreview } from './-components/preview-panes';
import { AdWizardProvider } from './-context';

export const Route = createFileRoute('/_authed/ads/new/')({
  component: CreateAdPage,
  validateSearch: newAdSearchSchema,
});

/**
 * Side-effect component: warms the locations list on /ads/new so the
 * offer-form-dialog has it ready by the time the owner opens it. No-op return.
 */
function PrefetchAdWizardData() {
  useListLocations();
  return null;
}

function AdWizardContent({ campaignId }: { campaignId?: string }) {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const [currentStepId, setCurrentStepId] = useState(() =>
    campaignId ? 'details' : 'campaign'
  );

  const handleStepChange = (_stepIndex: number, stepId: string) => {
    setCurrentStepId(stepId);
  };

  const showPreview = currentStepId === 'customize';

  return (
    <div
      className="grid min-h-svh"
      style={{ gridTemplateColumns: showPreview ? '800px 1fr' : '1fr' }}
    >
      <div className="flex w-full flex-col gap-4 px-8">
        <div className="flex w-full py-8">
          <Logo />
        </div>
        <div className="flex flex-1 justify-center">
          <div className="w-full max-w-[800px]">
            <AdWizardForm
              preselectedCampaignId={campaignId}
              onStepChange={handleStepChange}
              onClose={() => void navigate({ to: routes.advertising })}
            />
          </div>
        </div>
      </div>
      {showPreview ? (
        <div className="relative hidden w-full items-center justify-center bg-muted px-10 pb-20 lg:flex">
          <AdPreview />
        </div>
      ) : null}
    </div>
  );
}

function CreateAdPage() {
  const { campaignId } = Route.useSearch();
  const isMobile = useIsMobile();

  if (isMobile) {
    // Campaign is now chosen inside the mobile wizard (matching the web flow),
    // so we no longer require `?campaignId` to enter. A URL campaignId still
    // pre-selects that campaign and skips the in-wizard campaign step.
    return (
      <>
        <title>Create Ad | Borradh</title>
        <AdWizardProvider>
          <Suspense
            fallback={
              <div className="flex min-h-dvh items-center justify-center bg-white">
                Loading…
              </div>
            }
          >
            <AdMobileWizard campaignId={campaignId} />
          </Suspense>
        </AdWizardProvider>
      </>
    );
  }

  return (
    <>
      <title>Create Ad | Borradh</title>
      <AdWizardProvider>
        <PrefetchAdWizardData />
        <Suspense
          fallback={
            <div className="flex min-h-svh items-center justify-center">
              Loading...
            </div>
          }
        >
          <AdWizardContent campaignId={campaignId} />
        </Suspense>
      </AdWizardProvider>
    </>
  );
}

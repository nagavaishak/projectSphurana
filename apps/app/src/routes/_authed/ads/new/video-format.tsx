import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

import { useIsMobile } from '@/hooks/use-mobile';
import { ROUTES } from '@/lib/route-paths';

import { AdMobileVideoFormatPage } from './-components/ad-mobile/ad-mobile-video-format-page';
import { adNewVideoFormatSearchSchema } from './-components/ad-new-search';

export const Route = createFileRoute('/_authed/ads/new/video-format')({
  component: AdNewVideoFormatRoutePage,
  validateSearch: adNewVideoFormatSearchSchema,
});

function AdNewVideoFormatRoutePage() {
  const { campaignId } = Route.useSearch();
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isMobile) {
      void navigate({
        to: ROUTES.adsNew,
        search: { campaignId },
        replace: true,
      });
    }
  }, [isMobile, campaignId, navigate]);

  if (!isMobile) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-white text-[15px] text-[#8E8E93]">
        Redirecting…
      </div>
    );
  }

  return (
    <>
      <title>New video | Borradh</title>
      <AdMobileVideoFormatPage campaignId={campaignId} />
    </>
  );
}

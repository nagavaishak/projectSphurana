import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { Logo } from '@/components/global/logo';

import { MetaAdsSetupForm } from './-components/meta-ads-setup-form';

const metaAdsSearchSchema = z.object({
  returnTo: z.string().optional(),
});

export const Route = createFileRoute('/_authed/connect/meta-ads/')({
  component: MetaAdsSetupPage,
  validateSearch: metaAdsSearchSchema,
});

function MetaAdsSetupPage() {
  const { returnTo } = Route.useSearch();

  return (
    <>
      <title>Connect Meta Ads | Borradh</title>
      <div className="flex min-h-svh flex-col items-center px-6 md:px-10">
        <div className="flex w-full gap-2">
          <Logo />
        </div>
        <div className="flex w-full max-w-xl flex-1 items-center pb-16">
          <div className="w-full">
            <MetaAdsSetupForm returnTo={returnTo} />
          </div>
        </div>
      </div>
    </>
  );
}

import { createFileRoute } from '@tanstack/react-router';

import { UploadFunnel } from '@/features/onboarding/upload-assets/upload-funnel';

export const Route = createFileRoute('/_onboarding/upload-assets')({
  component: UploadAssetsPage,
});

function UploadAssetsPage() {
  return (
    <>
      <title>Upload Assets | Borradh</title>
      <UploadFunnel />
    </>
  );
}

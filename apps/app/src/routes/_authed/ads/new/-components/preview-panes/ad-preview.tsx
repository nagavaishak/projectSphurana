import { useListMetaAdsPages } from '@/features/integrations';
import { FacebookPostPreview } from '@/features/social-posts';
import { useAdWizard } from '../../-context';

export function AdPreview() {
  const { previewData, selectedVideo } = useAdWizard();
  const { pages } = useListMetaAdsPages();

  const facebookPage = pages.find(
    (p) => p.platform === 'facebook' && p.isActive
  );

  const imageUrl = selectedVideo?.thumbnailUrl ?? selectedVideo?.blobUrl ?? '';

  return (
    <div className="w-full max-w-sm">
      <FacebookPostPreview
        imageUrl={imageUrl}
        caption={previewData.primaryText || ''}
        profileImageUrl={facebookPage?.pagePictureUrl ?? undefined}
        profileName={facebookPage?.pageName ?? 'Your Business'}
      />
      <p className="text-center text-sm text-muted-foreground mt-4">
        Facebook Ad Preview
      </p>
    </div>
  );
}

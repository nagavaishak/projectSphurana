import { cn } from '@/lib/utils';
import type { SocialPostPlatform } from '@borradh-workspace/api-client/types';
import { FacebookPostPreview } from './facebook-post-preview';
import { InstagramPostPreview } from './instagram-post-preview';

interface SocialPostPreviewProps {
  platform: SocialPostPlatform;
  imageUrl: string;
  caption?: string;
  profileImageUrl?: string;
  profileName?: string;
  className?: string;
}

const previewComponents: Record<
  SocialPostPlatform,
  typeof InstagramPostPreview | typeof FacebookPostPreview
> = {
  instagram: InstagramPostPreview,
  facebook: FacebookPostPreview,
};

export function SocialPostPreview({
  platform,
  className,
  ...props
}: SocialPostPreviewProps) {
  const PreviewComponent = previewComponents[platform];

  return <PreviewComponent className={cn(className)} {...props} />;
}

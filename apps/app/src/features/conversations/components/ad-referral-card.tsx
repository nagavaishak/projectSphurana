import type { Conversation } from '@/features/conversations/api';
import { cn } from '@/lib/utils';
import { Megaphone, Play } from 'lucide-react';

/**
 * Pinned card at the top of a conversation thread showing the Click-to-Messenger
 * ad the lead came from. Renders the durable creative (our CDN, resolved
 * server-side) — image or video poster — with the ad's headline, truncated.
 *
 * Only shown when the conversation carries ad-referral metadata.
 */
export function AdReferralCard({
  metadata,
}: {
  metadata: Conversation['metadata'];
}) {
  const adTitle = metadata?.adTitle;
  const adPhotoUrl = metadata?.adPhotoUrl;
  const adVideoUrl = metadata?.adVideoUrl;

  // Nothing to show unless we have at least a creative or a title.
  if (!adPhotoUrl && !adVideoUrl && !adTitle) return null;

  const hasVideo = !!adVideoUrl;
  // A video poster (adPhotoUrl) is preferred; fall back to the video itself.
  const imageSrc = adPhotoUrl;

  return (
    <div className="mx-auto w-full max-w-md rounded-lg border bg-muted/40 p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Megaphone className="size-3.5" />
        Started from this ad
      </div>
      <div className="flex gap-2.5">
        {hasVideo && !imageSrc ? (
          <video
            src={adVideoUrl}
            className="size-14 shrink-0 rounded-md object-cover"
            muted
            playsInline
            preload="metadata"
          />
        ) : imageSrc ? (
          <div className="relative size-14 shrink-0">
            <img
              src={imageSrc}
              alt={adTitle ?? 'Ad creative'}
              className="size-14 rounded-md object-cover"
            />
            {hasVideo ? (
              <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/30">
                <Play className="size-5 fill-white text-white" />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted">
            <Megaphone className="size-5 text-muted-foreground" />
          </div>
        )}
        {adTitle ? (
          <p
            className={cn(
              'min-w-0 flex-1 self-center text-sm text-foreground',
              'line-clamp-2'
            )}
          >
            {adTitle}
          </p>
        ) : null}
      </div>
    </div>
  );
}

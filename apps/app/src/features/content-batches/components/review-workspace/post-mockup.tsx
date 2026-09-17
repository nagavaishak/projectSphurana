import { FacebookIcon, InstagramIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

import type { MetaAdsPage } from '@/features/integrations';

import { acceptBatchItemForm } from '../../api/accept-batch-item';
import type { ContentItemWithAsset } from '../../types';
import { ItemPreview } from './item-preview';

/** Labels come from the form declaration — the contract locates by these strings. */
const L = acceptBatchItemForm.labels;

const CAPTION_INPUT_ID = 'batch-caption';

/** Initials for the avatar fallback, from a page name or handle. */
function initials(name: string): string {
  const [first = '', second = ''] = name.trim().split(/\s+/).filter(Boolean);
  if (!first) return '?';
  if (!second) return first.slice(0, 2).toUpperCase();
  return `${first.slice(0, 1)}${second.slice(0, 1)}`.toUpperCase();
}

interface PostMockupProps {
  item: ContentItemWithAsset;
  caption: string;
  onCaptionChange: (value: string) => void;
  /** The pages this post is going to; the first one supplies the identity. */
  pages: MetaAdsPage[];
  selectedPageIds: string[];
  disabled?: boolean;
}

/**
 * The post as it will look, with the caption editable in place.
 *
 * Showing the copy inside the post rather than in a form field below it is the
 * point: a caption reads differently under an image than it does in a textarea,
 * and length in particular — where Instagram truncates, whether the hook
 * survives the fold — is invisible until you see it laid out. So the caption IS
 * the post body, and typing edits it there.
 *
 * Not built on `InstagramPostPreview` / `FacebookPostPreview` in
 * features/social-posts: those render into an SVG mockup, which fixes the
 * caption as drawn text (uneditable) and takes an `imageUrl`, so a video could
 * only appear as a still. Both are exactly what this surface needs to avoid.
 * They remain the right choice for a read-only preview of a finished post.
 */
export function PostMockup({
  item,
  caption,
  onCaptionChange,
  pages,
  selectedPageIds,
  disabled,
}: PostMockupProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow to fit. A fixed-height box with an inner scrollbar would defeat the
  // reason the caption is in the post at all — you could not see its length.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure on value change
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, [caption]);

  const page =
    pages.find((p) => selectedPageIds.includes(p.id)) ?? pages[0] ?? null;
  const handle = page?.pageUsername ?? page?.pageName ?? 'Your page';
  const PlatformIcon =
    page?.platform === 'instagram' ? InstagramIcon : FacebookIcon;

  return (
    // `w-fit` so the card hugs the media once its height is bounded. A
    // fixed-width card would have to letterbox or crop a portrait video to fill
    // itself; narrowing the card instead keeps the whole frame visible, which is
    // the point of a review screen.
    <article className="mx-auto w-fit max-w-full overflow-hidden rounded-xl border bg-card">
      <header className="flex items-center gap-2.5 px-3 py-2.5">
        <Avatar className="size-8">
          {page?.pagePictureUrl ? (
            <AvatarImage src={page.pagePictureUrl} alt="" />
          ) : null}
          <AvatarFallback className="text-[11px] font-medium">
            {initials(handle)}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {handle}
        </span>
        <PlatformIcon
          aria-hidden
          className={cn(
            'size-4 shrink-0',
            page?.platform === 'instagram' ? 'text-pink-600' : 'text-blue-600'
          )}
        />
      </header>

      <ItemPreview item={item} />

      <div className="px-3 pb-3 pt-2.5">
        <Label htmlFor={CAPTION_INPUT_ID} className="sr-only">
          {L.caption}
        </Label>
        {/* A single textarea, styled as post text — no separate display copy.
            An overlay mirror would let hashtags be tinted, but it has to track
            the input's metrics exactly, and any drift shows as doubled text.
            Not worth it for colour on three words. */}
        <textarea
          ref={textareaRef}
          id={CAPTION_INPUT_ID}
          value={caption}
          onChange={(e) => onCaptionChange(e.target.value)}
          disabled={disabled}
          rows={1}
          placeholder="Write a caption for this post…"
          className={cn(
            'w-full resize-none overflow-hidden bg-transparent text-sm leading-relaxed',
            'outline-none placeholder:text-muted-foreground',
            'focus-visible:ring-0',
            disabled && 'cursor-not-allowed opacity-70'
          )}
        />
      </div>
    </article>
  );
}

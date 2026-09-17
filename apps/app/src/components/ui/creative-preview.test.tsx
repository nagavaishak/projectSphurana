import { renderWithProviders, screen, waitFor } from '@/test/render';
import { fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CreativePreview } from './creative-preview';

/**
 * These pin the three things that were actually broken in production, each
 * measured against real creatives sampled from prod (see
 * `scripts/sample-ad-creatives.ts`):
 *
 *  1. The preview renders inside a SCROLLING FLEX COLUMN (the ad side panel).
 *     Without `shrink-0` a flex item's aspect-ratio height is shrinkable, and a
 *     4:5 graphic was squashed from 386x477 into a 386x397 landscape box while
 *     a 9:16 video lost 42% of its frame to grey bars.
 *  2. The frame takes the creative's real aspect ratio, so nothing crops or
 *     letterboxes — the old card used a fixed 16:9 box with `object-cover`.
 *  3. Meta's `thumbnail_url` is always 64x64, and blowing it up to panel width
 *     produces a large blur. A low-resolution source gets a small frame and
 *     says so.
 */
describe('CreativePreview', () => {
  it('does not shrink — the ad side panel is a scrolling flex column', () => {
    const { container } = renderWithProviders(
      <CreativePreview imageUrl="/graphic.png" width={1080} height={1341} />
    );
    expect(container.firstElementChild?.className).toContain('shrink-0');
  });

  it('frames an image at its own aspect ratio, never cropping it', () => {
    renderWithProviders(
      <CreativePreview
        imageUrl="/graphic.png"
        alt="Graphic"
        width={1080}
        height={1341}
      />
    );
    const img = screen.getByAltText('Graphic');
    expect(img.className).toContain('object-contain');
    expect(img.className).not.toContain('object-cover');

    const frame = img.parentElement as HTMLElement;
    expect(frame.style.aspectRatio).toBe(String(1080 / 1341));
  });

  it('frames a 9:16 video at 9:16 rather than a default square', () => {
    renderWithProviders(
      <CreativePreview videoUrl="/ad.mp4" width={1080} height={1920} />
    );
    const video = document.querySelector('video') as HTMLVideoElement;
    const frame = video.parentElement as HTMLElement;
    expect(frame.style.aspectRatio).toBe(String(1080 / 1920));
    expect(video.className).toContain('object-contain');
  });

  it('gives a 64x64 Meta thumbnail a small frame and labels it', () => {
    renderWithProviders(
      <CreativePreview imageUrl="/thumb.jpg" width={64} height={64} />
    );
    const frame = (screen.getByRole('img') as HTMLElement)
      .parentElement as HTMLElement;
    // 2x a 64px source, not the full panel width.
    expect(frame.style.width).toBe('128px');
    expect(screen.getByText(/low-resolution preview/i)).toBeInTheDocument();
  });

  it('does not label a full-size creative as low resolution', () => {
    renderWithProviders(
      <CreativePreview imageUrl="/graphic.png" width={1080} height={1341} />
    );
    expect(screen.queryByText(/low-resolution/i)).not.toBeInTheDocument();
  });

  it('degrades a broken source to a placeholder, not a broken-image icon', async () => {
    renderWithProviders(
      <CreativePreview imageUrl="/expired.jpg" alt="Expired" />
    );
    fireEvent.error(screen.getByAltText('Expired'));
    await waitFor(() => {
      expect(screen.queryByAltText('Expired')).not.toBeInTheDocument();
    });
    expect(screen.getByText('🎬')).toBeInTheDocument();
  });

  it('shows a placeholder when there is no creative at all', () => {
    renderWithProviders(<CreativePreview />);
    expect(screen.getByText('🎬')).toBeInTheDocument();
  });
});

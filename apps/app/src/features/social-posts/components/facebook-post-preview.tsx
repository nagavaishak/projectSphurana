import { useResolvedTheme } from '@/lib/use-resolved-theme';
import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';
import { shiftFollowingSiblings, wrapTextIntoLines } from './svg-text-utils';

interface FacebookPostPreviewProps {
  imageUrl: string;
  caption?: string;
  profileImageUrl?: string;
  profileName?: string;
  className?: string;
}

const SVG_PATHS = {
  light: '/social-mockups/FacebookPostLight.svg',
  dark: '/social-mockups/FacebookPostDark.svg',
} as const;

/** Caption layout constants (matched to the SVG mockup). */
const CAPTION = {
  X: 16,
  START_Y: 75.2109,
  LINE_HEIGHT: 20,
  MAX_WIDTH: 648, // 680 − 2×16
  DEFAULT_LINES: 3,
  FONT_FAMILY: 'Inter',
  FONT_SIZE: '15',
} as const;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Render initials inside the avatar circle as a fallback. */
function showInitialsFallback(
  svg: SVGSVGElement,
  cx: number,
  cy: number,
  r: number,
  clipId: string,
  name?: string
) {
  const initial = (name ?? '?').charAt(0).toUpperCase();
  const bg = document.createElementNS(SVG_NS, 'circle');
  bg.setAttribute('cx', String(cx));
  bg.setAttribute('cy', String(cy));
  bg.setAttribute('r', String(r));
  bg.setAttribute('fill', '#E4E4E7');
  bg.setAttribute('clip-path', `url(#${clipId})`);
  const txt = document.createElementNS(SVG_NS, 'text');
  txt.setAttribute('x', String(cx));
  txt.setAttribute('y', String(cy));
  txt.setAttribute('text-anchor', 'middle');
  txt.setAttribute('dominant-baseline', 'central');
  txt.setAttribute('font-size', String(r));
  txt.setAttribute('font-weight', '600');
  txt.setAttribute('fill', '#71717A');
  txt.setAttribute('clip-path', `url(#${clipId})`);
  txt.textContent = initial;
  const avatarEl = svg.querySelector('#Vector_2');
  if (avatarEl?.parentNode) {
    avatarEl.parentNode.insertBefore(bg, avatarEl.nextSibling);
    bg.parentNode?.insertBefore(txt, bg.nextSibling);
    avatarEl.setAttribute('fill', 'none');
  }
}

/**
 * Facebook post preview that loads the SVG inline and swaps text/image content.
 *
 * SVG dimensions: 680 x 1040 (light) / 680 x 1017 (dark)
 * Key IDs: Vector_2 (avatar circle), AnyAgency, Post_Text, Post_Image
 */
export function FacebookPostPreview({
  imageUrl,
  caption,
  profileImageUrl,
  profileName,
  className,
}: FacebookPostPreviewProps) {
  const resolvedTheme = useResolvedTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgCache, setSvgCache] = useState<Record<string, string>>({});
  const [aspectRatio, setAspectRatio] = useState('680 / 1040');

  // Fetch and cache SVG content
  useEffect(() => {
    for (const [key, path] of Object.entries(SVG_PATHS)) {
      if (svgCache[key]) continue;
      fetch(path)
        .then((r) => r.text())
        .then((text) => setSvgCache((prev) => ({ ...prev, [key]: text })))
        .catch(() => {});
    }
  }, [svgCache]);

  // Inject SVG and patch content
  useEffect(() => {
    const container = containerRef.current;
    const variant = resolvedTheme === 'dark' ? 'dark' : 'light';
    const raw = svgCache[variant];
    if (!container || !raw) return;

    container.innerHTML = raw.replaceAll(
      'font-family="Segoe UI"',
      'font-family="Inter"'
    );
    const svg = container.querySelector('svg');
    if (!svg) return;

    // Read base dimensions from the SVG viewBox
    const viewBox = svg.getAttribute('viewBox')?.split(' ').map(Number);
    const baseWidth = viewBox?.[2] ?? 680;
    const baseHeight = viewBox?.[3] ?? 1040;

    // Make SVG responsive
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.style.width = '100%';
    svg.style.height = '100%';

    // --- Profile picture ---
    const avatarPath = svg.querySelector('#Vector_2');
    if (avatarPath) {
      const cx = 36;
      const cy = 32;
      const r = 20;
      const clipId = 'fb-avatar-clip';
      const defs =
        svg.querySelector('defs') ??
        svg.insertBefore(
          document.createElementNS(SVG_NS, 'defs'),
          svg.firstChild
        );
      const clipPath = document.createElementNS(SVG_NS, 'clipPath');
      clipPath.setAttribute('id', clipId);
      const clipCircle = document.createElementNS(SVG_NS, 'circle');
      clipCircle.setAttribute('cx', String(cx));
      clipCircle.setAttribute('cy', String(cy));
      clipCircle.setAttribute('r', String(r));
      clipPath.appendChild(clipCircle);
      defs.appendChild(clipPath);

      if (profileImageUrl) {
        const img = document.createElementNS(SVG_NS, 'image');
        img.setAttribute('href', profileImageUrl);
        img.setAttribute('x', String(cx - r));
        img.setAttribute('y', String(cy - r));
        img.setAttribute('width', String(r * 2));
        img.setAttribute('height', String(r * 2));
        img.setAttribute('clip-path', `url(#${clipId})`);
        img.setAttribute('preserveAspectRatio', 'xMidYMid slice');
        img.addEventListener('error', () => {
          img.remove();
          showInitialsFallback(svg, cx, cy, r, clipId, profileName);
        });
        avatarPath.parentNode?.insertBefore(img, avatarPath);
        avatarPath.setAttribute('fill', 'none');
      } else {
        showInitialsFallback(svg, cx, cy, r, clipId, profileName);
      }
    }

    // --- Page name ---
    const nameTxt = svg.querySelector('#AnyAgency tspan');
    if (nameTxt && profileName) {
      nameTxt.textContent = profileName;
    }

    // --- Caption (above image) with text wrapping ---
    const postTextGroup = svg.querySelector('#Post_Text');
    let delta = 0;

    if (postTextGroup) {
      const textEl = postTextGroup.querySelector('text');
      if (textEl && caption !== undefined) {
        // Wrap caption into lines that fit the available width
        const lines = wrapTextIntoLines(
          svg,
          caption ?? '',
          CAPTION.MAX_WIDTH,
          CAPTION.FONT_FAMILY,
          CAPTION.FONT_SIZE
        );

        // Replace all tspans with properly positioned ones
        textEl.innerHTML = '';
        for (let i = 0; i < lines.length; i++) {
          const tspan = document.createElementNS(SVG_NS, 'tspan');
          tspan.setAttribute('x', String(CAPTION.X));
          tspan.setAttribute(
            'y',
            String(CAPTION.START_Y + i * CAPTION.LINE_HEIGHT)
          );
          tspan.textContent = lines[i];
          textEl.appendChild(tspan);
        }

        delta = (lines.length - CAPTION.DEFAULT_LINES) * CAPTION.LINE_HEIGHT;
      }
    }

    // Shift everything below the caption when it grows or shrinks
    if (delta !== 0 && postTextGroup) {
      // Level 1: siblings after Post_Text's parent (includes Post_Image)
      const postTextParent = postTextGroup.parentElement;
      if (postTextParent) {
        shiftFollowingSiblings(postTextParent, delta);
      }

      // Level 2: siblings after the content container (likes, comments, etc.)
      const contentContainer = postTextParent?.parentElement;
      if (contentContainer) {
        shiftFollowingSiblings(contentContainer, delta);
      }

      // Update viewBox height
      const newHeight = baseHeight + delta;
      svg.setAttribute('viewBox', `0 0 ${baseWidth} ${newHeight}`);
      setAspectRatio(`${baseWidth} / ${newHeight}`);
    } else {
      setAspectRatio(`${baseWidth} / ${baseHeight}`);
    }

    // --- Post image ---
    const postImage = svg.querySelector('#Post_Image');
    if (postImage && imageUrl) {
      const imgEl = document.createElementNS(SVG_NS, 'image');
      imgEl.setAttribute('href', imageUrl);
      imgEl.setAttribute('x', '0');
      imgEl.setAttribute('y', '130.9');
      imgEl.setAttribute('width', '680');
      imgEl.setAttribute('height', '680');
      imgEl.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      postImage.innerHTML = '';
      postImage.appendChild(imgEl);
    }
  }, [
    svgCache,
    resolvedTheme,
    imageUrl,
    caption,
    profileImageUrl,
    profileName,
  ]);

  return (
    <div
      ref={containerRef}
      className={cn('w-full', className)}
      style={{
        aspectRatio,
        backgroundColor: resolvedTheme === 'dark' ? '#242526' : '#FFFFFF',
        borderRadius: '12px',
        overflow: 'hidden',
      }}
    />
  );
}

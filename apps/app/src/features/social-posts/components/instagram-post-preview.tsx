import { useResolvedTheme } from '@/lib/use-resolved-theme';
import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';
import {
  measureSvgTextWidth,
  shiftFollowingSiblings,
  wrapTextIntoLines,
} from './svg-text-utils';

interface InstagramPostPreviewProps {
  imageUrl: string;
  caption?: string;
  profileImageUrl?: string;
  profileName?: string;
  className?: string;
}

const SVG_PATHS = {
  light: '/social-mockups/InstagramPostLight.svg',
  dark: '/social-mockups/InstagramPostDark.svg',
} as const;

/** Caption layout constants (matched to the SVG mockup). */
const CAPTION = {
  X: 16,
  START_Y: 569.727,
  LINE_HEIGHT: 18,
  MAX_WIDTH: 358, // 390 − 2×16
  FONT_FAMILY: 'Inter',
  FONT_SIZE: '13',
  /** Gap between the last caption baseline and the date baseline. */
  DATE_GAP: 20.773, // 590.5 − 569.727
  DEFAULT_LINES: 1,
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
  const avatarCircle = svg.querySelector('#ProfilePicture');
  if (avatarCircle?.parentNode) {
    avatarCircle.parentNode.insertBefore(bg, avatarCircle.nextSibling);
    bg.parentNode?.insertBefore(txt, bg.nextSibling);
    avatarCircle.setAttribute('fill', 'none');
  }
}

/**
 * Instagram post preview that loads the SVG inline and swaps text/image content.
 *
 * SVG dimensions: 390 x 609
 * Key IDs: ProfilePicture, MonNom, FirstImage, "MonNom La description du post"
 */
export function InstagramPostPreview({
  imageUrl,
  caption,
  profileImageUrl,
  profileName,
  className,
}: InstagramPostPreviewProps) {
  const resolvedTheme = useResolvedTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgCache, setSvgCache] = useState<Record<string, string>>({});
  const [aspectRatio, setAspectRatio] = useState('390 / 609');

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
    const baseWidth = viewBox?.[2] ?? 390;
    const baseHeight = viewBox?.[3] ?? 609;

    // Make SVG responsive
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.style.width = '100%';
    svg.style.height = '100%';

    // --- Profile picture ---
    const avatar = svg.querySelector<SVGCircleElement>('#ProfilePicture');
    if (avatar) {
      const cx = avatar.cx.baseVal.value;
      const cy = avatar.cy.baseVal.value;
      const r = avatar.r.baseVal.value;
      const clipId = 'avatar-clip';
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
        avatar.parentNode?.insertBefore(img, avatar);
        avatar.setAttribute('fill', 'none');
      } else {
        showInitialsFallback(svg, cx, cy, r, clipId, profileName);
      }
    }

    // --- Username (header) ---
    const usernameTxt = svg.querySelector('#MonNom tspan');
    if (usernameTxt && profileName) {
      usernameTxt.textContent = profileName;
    }

    // --- Post image ---
    const firstImage = svg.querySelector('#FirstImage');
    if (firstImage && imageUrl) {
      const imgEl = document.createElementNS(SVG_NS, 'image');
      imgEl.setAttribute('href', imageUrl);
      imgEl.setAttribute('x', '0');
      imgEl.setAttribute('y', '46');
      imgEl.setAttribute('width', '390');
      imgEl.setAttribute('height', '440');
      imgEl.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      firstImage.innerHTML = '';
      firstImage.appendChild(imgEl);
    }

    // --- Caption (username + text below image) with text wrapping ---
    const captionGroup =
      svg.querySelector('#MonNom\\ La\\ description\\ du\\ post') ??
      svg.querySelector('[id="MonNom La description du post"]');

    let delta = 0;

    if (captionGroup) {
      const texts = captionGroup.querySelectorAll('text');
      const boldText = Array.from(texts).find(
        (t) => t.getAttribute('font-weight') === '600'
      );
      const descText = Array.from(texts).find(
        (t) => !t.getAttribute('font-weight')
      );

      // Set bold username
      if (boldText) {
        const tspan = boldText.querySelector('tspan');
        if (tspan) tspan.textContent = profileName ? `${profileName} ` : '';
      }

      // Measure the username width so we know how much space the first line has
      const usernameStr = profileName ? `${profileName} ` : '';
      const usernameWidth = usernameStr
        ? measureSvgTextWidth(
            svg,
            usernameStr,
            CAPTION.FONT_FAMILY,
            CAPTION.FONT_SIZE,
            '600'
          )
        : 0;

      // Wrap the caption description text
      if (descText && caption !== undefined) {
        const firstLineMaxWidth = CAPTION.MAX_WIDTH - usernameWidth;

        const lines = wrapTextIntoLines(
          svg,
          caption ?? '',
          CAPTION.MAX_WIDTH,
          CAPTION.FONT_FAMILY,
          CAPTION.FONT_SIZE,
          undefined,
          firstLineMaxWidth
        );

        // Replace tspans in the description text element
        descText.innerHTML = '';
        for (let i = 0; i < lines.length; i++) {
          const tspan = document.createElementNS(SVG_NS, 'tspan');
          // First line starts after the username; subsequent lines at left margin
          tspan.setAttribute(
            'x',
            String(i === 0 ? CAPTION.X + usernameWidth : CAPTION.X)
          );
          tspan.setAttribute(
            'y',
            String(CAPTION.START_Y + i * CAPTION.LINE_HEIGHT)
          );
          tspan.textContent = lines[i];
          descText.appendChild(tspan);
        }

        delta = (lines.length - CAPTION.DEFAULT_LINES) * CAPTION.LINE_HEIGHT;
      }
    }

    // Shift the date text (and anything after the caption group) when caption grows
    if (delta !== 0 && captionGroup) {
      shiftFollowingSiblings(captionGroup, delta);

      // Expand the background rect to match the new height
      const newHeight = baseHeight + delta;
      const bgRect = svg.querySelector(
        `rect[width="${baseWidth}"]`
      ) as SVGRectElement | null;
      if (bgRect) {
        bgRect.setAttribute('height', String(newHeight));
      }

      // Update viewBox
      svg.setAttribute('viewBox', `0 0 ${baseWidth} ${newHeight}`);
      setAspectRatio(`${baseWidth} / ${newHeight}`);
    } else {
      setAspectRatio(`${baseWidth} / ${baseHeight}`);
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
      style={{ aspectRatio }}
    />
  );
}

// Layout helpers shared by block renderers. These are pure CSS plumbing, not
// engine-knob lookups — animations and type styles go through the registries.

import type {
  ResolvedOverlayPlacement,
  ResolvedTypeStyle,
} from '@borradh-workspace/video-templates';
import type { CSSProperties } from 'react';

// Applies a compile-resolved type style to CSS. Per-element fields (fontStyle,
// stroke, text-shadow) are applied VERBATIM when present so a template's
// styleOverride is authoritative; when absent, the container's default
// legibility (see textBoxStyle) fills in — preserving existing templates.
export function applyResolvedTypeStyle(
  style: ResolvedTypeStyle
): CSSProperties {
  const css: CSSProperties = {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle ?? 'normal',
    letterSpacing: `${style.letterSpacing}em`,
    textTransform: style.textTransform,
    color: style.color,
    lineHeight: 1.25,
  };
  if (style.strokeWidth && style.strokeWidth > 0) {
    css.WebkitTextStroke = `${style.strokeWidth}px ${style.strokeColor ?? '#000000'}`;
    css.paintOrder = 'stroke fill';
  }
  if (style.textShadow) css.textShadow = style.textShadow;
  return css;
}

// Convert region-relative 0–1 placement to absolute CSS.
export function overlayPlacementToStyle(
  p: ResolvedOverlayPlacement | undefined
): CSSProperties {
  if (!p) return {};
  const pct = (n: number) => `${n * 100}%`;
  const style: CSSProperties = { position: 'absolute' };

  if (p.width !== undefined) style.width = pct(p.width);
  if (p.height !== undefined) style.height = pct(p.height);

  const horizontal = p.anchor.includes('left')
    ? 'left'
    : p.anchor.includes('right')
      ? 'right'
      : 'center';
  const vertical = p.anchor.startsWith('top')
    ? 'top'
    : p.anchor.startsWith('bottom')
      ? 'bottom'
      : 'center';

  let transform = '';
  if (horizontal === 'left') style.left = pct(p.x);
  else if (horizontal === 'right') style.right = pct(1 - p.x);
  else {
    style.left = pct(p.x);
    transform += 'translateX(-50%) ';
  }

  if (vertical === 'top') style.top = pct(p.y);
  else if (vertical === 'bottom') style.bottom = pct(1 - p.y);
  else {
    style.top = pct(p.y);
    transform += 'translateY(-50%)';
  }

  if (transform.trim()) style.transform = transform.trim();
  return style;
}

// Maps a text container kind to a frame style (pill, button, or none).
// The text colour overrides whatever the type-style colour says when the
// container has its own background — the contrast is fixed per container.
export function textBoxStyle(
  container: 'none' | 'pill' | 'button' | 'plate' | undefined,
  style?: ResolvedTypeStyle
): CSSProperties {
  if (container === 'pill') {
    return {
      background: 'rgba(255,255,255,0.95)',
      borderRadius: 9999,
      padding: '18px 40px',
      color: '#111',
      boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
    };
  }
  if (container === 'button') {
    return {
      background: '#111',
      borderRadius: 14,
      padding: '20px 36px',
      color: '#fff',
      boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
    };
  }
  // `plate` — dark rounded backing for legible labels/interstitials over busy
  // footage. Chrome only; text colour/stroke/shadow come from the type style.
  if (container === 'plate') {
    return {
      background: 'rgba(0,0,0,0.7)',
      borderRadius: 8,
      padding: '12px 24px',
    };
  }
  // No container: text on the b-roll. If the element carries its own stroke or
  // shadow (a styleOverride), respect it; otherwise apply the default legibility
  // treatment so existing templates render unchanged.
  if (style?.strokeWidth !== undefined || style?.textShadow !== undefined) {
    return {};
  }
  return {
    textShadow: '0 2px 16px rgba(0,0,0,0.55)',
    WebkitTextStroke: '2px rgba(0,0,0,0.6)',
    paintOrder: 'stroke fill',
  };
}

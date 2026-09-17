import type {
  ResolvedInfoCardBackground,
  ResolvedInfoCardBlock,
  ResolvedInfoCardLayout,
  ResolvedTypeStyle,
} from '@borradh-workspace/video-templates';
import type React from 'react';
import { AbsoluteFill, Img, useCurrentFrame } from 'remotion';

import { getAnimationPreset } from '../registries/animations';
import { overlayPlacementToStyle } from './style-helpers';
import type { BlockRenderer, BlockRendererProps } from './types';

// info-card — composes headline + optional items/price/cta/logo against a
// solid or gradient background. It is self-contained: it paints its own
// background, picks text colours that contrast with that background, and
// scales its type/spacing to the width of the (possibly split) pane it lands
// in, so the same block reads correctly full-frame or in a narrow side pane.

function backgroundToCss(bg: ResolvedInfoCardBackground): string {
  if (bg.kind === 'solid') return bg.color;
  const angle = bg.angle ?? 135;
  return `linear-gradient(${angle}deg, ${bg.from}, ${bg.to})`;
}

// The dominant background colour, used to decide light/dark text contrast.
// Transparent / non-hex backgrounds return null → keep the baked type colours.
function backgroundKeyColor(bg: ResolvedInfoCardBackground): string | null {
  const c = bg.kind === 'solid' ? bg.color : bg.from;
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? c : null;
}

// WCAG relative luminance > 0.5 ≈ a light surface that wants dark text.
function isLightHex(hex: string): boolean {
  let v = hex.slice(1);
  if (v.length === 3)
    v = v
      .split('')
      .map((ch) => ch + ch)
      .join('');
  const r = Number.parseInt(v.slice(0, 2), 16) / 255;
  const g = Number.parseInt(v.slice(2, 4), 16) / 255;
  const b = Number.parseInt(v.slice(4, 6), 16) / 255;
  const lin = (s: number) =>
    s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum > 0.5;
}

function layoutToAlign(layout: ResolvedInfoCardLayout): {
  alignItems: React.CSSProperties['alignItems'];
  textAlign: React.CSSProperties['textAlign'];
} {
  if (layout === 'left-aligned') {
    return { alignItems: 'flex-start', textAlign: 'left' };
  }
  return { alignItems: 'center', textAlign: 'center' };
}

// Neutral fallbacks for legacy RenderDocs compiled before `accent` was baked.
const FALLBACK_ACCENT = '#111111';
const FALLBACK_ON_ACCENT = '#FFFFFF';

// Dark-on-light body colour (matches v1 offer-pane bullets).
const DARK_TEXT = '#333333';
const LIGHT_TEXT = '#FFFFFF';

// Frames between consecutive elements' entrances. Mirrors v1's staggered
// offer-pane cadence (~0.13s at 30fps) so headline → items → cta cascade in
// rather than popping as one block.
const STAGGER_FRAMES = 4;

const CheckIcon: React.FC<{ color: string; size: number }> = ({
  color,
  size,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    role="img"
    aria-label="Checkmark"
    style={{ flexShrink: 0 }}
  >
    <path
      d="M20 6L9 17L4 12"
      stroke={color}
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const InfoCardComponent: React.FC<BlockRendererProps> = ({ block, ctx }) => {
  if (block.kind !== 'info-card') return null;
  const card = block as ResolvedInfoCardBlock;
  const frame = useCurrentFrame();
  const preset = getAnimationPreset(card.entrance);
  const entranceFrames = card.entranceDurationFrames ?? 12;
  const align = layoutToAlign(card.layout);

  const accentColor = card.accent?.color ?? FALLBACK_ACCENT;
  const onAccentColor = card.accent?.onColor ?? FALLBACK_ON_ACCENT;

  // Font sizes are already baked at compile time (scaled down for narrow split
  // panes), so spacing/icon/logo sizes derive from those baked sizes to stay
  // proportionate — the renderer never needs the pane geometry.
  const headlineSize = card.headline?.typeStyle.fontSize ?? 64;
  const bodySize = card.items?.typeStyle.fontSize ?? headlineSize * 0.5;
  const gap = Math.round(headlineSize * 0.45);

  // Text colour resolves against the card's OWN background so it stays legible
  // regardless of the global theme's surface. Light card → dark text + brand
  // headline/markers (v1 offer parity); dark card → light text; unknown
  // (transparent) → keep the compile-baked type colours.
  const bgKey = backgroundKeyColor(card.background);
  const lightCard = bgKey ? isLightHex(bgKey) : null;
  const headlineColor =
    lightCard === true
      ? accentColor
      : lightCard === false
        ? LIGHT_TEXT
        : (card.headline?.typeStyle.color ?? LIGHT_TEXT);
  const bodyColor =
    lightCard === true ? DARK_TEXT : lightCard === false ? LIGHT_TEXT : null;
  const markerColor = lightCard === false ? LIGHT_TEXT : accentColor;

  const typeCss = (
    style: ResolvedTypeStyle,
    colorOverride?: string | null
  ): React.CSSProperties => ({
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    letterSpacing: `${style.letterSpacing}em`,
    textTransform: style.textTransform,
    color: colorOverride ?? style.color,
    lineHeight: 1.2,
    overflowWrap: 'break-word',
  });

  // Each element runs the same entrance preset, delayed by its position so the
  // card cascades in. `order` increments per visible element top-to-bottom.
  let order = 0;
  const entranceFor = (index: number): React.CSSProperties => {
    const s = preset(
      Math.max(0, frame - index * STAGGER_FRAMES),
      entranceFrames,
      ctx.fps
    );
    return { opacity: s.opacity, transform: s.transform, clipPath: s.clipPath };
  };

  const logoTop = card.logo?.position === 'top' ? card.logo : null;
  const logoBottom = card.logo?.position === 'bottom' ? card.logo : null;
  const numbered = card.layout === 'stacked';
  const hasItems = !!card.items && card.items.texts.length > 0;
  // Skip an empty/placeholder price (e.g. organic offers carry no real price)
  // so the card doesn't render a bare currency symbol.
  const showPrice = !!card.price && card.price.value.trim().length > 0;

  const inner = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: align.alignItems,
        textAlign: align.textAlign,
        gap,
        width: '100%',
        // Card-with-list fills the pane height and pins the CTA to the bottom
        // (v1 offer layout); a compact card (outro: logo + name + cta) hugs its
        // content and is centred by the wrapper.
        height: hasItems ? '100%' : undefined,
        justifyContent: hasItems ? 'flex-start' : 'center',
      }}
    >
      {logoTop &&
        (logoTop.size === 'hero' ? (
          // Logo-hero outro (v1 authority tagline): large, centred, no chrome.
          <Img
            src={logoTop.url}
            style={{
              width: '46%',
              aspectRatio: '1',
              objectFit: 'contain',
              ...entranceFor(order++),
            }}
          />
        ) : (
          <Img
            src={logoTop.url}
            style={{
              width: Math.round(headlineSize * 1.6),
              height: Math.round(headlineSize * 1.6),
              objectFit: 'contain',
              borderRadius: Math.round(headlineSize * 0.3),
              ...entranceFor(order++),
            }}
          />
        ))}

      {card.headline && (
        <div
          style={{
            ...typeCss(card.headline.typeStyle, headlineColor),
            ...entranceFor(order++),
          }}
        >
          {card.headline.text}
        </div>
      )}

      {card.items && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: Math.round(bodySize * 0.7),
            width: '100%',
          }}
        >
          {card.items.texts.map((t, i) => (
            <div
              key={`${i}-${t}`}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent:
                  align.alignItems === 'center' ? 'center' : 'flex-start',
                gap: Math.round(bodySize * 0.55),
                ...entranceFor(order++),
              }}
            >
              {/* Numbered lists keep their inline numeral; everything else gets
                  an accent checkmark marker (v1 offer-pane parity). */}
              {numbered ? null : (
                <div style={{ marginTop: Math.round(bodySize * 0.15) }}>
                  <CheckIcon color={markerColor} size={Math.round(bodySize)} />
                </div>
              )}
              <span
                style={typeCss(
                  card.items?.typeStyle as ResolvedTypeStyle,
                  bodyColor
                )}
              >
                {numbered ? `${i + 1}. ${t}` : t}
              </span>
            </div>
          ))}
        </div>
      )}

      {showPrice && card.price && (
        <div
          style={{
            ...typeCss(card.price.typeStyle, bodyColor),
            ...entranceFor(order++),
          }}
        >
          {card.price.currency}
          {card.price.value}
        </div>
      )}

      {card.cta && (
        <div
          style={{
            alignSelf: 'stretch',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: accentColor,
            borderRadius: Math.round(bodySize * 0.7),
            padding: `${Math.round(bodySize * 0.8)}px ${Math.round(bodySize * 1.6)}px`,
            boxSizing: 'border-box',
            marginTop: hasItems ? 'auto' : undefined,
            ...entranceFor(order++),
          }}
        >
          <span style={typeCss(card.cta.typeStyle, onAccentColor)}>
            {card.cta.text}
          </span>
        </div>
      )}

      {logoBottom &&
        (logoBottom.size === 'hero' ? (
          <Img
            src={logoBottom.url}
            style={{
              width: '46%',
              aspectRatio: '1',
              objectFit: 'contain',
              ...entranceFor(order++),
            }}
          />
        ) : (
          <Img
            src={logoBottom.url}
            style={{
              width: Math.round(headlineSize * 1.4),
              height: Math.round(headlineSize * 1.4),
              objectFit: 'contain',
              borderRadius: Math.round(headlineSize * 0.3),
              ...entranceFor(order++),
            }}
          />
        ))}
    </div>
  );

  const placement = card.placement
    ? overlayPlacementToStyle(card.placement)
    : null;

  if (placement) {
    return (
      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          background: backgroundToCss(card.background),
        }}
      >
        <div
          style={{
            ...placement,
            display: 'flex',
            justifyContent: 'center',
            // Stretch a list card to fill its placement height so the CTA can
            // pin to the bottom; centre a compact card.
            alignItems: hasItems ? 'stretch' : 'center',
          }}
        >
          {inner}
        </div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        background: backgroundToCss(card.background),
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      {inner}
    </AbsoluteFill>
  );
};

export const infoCardRenderer: BlockRenderer<ResolvedInfoCardBlock> = {
  kind: 'info-card',
  Component: InfoCardComponent,
};

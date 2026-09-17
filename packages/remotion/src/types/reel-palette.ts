/**
 * The curated organic-reel palette, lifted from the observed formats in the
 * aesthetics/skincare niche (reels research, July 2026): white/black plus ONE
 * soft accent — blush pink active states, cream serif "clinic voice", dark
 * slate text-protection bars, gold/tan serif accents, warm paper chips.
 *
 * The org brand colour still shows up — but in exactly ONE accent slot per
 * template (the active chip / badge / pill), injected by the worker as
 * `primaryColor`. Everything else stays on this palette, which also fills the
 * accent slot for orgs with no brand colour. Text on an accent fill is picked
 * by `accentTextColor` so any brand hex stays readable.
 */
export const REEL_PALETTE = {
  /** Warm cream — serif headlines and captions (the "clinic voice"). */
  cream: '#EFE0CE',
  /** Blush pink — active states, badges, filled chips (dark text on top). */
  blush: '#F2A9C4',
  /** Pastel clinic blue — framed/card backgrounds. */
  pastelBlue: '#CBDDE4',
  /** Near-black slate — text on light chips. */
  slate: '#15161C',
  /** The IG-classic rounded text-protection bar. */
  slateBar: 'rgba(13, 15, 24, 0.72)',
  /** Solid slate for pills/bands that need full opacity. */
  slateSolid: 'rgba(13, 15, 24, 0.86)',
  /** Gold/tan — accent words, ticks, progress fills. */
  gold: '#C9A96A',
  /** Warm paper white — chip/card backgrounds (dark text on top). */
  paper: 'rgba(250, 247, 242, 0.95)',
} as const;

/**
 * Darken an accent until it works as SMALL text on light chip backgrounds.
 * Small type needs far more contrast than big fills — anything lighter than
 * mid-luminance gets blended toward slate. Non-hex input falls back to slate.
 */
export function deepAccentColor(accent: string): string {
  const hex = accent.trim().replace('#', '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return REEL_PALETTE.slate;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  if (luminance <= 105) return `#${full}`;
  // Blend 65% toward slate (#15161C) so hue survives but text reads.
  const mix = (c: number, t: number) => Math.round(c * 0.35 + t * 0.65);
  const to2 = (n: number) => n.toString(16).padStart(2, '0');
  return `#${to2(mix(r, 21))}${to2(mix(g, 22))}${to2(mix(b, 28))}`;
}

/**
 * Pick a readable text colour for content sitting ON an accent fill. Brand
 * colours arrive as arbitrary hexes — a light blush wants slate text, a deep
 * navy wants cream. Non-hex values (rgba etc.) fall back to cream.
 */
export function accentTextColor(accent: string): string {
  const hex = accent.trim().replace('#', '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return REEL_PALETTE.cream;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 150 ? REEL_PALETTE.slate : '#FFFFFF';
}

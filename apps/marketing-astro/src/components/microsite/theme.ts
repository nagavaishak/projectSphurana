import type { MicrositeTheme } from '@borradh-workspace/web-shared';

/**
 * Theme → CSS custom properties. This is the ONLY place colour enters a
 * microsite page: blocks read `var(--brand-*)` and never hardcode a value, so
 * the theme stays a guardrail the agent cannot paint outside of.
 */

const FALLBACK = {
  primary: '#111111',
  accent: '#111111',
  neutral: '#555555',
  surface: '#ffffff',
} as const;

/**
 * Theme values round-trip through `jsonb`, so they are untrusted strings by
 * the time they reach us. We emit them into a `<style>` block, where a stray
 * `}` would let an author close the rule and inject arbitrary CSS — hence an
 * allowlist rather than escaping.
 */
const COLOR_RE =
  /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|oklch|lab|lch|color)\([0-9a-z%.,/\s+-]*\)|[a-z]{3,20})$/i;

export const sanitizeColor = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return COLOR_RE.test(trimmed) ? trimmed : fallback;
};

const RADIUS: Record<MicrositeTheme['radius'], string> = {
  none: '0px',
  sm: '0.25rem',
  md: '0.75rem',
  full: '9999px',
};

const DENSITY: Record<
  MicrositeTheme['density'],
  { sectionY: string; gap: string; maxWidth: string }
> = {
  tight: { sectionY: '2.75rem', gap: '1rem', maxWidth: '68rem' },
  comfortable: { sectionY: '4.5rem', gap: '1.75rem', maxWidth: '72rem' },
};

/**
 * No per-org font is stored anywhere (plan §4), so `scale` picks from a
 * curated set rather than loading a webfont — a webfont on an ad landing page
 * is a render-blocking round trip we are not spending against a 2.0s LCP.
 */
const TYPOGRAPHY: Record<
  MicrositeTheme['typography']['scale'],
  {
    base: string;
    headingFamily: string;
    headingWeight: string;
    tracking: string;
  }
> = {
  compact: {
    base: '0.9375rem',
    headingFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    headingWeight: '600',
    tracking: '-0.01em',
  },
  default: {
    base: '1rem',
    headingFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    headingWeight: '700',
    tracking: '-0.015em',
  },
  editorial: {
    base: '1.0625rem',
    headingFamily: 'ui-serif, Georgia, "Times New Roman", serif',
    headingWeight: '600',
    tracking: '-0.005em',
  },
};

const pick = <T extends string, V>(
  map: Record<T, V>,
  key: unknown,
  fallback: T
): V => map[(key as T) in map ? (key as T) : fallback];

/** Build the `--brand-*` / `--ms-*` custom property pairs for a theme. */
export const themeCssVars = (theme: MicrositeTheme): Record<string, string> => {
  const brand = theme?.brand ?? ({} as MicrositeTheme['brand']);
  const primary = sanitizeColor(brand.primary, FALLBACK.primary);
  const accent = sanitizeColor(brand.accent, FALLBACK.accent);
  const neutral = sanitizeColor(brand.neutral, FALLBACK.neutral);
  const surface = sanitizeColor(brand.surface, FALLBACK.surface);

  const radius = pick(RADIUS, theme?.radius, 'md');
  const density = pick(DENSITY, theme?.density, 'comfortable');
  const type = pick(TYPOGRAPHY, theme?.typography?.scale, 'default');
  const buttonStyle = (['solid', 'outline', 'pill'] as const).includes(
    theme?.buttonStyle as never
  )
    ? theme.buttonStyle
    : 'solid';

  return {
    '--brand-primary': primary,
    '--brand-accent': accent,
    '--brand-neutral': neutral,
    '--brand-surface': surface,
    /** Text that sits ON a primary/accent fill. */
    '--brand-on-primary': surface,
    /** Hairlines and dividers — neutral at low alpha via colour-mix. */
    '--brand-border': `color-mix(in srgb, ${neutral} 22%, transparent)`,
    '--brand-muted': `color-mix(in srgb, ${neutral} 70%, ${surface})`,
    '--brand-subtle': `color-mix(in srgb, ${neutral} 6%, ${surface})`,

    '--ms-radius': radius,
    '--ms-section-y': density.sectionY,
    '--ms-gap': density.gap,
    '--ms-max-width': density.maxWidth,

    '--ms-font-size': type.base,
    '--ms-heading-family': type.headingFamily,
    '--ms-heading-weight': type.headingWeight,
    '--ms-heading-tracking': type.tracking,

    '--ms-button-radius': buttonStyle === 'pill' ? '9999px' : radius,
    '--ms-button-bg': buttonStyle === 'outline' ? 'transparent' : primary,
    '--ms-button-fg': buttonStyle === 'outline' ? primary : surface,
    '--ms-button-border': buttonStyle === 'outline' ? primary : 'transparent',
  };
};

export const themeCssText = (theme: MicrositeTheme): string =>
  Object.entries(themeCssVars(theme))
    .map(([k, v]) => `${k}:${v};`)
    .join('');

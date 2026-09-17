/**
 * Outro layout types for branded video endings
 */
export type OutroLayoutType = 'offer' | 'location' | 'tagline';

/**
 * Configuration for outro layouts
 */
export interface OutroLayoutConfig {
  /** Layout style */
  layout: OutroLayoutType;
  /** Logo URL */
  logoUrl?: string;
  /** Business name or service name (displayed as service text in offer outro) */
  businessName: string;
  /** Business tagline */
  tagline?: string;
  /** Primary brand color (hex) */
  primaryColor: string;
  /** Secondary brand color (hex) */
  secondaryColor: string;
  /** Background color (hex) - used by offer layout */
  backgroundColor?: string;
  /** Business address - used by location layout */
  address?: string;
  /** Customizable header/CTA text (e.g., "LIMITED TIME OFFER!") */
  ctaText?: string;
  /** Offer main text (for offer layout, e.g., "Now Just £450!") */
  offerMainText?: string;
  /** Offer subtext (for offer layout, e.g., "was £1350") */
  offerSubtext?: string;
  /** Duration in frames */
  durationInFrames: number;
}

/**
 * Props for outro layout components
 */
export interface OutroLayoutProps {
  config: OutroLayoutConfig;
}

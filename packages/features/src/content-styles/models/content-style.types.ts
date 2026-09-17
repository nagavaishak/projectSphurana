/**
 * Content Style Template Types
 *
 * Defines the visual styling for all AI-generated content (videos, photos, graphics).
 * Each organization selects a template during onboarding which controls their brand's
 * visual appearance across all generated content.
 */

export type ContentStyleTemplateId =
  | 'clean_minimal'
  | 'bold_energetic'
  | 'elegant_professional'
  | 'playful_colorful';

/**
 * Caption background style for videos
 */
export type CaptionBackgroundStyle = 'none' | 'solid' | 'rounded' | 'highlight';

/**
 * Outro layout style for videos
 */
export type OutroLayout = 'centered' | 'split' | 'minimal' | 'branded';

/**
 * Animation style for transitions
 */
export type AnimationStyle = 'fade' | 'slide' | 'zoom' | 'none';

/**
 * Logo position options
 */
export type LogoPosition =
  | 'top'
  | 'bottom'
  | 'center'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

/**
 * Text alignment options
 */
export type TextAlignment = 'left' | 'center' | 'right';

/**
 * Shadow style options
 */
export type ShadowStyle = 'none' | 'soft' | 'strong';

/**
 * Color palette for a content style
 */
export interface ContentStyleColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
}

/**
 * Font configuration for a content style
 */
export interface ContentStyleFonts {
  /** Font for titles and headlines */
  heading: string;
  /** Font for body text and captions */
  body: string;
  /** Font for CTAs and special text */
  accent: string;
}

/**
 * Caption styling configuration for videos
 */
export interface ContentStyleCaptions {
  fontFamily: string;
  fontSize: number;
  color: string;
  backgroundColor: string;
  showBackground: boolean;
  backgroundStyle: CaptionBackgroundStyle;
  /** Border radius for rounded background style */
  borderRadius?: number;
  /** Padding around text */
  padding?: number;
}

/**
 * Outro styling configuration for videos
 */
export interface ContentStyleOutro {
  layout: OutroLayout;
  logoPosition: LogoPosition;
  animationStyle: AnimationStyle;
  /** Duration in frames (at 30fps) */
  durationInFrames: number;
}

/**
 * Graphic/photo styling configuration
 */
export interface ContentStyleGraphics {
  textAlignment: TextAlignment;
  overlayOpacity: number;
  borderRadius: number;
  shadowStyle: ShadowStyle;
}

/**
 * Complete content style template definition
 */
export interface ContentStyleDefinition {
  id: ContentStyleTemplateId;
  name: string;
  description: string;

  /** Default color palette (user can override primary/secondary) */
  defaultColors: ContentStyleColors;

  /** Typography configuration */
  fonts: ContentStyleFonts;

  /** Video caption styling */
  captionStyle: ContentStyleCaptions;

  /** Video outro styling */
  outroStyle: ContentStyleOutro;

  /** Photo/graphic styling */
  graphicStyle: ContentStyleGraphics;

  /** Preview image URL for template selection UI */
  previewUrl?: string;
}

/**
 * Organization's resolved brand configuration
 * Combines the selected template with any color overrides
 */
export interface OrganizationBrandConfig {
  organizationId: string;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  contentStyleTemplate: ContentStyleTemplateId;
  resolvedStyle: ContentStyleDefinition;
  logoUrl: string | null;
  tagline: string | null;
}

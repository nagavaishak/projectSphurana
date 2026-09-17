import type {
  ContentStyleDefinition,
  ContentStyleTemplateId,
} from './content-style.types.js';

/**
 * Content Style Template Definitions
 *
 * Each template defines a complete visual identity for generated content including:
 * - Color palette
 * - Typography (heading, body, accent fonts)
 * - Video caption styling
 * - Video outro layout and animation
 * - Photo/graphic styling
 */
export const CONTENT_STYLE_TEMPLATES: Record<
  ContentStyleTemplateId,
  ContentStyleDefinition
> = {
  clean_minimal: {
    id: 'clean_minimal',
    name: 'Clean & Minimal',
    description:
      'Modern, spacious design with subtle colors. Perfect for professional services.',

    defaultColors: {
      primary: '#1e293b', // Slate 800
      secondary: '#64748b', // Slate 500
      accent: '#0ea5e9', // Sky 500
      background: '#ffffff',
      text: '#1e293b',
    },

    fonts: {
      heading: 'Inter',
      body: 'Inter',
      accent: 'Inter',
    },

    captionStyle: {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 48,
      color: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      showBackground: true,
      backgroundStyle: 'rounded',
      borderRadius: 8,
      padding: 12,
    },

    outroStyle: {
      layout: 'minimal',
      logoPosition: 'center',
      animationStyle: 'fade',
      durationInFrames: 90, // 3 seconds at 30fps
    },

    graphicStyle: {
      textAlignment: 'center',
      overlayOpacity: 0.3,
      borderRadius: 8,
      shadowStyle: 'soft',
    },
  },

  bold_energetic: {
    id: 'bold_energetic',
    name: 'Bold & Energetic',
    description:
      'High-impact design with strong colors. Great for promotions and sales.',

    defaultColors: {
      primary: '#dc2626', // Red 600
      secondary: '#f97316', // Orange 500
      accent: '#fbbf24', // Amber 400
      background: '#0f172a', // Slate 900
      text: '#ffffff',
    },

    fonts: {
      heading: 'Bebas Neue',
      body: 'Montserrat',
      accent: 'Oswald',
    },

    captionStyle: {
      fontFamily: 'Montserrat, sans-serif',
      fontSize: 56,
      color: '#ffffff',
      backgroundColor: '#dc2626',
      showBackground: true,
      backgroundStyle: 'solid',
      borderRadius: 0,
      padding: 16,
    },

    outroStyle: {
      layout: 'branded',
      logoPosition: 'top',
      animationStyle: 'zoom',
      durationInFrames: 90,
    },

    graphicStyle: {
      textAlignment: 'center',
      overlayOpacity: 0.5,
      borderRadius: 0,
      shadowStyle: 'strong',
    },
  },

  elegant_professional: {
    id: 'elegant_professional',
    name: 'Elegant & Professional',
    description:
      'Sophisticated design with serif fonts. Ideal for luxury and premium services.',

    defaultColors: {
      primary: '#1c1917', // Stone 900
      secondary: '#78716c', // Stone 500
      accent: '#a16207', // Amber 700 (gold tone)
      background: '#fafaf9', // Stone 50
      text: '#1c1917',
    },

    fonts: {
      heading: 'Playfair Display',
      body: 'Lora',
      accent: 'Montserrat',
    },

    captionStyle: {
      fontFamily: 'Lora, serif',
      fontSize: 44,
      color: '#fafaf9',
      backgroundColor: 'rgba(28, 25, 23, 0.85)',
      showBackground: true,
      backgroundStyle: 'highlight',
      borderRadius: 4,
      padding: 14,
    },

    outroStyle: {
      layout: 'split',
      logoPosition: 'bottom',
      animationStyle: 'fade',
      durationInFrames: 120, // 4 seconds for more elegant pacing
    },

    graphicStyle: {
      textAlignment: 'left',
      overlayOpacity: 0.4,
      borderRadius: 4,
      shadowStyle: 'soft',
    },
  },

  playful_colorful: {
    id: 'playful_colorful',
    name: 'Playful & Colorful',
    description:
      'Fun, vibrant design with bright colors. Perfect for creative and youth-focused brands.',

    defaultColors: {
      primary: '#8b5cf6', // Violet 500
      secondary: '#ec4899', // Pink 500
      accent: '#06b6d4', // Cyan 500
      background: '#fdf4ff', // Fuchsia 50
      text: '#581c87', // Purple 900
    },

    fonts: {
      heading: 'Poppins',
      body: 'Poppins',
      accent: 'Dancing Script',
    },

    captionStyle: {
      fontFamily: 'Poppins, sans-serif',
      fontSize: 52,
      color: '#ffffff',
      backgroundColor: '#8b5cf6',
      showBackground: true,
      backgroundStyle: 'rounded',
      borderRadius: 16,
      padding: 14,
    },

    outroStyle: {
      layout: 'centered',
      logoPosition: 'center',
      animationStyle: 'slide',
      durationInFrames: 90,
    },

    graphicStyle: {
      textAlignment: 'center',
      overlayOpacity: 0.2,
      borderRadius: 16,
      shadowStyle: 'soft',
    },
  },
};

/**
 * Get a content style template by ID
 */
export function getContentStyleTemplate(
  id: ContentStyleTemplateId | string
): ContentStyleDefinition | undefined {
  return CONTENT_STYLE_TEMPLATES[id as ContentStyleTemplateId];
}

/**
 * Get all available content style templates
 */
export function getAllContentStyleTemplates(): ContentStyleDefinition[] {
  return Object.values(CONTENT_STYLE_TEMPLATES);
}

/**
 * Get template IDs as an array (useful for validation)
 */
export function getContentStyleTemplateIds(): ContentStyleTemplateId[] {
  return Object.keys(CONTENT_STYLE_TEMPLATES) as ContentStyleTemplateId[];
}

/**
 * Apply organization color overrides to a template
 * Returns a new ContentStyleDefinition with the org's colors merged in
 */
export function applyColorOverrides(
  template: ContentStyleDefinition,
  primaryColor?: string | null,
  secondaryColor?: string | null
): ContentStyleDefinition {
  return {
    ...template,
    defaultColors: {
      ...template.defaultColors,
      primary: primaryColor ?? template.defaultColors.primary,
      secondary: secondaryColor ?? template.defaultColors.secondary,
    },
  };
}

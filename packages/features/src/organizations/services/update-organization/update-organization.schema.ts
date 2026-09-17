import {
  outroStyleValues,
  stylePreferenceValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';

// Hex color regex pattern
const hexColorPattern = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

/**
 * Valid content style templates
 */
export const CONTENT_STYLE_TEMPLATES = [
  'clean_minimal',
  'bold_energetic',
  'elegant_professional',
  'playful_colorful',
] as const;

/**
 * Schema for updating an organization
 */
export const updateOrganizationSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name too long')
    .optional(),
  logo: z.string().url('Invalid logo URL').optional().nullable(),

  // Onboarding v2 fields - Website & Social
  websiteUrl: z.string().url('Invalid website URL').optional().nullable(),
  facebookPageUrl: z.string().url('Invalid Facebook URL').optional().nullable(),

  // Onboarding v2 fields - AI-extracted brand info
  brandVoice: z.array(z.string()).optional(),
  targetAudienceDescription: z.string().optional().nullable(),
  credibilityLine: z.string().optional().nullable(),

  // Brand settings
  primaryColor: z
    .string()
    .regex(hexColorPattern, 'Invalid hex color')
    .optional(),
  secondaryColor: z
    .string()
    .regex(hexColorPattern, 'Invalid hex color')
    .optional(),
  backgroundColor: z
    .string()
    .regex(hexColorPattern, 'Invalid hex color')
    .optional(),
  tagline: z.string().max(200, 'Tagline too long').optional().nullable(),
  address: z.string().max(500, 'Address too long').optional().nullable(),
  contentStyleTemplate: z.enum(CONTENT_STYLE_TEMPLATES).optional(),
  // 'clean' → edge-to-edge graphics, 'basic' → solid brand-color border
  stylePreference: z.enum(stylePreferenceValues).optional(),
  outroStyle: z.enum(outroStyleValues).optional(),
});

/**
 * Input type inferred from schema
 */
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

/**
 * Internal schema including session token
 */
export const updateOrganizationInternalSchema = updateOrganizationSchema.extend(
  {
    sessionToken: z.string().min(1, 'Session token is required'),
  }
);

export type UpdateOrganizationInternalInput = z.infer<
  typeof updateOrganizationInternalSchema
>;

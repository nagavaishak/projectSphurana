import {
  businessTypeValues,
  contentStyleTemplateValues,
  outroStyleValues,
  primaryCalendarTypeValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * Hex color regex pattern
 */
const hexColorPattern = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

/**
 * Business hours schema
 * Keys are day of week (0=Sunday, 6=Saturday)
 * Values are { from: minutes, to: minutes } from midnight
 */
const businessHoursEntrySchema = z.object({
  from: z.number().int().min(0).max(1440), // 0 to 24*60
  to: z.number().int().min(0).max(1440),
});

const businessHoursSchema = z
  .record(
    z
      .string()
      .regex(/^[0-6]$/), // Day index as string
    businessHoursEntrySchema
  )
  .transform((obj) => {
    // Convert string keys to number keys
    const result: Record<number, { from: number; to: number }> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[Number(key)] = value;
    }
    return result;
  });

/**
 * Schema for creating an organization with onboarding data
 * Onboarding v2: simplified flow with website analysis
 */
export const createOrganizationSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  logo: z.string().url('Invalid logo URL').optional().nullable(),
  businessType: z.enum(businessTypeValues),
  createdByUserId: z.string().min(1, 'User ID is required'),

  // Onboarding v2 fields - Website & Social
  websiteUrl: z.string().url('Invalid website URL').optional().nullable(),
  facebookPageUrl: z.string().url('Invalid Facebook URL').optional().nullable(),

  // Onboarding v2 fields - AI-extracted brand info
  brandVoice: z.array(z.string()).optional().default([]),
  targetAudienceDescription: z.string().optional().nullable(),
  credibilityLine: z.string().optional().nullable(),

  // Brand settings (optional - defaults will be applied from template)
  contentStyleTemplate: z
    .enum(contentStyleTemplateValues)
    .optional()
    .default('clean_minimal'),
  outroStyle: z.enum(outroStyleValues).optional().default('tagline'),
  primaryColor: z
    .string()
    .regex(hexColorPattern, 'Invalid hex color')
    .optional()
    .nullable(),
  secondaryColor: z
    .string()
    .regex(hexColorPattern, 'Invalid hex color')
    .optional()
    .nullable(),
  backgroundColor: z
    .string()
    .regex(hexColorPattern, 'Invalid hex color')
    .optional()
    .nullable(),
  address: z.string().max(500, 'Address too long').optional().nullable(),

  // Business hours (optional - can be set later in settings)
  businessHours: businessHoursSchema.optional().nullable(),

  // Deposit settings (optional)
  depositEnabled: z.boolean().optional().default(false),
  depositAmount: z.number().int().min(0).optional().nullable(), // in cents

  // Booking link for the organization
  defaultBookingLink: z
    .string()
    .url('Invalid booking URL')
    .optional()
    .nullable(),

  // Deposit link for the organization

  // Primary calendar type (booking destination)
  primaryCalendarType: z.enum(primaryCalendarTypeValues).optional().nullable(),
});

/**
 * Input type inferred from schema
 */
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

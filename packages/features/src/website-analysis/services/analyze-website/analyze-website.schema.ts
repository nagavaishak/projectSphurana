import { servicePriceTypeValues } from '@borradh-workspace/labels';
import { z } from 'zod';
import { analysisSectionValues } from './analysis-sections.js';

const normalizeUrl = (v: string) => {
  const trimmed = v.trim();
  if (trimmed && !/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
};

export {
  analysisSectionValues,
  type AnalysisSection,
} from './analysis-sections.js';

export const analysisSectionSchema = z.enum(analysisSectionValues);

export const analyzeWebsiteSchema = z.object({
  websiteUrl: z
    .string()
    .transform(normalizeUrl)
    .pipe(z.string().url('Invalid website URL')),
  facebookPageUrl: z
    .string()
    .transform(normalizeUrl)
    .pipe(z.string().url('Invalid Facebook URL'))
    .optional()
    .nullable(),
  bookingSystemUrl: z
    .string()
    .transform(normalizeUrl)
    .pipe(z.string().url('Invalid booking system URL'))
    .optional()
    .nullable(),
  organizationId: z.string().min(1).optional(),
  forceRefresh: z.boolean().optional(),
  /**
   * Which sections to ask the model for. Absent = all of them (the onboarding
   * default). Narrowing this narrows the PROMPT, not just what gets applied:
   * a prompt that doesn't ask for packages doesn't invent packages, and the
   * shorter prompt costs less. `packages` implies `services`, since a package
   * references its items by service name — the service resolves that.
   */
  scanFor: z.array(analysisSectionSchema).nonempty().optional(),
});

export type AnalyzeWebsiteInput = z.infer<typeof analyzeWebsiteSchema>;

export const analyzedLocationSchema = z.object({
  name: z.string().optional(),
  addressLine1: z.string(),
  city: z.string(),
  county: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string(), // 2-letter country code (e.g. "ie", "gb", "us")
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

export type AnalyzedLocation = z.infer<typeof analyzedLocationSchema>;

export const analyzedBusinessHoursSchema = z.record(
  z.string().regex(/^[0-6]$/),
  z.object({
    from: z.number().int().min(0).max(1440),
    to: z.number().int().min(0).max(1440),
  })
);

export type AnalyzedBusinessHours = z.infer<typeof analyzedBusinessHoursSchema>;

export const analyzedPractitionerSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  // Only when the site publishes a per-person address. Staff rows require an
  // email, so apply-website-analysis mints an undeliverable `.invalid`
  // placeholder when this is absent rather than guessing a real mailbox.
  email: z.string().email().optional(),
});

export type AnalyzedPractitioner = z.infer<typeof analyzedPractitionerSchema>;

/**
 * A bundle/course the business sells as one purchase (e.g. "6x Laser Full
 * Body", "Bridal Package"). `serviceNames` are the analyzer's own service
 * names — apply-website-analysis resolves them against the created services
 * and SKIPS any package whose items it cannot resolve, so a hallucinated item
 * never invents a package.
 */
export const analyzedPackageSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  /** Total package price in whole local-currency units. */
  priceAmount: z.number().nonnegative(),
  serviceNames: z.array(z.string()).default([]),
  validityDays: z.number().int().positive().optional(),
});

export type AnalyzedPackage = z.infer<typeof analyzedPackageSchema>;

export const analyzedServiceSchema = z.object({
  name: z.string(),
  // Freeform pricing note — kept for the messy multi-point tail and as the
  // `priceText` reference on the created service. Placeholder strings
  // ("Prices Vary", "Pricing not specifically mentioned.") are NOT emitted.
  pricingDescription: z.string().optional(),
  // Structured price anchor the AI extracts alongside the freeform text — the
  // single number it already finds, classified. `priceAmount` is in whole
  // local-currency units (e.g. 150 for "£150"); apply-analysis converts to
  // cents. Unknown/absent price → priceType 'poa' with no priceAmount.
  priceType: z.enum(servicePriceTypeValues).optional(),
  priceAmount: z.number().nonnegative().optional(),
});

export type AnalyzedService = z.infer<typeof analyzedServiceSchema>;

export const analyzeWebsiteResponseSchema = z.object({
  services: z.array(analyzedServiceSchema),
  targetAudienceDescription: z.string(),
  // Customer-facing "about this venue" prose for the booking page — what the
  // business does and what it is like to visit. Distinct from
  // targetAudienceDescription / credibility lines, which are ad-copy inputs.
  businessDescription: z.string().optional(),
  brandVoice: z.array(z.string()),
  suggestedCredibilityLines: z.array(z.string()),
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  logoUrl: z.string().url().optional().nullable(),
  locations: z.array(analyzedLocationSchema).optional().default([]),
  businessHours: analyzedBusinessHoursSchema.optional(),
  practitioners: z.array(analyzedPractitionerSchema).optional().default([]),
  packages: z.array(analyzedPackageSchema).optional().default([]),
});

export type AnalyzeWebsiteResponse = z.infer<
  typeof analyzeWebsiteResponseSchema
>;

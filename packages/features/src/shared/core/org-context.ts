import {
  organization,
  organizationLocation,
  organizationService,
} from '@borradh-workspace/database';
import { businessTypeLabels } from '@borradh-workspace/labels';
import { and, asc, desc, eq } from 'drizzle-orm';
import { notDeleted } from './soft-delete.js';
import type { DbConnection } from './types.js';

/**
 * The org's primary location country (lowercase ISO alpha-2), or null when the
 * org has no location on file. Prefers the `isPrimary` location, else the
 * earliest-created one.
 */
export async function getOrgCountry(
  db: DbConnection,
  organizationId: string
): Promise<string | null> {
  const [loc] = await db
    .select({ country: organizationLocation.country })
    .from(organizationLocation)
    .where(eq(organizationLocation.organizationId, organizationId))
    .orderBy(
      desc(organizationLocation.isPrimary),
      asc(organizationLocation.createdAt)
    )
    .limit(1);
  return loc?.country ?? null;
}

// NOTE: `getOrgCurrency` (org country → display currency) intentionally lives in
// the domain-flavored `../currency-for-country.js` module, NOT here — it depends
// on currency logic which is not part of the extractable stable core. The
// `../org-context.js` back-compat shim re-exports it so existing importers keep
// working unchanged.

export interface OrgServiceContext {
  name: string;
  painPoints: string[] | null;
  expectedResults: string[] | null;
  processDescription: string | null;
  targetArea: string | null;
}

export interface OrgContext {
  businessType: keyof typeof businessTypeLabels;
  brandVoice: string[];
  targetAudienceDescription: string | null;
  credibilityLine: string | null;
  tagline: string | null;
  services: string[];
  /** Detailed service info for richer AI prompts */
  serviceDetails: OrgServiceContext[];
  /**
   * Primary location country (lowercase ISO alpha-2), or null when unknown.
   * Drives the display currency for offer prices in ad copy. Optional so
   * existing OrgContext literals don't need updating; `getOrgContext`
   * populates it.
   */
  country?: string | null;
  /**
   * The org's standing content rules, as prompt lines ("Always mention the €50
   * deposit"). These are user-taught during content review and stored as
   * `knowledge_entry` preferences.
   *
   * Deliberately NOT populated by `getOrgContext`: reading them means calling
   * `getContentRuleLines` from the assistant package, and this module is the
   * extractable stable core — it must not depend on a feature domain (same
   * reason `getOrgCurrency` lives elsewhere). Callers that build a copy prompt
   * fetch the lines and spread them in; callers that don't simply omit the
   * field and lose nothing.
   */
  contentRules?: string[];
}

/**
 * Fetch organization context for prompt building.
 * When `serviceId` is provided, only that service's details are included
 * so the AI prompt focuses on the selected service.
 */
export async function getOrgContext(
  db: DbConnection,
  organizationId: string,
  serviceId?: string
): Promise<OrgContext | null> {
  const org = await db.query.organization.findFirst({
    where: and(eq(organization.id, organizationId), notDeleted(organization)),
    columns: {
      businessType: true,
      brandVoice: true,
      targetAudienceDescription: true,
      credibilityLine: true,
      tagline: true,
    },
  });

  if (!org) return null;

  // Fetch organization services with content generation fields
  // When serviceId is provided, only fetch that specific service
  const serviceFilter = serviceId
    ? and(
        eq(organizationService.organizationId, organizationId),
        eq(organizationService.id, serviceId)
      )
    : eq(organizationService.organizationId, organizationId);

  const services = await db
    .select({
      name: organizationService.name,
      painPoints: organizationService.painPoints,
      expectedResults: organizationService.expectedResults,
      processDescription: organizationService.processDescription,
      targetArea: organizationService.targetArea,
    })
    .from(organizationService)
    .where(serviceFilter);

  const country = await getOrgCountry(db, organizationId);

  return {
    country,
    businessType: org.businessType as keyof typeof businessTypeLabels,
    brandVoice: (org.brandVoice as string[]) || [],
    targetAudienceDescription: org.targetAudienceDescription,
    credibilityLine: org.credibilityLine,
    tagline: org.tagline,
    services: services.map((s) => s.name),
    serviceDetails: services.map((s) => ({
      name: s.name,
      painPoints: s.painPoints as string[] | null,
      expectedResults: s.expectedResults as string[] | null,
      processDescription: s.processDescription,
      targetArea: s.targetArea,
    })),
  };
}

/**
 * Build a context block string from org context for use in AI prompts
 */
export function buildOrgContextBlock(org: OrgContext): string {
  const lines: string[] = [];

  lines.push(
    `Business type: ${businessTypeLabels[org.businessType] || org.businessType}`
  );

  if (org.brandVoice.length > 0) {
    lines.push(`Write in a tone that is: ${org.brandVoice.join(', ')}`);
  }

  // Placed directly after brand voice and stated as non-negotiable: these are
  // corrections the owner has already made by hand, so they outrank the
  // model's defaults. Anything further down the block reads as background.
  if (org.contentRules?.length) {
    lines.push('');
    lines.push(
      'Content rules — the owner set these and they are not optional. Where one conflicts with any other instruction, the rule wins:'
    );
    for (const rule of org.contentRules) {
      lines.push(`- ${rule}`);
    }
    lines.push('');
  }

  if (org.targetAudienceDescription) {
    lines.push(`Target audience: ${org.targetAudienceDescription}`);
  }

  if (org.credibilityLine) {
    lines.push(`Credibility: ${org.credibilityLine}`);
  }

  if (org.tagline) {
    lines.push(`Tagline: ${org.tagline}`);
  }

  if (org.services.length > 0) {
    lines.push(`Services offered: ${org.services.join(', ')}`);
  }

  // Include detailed service info for richer AI content generation
  const detailedServices = org.serviceDetails.filter(
    (s) =>
      s.painPoints?.length ||
      s.expectedResults?.length ||
      s.processDescription ||
      s.targetArea
  );
  if (detailedServices.length > 0) {
    lines.push('');
    lines.push('Service details:');
    for (const s of detailedServices) {
      lines.push(`- ${s.name}:`);
      if (s.painPoints?.length)
        lines.push(`  Pain points clients have: ${s.painPoints.join(', ')}`);
      if (s.expectedResults?.length)
        lines.push(`  Expected results: ${s.expectedResults.join(', ')}`);
      if (s.processDescription)
        lines.push(`  How it works: ${s.processDescription}`);
      if (s.targetArea) lines.push(`  Target area: ${s.targetArea}`);
    }
  }

  return lines.join('\n');
}

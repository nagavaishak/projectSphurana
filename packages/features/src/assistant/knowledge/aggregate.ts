import {
  and,
  db,
  eq,
  inArray,
  metaAd,
  organization,
  socialPost,
  video,
} from '@borradh-workspace/database';
import type { MetaTargeting } from '@borradh-workspace/database';
import { logError } from '@borradh-workspace/observability';
import { notDeleted } from '../../shared/index.js';
import { upsertKnowledgeEntry } from './populate.js';

/** Minimum number of contributing orgs required per insight group to ensure anonymity */
const MIN_ORGS_PER_GROUP = 5;

/** Expiry period for aggregate insights (7 days = weekly refresh) */
const EXPIRY_DAYS = 7;

function getExpiryDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() + EXPIRY_DAYS);
  return d;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface OrgRow {
  id: string;
  businessType: string;
}

/**
 * Get all opted-in organizations grouped by business type.
 */
async function getOptedInOrgs(): Promise<Map<string, OrgRow[]>> {
  const orgs = await db
    .select({ id: organization.id, businessType: organization.businessType })
    .from(organization)
    .where(
      and(
        eq(organization.contributeToAggregateInsights, true),
        notDeleted(organization)
      )
    );

  const grouped = new Map<string, OrgRow[]>();
  for (const org of orgs) {
    const list = grouped.get(org.businessType) ?? [];
    list.push(org);
    grouped.set(org.businessType, list);
  }
  return grouped;
}

/**
 * Return only groups with at least MIN_ORGS_PER_GROUP contributing orgs.
 */
function filterByMinOrgs(
  grouped: Map<string, OrgRow[]>
): Map<string, OrgRow[]> {
  const result = new Map<string, OrgRow[]>();
  for (const [bt, orgs] of grouped) {
    if (orgs.length >= MIN_ORGS_PER_GROUP) {
      result.set(bt, orgs);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// aggregateAdInsights
// ---------------------------------------------------------------------------

/**
 * Aggregate ad structural data across opted-in orgs, grouped by business type.
 * Creates `industry_benchmark` knowledge entries with organizationId = null.
 *
 * Currently aggregates: CTA popularity, video usage, follow-up type distribution,
 * and template usage patterns.
 *
 * TODO: When an ad metrics table is added (impressions, clicks, spend, conversions),
 * aggregate: average CPL, average CTR, conversion rate by business type.
 */
export async function aggregateAdInsights(): Promise<void> {
  const grouped = filterByMinOrgs(await getOptedInOrgs());
  if (grouped.size === 0) return;

  const expiresAt = getExpiryDate();

  for (const [businessType, orgs] of grouped) {
    try {
      const orgIds = orgs.map((o) => o.id);

      const ads = await db
        .select({
          callToAction: metaAd.callToAction,
          followUpType: metaAd.followUpType,
          videoId: metaAd.videoId,
          organizationId: metaAd.organizationId,
        })
        .from(metaAd)
        .where(inArray(metaAd.organizationId, orgIds));

      if (ads.length === 0) continue;

      // CTA distribution
      const ctaCounts: Record<string, number> = {};
      const followUpCounts: Record<string, number> = {};
      let withVideo = 0;
      const uniqueOrgIds = new Set(ads.map((a) => a.organizationId));

      for (const ad of ads) {
        if (ad.callToAction) {
          ctaCounts[ad.callToAction] = (ctaCounts[ad.callToAction] || 0) + 1;
        }
        if (ad.followUpType) {
          followUpCounts[ad.followUpType] =
            (followUpCounts[ad.followUpType] || 0) + 1;
        }
        if (ad.videoId) withVideo++;
      }

      // Template usage from videos linked to ads
      const adVideoIds = ads
        .filter((a) => a.videoId)
        .map((a) => a.videoId as string);
      const templateCounts: Record<string, number> = {};
      if (adVideoIds.length > 0) {
        const videos = await db
          .select({ templateId: video.templateId })
          .from(video)
          .where(and(inArray(video.id, adVideoIds), notDeleted(video)));
        for (const v of videos) {
          if (v.templateId) {
            templateCounts[v.templateId] =
              (templateCounts[v.templateId] || 0) + 1;
          }
        }
      }

      const parts: string[] = [];
      parts.push(
        `Industry benchmark for ${businessType} businesses (${uniqueOrgIds.size} contributors, ${ads.length} ads total)`
      );

      // CTA ranking
      const ctaRanked = Object.entries(ctaCounts).sort((a, b) => b[1] - a[1]);
      if (ctaRanked.length > 0) {
        const ctaSummary = ctaRanked
          .slice(0, 5)
          .map(
            ([cta, count]) =>
              `${cta} (${Math.round((count / ads.length) * 100)}%)`
          )
          .join(', ');
        parts.push(`Most popular CTAs: ${ctaSummary}`);
      }

      // Video usage rate
      if (ads.length > 0) {
        parts.push(
          `Video creative usage: ${Math.round((withVideo / ads.length) * 100)}% of ads use video`
        );
      }

      // Follow-up type distribution
      const followUpRanked = Object.entries(followUpCounts).sort(
        (a, b) => b[1] - a[1]
      );
      if (followUpRanked.length > 0) {
        const fSummary = followUpRanked
          .map(
            ([type, count]) =>
              `${type} (${Math.round((count / ads.length) * 100)}%)`
          )
          .join(', ');
        parts.push(`Follow-up type distribution: ${fSummary}`);
      }

      // Template usage
      const templateRanked = Object.entries(templateCounts).sort(
        (a, b) => b[1] - a[1]
      );
      if (templateRanked.length > 0) {
        const tSummary = templateRanked
          .slice(0, 3)
          .map(([tmpl, count]) => `${tmpl} (${count} uses)`)
          .join(', ');
        parts.push(`Top video templates in ads: ${tSummary}`);
      }

      // TODO: When ad metrics table exists, add:
      // - Average CPL by business type
      // - Average CTR by business type
      // - Conversion rate benchmarks

      await upsertKnowledgeEntry({
        organizationId: null,
        type: 'industry_benchmark',
        title: `Ad Benchmarks — ${businessType}`,
        content: parts.join('. '),
        source: 'auto',
        confidence: 0.85,
        expiresAt,
        metadata: {
          businessType,
          contributingOrgs: uniqueOrgIds.size,
          totalAds: ads.length,
          ctaCounts,
          videoUsageRate: ads.length
            ? Math.round((withVideo / ads.length) * 100)
            : 0,
        },
      });
    } catch (error) {
      logError('assistant.aggregateAdInsights', error, {
        feature: 'assistant',
        extra: { businessType },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// aggregatePostInsights
// ---------------------------------------------------------------------------

/**
 * Aggregate social post patterns across opted-in orgs, grouped by business type.
 *
 * Aggregates: optimal posting hours, best posting days, platform preferences,
 * media type distribution.
 */
export async function aggregatePostInsights(): Promise<void> {
  const grouped = filterByMinOrgs(await getOptedInOrgs());
  if (grouped.size === 0) return;

  const expiresAt = getExpiryDate();

  for (const [businessType, orgs] of grouped) {
    try {
      const orgIds = orgs.map((o) => o.id);

      const posts = await db
        .select({
          mediaType: socialPost.mediaType,
          platforms: socialPost.platforms,
          status: socialPost.status,
          publishedAt: socialPost.publishedAt,
          scheduledAt: socialPost.scheduledAt,
          organizationId: socialPost.organizationId,
        })
        .from(socialPost)
        .where(inArray(socialPost.organizationId, orgIds));

      const published = posts.filter((p) => p.status === 'published');
      if (published.length === 0) continue;

      const uniqueOrgIds = new Set(published.map((p) => p.organizationId));

      const dayNames = [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
      ];
      const hourCounts: Record<number, number> = {};
      const dayCounts: Record<string, number> = {};
      const platformCounts: Record<string, number> = {};
      const mediaTypeCounts: Record<string, number> = {};

      for (const post of published) {
        // Media type
        mediaTypeCounts[post.mediaType] =
          (mediaTypeCounts[post.mediaType] || 0) + 1;

        // Platforms
        const platforms = post.platforms as string[] | null;
        if (platforms) {
          for (const p of platforms) {
            platformCounts[p] = (platformCounts[p] || 0) + 1;
          }
        }

        // Posting time analysis
        const pubTime = post.publishedAt || post.scheduledAt;
        if (pubTime) {
          const dt = new Date(pubTime);
          hourCounts[dt.getHours()] = (hourCounts[dt.getHours()] || 0) + 1;
          const day = dayNames[dt.getDay()];
          dayCounts[day] = (dayCounts[day] || 0) + 1;
        }
      }

      const parts: string[] = [];
      parts.push(
        `Industry benchmark for ${businessType} businesses (${uniqueOrgIds.size} contributors, ${published.length} published posts)`
      );

      // Optimal posting hours
      const topHours = Object.entries(hourCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      if (topHours.length > 0) {
        const formatHour = (h: number) => {
          const period = h >= 12 ? 'PM' : 'AM';
          const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
          return `${display}:00 ${period}`;
        };
        const hourSummary = topHours
          .map(
            ([h, count]) =>
              `${formatHour(Number(h))} (${Math.round((count / published.length) * 100)}%)`
          )
          .join(', ');
        parts.push(`Most popular posting hours: ${hourSummary}`);
      }

      // Best posting days
      const topDays = Object.entries(dayCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      if (topDays.length > 0) {
        const daySummary = topDays
          .map(
            ([day, count]) =>
              `${day} (${Math.round((count / published.length) * 100)}%)`
          )
          .join(', ');
        parts.push(`Most popular posting days: ${daySummary}`);
      }

      // Platform distribution
      const platformRanked = Object.entries(platformCounts).sort(
        (a, b) => b[1] - a[1]
      );
      if (platformRanked.length > 0) {
        const totalPlatformPicks = platformRanked.reduce(
          (sum, [, c]) => sum + c,
          0
        );
        const pSummary = platformRanked
          .map(
            ([platform, count]) =>
              `${platform} (${Math.round((count / totalPlatformPicks) * 100)}%)`
          )
          .join(', ');
        parts.push(`Platform preference: ${pSummary}`);
      }

      // Media type distribution
      const mediaRanked = Object.entries(mediaTypeCounts).sort(
        (a, b) => b[1] - a[1]
      );
      if (mediaRanked.length > 0) {
        const mSummary = mediaRanked
          .map(
            ([type, count]) =>
              `${type} (${Math.round((count / published.length) * 100)}%)`
          )
          .join(', ');
        parts.push(`Media type distribution: ${mSummary}`);
      }

      await upsertKnowledgeEntry({
        organizationId: null,
        type: 'industry_benchmark',
        title: `Post Benchmarks — ${businessType}`,
        content: parts.join('. '),
        source: 'auto',
        confidence: 0.85,
        expiresAt,
        metadata: {
          businessType,
          contributingOrgs: uniqueOrgIds.size,
          totalPublished: published.length,
          hourCounts,
          dayCounts,
          platformCounts,
          mediaTypeCounts,
        },
      });
    } catch (error) {
      logError('assistant.aggregatePostInsights', error, {
        feature: 'assistant',
        extra: { businessType },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// aggregateTargetingInsights
// ---------------------------------------------------------------------------

/**
 * Aggregate ad targeting patterns across opted-in orgs, grouped by business type.
 *
 * Aggregates: broad vs narrow targeting usage, age range distribution,
 * gender targeting patterns, distance/radius preferences.
 */
export async function aggregateTargetingInsights(): Promise<void> {
  const grouped = filterByMinOrgs(await getOptedInOrgs());
  if (grouped.size === 0) return;

  const expiresAt = getExpiryDate();

  for (const [businessType, orgs] of grouped) {
    try {
      const orgIds = orgs.map((o) => o.id);

      const ads = await db
        .select({
          targetingOverride: metaAd.targetingOverride,
          organizationId: metaAd.organizationId,
        })
        .from(metaAd)
        .where(inArray(metaAd.organizationId, orgIds));

      if (ads.length === 0) continue;

      const uniqueOrgIds = new Set(ads.map((a) => a.organizationId));

      let broadTargeting = 0;
      let narrowTargeting = 0;
      const ageMins: number[] = [];
      const ageMaxes: number[] = [];
      const genderCounts: Record<string, number> = {
        all: 0,
        male: 0,
        female: 0,
      };
      const distances: number[] = [];

      for (const ad of ads) {
        const targeting = ad.targetingOverride as MetaTargeting | null;

        if (
          !targeting ||
          (!targeting.ageMin &&
            !targeting.ageMax &&
            !targeting.genders?.length &&
            !targeting.distanceKm)
        ) {
          broadTargeting++;
        } else {
          narrowTargeting++;
        }

        if (targeting?.ageMin) ageMins.push(targeting.ageMin);
        if (targeting?.ageMax) ageMaxes.push(targeting.ageMax);

        if (targeting?.genders && targeting.genders.length > 0) {
          for (const g of targeting.genders) {
            if (g === 1) genderCounts.male++;
            else if (g === 2) genderCounts.female++;
          }
        } else {
          genderCounts.all++;
        }

        if (targeting?.distanceKm) distances.push(targeting.distanceKm);
      }

      const parts: string[] = [];
      parts.push(
        `Targeting benchmark for ${businessType} businesses (${uniqueOrgIds.size} contributors, ${ads.length} ads)`
      );

      // Broad vs narrow
      const totalTargeted = broadTargeting + narrowTargeting;
      if (totalTargeted > 0) {
        parts.push(
          `Targeting approach: ${Math.round((broadTargeting / totalTargeted) * 100)}% broad, ${Math.round((narrowTargeting / totalTargeted) * 100)}% narrow`
        );
      }

      // Age ranges
      if (ageMins.length > 0) {
        const avgMin = Math.round(
          ageMins.reduce((a, b) => a + b, 0) / ageMins.length
        );
        const avgMax = ageMaxes.length
          ? Math.round(ageMaxes.reduce((a, b) => a + b, 0) / ageMaxes.length)
          : null;
        parts.push(
          `Average age targeting: ${avgMin}${avgMax ? `–${avgMax}` : '+'}`
        );
      }

      // Gender targeting
      const totalGender =
        genderCounts.all + genderCounts.male + genderCounts.female;
      if (totalGender > 0) {
        const gParts: string[] = [];
        if (genderCounts.all > 0)
          gParts.push(
            `all genders ${Math.round((genderCounts.all / totalGender) * 100)}%`
          );
        if (genderCounts.female > 0)
          gParts.push(
            `female-only ${Math.round((genderCounts.female / totalGender) * 100)}%`
          );
        if (genderCounts.male > 0)
          gParts.push(
            `male-only ${Math.round((genderCounts.male / totalGender) * 100)}%`
          );
        parts.push(`Gender targeting: ${gParts.join(', ')}`);
      }

      // Distance/radius
      if (distances.length > 0) {
        const avgDist = Math.round(
          distances.reduce((a, b) => a + b, 0) / distances.length
        );
        const minDist = Math.min(...distances);
        const maxDist = Math.max(...distances);
        parts.push(
          `Location radius: avg ${avgDist} km (range ${minDist}–${maxDist} km)`
        );
      }

      await upsertKnowledgeEntry({
        organizationId: null,
        type: 'industry_benchmark',
        title: `Targeting Benchmarks — ${businessType}`,
        content: parts.join('. '),
        source: 'auto',
        confidence: 0.85,
        expiresAt,
        metadata: {
          businessType,
          contributingOrgs: uniqueOrgIds.size,
          totalAds: ads.length,
          broadTargetingPct: totalTargeted
            ? Math.round((broadTargeting / totalTargeted) * 100)
            : null,
        },
      });
    } catch (error) {
      logError('assistant.aggregateTargetingInsights', error, {
        feature: 'assistant',
        extra: { businessType },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run all aggregation functions with error isolation per function.
 * Each function can fail independently without blocking the others.
 */
export async function runAllAggregations(): Promise<{
  succeeded: string[];
  failed: string[];
}> {
  const results: { succeeded: string[]; failed: string[] } = {
    succeeded: [],
    failed: [],
  };

  const tasks = [
    { name: 'aggregateAdInsights', fn: aggregateAdInsights },
    { name: 'aggregatePostInsights', fn: aggregatePostInsights },
    { name: 'aggregateTargetingInsights', fn: aggregateTargetingInsights },
  ];

  for (const task of tasks) {
    try {
      await task.fn();
      results.succeeded.push(task.name);
    } catch (error) {
      results.failed.push(task.name);
      logError(`assistant.${task.name}`, error, {
        feature: 'assistant',
      });
    }
  }

  return results;
}

import {
  and,
  conversation,
  db,
  desc,
  eq,
  type knowledgeEntry,
  lead,
  metaAd,
  organization,
  organizationService,
  socialPost,
  sql,
  video,
} from '@borradh-workspace/database';
import type { KnowledgeEntry } from '@borradh-workspace/database';
import { logError } from '@borradh-workspace/observability';
import { notDeleted } from '../../shared/index.js';
import { generateEmbedding } from './embed.js';

/**
 * Upsert a knowledge entry by (organizationId, type, title).
 * If an entry with the same org+type+title exists, update content + embedding.
 * Otherwise, insert a new entry.
 */
export async function upsertKnowledgeEntry(params: {
  organizationId: string | null;
  type: (typeof knowledgeEntry.type.enumValues)[number];
  title: string;
  content: string;
  source: 'auto' | 'ai' | 'manual';
  confidence?: number;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const embedding = await generateEmbedding(params.content);
  const embeddingStr = `[${embedding.join(',')}]`;
  const metadataJson = params.metadata ? JSON.stringify(params.metadata) : null;

  // Check for existing entry by logical key (org + type + title)
  const existing = await db.execute<{ id: string }>(sql`
    SELECT id FROM knowledge_entry
    WHERE
      (organization_id = ${params.organizationId} OR (organization_id IS NULL AND ${params.organizationId}::text IS NULL))
      AND type = ${params.type}
      AND title = ${params.title}
    ORDER BY created_at DESC
    LIMIT 1
  `);

  if (existing.length > 0) {
    await db.execute(sql`
      UPDATE knowledge_entry
      SET
        content = ${params.content},
        embedding = ${embeddingStr}::vector,
        confidence = ${params.confidence ?? 1.0},
        expires_at = ${params.expiresAt?.toISOString() ?? null},
        metadata = ${metadataJson}::jsonb,
        updated_at = NOW()
      WHERE id = ${existing[0].id}
    `);
  } else {
    await db.execute(sql`
      INSERT INTO knowledge_entry (id, organization_id, type, title, content, embedding, source, confidence, expires_at, metadata, created_at, updated_at)
      VALUES (
        gen_random_uuid(),
        ${params.organizationId},
        ${params.type},
        ${params.title},
        ${params.content},
        ${embeddingStr}::vector,
        ${params.source},
        ${params.confidence ?? 1.0},
        ${params.expiresAt?.toISOString() ?? null},
        ${metadataJson}::jsonb,
        NOW(),
        NOW()
      )
    `);
  }
}

/**
 * Populate knowledge base with organization profile data.
 * Creates/updates a single "org_profile" entry with business context.
 */
export async function populateOrgProfile(
  organizationId: string
): Promise<void> {
  try {
    const org = await db.query.organization.findFirst({
      where: and(eq(organization.id, organizationId), notDeleted(organization)),
      columns: {
        name: true,
        businessType: true,
        brandVoice: true,
        targetAudienceDescription: true,
        credibilityLine: true,
        tagline: true,
        address: true,
      },
    });

    if (!org) return;

    const parts: string[] = [];
    parts.push(`Business: ${org.name}`);
    parts.push(`Type: ${org.businessType}`);

    if (org.address) {
      parts.push(`Location: ${org.address}`);
    }

    const brandVoice = org.brandVoice as string[] | null;
    if (brandVoice?.length) {
      parts.push(`Brand voice: ${brandVoice.join(', ')}`);
    }

    if (org.targetAudienceDescription) {
      parts.push(`Target audience: ${org.targetAudienceDescription}`);
    }

    if (org.credibilityLine) {
      parts.push(`Credibility: ${org.credibilityLine}`);
    }

    if (org.tagline) {
      parts.push(`Tagline: ${org.tagline}`);
    }

    const content = parts.join('. ');

    await upsertKnowledgeEntry({
      organizationId,
      type: 'org_profile',
      title: `${org.name} — Organization Profile`,
      content,
      source: 'auto',
      confidence: 1.0,
      metadata: { businessType: org.businessType },
    });
  } catch (error) {
    logError('assistant.populateOrgProfile', error, {
      feature: 'assistant',
      extra: { organizationId },
    });
  }
}

/**
 * Populate knowledge base with all organization services.
 * Creates/updates one "service" entry per service.
 */
export async function populateServices(organizationId: string): Promise<void> {
  try {
    const services = await db
      .select({
        id: organizationService.id,
        name: organizationService.name,
        painPoints: organizationService.painPoints,
        expectedResults: organizationService.expectedResults,
        processDescription: organizationService.processDescription,
        targetArea: organizationService.targetArea,
      })
      .from(organizationService)
      .where(eq(organizationService.organizationId, organizationId));

    for (const svc of services) {
      const parts: string[] = [];
      parts.push(`Service: ${svc.name}`);

      const painPoints = svc.painPoints as string[] | null;
      if (painPoints?.length) {
        parts.push(`Client pain points: ${painPoints.join(', ')}`);
      }

      const expectedResults = svc.expectedResults as string[] | null;
      if (expectedResults?.length) {
        parts.push(`Expected results: ${expectedResults.join(', ')}`);
      }

      if (svc.processDescription) {
        parts.push(`Process: ${svc.processDescription}`);
      }

      if (svc.targetArea) {
        parts.push(`Target area: ${svc.targetArea}`);
      }

      const content = parts.join('. ');

      await upsertKnowledgeEntry({
        organizationId,
        type: 'service',
        title: `Service — ${svc.name}`,
        content,
        source: 'auto',
        confidence: 1.0,
        metadata: { serviceId: svc.id },
      });
    }
  } catch (error) {
    logError('assistant.populateServices', error, {
      feature: 'assistant',
      extra: { organizationId },
    });
  }
}

/**
 * Populate knowledge base with ad performance insights.
 * Queries all meta_ads for the org and generates performance summaries.
 * Entries expire after 30 days (ad performance changes over time).
 */
export async function populateAdInsights(
  organizationId: string
): Promise<void> {
  try {
    const ads = await db
      .select({
        id: metaAd.id,
        name: metaAd.name,
        status: metaAd.status,
        headline: metaAd.headline,
        primaryText: metaAd.primaryText,
        callToAction: metaAd.callToAction,
        followUpType: metaAd.followUpType,
        metaAdId: metaAd.metaAdId,
        metaStatus: metaAd.metaStatus,
        videoId: metaAd.videoId,
        createdAt: metaAd.createdAt,
      })
      .from(metaAd)
      .where(eq(metaAd.organizationId, organizationId))
      .orderBy(desc(metaAd.createdAt));

    if (ads.length === 0) return;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // Summary entry across all ads
    const statusCounts: Record<string, number> = {};
    const ctaCounts: Record<string, number> = {};
    const followUpCounts: Record<string, number> = {};
    let withVideo = 0;

    for (const ad of ads) {
      const status = ad.metaStatus || ad.status;
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      if (ad.callToAction) {
        ctaCounts[ad.callToAction] = (ctaCounts[ad.callToAction] || 0) + 1;
      }
      if (ad.followUpType) {
        followUpCounts[ad.followUpType] =
          (followUpCounts[ad.followUpType] || 0) + 1;
      }
      if (ad.videoId) withVideo++;
    }

    const parts: string[] = [];
    parts.push(`Total ads: ${ads.length}`);

    const statusSummary = Object.entries(statusCounts)
      .map(([s, c]) => `${s}: ${c}`)
      .join(', ');
    parts.push(`Status breakdown: ${statusSummary}`);

    if (withVideo > 0) {
      parts.push(
        `${withVideo} of ${ads.length} ads use video creative (${Math.round((withVideo / ads.length) * 100)}%)`
      );
    }

    if (Object.keys(ctaCounts).length > 0) {
      const topCta = Object.entries(ctaCounts).sort((a, b) => b[1] - a[1])[0];
      parts.push(`Most common CTA: ${topCta[0]} (used ${topCta[1]} times)`);
    }

    if (Object.keys(followUpCounts).length > 0) {
      const followUpSummary = Object.entries(followUpCounts)
        .map(([f, c]) => `${f}: ${c}`)
        .join(', ');
      parts.push(`Follow-up types: ${followUpSummary}`);
    }

    await upsertKnowledgeEntry({
      organizationId,
      type: 'ad_insight',
      title: 'Ad Portfolio Overview',
      content: parts.join('. '),
      source: 'auto',
      confidence: 0.9,
      expiresAt,
      metadata: { adCount: ads.length, statusCounts, ctaCounts },
    });

    // Per-ad entries for ads that are active or have Meta sync
    const activeAds = ads.filter(
      (a) => a.metaAdId && (a.metaStatus === 'ACTIVE' || a.status === 'active')
    );

    for (const ad of activeAds) {
      const adParts: string[] = [];
      adParts.push(`Ad: ${ad.name}`);
      if (ad.headline) adParts.push(`Headline: "${ad.headline}"`);
      if (ad.primaryText) {
        const truncated =
          ad.primaryText.length > 100
            ? `${ad.primaryText.slice(0, 100)}...`
            : ad.primaryText;
        adParts.push(`Primary text: "${truncated}"`);
      }
      if (ad.callToAction) adParts.push(`CTA: ${ad.callToAction}`);
      adParts.push(`Status: ${ad.metaStatus || ad.status}`);
      adParts.push(`Follow-up: ${ad.followUpType}`);
      if (ad.videoId) adParts.push('Uses video creative');

      await upsertKnowledgeEntry({
        organizationId,
        type: 'ad_insight',
        title: `Ad — ${ad.name}`,
        content: adParts.join('. '),
        source: 'auto',
        confidence: 0.85,
        expiresAt,
        metadata: { adId: ad.id, metaAdId: ad.metaAdId },
      });
    }
  } catch (error) {
    logError('assistant.populateAdInsights', error, {
      feature: 'assistant',
      extra: { organizationId },
    });
  }
}

/**
 * Populate knowledge base with social post engagement insights.
 * Analyzes published posts for patterns (timing, platforms, media types).
 * Entries expire after 90 days.
 */
export async function populatePostInsights(
  organizationId: string
): Promise<void> {
  try {
    const posts = await db
      .select({
        id: socialPost.id,
        title: socialPost.title,
        caption: socialPost.caption,
        mediaType: socialPost.mediaType,
        platforms: socialPost.platforms,
        status: socialPost.status,
        scheduledAt: socialPost.scheduledAt,
        publishedAt: socialPost.publishedAt,
        platformResults: socialPost.platformResults,
        createdAt: socialPost.createdAt,
      })
      .from(socialPost)
      .where(eq(socialPost.organizationId, organizationId))
      .orderBy(desc(socialPost.createdAt));

    if (posts.length === 0) return;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);

    const published = posts.filter((p) => p.status === 'published');
    const scheduled = posts.filter((p) => p.status === 'scheduled');
    const drafts = posts.filter((p) => p.status === 'draft');

    const mediaTypeCounts: Record<string, number> = {};
    const platformCounts: Record<string, number> = {};
    const publishHours: number[] = [];

    for (const post of published) {
      mediaTypeCounts[post.mediaType] =
        (mediaTypeCounts[post.mediaType] || 0) + 1;

      const platforms = post.platforms as string[] | null;
      if (platforms) {
        for (const p of platforms) {
          platformCounts[p] = (platformCounts[p] || 0) + 1;
        }
      }

      const pubTime = post.publishedAt || post.scheduledAt;
      if (pubTime) {
        publishHours.push(new Date(pubTime).getHours());
      }
    }

    const parts: string[] = [];
    parts.push(
      `Total posts: ${posts.length} (${published.length} published, ${scheduled.length} scheduled, ${drafts.length} drafts)`
    );

    if (Object.keys(mediaTypeCounts).length > 0) {
      const mediaSummary = Object.entries(mediaTypeCounts)
        .map(([m, c]) => `${m}: ${c}`)
        .join(', ');
      parts.push(`Media types: ${mediaSummary}`);
    }

    if (Object.keys(platformCounts).length > 0) {
      const platformSummary = Object.entries(platformCounts)
        .map(([p, c]) => `${p}: ${c}`)
        .join(', ');
      parts.push(`Platform usage: ${platformSummary}`);
    }

    // Analyze day-of-week and hour patterns
    const dayNames = [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ];
    const dayCounts: Record<string, number> = {};
    const hourCounts: Record<number, number> = {};

    for (const h of publishHours) {
      hourCounts[h] = (hourCounts[h] || 0) + 1;
    }

    for (const post of published) {
      const pubTime = post.publishedAt || post.scheduledAt;
      if (pubTime) {
        const day = dayNames[new Date(pubTime).getDay()];
        dayCounts[day] = (dayCounts[day] || 0) + 1;
      }
    }

    if (publishHours.length >= 3) {
      // Most common posting hour
      const topHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];
      const hourNum = Number(topHour[0]);
      const period = hourNum >= 12 ? 'PM' : 'AM';
      const hour12 = hourNum === 0 ? 12 : hourNum > 12 ? hourNum - 12 : hourNum;
      parts.push(
        `Most common posting time: ${hour12} ${period} (${topHour[1]} posts)`
      );
    }

    if (Object.keys(dayCounts).length >= 2) {
      // Most common posting days
      const topDays = Object.entries(dayCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      const daySummary = topDays
        .map(([day, count]) => `${day}s (${count} posts)`)
        .join(', ');
      parts.push(`Best posting days: ${daySummary}`);
    }

    // Check for failed posts
    const failed = posts.filter((p) => p.status === 'failed');
    if (failed.length > 0) {
      parts.push(
        `${failed.length} post(s) failed to publish — may need attention`
      );
    }

    await upsertKnowledgeEntry({
      organizationId,
      type: 'post_insight',
      title: 'Social Post Overview',
      content: parts.join('. '),
      source: 'auto',
      confidence: 0.9,
      expiresAt,
      metadata: {
        totalPosts: posts.length,
        publishedCount: published.length,
        mediaTypeCounts,
        platformCounts,
        dayCounts,
        hourCounts,
      },
    });

    // Create a dedicated scheduling insight entry
    if (published.length >= 5) {
      const schedulingParts: string[] = [];
      const topDays = Object.entries(dayCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2);
      const topHours = Object.entries(hourCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2);

      if (topDays.length > 0) {
        schedulingParts.push(
          `Your most active posting days are ${topDays.map(([d, c]) => `${d}s (${c} posts)`).join(' and ')}`
        );
      }

      if (topHours.length > 0) {
        const formatHour = (h: number) => {
          const p = h >= 12 ? 'PM' : 'AM';
          const d = h === 0 ? 12 : h > 12 ? h - 12 : h;
          return `${d}:00 ${p}`;
        };
        schedulingParts.push(
          `Your most common posting times are around ${topHours.map(([h, c]) => `${formatHour(Number(h))} (${c} posts)`).join(' and ')}`
        );
      }

      if (schedulingParts.length > 0) {
        schedulingParts.push(
          'Consider posting at these times for consistency, or experiment with new windows to find higher engagement.'
        );

        await upsertKnowledgeEntry({
          organizationId,
          type: 'post_insight',
          title: 'Posting Schedule Patterns',
          content: schedulingParts.join('. '),
          source: 'auto',
          confidence: 0.85,
          expiresAt,
          metadata: { dayCounts, hourCounts },
        });
      }
    }
  } catch (error) {
    logError('assistant.populatePostInsights', error, {
      feature: 'assistant',
      extra: { organizationId },
    });
  }
}

/**
 * Populate knowledge base with video creation preferences.
 * Tracks which templates, music, caption styles the user prefers.
 * No expiry — preferences are long-lived.
 */
export async function populateVideoPreferences(
  organizationId: string
): Promise<void> {
  try {
    const videos = await db
      .select({
        id: video.id,
        title: video.title,
        status: video.status,
        templateId: video.templateId,
        draftConfig: video.draftConfig,
        durationMs: video.durationMs,
        createdAt: video.createdAt,
      })
      .from(video)
      .where(and(eq(video.organizationId, organizationId), notDeleted(video)))
      .orderBy(desc(video.createdAt));

    if (videos.length === 0) return;

    const templateCounts: Record<string, number> = {};
    const orientationCounts: Record<string, number> = {};
    const narrationCounts: Record<string, number> = {};
    const captionPositions: Record<string, number> = {};
    let captionsEnabled = 0;
    let captionsDisabled = 0;
    let withMusic = 0;
    let withOutro = 0;
    const readyVideos = videos.filter((v) => v.status === 'ready');

    for (const v of videos) {
      if (v.templateId) {
        templateCounts[v.templateId] = (templateCounts[v.templateId] || 0) + 1;
      }

      const config = v.draftConfig as Record<string, unknown> | null;
      if (!config) continue;

      const orientation = config.orientation as string | undefined;
      if (orientation) {
        orientationCounts[orientation] =
          (orientationCounts[orientation] || 0) + 1;
      }

      const narration = config.narrationType as string | undefined;
      if (narration) {
        narrationCounts[narration] = (narrationCounts[narration] || 0) + 1;
      }

      const captions = config.captions as
        | { enabled?: boolean; position?: string }
        | undefined;
      if (captions?.enabled) {
        captionsEnabled++;
        if (captions.position) {
          captionPositions[captions.position] =
            (captionPositions[captions.position] || 0) + 1;
        }
      } else {
        captionsDisabled++;
      }

      if (config.musicTrackId) withMusic++;

      const outro = config.outro as { businessName?: string } | undefined;
      if (outro?.businessName) withOutro++;
    }

    const parts: string[] = [];
    parts.push(
      `Total videos: ${videos.length} (${readyVideos.length} completed)`
    );

    if (Object.keys(templateCounts).length > 0) {
      const topTemplate = Object.entries(templateCounts).sort(
        (a, b) => b[1] - a[1]
      )[0];
      parts.push(
        `Most used template: ${topTemplate[0]} (${topTemplate[1]} times)`
      );
    }

    if (Object.keys(orientationCounts).length > 0) {
      const topOrientation = Object.entries(orientationCounts).sort(
        (a, b) => b[1] - a[1]
      )[0];
      parts.push(`Preferred orientation: ${topOrientation[0]}`);
    }

    if (Object.keys(narrationCounts).length > 0) {
      const narrationSummary = Object.entries(narrationCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([n, c]) => `${n}: ${c}`)
        .join(', ');
      parts.push(`Narration styles: ${narrationSummary}`);
    }

    if (captionsEnabled + captionsDisabled > 0) {
      parts.push(
        `Captions: enabled in ${captionsEnabled}/${captionsEnabled + captionsDisabled} videos`
      );
      if (Object.keys(captionPositions).length > 0) {
        const topPos = Object.entries(captionPositions).sort(
          (a, b) => b[1] - a[1]
        )[0];
        parts.push(`Preferred caption position: ${topPos[0]}`);
      }
    }

    if (withMusic > 0) {
      parts.push(
        `Music: used in ${withMusic}/${videos.length} videos (${Math.round((withMusic / videos.length) * 100)}%)`
      );
    }

    if (withOutro > 0) {
      parts.push(
        `Outro branding: used in ${withOutro}/${videos.length} videos`
      );
    }

    await upsertKnowledgeEntry({
      organizationId,
      type: 'video_preference',
      title: 'Video Creation Preferences',
      content: parts.join('. '),
      source: 'auto',
      confidence: 0.9,
      expiresAt: null, // No expiry — preferences are long-lived
      metadata: {
        videoCount: videos.length,
        templateCounts,
        orientationCounts,
        narrationCounts,
      },
    });
  } catch (error) {
    logError('assistant.populateVideoPreferences', error, {
      feature: 'assistant',
      extra: { organizationId },
    });
  }
}

/**
 * Populate knowledge base with customer patterns from leads and chatbot conversations.
 * Extracts patterns like common questions, lead sources, and conversion paths.
 * Entries expire after 90 days.
 */
export async function populateCustomerPatterns(
  organizationId: string
): Promise<void> {
  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);

    // --- Lead patterns ---
    const leads = await db
      .select({
        id: lead.id,
        source: lead.source,
        status: lead.status,
        tags: lead.tags,
        createdAt: lead.createdAt,
      })
      .from(lead)
      .where(and(eq(lead.organizationId, organizationId), notDeleted(lead)))
      .orderBy(desc(lead.createdAt));

    if (leads.length > 0) {
      const sourceCounts: Record<string, number> = {};
      const statusCounts: Record<string, number> = {};
      const tagCounts: Record<string, number> = {};

      for (const l of leads) {
        sourceCounts[l.source] = (sourceCounts[l.source] || 0) + 1;
        statusCounts[l.status] = (statusCounts[l.status] || 0) + 1;

        if (l.tags) {
          for (const tag of l.tags) {
            if (tag) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
          }
        }
      }

      const leadParts: string[] = [];
      leadParts.push(`Total leads: ${leads.length}`);

      const topSource = Object.entries(sourceCounts).sort(
        (a, b) => b[1] - a[1]
      )[0];
      leadParts.push(
        `Top lead source: ${topSource[0]} (${topSource[1]} leads, ${Math.round((topSource[1] / leads.length) * 100)}%)`
      );

      const statusSummary = Object.entries(statusCounts)
        .map(([s, c]) => `${s}: ${c}`)
        .join(', ');
      leadParts.push(`Status breakdown: ${statusSummary}`);

      const converted = statusCounts.converted || 0;
      if (converted > 0 && leads.length > 0) {
        leadParts.push(
          `Conversion rate: ${Math.round((converted / leads.length) * 100)}%`
        );
      }

      if (Object.keys(tagCounts).length > 0) {
        const topTags = Object.entries(tagCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([t, c]) => `${t} (${c})`)
          .join(', ');
        leadParts.push(`Common tags: ${topTags}`);
      }

      await upsertKnowledgeEntry({
        organizationId,
        type: 'customer_pattern',
        title: 'Lead Patterns',
        content: leadParts.join('. '),
        source: 'auto',
        confidence: 0.85,
        expiresAt,
        metadata: { leadCount: leads.length, sourceCounts, statusCounts },
      });
    }

    // --- Chatbot conversation patterns ---
    const conversations = await db
      .select({
        id: conversation.id,
        status: conversation.status,
        platform: conversation.platform,
        metadata: conversation.metadata,
        closedAt: conversation.closedAt,
        createdAt: conversation.createdAt,
      })
      .from(conversation)
      .where(eq(conversation.organizationId, organizationId))
      .orderBy(desc(conversation.createdAt));

    if (conversations.length > 0) {
      const platformCounts: Record<string, number> = {};
      const statusCounts: Record<string, number> = {};
      const treatmentCounts: Record<string, number> = {};
      let escalated = 0;
      let bookingInterest = 0;

      for (const conv of conversations) {
        platformCounts[conv.platform] =
          (platformCounts[conv.platform] || 0) + 1;
        statusCounts[conv.status] = (statusCounts[conv.status] || 0) + 1;

        if (conv.status === 'agent_handling') escalated++;

        const meta = conv.metadata as Record<string, unknown> | null;
        if (meta) {
          if (meta.bookingInterest) bookingInterest++;

          const treatments = meta.treatmentsDiscussed as string[] | undefined;
          if (treatments) {
            for (const t of treatments) {
              treatmentCounts[t] = (treatmentCounts[t] || 0) + 1;
            }
          }
        }
      }

      const convParts: string[] = [];
      convParts.push(`Total chatbot conversations: ${conversations.length}`);

      const platformSummary = Object.entries(platformCounts)
        .map(([p, c]) => `${p}: ${c}`)
        .join(', ');
      convParts.push(`Platforms: ${platformSummary}`);

      if (escalated > 0) {
        convParts.push(
          `${escalated} conversations (${Math.round((escalated / conversations.length) * 100)}%) were escalated to a human`
        );
      }

      if (bookingInterest > 0) {
        convParts.push(
          `${bookingInterest} conversations (${Math.round((bookingInterest / conversations.length) * 100)}%) showed booking interest`
        );
      }

      if (Object.keys(treatmentCounts).length > 0) {
        const topTreatments = Object.entries(treatmentCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([t, c]) => `${t} (${c})`)
          .join(', ');
        convParts.push(`Most discussed treatments/services: ${topTreatments}`);
      }

      await upsertKnowledgeEntry({
        organizationId,
        type: 'customer_pattern',
        title: 'Chatbot Conversation Patterns',
        content: convParts.join('. '),
        source: 'auto',
        confidence: 0.85,
        expiresAt,
        metadata: {
          conversationCount: conversations.length,
          platformCounts,
          treatmentCounts,
        },
      });
    }
  } catch (error) {
    logError('assistant.populateCustomerPatterns', error, {
      feature: 'assistant',
      extra: { organizationId },
    });
  }
}

/**
 * Run all knowledge base population functions for an organization.
 * Suitable for scheduled refresh (e.g., daily at 3 AM).
 */
export async function populateAll(organizationId: string): Promise<void> {
  await populateOrgProfile(organizationId);
  await populateServices(organizationId);
  await populateAdInsights(organizationId);
  await populatePostInsights(organizationId);
  await populateVideoPreferences(organizationId);
  await populateCustomerPatterns(organizationId);
}

/**
 * AI-initiated knowledge entry creation.
 * When the AI calls addKnowledgeEntry during a conversation,
 * this generates the embedding and stores it.
 */
export async function addKnowledgeEntry(params: {
  organizationId: string;
  type: KnowledgeEntry['type'];
  title: string;
  content: string;
  confidence?: number;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await upsertKnowledgeEntry({
    organizationId: params.organizationId,
    type: params.type,
    title: params.title,
    content: params.content,
    source: 'ai',
    confidence: params.confidence ?? 0.8,
    expiresAt: params.expiresAt,
    metadata: params.metadata,
  });
}

/**
 * Knowledge refresh scheduler configuration.
 * Exports functions and config for use in scheduler.service.ts.
 *
 * Suggested schedule: daily at 3 AM
 *
 * Usage in scheduler.service.ts:
 * ```
 * import { populateAll } from '@borradh-workspace/features/assistant';
 * import { getActiveOrganizationIds } from './helpers.js';
 *
 * // In your cron handler:
 * const orgIds = await getActiveOrganizationIds(db);
 * for (const orgId of orgIds) {
 *   await populateAll(orgId);
 * }
 * ```
 */
export const KNOWLEDGE_REFRESH_SCHEDULE = {
  /** Cron expression: daily at 3 AM */
  cron: '0 3 * * *',
  /** Human-readable description */
  description: 'Refresh knowledge base for all active organizations',
} as const;

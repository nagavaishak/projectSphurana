import { extractJson } from '@borradh-workspace/ai';
import {
  type OrganizationService,
  businessProfile,
  onboardingSession,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getAssistantContext } from '../../../assistant/index.js';
import { extractPriceCents } from '../../../claire/verticals/aesthetic-clinic/service-taxonomy.js';
import { listServicesForOrg } from '../../../organization-services/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { ensureAiClient } from '../_shared/ensure-ai-client.js';
import {
  type SuggestCampaignServiceInput,
  type SuggestCampaignServiceOutput,
  suggestCampaignServiceSchema,
} from './suggest-campaign-service.schema.js';

/** Shape the one-shot AI pick must return when no ranking exists. */
const aiPickSchema = z.object({
  serviceId: z.string().min(1),
  reasons: z.array(z.string().min(1)).min(1).max(3),
});

/** Deterministic reason used when the AI pick fails or returns garbage. */
const FALLBACK_REASON =
  "It's the strongest first-campaign candidate from your service list.";

/**
 * Chosen service + reasons. Prefers the recommendation engine's
 * `business_profile.rankedServices` (already scored + reasoned); falls back
 * to ONE `extractJson` call over the raw service list, and finally to the
 * first listed service so onboarding never dead-ends on a flaky completion.
 */
const chooseService = async (
  db: DbConnection,
  organizationId: string,
  services: OrganizationService[]
): Promise<{ service: OrganizationService; reasons: string[] }> => {
  // 1) Ranked path — the classifier already picked and explained an order.
  const profile = await db.query.businessProfile.findFirst({
    where: eq(businessProfile.organizationId, organizationId),
  });
  const ranked = [...(profile?.rankedServices ?? [])].sort(
    (a, b) => a.rank - b.rank
  );
  for (const entry of ranked) {
    const service = services.find((s) => s.id === entry.serviceId);
    if (!service) continue;
    const reasons = [
      entry.offerStrategyReason,
      entry.serviceRecommendationCopy?.body,
    ].filter((reason): reason is string => Boolean(reason?.trim()));
    return {
      service,
      reasons: reasons.length > 0 ? reasons : [FALLBACK_REASON],
    };
  }

  // 2) AI path — one extractJson call over the service list + org context.
  // Skip to the deterministic fallback if the AI client can't initialise
  // (no OPENAI_API_KEY) rather than throwing "AI client not initialized".
  if (!ensureAiClient()) {
    return { service: services[0], reasons: [FALLBACK_REASON] };
  }

  const contextResult = await getAssistantContext(db, { organizationId });
  const context = contextResult.success ? contextResult.data : null;

  const serviceLines = services
    .map(
      (s) =>
        `- id: ${s.id} | name: ${s.name}${s.priceText ? ` | price: ${s.priceText}` : ''}`
    )
    .join('\n');

  const extraction = await extractJson<z.infer<typeof aiPickSchema>>(
    [
      'Pick the single best service for this business to advertise in its FIRST paid campaign.',
      'Favour a broadly appealing, non-prescription, non-surgical service with a clear price that new clients can say yes to.',
      '',
      ...(context
        ? [
            `Business: ${context.name} (${context.businessTypeLabel})`,
            ...(context.targetAudienceDescription
              ? [`Target audience: ${context.targetAudienceDescription}`]
              : []),
            '',
          ]
        : []),
      'Services:',
      serviceLines,
      '',
      'Respond with ONLY a JSON object: { "serviceId": one of the ids above, "reasons": [1-3 short plain-language reasons addressed to the owner] }',
    ].join('\n'),
    { schema: aiPickSchema }
  );

  if (extraction.success && extraction.data) {
    const service = services.find((s) => s.id === extraction.data?.serviceId);
    if (service) {
      return { service, reasons: extraction.data.reasons };
    }
  }

  // 3) Deterministic fallback — never dead-end the deck.
  return { service: services[0], reasons: [FALLBACK_REASON] };
};

const suggestCampaignServiceImpl = async (
  db: DbConnection,
  input: SuggestCampaignServiceInput
): Promise<Result<SuggestCampaignServiceOutput>> => {
  const parsed = suggestCampaignServiceSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { userId } = parsed.data;

  try {
    const session = await db.query.onboardingSession.findFirst({
      where: eq(onboardingSession.userId, userId),
    });
    if (!session) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Onboarding session not found')
      );
    }
    if (!session.organizationId) {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          'Organization not created yet — complete the website analysis step first'
        )
      );
    }

    const servicesResult = await listServicesForOrg(db, {
      organizationId: session.organizationId,
    });
    if (!servicesResult.success) {
      // trackedResult-wrapped, so the error is the structural shape — re-wrap.
      return err(
        new FeatureError(
          servicesResult.error.code,
          servicesResult.error.message,
          servicesResult.error.details
        )
      );
    }
    const services = servicesResult.data;
    if (services.length === 0) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          'No services to advertise — add a service first'
        )
      );
    }

    const { service, reasons } = await chooseService(
      db,
      session.organizationId,
      services
    );

    // Prefer the structured `price_cents` column (owner-set or migrated) — it's
    // the source of truth. Fall back to parsing the legacy freeform `priceText`
    // only when priceCents is null.
    const priceCents = service.priceCents ?? extractPriceCents(service);

    await db
      .update(onboardingSession)
      .set({ selectedServiceId: service.id })
      .where(eq(onboardingSession.id, session.id));

    return ok({
      serviceId: service.id,
      serviceName: service.name,
      reasons,
      priceKnown: priceCents !== undefined,
      ...(priceCents !== undefined ? { priceCents } : {}),
    });
  } catch (error) {
    logError('onboarding.suggestCampaignService', error, {
      feature: 'onboarding',
      extra: { userId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to suggest a campaign service'
      )
    );
  }
};

export const suggestCampaignService = (
  db: DbConnection,
  input: SuggestCampaignServiceInput
) =>
  trackedResult(
    'onboarding.suggestCampaignService',
    () => suggestCampaignServiceImpl(db, input),
    {
      properties: { userId: input.userId },
      internalErrorsOnly: true,
    }
  );

export type SuggestCampaignServiceResult = Awaited<
  ReturnType<typeof suggestCampaignService>
>;

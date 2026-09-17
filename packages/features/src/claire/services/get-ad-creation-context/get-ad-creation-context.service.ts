import {
  type Disagreement,
  type RankedService,
  businessProfile,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { listServicesForOrg } from '../../../organization-services/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { computeRecommendation } from '../../recommendation-engine/index.js';
import { triggerAdContextClassify } from '../../triggers/ad-context-classify/ad-context-classify.trigger.js';
import { getBusinessProfile } from '../get-business-profile/index.js';
import {
  type GetAdCreationContextInput,
  getAdCreationContextSchema,
} from './get-ad-creation-context.schema.js';

type ProfileState = 'fresh' | 'pending' | 'missing';

export type AdCreationContextService = {
  serviceId: string;
  title: string;
  body: string;
  reasoning: string;
  objections: RankedService['objections'];
};

export type AdCreationContextOffer = {
  strategy: RankedService['offerStrategy'];
  suggestedIntroPrice?: number;
  title: string;
  body: string;
  reasoning: string;
};

export type AdCreationContextAlternative = {
  serviceId: string;
  rank: number;
  title: string;
};

export interface AdCreationContextResponse {
  service: AdCreationContextService | null;
  offer: AdCreationContextOffer | null;
  alternatives: AdCreationContextAlternative[];
  profileState: ProfileState;
  needsMarketPosition: boolean;
  disagreement: Disagreement | null;
}

const composeReasoning = (ranked: RankedService): string =>
  [
    `Why this service: ${ranked.serviceRecommendationCopy.body}`,
    `Offer strategy: ${ranked.offerStrategyReason}`,
  ].join(' ');

/**
 * Build the ad-creation widget's context payload for an organization.
 *
 * Three branches based on the BusinessProfile row:
 *   - missing  → no row yet; kick off classification, return placeholder.
 *   - pending  → row exists but inputHash/classifierVersion is 'pending'
 *                (set-market-position stub before classification finished);
 *                kick off classification again, return placeholder.
 *   - fresh    → row exists and is fully classified; compute recommendation
 *                from rankedServices and surface any pending disagreement
 *                on first read (sets `disagreement.surfaced = true`).
 */
const getAdCreationContextImpl = async (
  db: DbConnection,
  input: GetAdCreationContextInput
): Promise<Result<AdCreationContextResponse>> => {
  const parsed = getAdCreationContextSchema.safeParse(input);
  if (!parsed.success) {
    return ok({
      service: null,
      offer: null,
      alternatives: [],
      profileState: 'missing',
      needsMarketPosition: false,
      disagreement: null,
    });
  }
  const { organizationId } = parsed.data;

  const profileResult = await getBusinessProfile(db, { organizationId });

  if (!profileResult.success) {
    if (profileResult.error.code === ErrorCodes.NOT_FOUND) {
      // No profile yet — enqueue classification on the worker queue. Running it
      // in-process here (detached, un-awaited) made a 10–40s LLM call then wrote
      // to the DB long after this request's connection lifecycle ended, which on
      // Fly→Neon orphaned the connection and surfaced as UNSAFE_TRANSACTION
      // (ENG-313). triggerAdContextClassify swallows its own enqueue errors.
      await triggerAdContextClassify(organizationId);
      return ok({
        service: null,
        offer: null,
        alternatives: [],
        profileState: 'missing',
        needsMarketPosition: false,
        disagreement: null,
      });
    }
    return err(
      new FeatureError(profileResult.error.code, profileResult.error.message)
    );
  }
  const profile = profileResult.data;

  // 'pending' inputHash/classifierVersion means the row was stubbed by the
  // set-market-position endpoint before classification finished. The client
  // treats this the same as 'missing' visually but the profile row exists.
  const isStub =
    profile.inputHash === 'pending' || profile.classifierVersion === 'pending';
  if (isStub) {
    // Stub row from set-market-position — enqueue the real classification on
    // the worker queue rather than running it in-process (see ENG-313 note in
    // the missing-profile branch above).
    await triggerAdContextClassify(organizationId);
    return ok({
      service: null,
      offer: null,
      alternatives: [],
      profileState: 'pending',
      needsMarketPosition: profile.marketPosition === 'unknown',
      disagreement: null,
    });
  }

  const servicesResult = await listServicesForOrg(db, { organizationId });
  if (!servicesResult.success) {
    return err(
      new FeatureError(servicesResult.error.code, servicesResult.error.message)
    );
  }
  const services = servicesResult.data;

  const recommendation = computeRecommendation(profile, services);

  // Mark disagreement.surfaced=true on first read so the widget only fires
  // the inline footer once. Resolution still 'pending' means we keep
  // returning it on every read until the owner decides.
  let disagreementForResponse: Disagreement | null = null;
  if (profile.disagreement) {
    if (!profile.disagreement.surfaced) {
      const surfaced: Disagreement = {
        ...profile.disagreement,
        surfaced: true,
        surfacedAt: new Date().toISOString(),
      };
      await db
        .update(businessProfile)
        .set({ disagreement: surfaced })
        .where(eq(businessProfile.id, profile.id));
      disagreementForResponse = surfaced;
    } else if (profile.disagreement.resolution === 'pending') {
      disagreementForResponse = profile.disagreement;
    }
  }

  const top = recommendation.topService;

  return ok({
    service: top
      ? {
          serviceId: top.serviceId,
          title: top.serviceRecommendationCopy.title,
          body: top.serviceRecommendationCopy.body,
          reasoning: composeReasoning(top),
          objections: top.objections,
        }
      : null,
    offer: top
      ? {
          strategy: top.offerStrategy,
          ...(top.suggestedIntroPrice !== undefined && {
            suggestedIntroPrice: top.suggestedIntroPrice,
          }),
          title: top.offerRecommendationCopy.title,
          body: top.offerRecommendationCopy.body,
          reasoning: top.offerStrategyReason,
        }
      : null,
    alternatives: recommendation.alternatives.map((alt) => ({
      serviceId: alt.serviceId,
      rank: alt.rank,
      title: alt.serviceRecommendationCopy.title,
    })),
    profileState: 'fresh',
    needsMarketPosition: profile.marketPosition === 'unknown',
    disagreement: disagreementForResponse,
  });
};

export const getAdCreationContext = (
  db: DbConnection,
  input: GetAdCreationContextInput
) =>
  trackedResult(
    'claire.getAdCreationContext',
    () => getAdCreationContextImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type GetAdCreationContextResult = Awaited<
  ReturnType<typeof getAdCreationContext>
>;

import {
  organization,
  organizationLocation,
} from '@borradh-workspace/database';
import type { ChatbotSettings } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import { createLogger, trackedResult } from '@borradh-workspace/observability';
import { and, asc, desc, eq } from 'drizzle-orm';
import {
  micrositeBookingBase,
  resolveMicrositeLinkTarget,
} from '../../../shared/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { retrieveVoiceExamples } from '../../../voice-cloning/services/retrieve-voice-examples/index.js';
import type { VoiceExample } from './borradh-prompt-builder.js';
import { buildBorradhSystemPrompt } from './borradh-prompt-builder.js';
import { resolveOrganizationServices } from './resolve-organization-services.js';

const logger = createLogger('BuildTestChatContext');

function buildTestChatOverride(botName: string): string {
  return `

=== TEST MODE OVERRIDE ===
This is a test conversation in the playground.
- Respond with ONLY the raw message text. No JSON, no quotes, no metadata fields (action, collectedData, stage).
- You MUST use ---MSG_BREAK--- to separate multiple message bubbles. Do NOT replace it with newlines.
- Do NOT wrap your response in quotes.

Example correct response:
heyyy, i'm ${botName.toLowerCase()}, the receptionist here at Bayside Beauty---MSG_BREAK---here's the link to book a consultation with us: https://example.com any other questions please let me know. and what's your name btw?`;
}

export interface TestChatContext {
  systemPrompt: string;
}

interface BuildTestChatContextInput {
  organizationId: string;
  messageCount: number;
  /** When true, retrieve voice examples and inject voice style into prompt. */
  voiceCloning?: boolean;
  /** The latest user message — used for semantic search when voiceCloning is enabled. */
  userMessage?: string;
}

const buildTestChatContextImpl = async (
  db: DbConnection,
  input: BuildTestChatContextInput
): Promise<Result<TestChatContext>> => {
  const { organizationId, messageCount } = input;

  const org = await db.query.organization.findFirst({
    where: and(eq(organization.id, organizationId), notDeleted(organization)),
  });

  if (!org) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }

  const locations = await db.query.organizationLocation.findMany({
    where: eq(organizationLocation.organizationId, org.id),
    orderBy: [
      desc(organizationLocation.isPrimary),
      asc(organizationLocation.sortOrder),
    ],
  });

  // Resolved once, exactly as the live path does — otherwise the playground
  // shows a different host from the one Claire actually sends.
  const linkTarget = await resolveMicrositeLinkTarget(db, {
    id: org.id,
    slug: org.slug ?? '',
  });

  const { services } = await resolveOrganizationServices(db, {
    organizationId: org.id,
    orgSlug: org.slug,
    micrositePrimaryDomain: linkTarget.primaryDomain,
    convMetadata: null,
    primaryCalendarType: org.primaryCalendarType,
    defaultBookingLink: org.defaultBookingLink,
    // Same source the live path uses (generate-ai-response.service.ts). Without
    // it the currency falls back to the default, so a GB clinic testing its own
    // chatbot in the playground sees € against prices the live bot quotes in £.
    orgCountry: locations[0]?.country ?? null,
    org,
  });

  const chatbotSettings = org.chatbotSettings as ChatbotSettings | null;
  const resolvedBotName = chatbotSettings?.ownerName ?? 'Claire';

  // Derive booking link from primaryCalendarType
  const effectiveBookingLink =
    org.primaryCalendarType === 'borradh' &&
    org.slug &&
    (apiEnv.WEB_URL || linkTarget.primaryDomain)
      ? micrositeBookingBase(linkTarget)
      : org.defaultBookingLink;

  // Retrieve voice cloning data if requested
  let voiceStyleProfile: string | undefined;
  let voiceExamples: VoiceExample[] | undefined;

  if (input.voiceCloning) {
    if (!org.voiceStyleProfile) {
      logger.warn('Voice cloning requested but no voiceStyleProfile on org', {
        organizationId: org.id,
      });
    } else {
      // Always apply the style profile when voice cloning is requested
      voiceStyleProfile = org.voiceStyleProfile;

      try {
        const voiceResult = await retrieveVoiceExamples(db, {
          organizationId: org.id,
          customerMessage: input.userMessage || 'hello',
          limit: 5,
        });

        if (voiceResult.success && voiceResult.data.length > 0) {
          voiceExamples = voiceResult.data.map((ex) => ({
            customerMessage: ex.customerMessage,
            businessReply: ex.businessReply,
          }));
        } else {
          logger.warn('Voice example retrieval returned no results', {
            organizationId: org.id,
            success: voiceResult.success,
            errorCode: !voiceResult.success
              ? voiceResult.error.code
              : undefined,
          });
        }
      } catch {
        logger.warn('Voice example retrieval threw an exception', {
          organizationId: org.id,
        });
      }

      logger.info('Voice cloning enabled for test chat', {
        organizationId: org.id,
        hasStyleProfile: true,
        exampleCount: voiceExamples?.length ?? 0,
      });
    }
  }

  const systemPrompt = buildBorradhSystemPrompt({
    organizationName: org.name,
    chatbotSettings,
    services,
    defaultBookingLink: effectiveBookingLink,
    businessType: org.businessType,
    tagline: org.tagline,
    credibilityLine: org.credibilityLine,
    businessHours: org.businessHours,
    locations: locations.map((loc) => ({
      name: loc.name,
      addressLine1: loc.addressLine1,
      addressLine2: loc.addressLine2,
      city: loc.city,
      county: loc.county,
      postalCode: loc.postalCode,
      country: loc.country,
    })),
    websiteUrl: org.websiteUrl,
    knowledgeBase: org.knowledgeBase,
    customSystemPrompt: org.chatbotSystemPrompt,
    isReturningConversation: messageCount > 1,
    voiceStyleProfile,
    voiceExamples,
  });

  return ok({
    systemPrompt: systemPrompt + buildTestChatOverride(resolvedBotName),
  });
};

export const buildTestChatContext = (
  db: DbConnection,
  input: BuildTestChatContextInput
) =>
  trackedResult(
    'chatbots.buildTestChatContext',
    () => buildTestChatContextImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
      },
      internalErrorsOnly: true,
    }
  );

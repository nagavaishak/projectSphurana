import {
  chatCompletion,
  initAIClient,
  isAIClientInitialized,
} from '@borradh-workspace/ai';
import {
  conversation,
  conversationMessage,
  organization,
  sql,
} from '@borradh-workspace/database';
import type { ConversationMetadata } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import { createLogger, logError } from '@borradh-workspace/observability';
import { and, desc, eq, gte } from 'drizzle-orm';
import { type DbConnection, notDeleted } from '../../shared/index.js';
import { upsertKnowledgeEntry } from './populate.js';

const logger = createLogger('ChatbotExtraction');

/** Minimum conversations required before running extraction. */
const MIN_CONVERSATIONS = 10;
/** Max conversations to process per GPT call. */
const BATCH_SIZE = 20;
/** Max user+bot messages to load per conversation. */
const MESSAGES_PER_CONV = 10;
/** GPT model for extraction — use mini for cost efficiency. */
const EXTRACTION_MAX_TOKENS = 2000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function thirtyDaysAgo(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d;
}

function ensureAIClient(): void {
  if (!isAIClientInitialized()) {
    const apiKey = apiEnv.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
    initAIClient({ apiKey });
  }
}

// ---------------------------------------------------------------------------
// extractFAQs
// ---------------------------------------------------------------------------

interface ExtractedFAQ {
  question: string;
  answer: string;
  count: number;
}

/**
 * Extract recurring FAQ patterns from chatbot conversations using GPT-4o-mini.
 * Upserts knowledge entries of type 'faq' with confidence based on occurrence count.
 */
export async function extractFAQs(
  db: DbConnection,
  organizationId: string
): Promise<void> {
  try {
    const cutoff = thirtyDaysAgo();

    // Count recent conversations to see if extraction is worthwhile
    const countResult = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count
      FROM ${conversation}
      WHERE organization_id = ${organizationId}
        AND created_at > ${cutoff.toISOString()}
    `);
    const totalConvs = Number(countResult[0]?.count ?? 0);

    if (totalConvs < MIN_CONVERSATIONS) {
      logger.debug('Skipping FAQ extraction — not enough conversations', {
        organizationId,
        totalConvs,
      });
      return;
    }

    // Load conversations with 3+ messages (meaningful exchanges)
    const convs = await db.execute<{
      id: string;
      metadata: ConversationMetadata | null;
    }>(sql`
      SELECT c.id, c.metadata
      FROM ${conversation} c
      WHERE c.organization_id = ${organizationId}
        AND c.created_at > ${cutoff.toISOString()}
        AND (
          SELECT COUNT(*) FROM ${conversationMessage} cm
          WHERE cm.conversation_id = c.id
        ) >= 3
      ORDER BY c.created_at DESC
      LIMIT 100
    `);

    if (convs.length === 0) return;

    // Load messages for each conversation
    const convWithMessages: { id: string; messages: string }[] = [];

    for (const conv of convs) {
      const msgs = await db
        .select({
          role: conversationMessage.role,
          content: conversationMessage.content,
        })
        .from(conversationMessage)
        .where(eq(conversationMessage.conversationId, conv.id))
        .orderBy(conversationMessage.createdAt)
        .limit(MESSAGES_PER_CONV);

      const formatted = msgs
        .map((m) => `${m.role === 'user' ? 'Customer' : 'Bot'}: ${m.content}`)
        .join('\n');

      convWithMessages.push({ id: conv.id, messages: formatted });
    }

    // Process in batches
    const allFAQs: ExtractedFAQ[] = [];
    ensureAIClient();

    for (let i = 0; i < convWithMessages.length; i += BATCH_SIZE) {
      const batch = convWithMessages.slice(i, i + BATCH_SIZE);
      const batchText = batch
        .map((c, idx) => `--- Conversation ${idx + 1} ---\n${c.messages}`)
        .join('\n\n');

      const prompt = `Analyze these ${batch.length} customer conversations.
Identify questions that appear in 3 or more conversations.
For each recurring question, provide:
- The common question (generalised, not verbatim)
- The best answer based on how the bot responded
- How many conversations contained this question

Return JSON: { "faqs": [{ "question": "string", "answer": "string", "count": number }] }
Only return questions appearing in 3+ conversations. If none qualify, return { "faqs": [] }.

${batchText}`;

      try {
        const result = await chatCompletion(prompt, {
          maxTokens: EXTRACTION_MAX_TOKENS,
          temperature: 0.3,
          jsonResponse: true,
        });

        const parsed = JSON.parse(result.content) as { faqs: ExtractedFAQ[] };
        if (parsed.faqs?.length) {
          allFAQs.push(...parsed.faqs);
        }
      } catch (_parseError) {
        logger.warn('Failed to parse FAQ extraction result', {
          organizationId,
          batchIndex: i,
        });
      }
    }

    // Upsert FAQ knowledge entries
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);

    for (const faq of allFAQs) {
      const confidence = Math.min(faq.count / 10, 1.0);

      await upsertKnowledgeEntry({
        organizationId,
        type: 'faq',
        title: `FAQ: ${faq.question.slice(0, 150)}`,
        content: `Common question: "${faq.question}" — Answer: "${faq.answer}" (asked in ${faq.count} conversations)`,
        source: 'ai',
        confidence,
        expiresAt,
        metadata: { count: faq.count, extractedAt: new Date().toISOString() },
      });
    }

    logger.info('FAQ extraction complete', {
      organizationId,
      conversationsAnalyzed: convWithMessages.length,
      faqsExtracted: allFAQs.length,
    });
  } catch (error) {
    logError('assistant.extractFAQs', error, {
      feature: 'assistant',
      extra: { organizationId },
    });
  }
}

// ---------------------------------------------------------------------------
// extractChatbotInsights
// ---------------------------------------------------------------------------

/**
 * Calculate conversation statistics and generate a natural language insight
 * using GPT-4o-mini. Stores as type 'chatbot_insight' with 30-day expiry.
 */
export async function extractChatbotInsights(
  db: DbConnection,
  organizationId: string
): Promise<void> {
  try {
    const cutoff = thirtyDaysAgo();

    const convs = await db
      .select({
        id: conversation.id,
        status: conversation.status,
        metadata: conversation.metadata,
        createdAt: conversation.createdAt,
      })
      .from(conversation)
      .where(
        and(
          eq(conversation.organizationId, organizationId),
          gte(conversation.createdAt, cutoff)
        )
      )
      .orderBy(desc(conversation.createdAt));

    if (convs.length < MIN_CONVERSATIONS) return;

    // Calculate stats
    const total = convs.length;
    let bookingInterest = 0;
    let escalated = 0;
    const treatmentCounts: Record<string, number> = {};
    const stageCounts: Record<string, number> = {};
    let totalMessagesBeforeBooking = 0;
    let bookingLinkConvs = 0;

    for (const conv of convs) {
      const meta = conv.metadata as ConversationMetadata | null;
      if (!meta) continue;

      if (meta.bookingInterest) bookingInterest++;
      if (conv.status === 'agent_handling') escalated++;

      if (meta.stage) {
        stageCounts[meta.stage] = (stageCounts[meta.stage] || 0) + 1;
      }

      if (meta.treatmentsDiscussed) {
        for (const t of meta.treatmentsDiscussed) {
          treatmentCounts[t] = (treatmentCounts[t] || 0) + 1;
        }
      }

      if (meta.bookingLinkSent) {
        bookingLinkConvs++;
        // Rough proxy: bookingPushCount * 2 for average messages before booking
        totalMessagesBeforeBooking += (meta.bookingPushCount ?? 1) * 2;
      }
    }

    const bookingRate =
      total > 0 ? Math.round((bookingInterest / total) * 100) : 0;
    const escalationRate =
      total > 0 ? Math.round((escalated / total) * 100) : 0;
    const avgMsgsBeforeBooking =
      bookingLinkConvs > 0
        ? Math.round(totalMessagesBeforeBooking / bookingLinkConvs)
        : null;

    const topTreatments = Object.entries(treatmentCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t]) => t);

    const topStages = Object.entries(stageCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([s]) => s);

    // Load org business type for GPT context
    const org = await db.query.organization.findFirst({
      where: and(eq(organization.id, organizationId), notDeleted(organization)),
      columns: { businessType: true },
    });

    // Generate natural language insight via GPT
    ensureAIClient();

    const statsText = `
Business type: ${org?.businessType ?? 'unknown'}
Total conversations (last 30 days): ${total}
Booking interest rate: ${bookingRate}%
Escalation rate: ${escalationRate}%
${avgMsgsBeforeBooking ? `Average messages before booking link: ${avgMsgsBeforeBooking}` : ''}
Most discussed services: ${topTreatments.join(', ') || 'none tracked'}
Most common conversation stages: ${topStages.join(', ') || 'none tracked'}`;

    const prompt = `Given these chatbot performance statistics, write a concise 2-3 sentence natural language insight for the business owner. Be specific with numbers. Don't use bullet points.

${statsText}

Return JSON: { "insight": "string" }`;

    try {
      const result = await chatCompletion(prompt, {
        maxTokens: 500,
        temperature: 0.5,
        jsonResponse: true,
      });

      const parsed = JSON.parse(result.content) as { insight: string };

      if (parsed.insight) {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        await upsertKnowledgeEntry({
          organizationId,
          type: 'chatbot_insight',
          title: 'Chatbot Performance Summary',
          content: parsed.insight,
          source: 'ai',
          confidence: 0.9,
          expiresAt,
          metadata: {
            total,
            bookingRate,
            escalationRate,
            topTreatments,
            extractedAt: new Date().toISOString(),
          },
        });

        logger.info('Chatbot insight extraction complete', {
          organizationId,
          total,
          bookingRate,
          escalationRate,
        });
      }
    } catch (_parseError) {
      logger.warn('Failed to parse chatbot insight result', { organizationId });
    }
  } catch (error) {
    logError('assistant.extractChatbotInsights', error, {
      feature: 'assistant',
      extra: { organizationId },
    });
  }
}

// ---------------------------------------------------------------------------
// extractAdChatbotPatterns
// ---------------------------------------------------------------------------

/**
 * Analyze conversations attributed to specific ads and extract per-ad
 * conversion metrics. Stores as type 'ad_insight' entries.
 */
export async function extractAdChatbotPatterns(
  db: DbConnection,
  organizationId: string
): Promise<void> {
  try {
    const cutoff = thirtyDaysAgo();

    // Get conversations with ad attribution
    const convs = await db
      .select({
        id: conversation.id,
        metadata: conversation.metadata,
        status: conversation.status,
      })
      .from(conversation)
      .where(
        and(
          eq(conversation.organizationId, organizationId),
          gte(conversation.createdAt, cutoff),
          sql`${conversation.metadata}->>'adMetaId' IS NOT NULL`
        )
      );

    if (convs.length < MIN_CONVERSATIONS) return;

    // Group by ad
    const adGroups = new Map<
      string,
      {
        adMetaId: string;
        adTitle: string;
        total: number;
        bookingInterest: number;
        escalated: number;
      }
    >();

    for (const conv of convs) {
      const meta = conv.metadata as ConversationMetadata | null;
      if (!meta?.adMetaId) continue;

      const key = meta.adMetaId;
      const existing = adGroups.get(key) ?? {
        adMetaId: meta.adMetaId,
        adTitle: meta.adTitle ?? 'Unknown Ad',
        total: 0,
        bookingInterest: 0,
        escalated: 0,
      };

      existing.total++;
      if (meta.bookingInterest) existing.bookingInterest++;
      if (conv.status === 'agent_handling') existing.escalated++;

      adGroups.set(key, existing);
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    for (const [adMetaId, stats] of adGroups) {
      if (stats.total < 3) continue; // Need at least 3 conversations per ad

      const bookingRate =
        stats.total > 0
          ? Math.round((stats.bookingInterest / stats.total) * 100)
          : 0;
      const escalationRate =
        stats.total > 0 ? Math.round((stats.escalated / stats.total) * 100) : 0;

      const content = `Ad "${stats.adTitle}" generated ${stats.total} chatbot conversations. ${bookingRate}% showed booking interest, ${escalationRate}% escalated to a human agent.`;

      await upsertKnowledgeEntry({
        organizationId,
        type: 'ad_insight',
        title: `Ad Chatbot Pipeline — ${stats.adTitle}`,
        content,
        source: 'ai',
        confidence: Math.min(stats.total / 20, 0.95),
        expiresAt,
        metadata: {
          adMetaId,
          total: stats.total,
          bookingRate,
          escalationRate,
          extractedAt: new Date().toISOString(),
        },
      });
    }

    logger.info('Ad-chatbot pattern extraction complete', {
      organizationId,
      adsAnalyzed: adGroups.size,
      totalConversations: convs.length,
    });
  } catch (error) {
    logError('assistant.extractAdChatbotPatterns', error, {
      feature: 'assistant',
      extra: { organizationId },
    });
  }
}

import { type db, sql } from '@borradh-workspace/database';
import type { KnowledgeEntryType } from '@borradh-workspace/database';
import { createLogger } from '@borradh-workspace/observability';

const logger = createLogger('ChatbotKnowledgeQuery');

/** Max token budget for knowledge context in the chatbot system prompt. */
const MAX_KNOWLEDGE_TOKENS = 2000;
/** Rough chars-per-token estimate for English text. */
const CHARS_PER_TOKEN = 4;
const MAX_KNOWLEDGE_CHARS = MAX_KNOWLEDGE_TOKENS * CHARS_PER_TOKEN;

/** Knowledge entry types relevant to chatbot conversations. */
const CHATBOT_RELEVANT_TYPES: KnowledgeEntryType[] = [
  'service',
  'customer_pattern',
  'faq',
  'chatbot_insight',
  'area_info',
  'industry_benchmark',
];

interface KnowledgeRow extends Record<string, unknown> {
  type: KnowledgeEntryType;
  title: string;
  content: string;
  confidence: number | null;
}

/** Human-readable section headers for each knowledge type. */
const TYPE_SECTION_HEADERS: Partial<Record<KnowledgeEntryType, string>> = {
  service: 'Services Knowledge',
  customer_pattern: 'Customer Patterns',
  faq: 'FAQs',
  chatbot_insight: 'Chatbot Performance',
  area_info: 'Area Information',
  industry_benchmark: 'Industry Insights',
};

/**
 * Query the knowledge_entry table for chatbot-relevant entries.
 * Returns a formatted context string grouped by type, ready to append
 * to the chatbot system prompt.
 *
 * Returns empty string if no entries found.
 */
export async function getKnowledgeForChatbot(
  _db: typeof db,
  { organizationId }: { organizationId: string }
): Promise<string> {
  try {
    const typeList = CHATBOT_RELEVANT_TYPES.map((t) => `'${t}'`).join(', ');

    const rows = await _db.execute<KnowledgeRow>(sql`
      SELECT type, title, content, confidence
      FROM knowledge_entry
      WHERE
        (organization_id = ${organizationId} OR organization_id IS NULL)
        AND type IN (${sql.raw(typeList)})
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY confidence DESC NULLS LAST, created_at DESC
      LIMIT 20
    `);

    if (rows.length === 0) return '';

    return formatChatbotKnowledge(rows);
  } catch (error) {
    logger.error('Failed to query knowledge for chatbot', {
      organizationId,
      error: error instanceof Error ? error.message : error,
    });
    return '';
  }
}

/**
 * Format knowledge rows into a grouped context string.
 * Truncates to stay within the token budget.
 */
function formatChatbotKnowledge(rows: KnowledgeRow[]): string {
  // Group entries by type
  const grouped = new Map<KnowledgeEntryType, KnowledgeRow[]>();
  for (const row of rows) {
    const existing = grouped.get(row.type) ?? [];
    existing.push(row);
    grouped.set(row.type, existing);
  }

  const sections: string[] = [];
  let totalChars = 0;

  for (const type of CHATBOT_RELEVANT_TYPES) {
    const entries = grouped.get(type);
    if (!entries || entries.length === 0) continue;

    const header = TYPE_SECTION_HEADERS[type] ?? type;
    const lines: string[] = [`## ${header}`];

    for (const entry of entries) {
      const line = `- ${entry.content.slice(0, 500)}`;
      const lineChars = line.length + 1; // +1 for newline

      if (totalChars + lineChars > MAX_KNOWLEDGE_CHARS) {
        logger.warn('Knowledge context truncated due to token budget', {
          truncatedAtType: type,
          totalEntries: rows.length,
        });
        break;
      }

      lines.push(line);
      totalChars += lineChars;
    }

    // Only add section if it has entries (not just the header)
    if (lines.length > 1) {
      sections.push(lines.join('\n'));
    }

    if (totalChars >= MAX_KNOWLEDGE_CHARS) break;
  }

  return sections.join('\n\n');
}

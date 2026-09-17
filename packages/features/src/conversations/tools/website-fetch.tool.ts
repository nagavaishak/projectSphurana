/**
 * Website Fetch Tool
 *
 * Allows the chatbot to fetch and summarize content from a URL during a conversation.
 * Results are cached in Redis for 1 hour to avoid redundant fetches.
 */

import { createHash } from 'node:crypto';
import {
  chatCompletion,
  initAIClient,
  isAIClientInitialized,
} from '@borradh-workspace/ai';
import { createLogger } from '@borradh-workspace/observability';
import { getRedis } from '@borradh-workspace/redis';
import {
  extractTextFromHtml,
  fetchWebsiteContent,
} from '../../website-analysis/utils/index.js';
import type { ChatbotTool, ToolContext, ToolResult } from './types.js';

const logger = createLogger('WebsiteFetchTool');

const CACHE_PREFIX = 'chatbot:web-cache';
const CACHE_TTL_SECONDS = 3600; // 1 hour

function cacheKey(scopeId: string, url: string): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 16);
  return `${CACHE_PREFIX}:${scopeId}:${hash}`;
}

interface WebsiteFetchToolConfig {
  apiKey?: string;
}

export function createWebsiteFetchTool(
  config: WebsiteFetchToolConfig
): ChatbotTool {
  const { apiKey } = config;

  return {
    name: 'fetch_website',
    description:
      'Fetch and summarize content from a website URL. Use this when you need up-to-date information from the clinic website or a specific page to answer a customer question.',
    parameters: {
      url: {
        type: 'string',
        description: 'The URL to fetch content from',
        required: true,
      },
      query: {
        type: 'string',
        description:
          'What information to extract from the page (e.g. "pricing for botox", "opening hours")',
        required: true,
      },
    },
    execute: async (
      params: Record<string, unknown>,
      context: ToolContext
    ): Promise<ToolResult> => {
      const url = params.url as string;
      const query = params.query as string;

      if (!url || !query) {
        return { success: false, error: 'Both url and query are required' };
      }

      try {
        const redis = getRedis();
        const key = cacheKey(context.organizationId, url);

        // Check cache first
        const cached = await redis.get(key);
        let pageText: string;

        if (cached) {
          logger.info(`Cache hit for ${url} (org: ${context.organizationId})`);
          pageText = cached;
        } else {
          // Fetch fresh content
          logger.info(`Fetching ${url} for org ${context.organizationId}`);
          try {
            const html = await fetchWebsiteContent(url);
            pageText = extractTextFromHtml(html);

            // Cache the raw text
            await redis.set(key, pageText, 'EX', CACHE_TTL_SECONDS);
          } catch (fetchError) {
            logger.warn(
              `Failed to fetch ${url}: ${fetchError instanceof Error ? fetchError.message : fetchError}`
            );

            return {
              success: false,
              error: `Could not fetch the website: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}`,
            };
          }
        }

        // Summarize relevant content with GPT-4o-mini
        if (!apiKey) {
          // Return raw text truncated if no API key
          return {
            success: true,
            data: pageText.slice(0, 2000),
          };
        }

        if (!isAIClientInitialized()) {
          initAIClient({ apiKey });
        }

        const summary = await chatCompletion(
          `You are helping a chatbot answer a customer question. Extract the most relevant information from this website content to answer the query.

Query: ${query}

Website content:
${pageText.slice(0, 8000)}

Provide a concise, factual answer based only on the content above. If the information is not found, say "Information not found on this page."`,
          { maxTokens: 500 }
        );

        return {
          success: true,
          data: summary.content ?? 'No relevant information found.',
        };
      } catch (error) {
        logger.error(
          `Website fetch tool error: ${error instanceof Error ? error.message : error}`
        );

        return {
          success: false,
          error: `Website fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }
    },
  };
}

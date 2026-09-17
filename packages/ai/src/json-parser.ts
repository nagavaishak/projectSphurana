/**
 * JSON Parser Utilities
 *
 * Helpers for extracting and validating JSON from AI responses.
 */

import { logError } from '@borradh-workspace/observability';
import { chatCompletion } from './completions.js';
import { RATE_LIMIT_MESSAGE, isRateLimitError } from './errors.js';
import type { JsonExtractionOptions, JsonExtractionResult } from './types.js';

/**
 * Extract and parse JSON from an AI response.
 *
 * @param prompt - The prompt to send
 * @param options - Extraction options including optional Zod schema
 * @returns Parsed JSON result
 */
export async function extractJson<T = unknown>(
  prompt: string,
  options: JsonExtractionOptions<T> = {}
): Promise<JsonExtractionResult<T>> {
  try {
    const result = await chatCompletion(prompt, {
      ...options,
      jsonResponse: true,
    });

    if (!result.content) {
      return {
        success: false,
        data: options.defaultValue ?? null,
        error: 'Empty response from AI',
      };
    }

    return parseJsonResponse<T>(result.content, options);
  } catch (error) {
    if (isRateLimitError(error)) {
      return {
        success: false,
        data: options.defaultValue ?? null,
        error: RATE_LIMIT_MESSAGE,
      };
    }

    logError('ai.extractJson', error, {
      feature: 'ai',
    });

    return {
      success: false,
      data: options.defaultValue ?? null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Parse a JSON string response, optionally validating with Zod.
 *
 * @param content - The raw JSON string
 * @param options - Options including schema and default value
 * @returns Parsed result
 */
export function parseJsonResponse<T = unknown>(
  content: string,
  options: Pick<JsonExtractionOptions<T>, 'schema' | 'defaultValue'> = {}
): JsonExtractionResult<T> {
  let parsed: unknown;

  try {
    // Try to extract JSON from the content (handles markdown code blocks)
    const jsonString = extractJsonString(content);
    parsed = JSON.parse(jsonString);
  } catch (_error) {
    return {
      success: false,
      data: options.defaultValue ?? null,
      raw: content,
      error: 'Failed to parse JSON from response',
    };
  }

  // Validate with schema if provided
  if (options.schema) {
    const validation = options.schema.safeParse(parsed);
    if (!validation.success) {
      return {
        success: false,
        data: options.defaultValue ?? null,
        raw: content,
        error: 'Schema validation failed',
      };
    }
    return {
      success: true,
      data: validation.data as T,
      raw: content,
    };
  }

  return {
    success: true,
    data: parsed as T,
    raw: content,
  };
}

/**
 * Extract JSON string from content that might include markdown code blocks.
 */
function extractJsonString(content: string): string {
  // Remove markdown code blocks if present
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try to find JSON object or array
  const jsonMatch = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    return jsonMatch[1];
  }

  // Return as-is and let JSON.parse handle it
  return content.trim();
}

/**
 * Safely extract a value from parsed JSON with a default.
 */
export function safeGet<T>(
  obj: Record<string, unknown>,
  key: string,
  defaultValue: T
): T {
  const value = obj[key];
  if (value === undefined || value === null) {
    return defaultValue;
  }
  return value as T;
}

/**
 * Safely extract an array from parsed JSON.
 */
export function safeGetArray<T>(
  obj: Record<string, unknown>,
  key: string,
  validator: (item: unknown) => item is T,
  maxItems?: number
): T[] {
  const value = obj[key];
  if (!Array.isArray(value)) {
    return [];
  }
  const filtered = value.filter(validator);
  return maxItems ? filtered.slice(0, maxItems) : filtered;
}

/**
 * Safely extract a string array from parsed JSON.
 */
export function safeGetStringArray(
  obj: Record<string, unknown>,
  key: string,
  maxItems?: number
): string[] {
  return safeGetArray(
    obj,
    key,
    (item): item is string => typeof item === 'string',
    maxItems
  );
}

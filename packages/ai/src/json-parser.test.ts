import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@borradh-workspace/observability', () => ({
  logError: vi.fn(),
}));

const mockChatCompletion = vi.fn();

vi.mock('./completions.js', () => ({
  chatCompletion: (...args: unknown[]) => mockChatCompletion(...args),
}));

import { logError } from '@borradh-workspace/observability';
import { RATE_LIMIT_MESSAGE } from './errors.js';
import {
  extractJson,
  parseJsonResponse,
  safeGet,
  safeGetArray,
  safeGetStringArray,
} from './json-parser.js';

describe('parseJsonResponse', () => {
  it('parses valid JSON string', () => {
    const result = parseJsonResponse('{"name": "test", "value": 42}');

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ name: 'test', value: 42 });
  });

  it('handles markdown code blocks with json tag', () => {
    const content = '```json\n{"name": "test"}\n```';
    const result = parseJsonResponse(content);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ name: 'test' });
  });

  it('handles markdown code blocks without json tag', () => {
    const content = '```\n{"name": "test"}\n```';
    const result = parseJsonResponse(content);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ name: 'test' });
  });

  it('extracts JSON object from surrounding text', () => {
    const content = 'Here is the result: {"key": "value"} and more text';
    const result = parseJsonResponse(content);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ key: 'value' });
  });

  it('extracts JSON array from surrounding text', () => {
    const content = 'Result: [1, 2, 3]';
    const result = parseJsonResponse(content);

    expect(result.success).toBe(true);
    expect(result.data).toEqual([1, 2, 3]);
  });

  it('validates with Zod schema when provided', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const result = parseJsonResponse('{"name": "John", "age": 30}', { schema });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ name: 'John', age: 30 });
  });

  it('returns error on schema validation failure', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const result = parseJsonResponse(
      '{"name": "John", "age": "not a number"}',
      {
        schema,
      }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Schema validation failed');
    expect(result.data).toBeNull();
  });

  it('returns defaultValue on schema validation failure when provided', () => {
    const schema = z.object({ name: z.string() });
    const defaultValue = { name: 'default' };

    const result = parseJsonResponse('{"invalid": true}', {
      schema,
      defaultValue,
    });

    expect(result.success).toBe(false);
    expect(result.data).toEqual(defaultValue);
  });

  it('returns error on invalid JSON', () => {
    const result = parseJsonResponse('not json at all');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to parse JSON from response');
    expect(result.data).toBeNull();
  });

  it('returns defaultValue on invalid JSON when provided', () => {
    const result = parseJsonResponse('not json', {
      defaultValue: 'fallback' as unknown,
    });

    expect(result.success).toBe(false);
    expect(result.data).toBe('fallback');
  });
});

describe('extractJson', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns parsed JSON on success', async () => {
    mockChatCompletion.mockResolvedValue({
      content: '{"result": "success"}',
    });

    const result = await extractJson('Give me JSON');

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ result: 'success' });
  });

  it('passes jsonResponse: true to chatCompletion', async () => {
    mockChatCompletion.mockResolvedValue({
      content: '{"ok": true}',
    });

    await extractJson('Give JSON', { temperature: 0.5 });

    expect(mockChatCompletion).toHaveBeenCalledWith('Give JSON', {
      temperature: 0.5,
      jsonResponse: true,
    });
  });

  it('returns defaultValue with RATE_LIMIT_MESSAGE on rate limit', async () => {
    mockChatCompletion.mockRejectedValue(new Error(RATE_LIMIT_MESSAGE));

    const result = await extractJson('Give me JSON', {
      defaultValue: { fallback: true },
    });

    expect(result.success).toBe(false);
    expect(result.data).toEqual({ fallback: true });
    expect(result.error).toBe(RATE_LIMIT_MESSAGE);
  });

  it('returns error result on non-rate-limit errors', async () => {
    mockChatCompletion.mockRejectedValue(new Error('Something broke'));

    const result = await extractJson('Give me JSON');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Something broke');
    expect(logError).toHaveBeenCalledWith('ai.extractJson', expect.any(Error), {
      feature: 'ai',
    });
  });

  it('returns error on empty response content', async () => {
    mockChatCompletion.mockResolvedValue({ content: '' });

    const result = await extractJson('Give me JSON');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Empty response from AI');
    expect(result.data).toBeNull();
  });

  it('returns defaultValue on empty response when provided', async () => {
    mockChatCompletion.mockResolvedValue({ content: '' });

    const result = await extractJson('Give me JSON', {
      defaultValue: 'default' as unknown,
    });

    expect(result.success).toBe(false);
    expect(result.data).toBe('default');
  });

  it('returns null data for non-Error exceptions', async () => {
    mockChatCompletion.mockRejectedValue('string error');

    const result = await extractJson('Give me JSON');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unknown error');
  });
});

describe('safeGet', () => {
  it('returns value when key exists', () => {
    const obj = { name: 'test', count: 42 };
    expect(safeGet(obj, 'name', 'default')).toBe('test');
    expect(safeGet(obj, 'count', 0)).toBe(42);
  });

  it('returns default when value is null', () => {
    const obj: Record<string, unknown> = { name: null };
    expect(safeGet(obj, 'name', 'default')).toBe('default');
  });

  it('returns default when value is undefined', () => {
    const obj: Record<string, unknown> = { name: undefined };
    expect(safeGet(obj, 'name', 'default')).toBe('default');
  });

  it('returns default when key does not exist', () => {
    const obj = { other: 'value' };
    expect(safeGet(obj, 'missing', 'default')).toBe('default');
  });

  it('returns falsy values that are not null/undefined', () => {
    const obj = { empty: '', zero: 0, flag: false };
    expect(safeGet(obj, 'empty', 'default')).toBe('');
    expect(safeGet(obj, 'zero', 99)).toBe(0);
    expect(safeGet(obj, 'flag', true)).toBe(false);
  });
});

describe('safeGetArray', () => {
  const isString = (item: unknown): item is string => typeof item === 'string';
  const isNumber = (item: unknown): item is number => typeof item === 'number';

  it('returns filtered array when key exists', () => {
    const obj = { items: ['a', 'b', 'c'] };
    expect(safeGetArray(obj, 'items', isString)).toEqual(['a', 'b', 'c']);
  });

  it('filters out non-matching items', () => {
    const obj = { items: ['a', 1, 'b', 2] };
    expect(safeGetArray(obj, 'items', isString)).toEqual(['a', 'b']);
  });

  it('returns empty array for non-array values', () => {
    const obj = { items: 'not an array' };
    expect(safeGetArray(obj, 'items', isString)).toEqual([]);
  });

  it('returns empty array when key does not exist', () => {
    const obj: Record<string, unknown> = {};
    expect(safeGetArray(obj, 'missing', isString)).toEqual([]);
  });

  it('respects maxItems', () => {
    const obj = { items: [1, 2, 3, 4, 5] };
    expect(safeGetArray(obj, 'items', isNumber, 3)).toEqual([1, 2, 3]);
  });

  it('returns all items when maxItems exceeds array length', () => {
    const obj = { items: [1, 2] };
    expect(safeGetArray(obj, 'items', isNumber, 10)).toEqual([1, 2]);
  });
});

describe('safeGetStringArray', () => {
  it('returns string array', () => {
    const obj = { tags: ['a', 'b', 'c'] };
    expect(safeGetStringArray(obj, 'tags')).toEqual(['a', 'b', 'c']);
  });

  it('filters out non-string items', () => {
    const obj = { tags: ['a', 1, 'b', null, 'c'] };
    expect(safeGetStringArray(obj, 'tags')).toEqual(['a', 'b', 'c']);
  });

  it('returns empty array for non-array values', () => {
    const obj = { tags: 'not an array' };
    expect(safeGetStringArray(obj, 'tags')).toEqual([]);
  });

  it('returns empty array when key is missing', () => {
    const obj: Record<string, unknown> = {};
    expect(safeGetStringArray(obj, 'tags')).toEqual([]);
  });

  it('respects maxItems', () => {
    const obj = { tags: ['a', 'b', 'c', 'd', 'e'] };
    expect(safeGetStringArray(obj, 'tags', 2)).toEqual(['a', 'b']);
  });
});

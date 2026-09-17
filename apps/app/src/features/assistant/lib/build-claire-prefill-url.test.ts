/**
 * Documents the `buildClairePrefillUrl` contract for the W-C18 cross-app
 * entry points. Per the cross-cutting gotcha in claire.md §1, `apps/web`
 * has no test runner — `pnpm test` is vacuous here. This file is structured
 * as a vitest spec so that when a runner is wired (C-04 or follow-up), the
 * tests pick up automatically. Until then it serves as a typed contract
 * spec next to the helper.
 *
 * Excluded from `pnpm typecheck` via `tsconfig.json` `exclude`.
 */
import { describe, expect, it } from 'vitest';

import {
  CLAIRE_PREFILL_ENTITY_TYPES,
  CLAIRE_PREFILL_PROMPT_MAX_LENGTH,
  buildClairePrefillUrl,
  isClairePrefillEntityType,
} from './build-claire-prefill-url';

describe('buildClairePrefillUrl', () => {
  it('encodes a plain prompt as ?prefill=<encoded>', () => {
    const url = buildClairePrefillUrl('Tell me about lead Bob');
    expect(url).toBe('/assistant?prefill=Tell+me+about+lead+Bob');
  });

  it('URL-encodes special characters', () => {
    const url = buildClairePrefillUrl('Cost? & profit/loss = €100');
    // URLSearchParams encodes `?` as `%3F`, `&` as `%26`, `/` as `%2F`,
    // `=` as `%3D`, and spaces as `+`.
    expect(url).toBe(
      '/assistant?prefill=Cost%3F+%26+profit%2Floss+%3D+%E2%82%AC100'
    );
  });

  it('includes entityType and entityId when provided', () => {
    const url = buildClairePrefillUrl('Brief me', {
      entityType: 'lead',
      entityId: 'abc-123',
    });
    expect(url).toBe(
      '/assistant?prefill=Brief+me&entityType=lead&entityId=abc-123'
    );
  });

  it('omits entityType / entityId when not provided', () => {
    const url = buildClairePrefillUrl('Hello', {});
    expect(url).toBe('/assistant?prefill=Hello');
    expect(url).not.toContain('entityType');
    expect(url).not.toContain('entityId');
  });

  it('omits entityId alone when entityType missing', () => {
    const url = buildClairePrefillUrl('Hello', { entityId: 'abc' });
    expect(url).toBe('/assistant?prefill=Hello&entityId=abc');
  });

  it('returns /assistant with no querystring for an empty prompt', () => {
    expect(buildClairePrefillUrl('')).toBe('/assistant');
  });

  it('returns /assistant for a whitespace-only prompt', () => {
    expect(buildClairePrefillUrl('   \n\t')).toBe('/assistant');
  });

  it('drops options when prompt is empty (no querystring at all)', () => {
    // No prompt = no /assistant context to attach an entity to. The
    // caller would never legitimately do this but we guarantee the
    // shape stays predictable.
    const url = buildClairePrefillUrl('', {
      entityType: 'lead',
      entityId: 'abc',
    });
    expect(url).toBe('/assistant');
  });

  it('caps prompts longer than CLAIRE_PREFILL_PROMPT_MAX_LENGTH with an ellipsis', () => {
    const longPrompt = 'a'.repeat(CLAIRE_PREFILL_PROMPT_MAX_LENGTH + 50);
    const url = buildClairePrefillUrl(longPrompt);
    const capped = new URLSearchParams(url.split('?')[1]).get('prefill');
    expect(capped).not.toBeNull();
    expect(capped).toHaveLength(CLAIRE_PREFILL_PROMPT_MAX_LENGTH);
    expect(capped?.endsWith('…')).toBe(true);
  });

  it('does not cap prompts at exactly the max length', () => {
    const exactly = 'b'.repeat(CLAIRE_PREFILL_PROMPT_MAX_LENGTH);
    const url = buildClairePrefillUrl(exactly);
    const value = new URLSearchParams(url.split('?')[1]).get('prefill');
    expect(value).toBe(exactly);
    expect(value?.endsWith('…')).toBe(false);
  });

  it('treats all 7 entity types as valid', () => {
    const types = [
      'lead',
      'appointment',
      'ad',
      'offer',
      'conversation',
    ] as const;
    for (const entityType of types) {
      const url = buildClairePrefillUrl('p', { entityType, entityId: 'x' });
      expect(url).toContain(`entityType=${entityType}`);
      expect(url).toContain('entityId=x');
    }
  });
});

describe('CLAIRE_PREFILL_ENTITY_TYPES', () => {
  it('matches the documented 7-type union exactly', () => {
    // Source-of-truth check: if this list ever drifts from the type union,
    // page.tsx URL parsing and `isClairePrefillEntityType` go out of sync.
    expect([...CLAIRE_PREFILL_ENTITY_TYPES]).toEqual([
      'lead',
      'appointment',
      'ad',
      'meta_campaign',
      'offer',
      'conversation',
      // The review page runs the ordinary assistant chat now, so the post
      // under discussion arrives as an entity like every other.
      'content_item',
    ]);
  });
});

describe('isClairePrefillEntityType', () => {
  it.each([...CLAIRE_PREFILL_ENTITY_TYPES])(
    'accepts the canonical entity type "%s"',
    (entityType) => {
      expect(isClairePrefillEntityType(entityType)).toBe(true);
    }
  );

  it('rejects unknown entity types', () => {
    expect(isClairePrefillEntityType('invoice')).toBe(false);
    expect(isClairePrefillEntityType('')).toBe(false);
    expect(isClairePrefillEntityType('LEAD')).toBe(false); // case-sensitive
    expect(isClairePrefillEntityType('lead ')).toBe(false); // no auto-trim
  });
});

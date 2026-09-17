import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toWire } from './wire.js';

describe('toWire — source emission', () => {
  it('maps z.date() → z.string().datetime()', () => {
    expect(toWire(z.date()).source).toBe('z.string().datetime()');
  });

  it('maps z.number() → z.number()', () => {
    expect(toWire(z.number()).source).toBe('z.number()');
  });

  it('maps z.string() → z.string()', () => {
    expect(toWire(z.string()).source).toBe('z.string()');
  });

  it('maps z.boolean() → z.boolean()', () => {
    expect(toWire(z.boolean()).source).toBe('z.boolean()');
  });

  it('inlines pgEnum values by default', () => {
    expect(toWire(z.enum(['new', 'won'])).source).toBe(
      'z.enum(["new", "won"])'
    );
  });

  it('references a labels array when a resolver is supplied', () => {
    const source = toWire(z.enum(['new', 'won']), {
      resolveEnum: (values) =>
        values.includes('new') ? 'leadStatusValues' : null,
    }).source;
    expect(source).toBe('z.enum(leadStatusValues)');
  });

  it('emits z.literal for literals', () => {
    expect(toWire(z.literal('active')).source).toBe('z.literal("active")');
  });

  it('preserves nullability', () => {
    expect(toWire(z.string().nullable()).source).toBe('z.string().nullable()');
    expect(toWire(z.date().nullable()).source).toBe(
      'z.string().datetime().nullable()'
    );
  });

  it('preserves optionality', () => {
    expect(toWire(z.number().optional()).source).toBe('z.number().optional()');
  });

  it('drops server defaults (default does not change the wire shape)', () => {
    expect(toWire(z.boolean().default(false)).source).toBe('z.boolean()');
  });

  it('recurses into arrays (incl. nullable text[] columns)', () => {
    expect(toWire(z.array(z.string())).source).toBe('z.array(z.string())');
    expect(toWire(z.array(z.string()).nullable()).source).toBe(
      'z.array(z.string()).nullable()'
    );
    expect(toWire(z.array(z.date())).source).toBe(
      'z.array(z.string().datetime())'
    );
  });

  it('recurses into objects, transforming each field', () => {
    expect(
      toWire(z.object({ createdAt: z.date(), name: z.string().nullable() }))
        .source
    ).toBe(
      'z.object({ "createdAt": z.string().datetime(), "name": z.string().nullable() })'
    );
  });

  it('recurses into unions', () => {
    expect(toWire(z.union([z.string(), z.date()])).source).toBe(
      'z.union([z.string(), z.string().datetime()])'
    );
  });

  it('collapses untyped jsonb leaves to z.unknown()', () => {
    expect(toWire(z.unknown()).source).toBe('z.unknown()');
    expect(toWire(z.record(z.string(), z.unknown())).source).toBe(
      'z.record(z.string(), z.unknown())'
    );
  });
});

describe('toWire — runtime schema behaviour', () => {
  it('rejects a Date and accepts an ISO string for date columns', () => {
    const { schema } = toWire(z.date());
    expect(schema.safeParse(new Date()).success).toBe(false);
    expect(schema.safeParse('2024-01-01T00:00:00.000Z').success).toBe(true);
    expect(schema.safeParse('not-a-date').success).toBe(false);
  });

  it('keeps numbers as numbers (numeric columns surfaced as numbers)', () => {
    const { schema } = toWire(z.number());
    expect(schema.safeParse(42).success).toBe(true);
    expect(schema.safeParse('42').success).toBe(false);
  });

  it('passes enum values through unchanged', () => {
    const { schema } = toWire(z.enum(['new', 'won']));
    expect(schema.safeParse('new').success).toBe(true);
    expect(schema.safeParse('lost').success).toBe(false);
  });

  it('honours nullability at runtime', () => {
    const { schema } = toWire(z.string().nullable());
    expect(schema.safeParse(null).success).toBe(true);
    expect(schema.safeParse('x').success).toBe(true);
    expect(schema.safeParse(3).success).toBe(false);
  });

  it('validates a full row: dates become ISO strings, the rest passes through', () => {
    const { schema } = toWire(
      z.object({
        id: z.string(),
        count: z.number(),
        status: z.enum(['a', 'b']),
        tags: z.array(z.string()).nullable(),
        createdAt: z.date(),
        deletedAt: z.date().nullable(),
      })
    );

    const good = {
      id: 'l1',
      count: 3,
      status: 'a' as const,
      tags: ['vip'],
      createdAt: '2024-01-01T00:00:00.000Z',
      deletedAt: null,
    };
    expect(schema.safeParse(good).success).toBe(true);

    // A real Date object (un-serialized) must fail — this is the drift the
    // parse is meant to catch.
    expect(schema.safeParse({ ...good, createdAt: new Date() }).success).toBe(
      false
    );
  });

  it('the emitted source, when re-evaluated, parses the same way', () => {
    // Prove source ⇄ schema parity: eval the emitted string in a z-scope and
    // confirm it agrees with the runtime schema on representative inputs.
    const { source, schema } = toWire(
      z.object({ createdAt: z.date(), name: z.string().nullable() })
    );
    // eslint-disable-next-line no-new-func
    const rebuilt = new Function('z', `return ${source};`)(z) as z.ZodType;

    const sample = { createdAt: '2024-01-01T00:00:00.000Z', name: null };
    expect(rebuilt.safeParse(sample).success).toBe(
      schema.safeParse(sample).success
    );
    const bad = { createdAt: new Date(), name: null };
    expect(rebuilt.safeParse(bad).success).toBe(schema.safeParse(bad).success);
  });
});

/**
 * Registry-wide guard for every built-in v2 TemplateDoc.
 *
 * The per-shape specs (authority-1.test.ts, before-after-2.test.ts, …) assert
 * each template's bespoke structural invariants — but they're opt-in: a new
 * template added to `BUILT_IN_TEMPLATES` with no matching `.test.ts` would ship
 * completely unguarded. This sweep closes that hole: EVERY registered template
 * must parse against the canonical `templateDocSchema` and carry a unique id.
 *
 * Note on token references: `typeStyleRef` / `animationRef` / `transitionRef`
 * are `z.enum`-backed, so `templateDocSchema.parse()` already rejects any
 * reference to a token missing from its registry — no separate cross-registry
 * check is needed. (SFX/music are intentionally open strings resolved fuzzily
 * at synthesis time, so there's nothing closed-set to validate there.)
 */
import { describe, expect, it } from 'vitest';
import { templateDocSchema } from './schemas.js';
import { BUILT_IN_TEMPLATES, getTemplateDocById } from './template-registry.js';

describe('BUILT_IN_TEMPLATES registry', () => {
  it('is non-empty', () => {
    expect(BUILT_IN_TEMPLATES.length).toBeGreaterThan(0);
  });

  it('has globally unique template ids', () => {
    const ids = BUILT_IN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size, `duplicate id in [${ids.join(', ')}]`).toBe(
      ids.length
    );
  });

  it('resolves every registered template by id', () => {
    for (const t of BUILT_IN_TEMPLATES) {
      expect(getTemplateDocById(t.id), `getTemplateDocById(${t.id})`).toBe(t);
    }
  });
});

describe.each(BUILT_IN_TEMPLATES.map((t) => [t.id, t] as const))(
  'TemplateDoc %s',
  (id, doc) => {
    it('parses against templateDocSchema', () => {
      const result = templateDocSchema.safeParse(doc);
      if (!result.success) {
        throw new Error(
          `templateDocSchema rejected ${id}: ${JSON.stringify(
            result.error.issues,
            null,
            2
          )}`
        );
      }
      expect(result.success).toBe(true);
    });

    it('is schemaVersion 2 with at least one aspect ratio', () => {
      expect(doc.schemaVersion).toBe(2);
      expect(doc.aspectRatios.length).toBeGreaterThan(0);
    });
  }
);

import { describe, expect, it } from '@borradh-workspace/testing';
import type { GraphicDefect } from './inspect-graphic.schema.js';
import {
  DEFECT_KIND_FABRICATED_BEFORE_AFTER,
  DEFECT_KIND_FABRICATED_PRODUCT,
  DEFECT_KIND_INVENTED_PEOPLE,
  applyImageryPolicy,
} from './inspect-graphic.service.js';

const defect = (kind: string): GraphicDefect => ({
  severity: 'blocker',
  kind,
  detail: 'x',
});

describe('applyImageryPolicy', () => {
  it('leaves everything alone when AI imagery was not opted into', () => {
    const input = [defect(DEFECT_KIND_INVENTED_PEOPLE), defect('clipped-text')];
    expect(applyImageryPolicy(input, false)).toEqual(input);
  });

  it('downgrades invented people to a warning when the org asked for AI imagery', () => {
    const [d] = applyImageryPolicy([defect(DEFECT_KIND_INVENTED_PEOPLE)], true);
    expect(d.severity).toBe('warning');
  });

  it('KEEPS the invented-people finding rather than dropping it', () => {
    // "This deck is full of invented faces" is worth seeing even when it was
    // asked for. Dropping it is how an output that visibly worsened scored the
    // same as one that had not.
    const out = applyImageryPolicy([defect(DEFECT_KIND_INVENTED_PEOPLE)], true);
    expect(out).toHaveLength(1);
  });

  it('never downgrades a fabricated before/after pair', () => {
    // A claim about treatment results the business did not produce. No org
    // setting makes that publishable.
    const [d] = applyImageryPolicy(
      [defect(DEFECT_KIND_FABRICATED_BEFORE_AFTER)],
      true
    );
    expect(d.severity).toBe('blocker');
  });

  it('never downgrades an unrelated defect', () => {
    const [d] = applyImageryPolicy([defect('duplicated-text')], true);
    expect(d.severity).toBe('blocker');
  });

  it('tolerates the model returning the slug with different casing or spacing', () => {
    const [d] = applyImageryPolicy([defect('Invented People')], true);
    expect(d.severity).toBe('warning');
  });
});

describe('applyImageryPolicy — fabricated product', () => {
  it('never downgrades a fabricated product carrying the brand name', () => {
    // Opting into AI imagery is permission to invent a SCENE, not a product
    // line. A slide once drew a gold serum bottle labelled with the org's own
    // service name for a business that sells treatments and has no product —
    // the checklist covered invented people and not invented merchandise, so it
    // passed the gate cleanly and shipped.
    const [d] = applyImageryPolicy(
      [defect(DEFECT_KIND_FABRICATED_PRODUCT)],
      true
    );
    expect(d.severity).toBe('blocker');
  });

  it('is distinct from invented-people, which IS downgradable', () => {
    const out = applyImageryPolicy(
      [
        defect(DEFECT_KIND_INVENTED_PEOPLE),
        defect(DEFECT_KIND_FABRICATED_PRODUCT),
      ],
      true
    );
    expect(out.map((d) => d.severity)).toEqual(['warning', 'blocker']);
  });
});

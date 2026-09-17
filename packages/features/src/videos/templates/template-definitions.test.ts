import { describe, expect, it } from 'vitest';
import {
  CONTENT_IDEA_TEMPLATES,
  ORGANIC_TEMPLATE_IDS,
  RETIRED_TEMPLATE_IDS,
  getOrganicTemplates,
  getPlannableOrganicTemplates,
  getTemplateById,
} from './template-definitions.js';

describe('ORGANIC_TEMPLATE_IDS — single source of truth', () => {
  it('covers exactly the usageType:"organic" subset of CONTENT_IDEA_TEMPLATES', () => {
    // This is the invariant the module-load guard enforces (it throws on
    // divergence). Asserting it here makes the contract explicit: adding an
    // organic template to CONTENT_IDEA_TEMPLATES without registering its id in
    // ORGANIC_TEMPLATE_IDS — which feeds the idea-gen input enum and the
    // TEMPLATE_FORMAT_HINTS Record — is what let fade-benefits / aesthetic-line
    // / numbered-list ship without idea-gen support (#444).
    const fromArray = getOrganicTemplates()
      .map((t) => t.id)
      .sort();
    const fromTuple = [...ORGANIC_TEMPLATE_IDS].sort();
    expect(fromTuple).toEqual(fromArray);
  });

  it('only lists ids that are real, organic templates', () => {
    for (const id of ORGANIC_TEMPLATE_IDS) {
      const tpl = CONTENT_IDEA_TEMPLATES.find((t) => t.id === id);
      expect(tpl, `template "${id}" must exist`).toBeDefined();
      expect(tpl?.usageType).toBe('organic');
    }
  });
});

describe('retired templates', () => {
  // Retirement is a SELECTION decision, not a registry change: the id stays
  // registered so existing rows resolve for playback and idea-gen keeps its
  // enum entry, but nothing new may be planned with it.
  it('excludes retired ids from the plannable organic set', () => {
    const plannable = getPlannableOrganicTemplates().map((t) => t.id);
    for (const retired of RETIRED_TEMPLATE_IDS) {
      expect(plannable).not.toContain(retired);
    }
  });

  it('keeps retired ids in the registry so old rows still resolve', () => {
    const allOrganic = getOrganicTemplates().map((t) => t.id);
    expect(allOrganic).toContain('versus');
  });

  it('declines a retired id through getTemplateById', () => {
    expect(getTemplateById('versus')).toBeUndefined();
    expect(getTemplateById('before-after')).toBeUndefined();
  });
});

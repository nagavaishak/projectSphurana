import type { VideoDraftConfig } from '@borradh-workspace/database';

/**
 * The on-screen COPY of a video, as text.
 *
 * Lifted out of `content-batches` because it is a fact about a video's draft
 * config, not about a batch — and because `content-items` needs it and cannot
 * import `content-batches` without a cycle (that package already imports the
 * item layer). Two callers now: the review turn, and the active-context line
 * that tells Claire what the post on screen actually says.
 */

/**
 * The organic template config keys on `VideoDraftConfig`, in the order they are
 * probed. At most one is populated per draft — the choice is driven by the
 * selected `variationId` — so the first one present IS the active template.
 *
 * Listed explicitly rather than derived by scanning keys: a draft carries plenty
 * of other objects (`captions`, `outro`, `offerCard`…), and letting a model
 * write into those through a "change the text" instruction is exactly what the
 * narrowing below exists to prevent.
 */
const TEMPLATE_CONFIG_KEYS = [
  'captionTease',
  'fadeBenefits',
  'aestheticLine',
  'numberedList',
  'insOuts',
  'questionCta',
  'improves',
  'stepTimer',
  'timeProgress',
  'poll',
  'mythFact',
  'versus',
  'priceReveal',
  'clientQuestion',
  'comeWithMe',
] as const satisfies readonly (keyof VideoDraftConfig)[];

export type TemplateConfigKey = (typeof TEMPLATE_CONFIG_KEYS)[number];

/** The active organic template's config key, or null when there isn't one. */
export function activeTemplateKey(
  draftConfig: VideoDraftConfig | null | undefined
): TemplateConfigKey | null {
  if (!draftConfig) return null;
  for (const key of TEMPLATE_CONFIG_KEYS) {
    const value = draftConfig[key];
    if (value && typeof value === 'object') return key;
  }
  return null;
}

/**
 * The editable text on the active template: field name → current value.
 *
 * Only string and string[] leaves. Numbers (`secondsPerLine`) and colours
 * (`primaryColor`) are template mechanics, not copy, and a model rewriting them
 * from "change the text" would break the render rather than the wording.
 */
export function templateTextFields(
  draftConfig: VideoDraftConfig | null | undefined
): Record<string, string | string[]> {
  const key = activeTemplateKey(draftConfig);
  if (!key || !draftConfig) return {};

  const config = draftConfig[key] as unknown as Record<string, unknown>;
  const fields: Record<string, string | string[]> = {};

  for (const [field, value] of Object.entries(config)) {
    if (typeof value === 'string') {
      fields[field] = value;
    } else if (
      Array.isArray(value) &&
      value.every((entry) => typeof entry === 'string')
    ) {
      fields[field] = value as string[];
    }
  }

  return fields;
}

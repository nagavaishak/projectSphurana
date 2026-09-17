/**
 * @borradh-workspace/features/image-generation
 *
 * The branded-graphic (nano-banana / Gemini) engine: generates graphics from
 * the org's real service media + brand corpus. The legacy Fabric.js +
 * PPTX-template pipeline (planner, slot-map schema, template CRUD) was
 * removed.
 */

export * from './types.js';
export * from './gemini-image.js';
export * from './reference-image-store.js';
export * from './logo-variants.js';
export * from './carousel-templates/index.js';
export * from './slot-image-source/index.js';
export * from './services/index.js';
export * from './imagery-policy.js';
export * from './resolve-reference-image-urls.js';
export * from './brand-swatch.js';
/**
 * The shared prompt RULES, exported so an experiment can quote production's
 * exact wording instead of a paraphrase that drifts away from it.
 */
export * from './graphic-rules.js';

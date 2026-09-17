/**
 * Service-layer barrel for the image-generation feature.
 *
 * The branded-graphic (nano-banana / Gemini) engine generates each graphic
 * from the org's real service media + brand corpus. The legacy Fabric.js +
 * PPTX-template pipeline (planner, template CRUD, slide renderer) was removed.
 */

export * from './generate-ai-image/index.js';
export * from './resolve-slot-image/index.js';
export * from './build-brand-corpus/index.js';
export * from './generate-branded-graphic/index.js';
export * from './orchestrate-carousel/index.js';
export * from './generate-templated-single/index.js';
export * from './regenerate-carousel-slide/index.js';
export * from './select-inspiration-set/index.js';
export * from './inspect-graphic/index.js';
export * from './judge-logo/index.js';
export * from './verify-asset-depicts-service/index.js';

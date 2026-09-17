/**
 * The microsites public surface.
 *
 * Everything the API controllers, the Astro renderer and (later) the agent
 * tools consume comes through here: the block library (schemas + catalogue)
 * and the services. The jsonb SHAPES themselves live in
 * `@borradh-workspace/web-shared` — that package is THE CONTRACT, and it is
 * imported directly by consumers rather than re-exported here, so those types
 * keep coming from exactly one place.
 */

export * from './agent/index.js';
export * from './attribution/index.js';
export * from './blocks/index.js';
export * from './pixel/index.js';
export * from './domains/index.js';
export * from './services/index.js';
export {
  PREVIEW_TOKEN_TTL_SECONDS,
  mintPreviewToken,
  verifyPreviewToken,
} from './preview-token.js';

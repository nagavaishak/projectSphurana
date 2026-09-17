/**
 * `SlotImageSource` strategy implementations.
 *
 * v1 only ships `AiGeneratedSource` (always returns a generation prompt).
 * Future implementations (real business asset extraction from videos, brand
 * library lookup, etc.) plug in behind the same interface without touching
 * the planner.
 */

export {
  createAiGeneratedSource,
  type AiGeneratedSourceOptions,
} from './ai-generated-source.js';

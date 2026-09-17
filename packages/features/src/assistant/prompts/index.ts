/**
 * Prompt-layer exports.
 *
 * The old monolithic `buildSystemPrompt` shipped in v2 was deleted in
 * W-C03-D-finish; the orchestrator + skill modules in
 * `packages/features/src/assistant/skills/` (W-C03-A/B) are now the source
 * of system-prompt content. Sanitization helpers stay here — both the
 * orchestrator (Block 4 business context) and individual skill builders
 * may need them in future Phase 2/3 work.
 */
export { sanitizeField, sanitizeArray } from './sanitize.js';

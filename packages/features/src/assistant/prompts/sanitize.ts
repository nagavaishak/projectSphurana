/**
 * Sanitize user-supplied data before interpolation into LLM system prompts.
 *
 * Mitigates prompt injection attacks where attacker-controlled data
 * (org fields, knowledge entries, etc.) attempts to override system instructions.
 */

/**
 * Patterns that indicate prompt injection attempts.
 * These are stripped from user data before prompt interpolation.
 */
const INJECTION_PATTERNS = [
  // Attempt to start a new system/assistant role
  /\b(SYSTEM|ASSISTANT|USER)\s*:/gi,
  // Common override directives
  /\bIGNORE\s+(ALL\s+)?(PREVIOUS|ABOVE|PRIOR)\s+(INSTRUCTIONS?|RULES?|PROMPTS?)\b/gi,
  /\bDISREGARD\s+(ALL\s+)?(PREVIOUS|ABOVE|PRIOR)\s+(INSTRUCTIONS?|RULES?|PROMPTS?)\b/gi,
  /\bFORGET\s+(ALL\s+)?(PREVIOUS|ABOVE|PRIOR)\s+(INSTRUCTIONS?|RULES?|PROMPTS?)\b/gi,
  /\bOVERRIDE\s+(ALL\s+)?(PREVIOUS|ABOVE|PRIOR)\s+(INSTRUCTIONS?|RULES?|PROMPTS?)\b/gi,
  // "You are now..." identity overrides
  /\bYOU\s+ARE\s+NOW\b/gi,
  /\bACT\s+AS\s+(A|AN|THE)\b/gi,
  /\bYOU\s+MUST\s+(NOW\s+)?/gi,
  /\bNEW\s+INSTRUCTIONS?\s*:/gi,
  // Delimiter escape attempts
  /<\|[^|]*\|>/g,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<<\s*SYS\s*>>/gi,
  /<<\s*\/SYS\s*>>/gi,
];

/**
 * Sanitize a single string field for safe inclusion in a system prompt.
 *
 * - Strips control characters (except newlines and tabs)
 * - Removes prompt injection patterns
 * - Collapses excessive whitespace
 * - Enforces a maximum length
 */
export function sanitizeField(value: string, maxLength = 500): string {
  let cleaned = value;

  // Strip control characters (keep \n and \t)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally stripping control chars from user input
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Strip injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Strip markdown heading syntax that could create new prompt sections
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');

  // Collapse runs of 3+ newlines into 2
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // Trim and enforce length
  cleaned = cleaned.trim();
  if (cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength);
  }

  return cleaned;
}

/**
 * Sanitize an array of strings (e.g., brandVoice, services).
 */
export function sanitizeArray(
  values: string[],
  maxItemLength = 200,
  maxItems = 50
): string[] {
  return values.slice(0, maxItems).map((v) => sanitizeField(v, maxItemLength));
}

/**
 * Wrap user-supplied data in delimiters so the model treats it as data, not instructions.
 * The delimiter name describes the data type for clarity.
 */
export function wrapUserData(label: string, content: string): string {
  return `[${label}: ${content}]`;
}

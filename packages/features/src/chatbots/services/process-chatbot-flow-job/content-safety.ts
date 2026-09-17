export type ContentSafetyResult =
  | { action: 'continue' }
  | {
      action: 'escalate';
      reason: 'user_requested_human' | 'inappropriate_content';
      detail: string;
    };

const HUMAN_REQUEST_PATTERNS = [
  /\b(?:talk|speak|chat)\s+(?:to|with)\s+(?:a\s+)?(?:real\s+)?(?:human|person|agent|someone|staff|manager)\b/i,
  /\b(?:real\s+)?(?:human|person)\s+(?:please|pls)\b/i,
  /\bcan\s+i\s+(?:talk|speak|chat)\s+(?:to|with)\s+(?:someone|a\s+person)\b/i,
  /\bget\s+me\s+(?:a\s+)?(?:real\s+)?(?:human|person|agent)\b/i,
  /\bi\s+(?:want|need)\s+(?:to\s+)?(?:talk|speak)\s+(?:to\s+)?(?:a\s+)?(?:real\s+)?(?:human|person|agent)\b/i,
  /\b(?:stop|quit|enough)\s+(?:with\s+)?(?:the\s+)?(?:bot|ai|automated|chatbot)\b/i,
  /\byou(?:'re|\s+are)\s+(?:a\s+)?(?:bot|ai|robot|automated)\b/i,
  /\bare\s+you\s+(?:a\s+)?(?:bot|ai|robot|real)\b/i,
];

export function checkContentSafety(content: string): ContentSafetyResult {
  if (!content?.trim()) return { action: 'continue' };

  for (const pattern of HUMAN_REQUEST_PATTERNS) {
    if (pattern.test(content)) {
      return {
        action: 'escalate',
        reason: 'user_requested_human',
        detail: `Customer said: "${content.slice(0, 200)}"`,
      };
    }
  }

  return { action: 'continue' };
}

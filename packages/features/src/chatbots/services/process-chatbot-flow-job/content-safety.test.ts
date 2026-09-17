import { describe, expect, it } from 'vitest';

import { checkContentSafety } from './content-safety.js';

describe('checkContentSafety', () => {
  it('returns continue for normal messages', () => {
    const result = checkContentSafety('What services do you offer?');
    expect(result.action).toBe('continue');
  });

  it('returns escalate with user_requested_human for "I want to talk to a real person"', () => {
    const result = checkContentSafety('I want to talk to a real person');
    expect(result.action).toBe('escalate');
    if (result.action === 'escalate') {
      expect(result.reason).toBe('user_requested_human');
    }
  });

  it('returns escalate for "can I speak with someone?"', () => {
    const result = checkContentSafety('can I speak with someone?');
    expect(result.action).toBe('escalate');
    if (result.action === 'escalate') {
      expect(result.reason).toBe('user_requested_human');
    }
  });

  it('returns escalate for "get me a human agent"', () => {
    const result = checkContentSafety('get me a human agent');
    expect(result.action).toBe('escalate');
    if (result.action === 'escalate') {
      expect(result.reason).toBe('user_requested_human');
    }
  });

  it('returns escalate for "stop with the bot"', () => {
    const result = checkContentSafety('stop with the bot');
    expect(result.action).toBe('escalate');
    if (result.action === 'escalate') {
      expect(result.reason).toBe('user_requested_human');
    }
  });

  it('returns escalate for "you\'re a bot aren\'t you"', () => {
    const result = checkContentSafety("you're a bot aren't you");
    expect(result.action).toBe('escalate');
    if (result.action === 'escalate') {
      expect(result.reason).toBe('user_requested_human');
    }
  });

  it('returns escalate for "are you a real person?"', () => {
    const result = checkContentSafety('are you a real person?');
    expect(result.action).toBe('escalate');
    if (result.action === 'escalate') {
      expect(result.reason).toBe('user_requested_human');
    }
  });

  it('returns continue for messages mentioning "bot" in non-request context', () => {
    const result = checkContentSafety('I love this chatbot');
    expect(result.action).toBe('continue');
  });

  it('returns continue for empty content', () => {
    const result = checkContentSafety('');
    expect(result.action).toBe('continue');
  });

  it('returns continue for null-ish content', () => {
    const result = checkContentSafety(null as unknown as string);
    expect(result.action).toBe('continue');
  });

  it('detail field includes truncated customer message', () => {
    const result = checkContentSafety('I want to talk to a real person');
    expect(result.action).toBe('escalate');
    if (result.action === 'escalate') {
      expect(result.detail).toContain('Customer said:');
      expect(result.detail).toContain('I want to talk to a real person');
    }
  });

  it('truncates very long messages in the detail field', () => {
    const longMessage = `I want to talk to a real person ${'x'.repeat(300)}`;
    const result = checkContentSafety(longMessage);
    expect(result.action).toBe('escalate');
    if (result.action === 'escalate') {
      // Content is sliced to 200 chars
      expect(result.detail.length).toBeLessThan(longMessage.length + 50);
    }
  });
});

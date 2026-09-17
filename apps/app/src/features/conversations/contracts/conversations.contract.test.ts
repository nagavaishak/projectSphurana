/**
 * Contract proof for the conversations / Claire projections.
 *
 * Proves the hand-composed projections match the wire shape and that the SAME
 * schema behaves as the runtime parser expects (report passthrough vs strict
 * throw) — the two modes `apiClient` gates behind the observability flags.
 */
import {
  ResponseParseError,
  parseResponse,
  setResponseParseConfig,
} from '@borradh-workspace/api-client';
import {
  assistantRecommendationSchema,
  businessProfileSchema,
  conversationMessageSchema,
  conversationSchema,
  listConversationsResponseSchema,
  listMessagesResponseSchema,
} from '@borradh-workspace/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aBusinessProfile,
  aConversation,
  aConversationMessage,
  aRecommendation,
} from './base';

describe('conversations domain contracts', () => {
  afterEach(() => setResponseParseConfig({}));

  it('the fixtures are exactly what their schemas accept', () => {
    expect(conversationSchema.safeParse(aConversation()).success).toBe(true);
    expect(
      conversationMessageSchema.safeParse(aConversationMessage()).success
    ).toBe(true);
    expect(
      assistantRecommendationSchema.safeParse(aRecommendation()).success
    ).toBe(true);
    expect(businessProfileSchema.safeParse(aBusinessProfile()).success).toBe(
      true
    );
  });

  it('list wrappers validate — conversations has total, messages does not', () => {
    const conversations = {
      items: [
        {
          ...aConversation(),
          lastMessageContent: 'hi',
          lastMessageRole: 'user',
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
    };
    expect(
      listConversationsResponseSchema.safeParse(conversations).success
    ).toBe(true);

    const messages = {
      items: [aConversationMessage()],
      limit: 20,
      offset: 0,
    };
    expect(listMessagesResponseSchema.safeParse(messages).success).toBe(true);
  });

  it('narrows widened columns — a bad message origin is rejected', () => {
    const drifted = { ...aConversationMessage(), origin: 'nonsense' };
    expect(conversationMessageSchema.safeParse(drifted).success).toBe(false);
  });

  it('rejects drift — a Date instead of an ISO string for createdAt', () => {
    const drifted = { ...aConversation(), createdAt: new Date() };
    expect(conversationSchema.safeParse(drifted).success).toBe(false);
  });

  it('report mode: passes raw data through and logs the failure (non-fatal)', () => {
    const onParseError = vi.fn();
    setResponseParseConfig({ isStrict: () => false, onParseError });

    const drifted = { ...aConversation(), createdAt: new Date() } as never;
    const result = parseResponse(
      'conversations/conv_1',
      drifted,
      conversationSchema
    );

    expect(result).toBe(drifted);
    expect(onParseError).toHaveBeenCalledTimes(1);
    expect(onParseError.mock.calls[0][0].endpoint).toBe('conversations/conv_1');
  });

  it('strict mode: throws a ResponseParseError on drift', () => {
    setResponseParseConfig({ isStrict: () => true });
    const drifted = { ...aConversation(), createdAt: new Date() } as never;

    expect(() =>
      parseResponse('conversations/conv_1', drifted, conversationSchema)
    ).toThrow(ResponseParseError);
  });
});

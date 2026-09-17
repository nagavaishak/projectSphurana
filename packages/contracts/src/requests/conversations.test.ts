import { describe, expect, it } from 'vitest';
import {
  assignConversationRequestSchema,
  sendMessageRequestSchema,
} from './conversations.js';

describe('sendMessageRequestSchema', () => {
  it('accepts a valid agent reply', () => {
    expect(
      sendMessageRequestSchema.safeParse({ content: 'On my way!' }).success
    ).toBe(true);
  });

  it('rejects an empty reply', () => {
    expect(sendMessageRequestSchema.safeParse({ content: '' }).success).toBe(
      false
    );
  });

  it('rejects a reply over the 2000-char provider limit', () => {
    expect(
      sendMessageRequestSchema.safeParse({ content: 'a'.repeat(2001) }).success
    ).toBe(false);
  });

  it('accepts exactly 2000 chars (the bound is inclusive)', () => {
    expect(
      sendMessageRequestSchema.safeParse({ content: 'a'.repeat(2000) }).success
    ).toBe(true);
  });

  it('REJECTS `userId` in the body — authorship is stamped from the session', () => {
    const result = sendMessageRequestSchema.safeParse({
      content: 'hi',
      userId: 'user_impostor',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.code === 'unrecognized_keys')
      ).toBe(true);
    }
  });

  it('REJECTS the route param `conversationId` in the body', () => {
    expect(
      sendMessageRequestSchema.safeParse({
        content: 'hi',
        conversationId: 'conv_1',
      }).success
    ).toBe(false);
  });

  it('rejects a body missing `content`', () => {
    expect(sendMessageRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('assignConversationRequestSchema', () => {
  it('accepts a valid assignment', () => {
    expect(
      assignConversationRequestSchema.safeParse({ assignToUserId: 'user_1' })
        .success
    ).toBe(true);
  });

  it('rejects an empty assignee id', () => {
    expect(
      assignConversationRequestSchema.safeParse({ assignToUserId: '' }).success
    ).toBe(false);
  });

  it('rejects `null` — unassigning is not expressible on this endpoint', () => {
    expect(
      assignConversationRequestSchema.safeParse({ assignToUserId: null })
        .success
    ).toBe(false);
  });

  it('REJECTS an unknown / extra field (proves .strict())', () => {
    expect(
      assignConversationRequestSchema.safeParse({
        assignToUserId: 'user_1',
        organizationId: 'org_1',
      }).success
    ).toBe(false);
  });
});

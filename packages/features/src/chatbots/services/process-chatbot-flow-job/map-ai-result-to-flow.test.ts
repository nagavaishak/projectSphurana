import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIResponseResult } from '../generate-ai-response/index.js';
import { mapAIResultToFlowResult } from './map-ai-result-to-flow.js';

describe('mapAIResultToFlowResult', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const makeAIResult = (
    overrides: Partial<AIResponseResult> = {}
  ): AIResponseResult => ({
    message: 'Hello there!',
    ...overrides,
  });

  it('should map a basic AI message to flow result', async () => {
    const result = await mapAIResultToFlowResult(
      mockDb as never,
      'conv-1',
      makeAIResult()
    );

    expect(result.messages).toEqual([{ type: 'text', text: 'Hello there!' }]);
    expect(result.newNodeId).toBeNull();
    expect(result.stoppedAt).toBe('waiting');
  });

  it('should map handoff action correctly', async () => {
    const result = await mapAIResultToFlowResult(
      mockDb as never,
      'conv-1',
      makeAIResult({ action: 'handoff' })
    );

    expect(result.stoppedAt).toBe('handoff');
    expect(result.setAgentHandling).toBe(true);
  });

  it('should map silent_handoff action correctly', async () => {
    const result = await mapAIResultToFlowResult(
      mockDb as never,
      'conv-1',
      makeAIResult({
        action: 'silent_handoff',
        silentHandoffReason:
          'Directive says not to respond to returning customers',
        ownerNotification:
          'Sarah messaged about getting coffee, seems personal',
      })
    );

    expect(result.stoppedAt).toBe('silent_handoff');
    expect(result.setAgentHandling).toBe(true);
    expect(result.messages).toEqual([]);
    expect(result.metadataUpdates?.silentHandoffReason).toBe(
      'Directive says not to respond to returning customers'
    );
    expect(result.metadataUpdates?.ownerNotification).toBe(
      'Sarah messaged about getting coffee, seems personal'
    );
  });

  it('should clear messages on silent_handoff even when AI provides one', async () => {
    const result = await mapAIResultToFlowResult(
      mockDb as never,
      'conv-1',
      makeAIResult({
        message: 'This should not be sent',
        action: 'silent_handoff',
        silentHandoffReason: 'Testing',
      })
    );

    expect(result.messages).toEqual([]);
    expect(result.stoppedAt).toBe('silent_handoff');
  });

  it('should map end action correctly', async () => {
    const result = await mapAIResultToFlowResult(
      mockDb as never,
      'conv-1',
      makeAIResult({ action: 'end' })
    );

    expect(result.stoppedAt).toBe('end');
  });

  it('should include collectedData in metadata updates', async () => {
    const result = await mapAIResultToFlowResult(
      mockDb as never,
      'conv-1',
      makeAIResult({ collectedData: { name: 'Sarah', phone: '+353123' } })
    );

    expect(result.metadataUpdates?.name).toBe('Sarah');
    expect(result.metadataUpdates?.phone).toBe('+353123');
  });

  it('should set stage in metadata updates', async () => {
    const result = await mapAIResultToFlowResult(
      mockDb as never,
      'conv-1',
      makeAIResult({ stage: 'qualified' })
    );

    expect(result.metadataUpdates?.stage).toBe('qualified');
  });

  it('should merge treatments with existing (Set dedup)', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      metadata: { treatmentsDiscussed: ['botox', 'filler'] },
    });

    const result = await mapAIResultToFlowResult(
      mockDb as never,
      'conv-1',
      makeAIResult({ treatmentsMentioned: ['filler', 'laser'] })
    );

    expect(result.metadataUpdates?.treatmentsDiscussed).toEqual([
      'botox',
      'filler',
      'laser',
    ]);
  });

  it('should handle treatments when no existing metadata', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      metadata: null,
    });

    const result = await mapAIResultToFlowResult(
      mockDb as never,
      'conv-1',
      makeAIResult({ treatmentsMentioned: ['botox'] })
    );

    expect(result.metadataUpdates?.treatmentsDiscussed).toEqual(['botox']);
  });

  it('should set healthConcerns when detected', async () => {
    const result = await mapAIResultToFlowResult(
      mockDb as never,
      'conv-1',
      makeAIResult({ healthConcernDetected: true })
    );

    expect(result.metadataUpdates?.healthConcerns).toEqual(['detected']);
  });

  it('should set booking interest correctly', async () => {
    const result = await mapAIResultToFlowResult(
      mockDb as never,
      'conv-1',
      makeAIResult({ bookingInterest: true })
    );

    expect(result.metadataUpdates?.bookingInterest).toBe(true);
  });

  it('should set bookingLinkSent with timestamp', async () => {
    const result = await mapAIResultToFlowResult(
      mockDb as never,
      'conv-1',
      makeAIResult({ bookingLinkSent: true })
    );

    expect(result.metadataUpdates?.bookingLinkSent).toBe(true);
    expect(result.metadataUpdates?.bookingLinkSentAt).toBeDefined();
  });

  it('should set needsFollowUp with reason', async () => {
    const result = await mapAIResultToFlowResult(
      mockDb as never,
      'conv-1',
      makeAIResult({
        needsFollowUp: true,
        followUpReason: 'Asked about hair removal',
      })
    );

    expect(result.metadataUpdates?.needsFollowUp).toBe(true);
    expect(result.metadataUpdates?.followUpReason).toBe(
      'Asked about hair removal'
    );
  });

  it('should always set lastBotResponseAt', async () => {
    const result = await mapAIResultToFlowResult(
      mockDb as never,
      'conv-1',
      makeAIResult()
    );

    expect(result.metadataUpdates?.lastBotResponseAt).toBeDefined();
  });

  it('should preserve existing metadata when AI returns empty fields', async () => {
    const result = await mapAIResultToFlowResult(
      mockDb as never,
      'conv-1',
      makeAIResult({})
    );

    // Only lastBotResponseAt should be set
    expect(result.metadataUpdates).toBeDefined();
    expect(Object.keys(result.metadataUpdates ?? {}).length).toBe(1);
    expect(result.metadataUpdates?.lastBotResponseAt).toBeDefined();
  });

  describe('completed booking (ENG-815)', () => {
    const bookingCompleted = {
      appointmentId: 'apt-1',
      confirmationCode: 'APT-ABC123',
      slotIsoStart: '2026-09-03T13:00:00.000Z',
      displayTime: '2:00 PM',
    };

    it('records the booking and flags it as real', async () => {
      const result = await mapAIResultToFlowResult(
        mockDb as never,
        'conv-1',
        makeAIResult({
          message: "You're all booked for Thursday at 2 PM.",
          bookingCompleted,
        })
      );

      expect(result.bookingConfirmed).toBe(true);
      expect(result.metadataUpdates?.directBookingConfirmedAt).toEqual(
        expect.any(String)
      );
      expect(result.metadataUpdates?.stage).toBe('booking');
    });

    it('flags nothing when no appointment was written', async () => {
      // There is no third state. Absent `bookingCompleted` means absent
      // booking, and the guard downstream must stay armed.
      const result = await mapAIResultToFlowResult(
        mockDb as never,
        'conv-1',
        makeAIResult({ message: "I'm arranging that now.", stage: 'booking' })
      );

      expect(result.bookingConfirmed).toBeUndefined();
      expect(result.metadataUpdates?.directBookingConfirmedAt).toBeUndefined();
    });
  });

  describe('booking push verification from message content', () => {
    it('increments bookingPushCount when message contains booking link but model said false', async () => {
      mockDb.query.conversation.findFirst.mockResolvedValueOnce({
        id: 'conv-1',
        metadata: { bookingPushCount: 0 },
      });

      const result = await mapAIResultToFlowResult(
        mockDb as never,
        'conv-1',
        makeAIResult({
          message: 'Here is our link https://booksolo.co/onlyskin to book in',
          bookingPushed: false,
          bookingLinkSent: false,
        }),
        'https://booksolo.co/onlyskin'
      );

      expect(result.metadataUpdates?.bookingPushCount).toBe(1);
      expect(result.metadataUpdates?.bookingLinkSent).toBe(true);
    });

    it('does not double-increment when model already reported bookingPushed true', async () => {
      mockDb.query.conversation.findFirst.mockResolvedValueOnce({
        id: 'conv-1',
        metadata: { bookingPushCount: 0 },
      });

      const result = await mapAIResultToFlowResult(
        mockDb as never,
        'conv-1',
        makeAIResult({
          message: 'Here is our link https://booksolo.co/onlyskin to book',
          bookingPushed: true,
          bookingLinkSent: true,
        }),
        'https://booksolo.co/onlyskin'
      );

      // Should be 1 (from the model-reported push), not 2
      expect(result.metadataUpdates?.bookingPushCount).toBe(1);
    });

    it('does not increment when no booking link in message and model said false', async () => {
      const result = await mapAIResultToFlowResult(
        mockDb as never,
        'conv-1',
        makeAIResult({
          message: 'Just answering your question about pricing.',
          bookingPushed: false,
        }),
        'https://booksolo.co/onlyskin'
      );

      expect(result.metadataUpdates?.bookingPushCount).toBeUndefined();
    });

    it('handles null bookingLink parameter gracefully', async () => {
      const result = await mapAIResultToFlowResult(
        mockDb as never,
        'conv-1',
        makeAIResult({
          message: 'Hello!',
          bookingPushed: false,
        }),
        null
      );

      expect(result.metadataUpdates?.bookingPushCount).toBeUndefined();
    });

    it('handles undefined bookingLink parameter gracefully', async () => {
      const result = await mapAIResultToFlowResult(
        mockDb as never,
        'conv-1',
        makeAIResult({
          message: 'Hello!',
          bookingPushed: false,
        })
      );

      expect(result.metadataUpdates?.bookingPushCount).toBeUndefined();
    });

    it('detects booking link with query params', async () => {
      mockDb.query.conversation.findFirst.mockResolvedValueOnce({
        id: 'conv-1',
        metadata: { bookingPushCount: 1 },
      });

      const result = await mapAIResultToFlowResult(
        mockDb as never,
        'conv-1',
        makeAIResult({
          message: 'Book here: https://booksolo.co/onlyskin?ref=fb',
          bookingPushed: false,
        }),
        'https://booksolo.co/onlyskin'
      );

      expect(result.metadataUpdates?.bookingPushCount).toBe(2);
    });
  });

  it('should handle null/undefined fields in AI result', async () => {
    const result = await mapAIResultToFlowResult(
      mockDb as never,
      'conv-1',
      makeAIResult({
        collectedData: undefined,
        stage: undefined,
        treatmentsMentioned: undefined,
        healthConcernDetected: undefined,
        bookingInterest: undefined,
      })
    );

    expect(result.messages).toHaveLength(1);
    expect(result.stoppedAt).toBe('waiting');
  });
});

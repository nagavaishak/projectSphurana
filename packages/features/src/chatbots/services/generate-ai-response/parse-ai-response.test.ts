import { describe, expect, it } from 'vitest';
import { parseAIResponse } from './parse-ai-response.js';

describe('parseAIResponse', () => {
  it('parses valid JSON with all fields', () => {
    const result = parseAIResponse(
      JSON.stringify({
        message: 'Hello!',
        action: 'handoff',
        collectedData: { name: 'John', email: 'john@test.com' },
        stage: 'qualified',
        treatmentsMentioned: ['Botox', 'Filler'],
        healthConcernDetected: true,
        bookingInterest: true,
        bookingLinkSent: false,
        needsFollowUp: true,
        followUpReason: 'Asked about laser treatment',
        checkAvailability: { date: '2026-03-15', timePreference: 'morning' },
        bookAppointment: {
          date: '2026-03-15',
          time: '10:00',
          customerName: 'John',
        },
      })
    );

    expect(result.message).toBe('Hello!');
    expect(result.action).toBe('handoff');
    expect(result.collectedData).toEqual({
      name: 'John',
      email: 'john@test.com',
    });
    expect(result.usedWebsiteFetch).toBe(false);
    expect(result.stage).toBe('qualified');
    expect(result.treatmentsMentioned).toEqual(['Botox', 'Filler']);
    expect(result.healthConcernDetected).toBe(true);
    expect(result.bookingInterest).toBe(true);
    expect(result.bookingLinkSent).toBe(false);
    expect(result.needsFollowUp).toBe(true);
    expect(result.followUpReason).toBe('Asked about laser treatment');
    expect(result.checkAvailability).toEqual({
      date: '2026-03-15',
      timePreference: 'morning',
    });
    expect(result.bookAppointment).toEqual({
      date: '2026-03-15',
      time: '10:00',
      customerName: 'John',
    });
  });

  it('parses partial JSON with only message', () => {
    const result = parseAIResponse(
      JSON.stringify({ message: 'Just a message' })
    );

    expect(result.message).toBe('Just a message');
    expect(result.action).toBeUndefined();
    expect(result.collectedData).toBeUndefined();
    expect(result.stage).toBeUndefined();
    expect(result.usedWebsiteFetch).toBe(false);
  });

  it('uses raw content as message when JSON has no message field', () => {
    const content = JSON.stringify({ action: 'handoff' });
    const result = parseAIResponse(content);

    // Falls back to the raw JSON string as the message
    expect(result.message).toBe(content);
    expect(result.action).toBe('handoff');
  });

  it('falls back to raw text for invalid JSON', () => {
    const result = parseAIResponse('This is not JSON, just plain text.');

    expect(result.message).toBe('This is not JSON, just plain text.');
    expect(result.usedWebsiteFetch).toBe(false);
    expect(result.action).toBeUndefined();
    expect(result.collectedData).toBeUndefined();
  });

  it('falls back to raw text for empty string', () => {
    const result = parseAIResponse('');

    expect(result.message).toBe('');
    expect(result.usedWebsiteFetch).toBe(false);
  });

  it('maps action values correctly', () => {
    const handoff = parseAIResponse(
      JSON.stringify({ message: 'hi', action: 'handoff' })
    );
    expect(handoff.action).toBe('handoff');

    const end = parseAIResponse(
      JSON.stringify({ message: 'bye', action: 'end' })
    );
    expect(end.action).toBe('end');

    const silentHandoff = parseAIResponse(
      JSON.stringify({ message: '', action: 'silent_handoff' })
    );
    expect(silentHandoff.action).toBe('silent_handoff');
  });

  it('parses silent_handoff with reason and owner notification', () => {
    const result = parseAIResponse(
      JSON.stringify({
        message: '',
        action: 'silent_handoff',
        silentHandoffReason:
          'Returning customer, directive says not to respond',
        ownerNotification:
          'Sarah messaged asking about coffee tomorrow, seems personal',
      })
    );

    expect(result.action).toBe('silent_handoff');
    expect(result.silentHandoffReason).toBe(
      'Returning customer, directive says not to respond'
    );
    expect(result.ownerNotification).toBe(
      'Sarah messaged asking about coffee tomorrow, seems personal'
    );
  });

  it('always sets usedWebsiteFetch to false', () => {
    // usedWebsiteFetch is set later by the service when it actually fetches a website
    const result = parseAIResponse(
      JSON.stringify({ message: 'hi', usedWebsiteFetch: true })
    );
    expect(result.usedWebsiteFetch).toBe(false);
  });
});

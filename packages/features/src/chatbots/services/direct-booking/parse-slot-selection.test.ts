import { describe, expect, it } from '@borradh-workspace/testing';
import { parseSlotSelection } from './parse-slot-selection.js';

type Slot = {
  date: string;
  startTime: string;
  endTime: string;
  displayTime: string;
  isoStart: string;
  isoEnd: string;
  practitionerName?: string;
};

const makeSlot = (
  isoStart: string,
  startTime: string,
  overrides: Partial<Slot> = {}
): Slot => ({
  date: isoStart.slice(0, 10),
  startTime,
  endTime: startTime,
  displayTime: startTime,
  isoStart,
  isoEnd: isoStart,
  ...overrides,
});

const dayNames = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

describe('parseSlotSelection', () => {
  it('matches an ordinal selection ("the first one")', async () => {
    const slots = [
      makeSlot('2026-06-15T10:00:00.000Z', '10:00'),
      makeSlot('2026-06-16T14:00:00.000Z', '14:00'),
    ];

    const result = await parseSlotSelection({
      userMessage: 'the first one please',
      offeredSlots: slots,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.matched).toBe(true);
    expect(result.data.selectedSlot).toEqual(slots[0]);
    expect(result.data.confidence).toBe('high');
    expect(result.data.needsNegotiation).toBeUndefined();
  });

  it('matches by day of week', async () => {
    const slotA = makeSlot('2026-06-15T10:00:00.000Z', '10:00');
    const slotB = makeSlot('2026-06-17T14:00:00.000Z', '14:00');
    const dayA = dayNames[new Date(slotA.isoStart).getDay()];
    const dayB = dayNames[new Date(slotB.isoStart).getDay()];
    // Guard: the two slots must fall on different weekdays for the match to be
    // unambiguous.
    expect(dayA).not.toBe(dayB);

    const result = await parseSlotSelection({
      userMessage: `${dayA} works for me`,
      offeredSlots: [slotA, slotB],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.matched).toBe(true);
    expect(result.data.selectedSlot).toEqual(slotA);
    expect(result.data.confidence).toBe('medium');
  });

  it('matches by time of day', async () => {
    const slots = [
      makeSlot('2026-06-15T10:00:00.000Z', '10:00'),
      makeSlot('2026-06-16T14:00:00.000Z', '14:00'),
    ];

    const result = await parseSlotSelection({
      userMessage: 'can I do 2pm?',
      offeredSlots: slots,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.matched).toBe(true);
    expect(result.data.selectedSlot).toEqual(slots[1]);
    expect(result.data.confidence).toBe('high');
  });

  it('accepts an affirmative when only one slot was offered', async () => {
    const slots = [makeSlot('2026-06-15T10:00:00.000Z', '10:00')];

    const result = await parseSlotSelection({
      userMessage: 'yes',
      offeredSlots: slots,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.matched).toBe(true);
    expect(result.data.selectedSlot).toEqual(slots[0]);
    expect(result.data.confidence).toBe('high');
  });

  it('returns no match for an unrecognised reply', async () => {
    const slots = [
      makeSlot('2026-06-15T10:00:00.000Z', '10:00'),
      makeSlot('2026-06-16T14:00:00.000Z', '14:00'),
    ];

    const result = await parseSlotSelection({
      userMessage: 'hmm, banana',
      offeredSlots: slots,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.matched).toBe(false);
    expect(result.data.selectedSlot).toBeUndefined();
    expect(result.data.confidence).toBe('none');
    expect(result.data.needsNegotiation).toBeUndefined();
  });

  it('flags a negotiation request with the requested alternative', async () => {
    const slots = [
      makeSlot('2026-06-15T10:00:00.000Z', '10:00'),
      makeSlot('2026-06-16T14:00:00.000Z', '14:00'),
    ];

    const result = await parseSlotSelection({
      userMessage: 'do you have anything else?',
      offeredSlots: slots,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.matched).toBe(false);
    expect(result.data.needsNegotiation).toBe(true);
    expect(result.data.requestedAlternative).toBe('different');
    expect(result.data.confidence).toBe('medium');
  });

  it('flags a "next week" alternative request', async () => {
    const slots = [makeSlot('2026-06-15T10:00:00.000Z', '10:00')];

    const result = await parseSlotSelection({
      userMessage: 'could you do next week instead?',
      offeredSlots: slots,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.matched).toBe(false);
    expect(result.data.needsNegotiation).toBe(true);
    expect(result.data.requestedAlternative).toBe('next_week');
  });

  it('returns confidence "none" when no slots were offered', async () => {
    const result = await parseSlotSelection({
      userMessage: 'the first one',
      offeredSlots: [],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.matched).toBe(false);
    expect(result.data.confidence).toBe('none');
  });
  // Regression: a ±30-minute tolerance combined with `.find()` meant the first
  // slot within half an hour won, so with 30-minute intervals an adjacent slot
  // always matched. Asking for "9:30 AM" booked the 9:00 slot — the customer
  // was placed in a time they never chose. Verified against a real booking:
  // appointment written at 09:00 for a 9:30 request.
  it('picks the EXACT slot when the requested time is offered', async () => {
    const slots = [
      makeSlot('2026-07-20T09:00:00.000Z', '09:00'),
      makeSlot('2026-07-20T09:30:00.000Z', '09:30'),
      makeSlot('2026-07-20T10:00:00.000Z', '10:00'),
    ];

    const result = await parseSlotSelection({
      userMessage: '9:30 AM works for me please',
      offeredSlots: slots,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.matched).toBe(true);
      expect(result.data.selectedSlot?.startTime).toBe('09:30');
    }
  });

  it('picks the exact slot regardless of the order slots are offered in', async () => {
    const slots = [
      makeSlot('2026-07-20T10:00:00.000Z', '10:00'),
      makeSlot('2026-07-20T09:00:00.000Z', '09:00'),
      makeSlot('2026-07-20T09:30:00.000Z', '09:30'),
    ];

    const result = await parseSlotSelection({
      userMessage: 'can I do 9am',
      offeredSlots: slots,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.selectedSlot?.startTime).toBe('09:00');
    }
  });

  it('does not book a nearby slot when the requested time is ambiguous', async () => {
    // 9:15 sits exactly between 9:00 and 9:30. Guessing either would book
    // someone into a time they did not pick, so we ask instead.
    const slots = [
      makeSlot('2026-07-20T09:00:00.000Z', '09:00'),
      makeSlot('2026-07-20T09:30:00.000Z', '09:30'),
    ];

    const result = await parseSlotSelection({
      userMessage: 'is 9:15 possible?',
      offeredSlots: slots,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.matched).toBe(false);
    }
  });

  it('does not book anything when the requested time is far from every slot', async () => {
    const slots = [
      makeSlot('2026-07-20T09:00:00.000Z', '09:00'),
      makeSlot('2026-07-20T09:30:00.000Z', '09:30'),
    ];

    const result = await parseSlotSelection({
      userMessage: 'could I do 4pm instead',
      offeredSlots: slots,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.matched).toBe(false);
    }
  });
});

import type { DbConnection } from '@borradh-workspace/database';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import * as checkAvailabilityModule from '../../../calendar/services/check-availability/check-availability.service.js';
import { offerBookingSlots } from './offer-booking-slots.js';

// A restored `vi.spyOn`, NOT `vi.mock`. Under `isolate: false` the worker shares
// one module graph, so a hoisted `vi.mock` of an internal module both leaks its
// bare factory into every later file and silently misses whenever an earlier
// file already imported the real module. Spy the SOURCE module — the
// `calendar/services/index.js` barrel re-export is a live getter that
// `vi.spyOn` cannot redefine.
let mockCheckAvailability: MockInstance;

const mockDb = {
  query: {
    conversation: {
      findFirst: vi.fn(),
    },
    organizationService: {
      findFirst: vi.fn(),
    },
    organization: {
      findFirst: vi.fn(),
    },
  },
};

describe('offerBookingSlots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckAvailability = vi
      .spyOn(checkAvailabilityModule, 'checkAvailability')
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    mockCheckAvailability.mockRestore();
  });

  it('offers times from across the day, not just the earliest three (ENG-814)', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      metadata: {},
      externalUserName: 'Jane',
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      defaultAppointmentDuration: 30,
      timezone: 'Europe/Dublin',
    });

    // A clinic open 10:00-19:00: 18 free slots on day one.
    const daySlots = Array.from({ length: 18 }, (_, i) => {
      const hour = 10 + Math.floor(i / 2);
      const minute = i % 2 === 0 ? '00' : '30';
      const hh = hour.toString().padStart(2, '0');
      return {
        date: '2024-01-18',
        startTime: `${hh}:${minute}`,
        endTime: `${hh}:${minute}`,
        displayTime: `${hh}:${minute}`,
        isoStart: `2024-01-18T${hh}:${minute}:00.000Z`,
        isoEnd: `2024-01-18T${hh}:${minute}:00.000Z`,
      };
    });
    mockCheckAvailability.mockResolvedValue({
      success: true,
      data: {
        available: true,
        provider: 'borradh',
        message: '',
        slots: daySlots,
      },
    } as never);

    const result = await offerBookingSlots(mockDb as unknown as DbConnection, {
      conversationId: 'conv-1',
      organizationId: 'org-1',
      slotsToOffer: 3,
      daysAhead: 7,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    const offered = result.data.slots.map((s) => s.startTime);
    // The head-of-day slice would have given 10:00, 10:30, 11:00 — three
    // times inside the first hour of a nine-hour day.
    expect(offered).not.toEqual(['10:00', '10:30', '11:00']);
    expect(offered[0]).toBe('10:00');
    expect(offered.at(-1)).toBe('18:30');
    expect(result.data.message).toContain('18:30');
  });

  it('returns slots message with customer name', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      metadata: { name: 'Jane Smith' },
      externalUserName: 'Jane',
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      defaultAppointmentDuration: 30,
    });

    // Mock first call to return slots (the loop will stop after getting enough slots)
    mockCheckAvailability.mockResolvedValue({
      success: true,
      data: {
        available: true,
        provider: 'borradh',
        message: '',
        slots: [
          {
            date: '2024-01-18',
            startTime: '14:00',
            endTime: '14:30',
            displayTime: '2 PM',
            isoStart: '2024-01-18T14:00:00.000Z',
            isoEnd: '2024-01-18T14:30:00.000Z',
          },
          {
            date: '2024-01-18',
            startTime: '15:00',
            endTime: '15:30',
            displayTime: '3 PM',
            isoStart: '2024-01-18T15:00:00.000Z',
            isoEnd: '2024-01-18T15:30:00.000Z',
          },
          {
            date: '2024-01-18',
            startTime: '16:00',
            endTime: '16:30',
            displayTime: '4 PM',
            isoStart: '2024-01-18T16:00:00.000Z',
            isoEnd: '2024-01-18T16:30:00.000Z',
          },
        ],
      },
    } as never);

    const result = await offerBookingSlots(mockDb as unknown as DbConnection, {
      conversationId: 'conv-1',
      organizationId: 'org-1',
      slotsToOffer: 3,
      daysAhead: 7,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toContain('Jane');
      expect(result.data.slots.length).toBeGreaterThan(0);
      expect(result.data.noAvailability).toBe(false);
    }
  });

  it('returns no availability message when no slots found', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      metadata: { name: 'John' },
      externalUserName: 'John',
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      defaultAppointmentDuration: 30,
    });

    // Mock all days returning no slots
    mockCheckAvailability.mockResolvedValue({
      success: true,
      data: {
        available: false,
        provider: 'borradh',
        message: 'No slots',
        slots: [],
      },
    } as never);

    const result = await offerBookingSlots(mockDb as unknown as DbConnection, {
      conversationId: 'conv-1',
      organizationId: 'org-1',
      slotsToOffer: 3,
      daysAhead: 7,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toContain('sorry');
      expect(result.data.noAvailability).toBe(true);
      expect(result.data.slots.length).toBe(0);
    }
  });

  it('does NOT propose any times when every day in the window is closed', async () => {
    // The clinic is fully closed across the whole lookahead window (e.g. all
    // weekend, or hours misconfigured). The bot must say it has nothing and
    // must not invent a time.
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      metadata: { name: 'Mary' },
      externalUserName: 'Mary',
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      defaultAppointmentDuration: 30,
    });

    mockCheckAvailability.mockResolvedValue({
      success: true,
      data: { available: false, provider: 'borradh', message: '', slots: [] },
    } as never);

    const result = await offerBookingSlots(mockDb as unknown as DbConnection, {
      conversationId: 'conv-1',
      organizationId: 'org-1',
      slotsToOffer: 3,
      daysAhead: 7,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.noAvailability).toBe(true);
    expect(result.data.slots).toHaveLength(0);
    // No time-of-day must leak into the message.
    expect(result.data.message).not.toMatch(/\d\s?(am|pm)/i);
    expect(result.data.message).not.toMatch(/\d{1,2}:\d{2}/);
    // Every day in the window was checked.
    expect(mockCheckAvailability).toHaveBeenCalledTimes(7);
  });

  it('treats an availability check error for a day as no slots (fails safe)', async () => {
    // If checkAvailability returns an error (e.g. calendar misconfigured), the
    // bot must not offer anything for that day rather than crashing or guessing.
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      metadata: { name: 'Sam' },
      externalUserName: 'Sam',
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      defaultAppointmentDuration: 30,
    });

    mockCheckAvailability.mockResolvedValue({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'boom' },
    } as never);

    const result = await offerBookingSlots(mockDb as unknown as DbConnection, {
      conversationId: 'conv-1',
      organizationId: 'org-1',
      slotsToOffer: 3,
      daysAhead: 5,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.noAvailability).toBe(true);
    expect(result.data.slots).toHaveLength(0);
  });

  it('skips closed days and collects from the first open days', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      metadata: { name: 'Lee' },
      externalUserName: 'Lee',
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      defaultAppointmentDuration: 30,
    });

    const slot = (date: string, startTime: string, displayTime: string) => ({
      date,
      startTime,
      endTime: startTime,
      displayTime,
      isoStart: `${date}T${startTime}:00.000Z`,
      isoEnd: `${date}T${startTime}:00.000Z`,
    });
    const empty = {
      success: true,
      data: { available: false, provider: 'borradh', message: '', slots: [] },
    } as never;

    // Day 1 closed, day 2 has two slots, day 3 has two slots.
    mockCheckAvailability
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce({
        success: true,
        data: {
          available: true,
          provider: 'borradh',
          message: '',
          slots: [
            slot('2026-06-02', '10:00', '10 AM'),
            slot('2026-06-02', '10:30', '10:30 AM'),
          ],
        },
      } as never)
      .mockResolvedValueOnce({
        success: true,
        data: {
          available: true,
          provider: 'borradh',
          message: '',
          slots: [
            slot('2026-06-03', '09:00', '9 AM'),
            slot('2026-06-03', '09:30', '9:30 AM'),
          ],
        },
      } as never)
      .mockResolvedValue(empty);

    const result = await offerBookingSlots(mockDb as unknown as DbConnection, {
      conversationId: 'conv-1',
      organizationId: 'org-1',
      slotsToOffer: 3,
      daysAhead: 7,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    // Capped at slotsToOffer (3): two from day 2, one from day 3.
    expect(result.data.slots).toHaveLength(3);
    expect(result.data.noAvailability).toBe(false);
    expect(result.data.slots.map((s) => s.date)).toEqual([
      '2026-06-02',
      '2026-06-02',
      '2026-06-03',
    ]);
  });

  it('stops querying once enough slots have been collected', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      metadata: { name: 'Pat' },
      externalUserName: 'Pat',
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      defaultAppointmentDuration: 30,
    });

    mockCheckAvailability.mockResolvedValue({
      success: true,
      data: {
        available: true,
        provider: 'borradh',
        message: '',
        slots: [
          {
            date: '2026-06-02',
            startTime: '10:00',
            endTime: '10:30',
            displayTime: '10 AM',
            isoStart: '2026-06-02T10:00:00.000Z',
            isoEnd: '2026-06-02T10:30:00.000Z',
          },
          {
            date: '2026-06-02',
            startTime: '10:30',
            endTime: '11:00',
            displayTime: '10:30 AM',
            isoStart: '2026-06-02T10:30:00.000Z',
            isoEnd: '2026-06-02T11:00:00.000Z',
          },
        ],
      },
    } as never);

    const result = await offerBookingSlots(mockDb as unknown as DbConnection, {
      conversationId: 'conv-1',
      organizationId: 'org-1',
      slotsToOffer: 2,
      daysAhead: 7,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.slots).toHaveLength(2);
    // Got 2 slots on the first open day → must not keep scanning the window.
    expect(mockCheckAvailability).toHaveBeenCalledTimes(1);
  });

  it('returns NOT_FOUND when conversation not found', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(null);

    const result = await offerBookingSlots(mockDb as unknown as DbConnection, {
      conversationId: 'conv-nonexistent',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('uses fallback name when no name in metadata', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      metadata: {},
      externalUserName: null,
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      defaultAppointmentDuration: 30,
    });

    // Mock returning enough slots
    mockCheckAvailability.mockResolvedValue({
      success: true,
      data: {
        available: true,
        provider: 'borradh',
        message: '',
        slots: [
          {
            date: '2024-01-18',
            startTime: '14:00',
            endTime: '14:30',
            displayTime: '2 PM',
            isoStart: '2024-01-18T14:00:00.000Z',
            isoEnd: '2024-01-18T14:30:00.000Z',
          },
          {
            date: '2024-01-18',
            startTime: '15:00',
            endTime: '15:30',
            displayTime: '3 PM',
            isoStart: '2024-01-18T15:00:00.000Z',
            isoEnd: '2024-01-18T15:30:00.000Z',
          },
          {
            date: '2024-01-18',
            startTime: '16:00',
            endTime: '16:30',
            displayTime: '4 PM',
            isoStart: '2024-01-18T16:00:00.000Z',
            isoEnd: '2024-01-18T16:30:00.000Z',
          },
        ],
      },
    } as never);

    const result = await offerBookingSlots(mockDb as unknown as DbConnection, {
      conversationId: 'conv-1',
      organizationId: 'org-1',
      slotsToOffer: 3,
      daysAhead: 7,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // With no name on the conversation we address nobody rather than
      // falling back to the literal "there", which produced messages opening
      // "there, I can see we have availability ...".
      expect(result.data.message).not.toMatch(/^there,/i);
      expect(result.data.message).toContain('I can see we have availability');
      expect(result.data.message).toContain('2 PM');
    }
  });
});

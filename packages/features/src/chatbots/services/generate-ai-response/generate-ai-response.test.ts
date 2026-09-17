import { chatCompletion } from '@borradh-workspace/ai';
import { createMockDatabase } from '@borradh-workspace/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type MockInstance, vi } from 'vitest';
import * as updateAppointmentModule from '../../../appointments/services/update-appointment/update-appointment.service.js';
import * as checkAvailabilityModule from '../../../calendar/services/check-availability/check-availability.service.js';
import * as websiteFetchToolModule from '../../../conversations/tools/website-fetch.tool.js';
import { ErrorCodes } from '../../../shared/index.js';
import * as bookDirectAppointmentModule from '../direct-booking/book-direct-appointment.js';
import * as evaluateReschedulePolicyModule from '../evaluate-reschedule-policy/evaluate-reschedule-policy.service.js';
import { generateAIResponse } from './generate-ai-response.service.js';

// `@borradh-workspace/email` is a canonically-aliased boundary module (see
// vitest.config.ts) — do NOT vi.mock it. A file-local vi.mock replaces the
// shared module under `isolate: false` and breaks other files that captured the
// aliased `sendEmail`. The alias already stubs `sendEmail` + templates.
//
// The collaborators below are INTERNAL modules and use restored `vi.spyOn`s
// rather than `vi.mock`: under `isolate: false` a hoisted factory leaks into
// every later file AND silently misses once an earlier file has imported the
// real module. Each spy targets the SOURCE module the symbol is defined in —
// barrel `index.js` re-exports are live getters and cannot be redefined.
let mockCheckAvailability: MockInstance;
let mockCreateWebsiteFetchTool: MockInstance;
let mockUpdateAppointment: MockInstance;
let mockEvaluateReschedulePolicy: MockInstance;
let mockBookDirectAppointment: MockInstance;

describe('generateAIResponse', () => {
  const mockDb = createMockDatabase();
  const apiKey = 'test-openai-key';

  const makeConversation = (overrides = {}) => ({
    id: 'conv-1',
    organizationId: 'org-1',
    platform: 'whatsapp',
    currentNodeId: null,
    metadata: {},
    externalUserId: 'ext-user-1',
    externalUserName: 'Test User',
    metaAdsPageId: null,
    ...overrides,
  });

  const makeOrganization = (overrides = {}) => ({
    id: 'org-1',
    name: 'Test Clinic',
    slug: 'test-clinic',
    defaultBookingLink: null,
    businessType: 'clinic',
    tagline: null,
    credibilityLine: null,
    businessHours: null,
    websiteUrl: null,
    primaryCalendarType: null,
    primaryCalendarAccountId: null,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockCheckAvailability = vi
      .spyOn(checkAvailabilityModule, 'checkAvailability')
      .mockResolvedValue(undefined as never);
    mockCreateWebsiteFetchTool = vi
      .spyOn(websiteFetchToolModule, 'createWebsiteFetchTool')
      .mockReturnValue(undefined as never);
    mockUpdateAppointment = vi
      .spyOn(updateAppointmentModule, 'updateAppointment')
      .mockResolvedValue(undefined as never);
    mockEvaluateReschedulePolicy = vi
      .spyOn(evaluateReschedulePolicyModule, 'evaluateReschedulePolicy')
      .mockResolvedValue(undefined as never);
    mockBookDirectAppointment = vi
      .spyOn(bookDirectAppointmentModule, 'bookDirectAppointment')
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    mockCheckAvailability.mockRestore();
    mockCreateWebsiteFetchTool.mockRestore();
    mockUpdateAppointment.mockRestore();
    mockEvaluateReschedulePolicy.mockRestore();
    mockBookDirectAppointment.mockRestore();
  });

  it('should generate an AI response for valid input', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(
      makeConversation()
    );
    mockDb.query.organization.findFirst.mockResolvedValueOnce(
      makeOrganization()
    );
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([]);
    mockDb.query.metaAd.findMany.mockResolvedValueOnce([]);
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([]);
    mockDb.query.conversationMessage.findMany.mockResolvedValueOnce([]);

    vi.mocked(chatCompletion).mockResolvedValueOnce({
      content: JSON.stringify({
        message: 'Hello! How can I help you today?',
        stage: 'first_contact',
      }),
      model: 'gpt-4o',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    const result = await generateAIResponse(
      mockDb as never,
      { conversationId: 'conv-1', userMessage: 'Hi there' },
      apiKey
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toBe('Hello! How can I help you today?');
      expect(result.data.stage).toBe('first_contact');
    }
  });

  it('surfaces the lead-form enquiry and mapped service in the prompt', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(
      makeConversation({ metadata: { leadId: 'lead-1' } })
    );
    mockDb.query.organization.findFirst.mockResolvedValueOnce(
      makeOrganization()
    );
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([]);
    mockDb.query.metaAd.findMany.mockResolvedValueOnce([]);
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([]);
    mockDb.query.conversationMessage.findMany.mockResolvedValueOnce([]);

    // resolveLeadEnquiry: load the linked lead, its form, and the mapped service.
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead-1',
      source: 'meta_lead_form',
      formData: {
        form_id: 'F1',
        'which_treatment_are_you_interested_in?': 'japanese_head_spa',
      },
    });
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce({
      name: 'JHS — New Client Form',
      organizationServiceId: 'svc-jhs',
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      name: 'Japanese Head Spa',
      isActive: true,
    });

    vi.mocked(chatCompletion).mockResolvedValueOnce({
      content: JSON.stringify({ message: 'Hi!', stage: 'first_contact' }),
      model: 'gpt-4o',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    const result = await generateAIResponse(
      mockDb as never,
      { conversationId: 'conv-1', userMessage: 'how much?' },
      apiKey
    );

    expect(result.success).toBe(true);
    const userPrompt = vi.mocked(chatCompletion).mock.calls[0]?.[0] as string;
    expect(userPrompt).toContain('Lead Form Enquiry');
    expect(userPrompt).toContain('Japanese Head Spa');
    expect(userPrompt).toContain('which treatment are you interested in');
  });

  it('should handle non-JSON AI response gracefully', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(
      makeConversation()
    );
    mockDb.query.organization.findFirst.mockResolvedValueOnce(
      makeOrganization()
    );
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([]);
    mockDb.query.metaAd.findMany.mockResolvedValueOnce([]);
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([]);
    mockDb.query.conversationMessage.findMany.mockResolvedValueOnce([]);

    vi.mocked(chatCompletion).mockResolvedValueOnce({
      content: 'Just plain text response',
      model: 'gpt-4o',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    const result = await generateAIResponse(
      mockDb as never,
      { conversationId: 'conv-1', userMessage: 'Hi' },
      apiKey
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toBe('Just plain text response');
    }
  });

  it('should return VALIDATION_ERROR for empty conversationId', async () => {
    const result = await generateAIResponse(
      mockDb as never,
      { conversationId: '', userMessage: 'Hello' },
      apiKey
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('should return VALIDATION_ERROR for empty userMessage', async () => {
    const result = await generateAIResponse(
      mockDb as never,
      { conversationId: 'conv-1', userMessage: '' },
      apiKey
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('should return NOT_FOUND when conversation does not exist', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(null);

    const result = await generateAIResponse(
      mockDb as never,
      { conversationId: 'conv-1', userMessage: 'Hi' },
      apiKey
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  describe('backfill message filtering', () => {
    it('should treat returning conversation as first contact when only backfill bot messages exist', async () => {
      // History contains only backfill bot messages — after filtering, no bot messages remain
      // So isReturningConversation should be false → first message rules apply
      mockDb.query.conversation.findFirst.mockResolvedValueOnce(
        makeConversation()
      );
      mockDb.query.organization.findFirst.mockResolvedValueOnce(
        makeOrganization()
      );
      mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([]);
      mockDb.query.metaAd.findMany.mockResolvedValueOnce([]);
      mockDb.query.organizationService.findMany.mockResolvedValueOnce([]);

      // After backfill filter, only user messages remain (no bot messages)
      mockDb.query.conversationMessage.findMany.mockResolvedValueOnce([
        {
          role: 'user',
          content: 'Hi',
          origin: 'live',
          createdAt: new Date(),
        },
      ]);

      vi.mocked(chatCompletion).mockResolvedValueOnce({
        content: JSON.stringify({
          message: 'Hey! I am the receptionist.',
          stage: 'first_contact',
        }),
        model: 'gpt-4o',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      });

      const result = await generateAIResponse(
        mockDb as never,
        { conversationId: 'conv-1', userMessage: 'Hi there' },
        apiKey
      );

      expect(result.success).toBe(true);
      // The AI should have been called — verify the system prompt contains first message rules
      expect(vi.mocked(chatCompletion)).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(chatCompletion).mock.calls[0];
      const systemPrompt = callArgs?.[1]?.systemMessage as string;
      expect(systemPrompt).toContain('FIRST MESSAGE RULES');
    });

    it('should detect returning conversation when live bot messages exist', async () => {
      mockDb.query.conversation.findFirst.mockResolvedValueOnce(
        makeConversation({ createdAt: new Date('2026-03-01') })
      );
      mockDb.query.organization.findFirst.mockResolvedValueOnce(
        makeOrganization()
      );
      mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([]);
      mockDb.query.metaAd.findMany.mockResolvedValueOnce([]);
      mockDb.query.organizationService.findMany.mockResolvedValueOnce([]);

      // History contains a live bot message — isReturningConversation = true
      mockDb.query.conversationMessage.findMany.mockResolvedValueOnce([
        {
          role: 'user',
          content: 'Hi',
          origin: 'live',
          createdAt: new Date('2026-03-01'),
        },
        {
          role: 'bot',
          content: 'Hey!',
          origin: 'live',
          createdAt: new Date('2026-03-01'),
        },
      ]);

      // Mock the count query for returning sender
      mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 2 }]),
        }),
      });

      vi.mocked(chatCompletion).mockResolvedValueOnce({
        content: JSON.stringify({
          message: 'Hey, good to hear from you!',
          stage: 'qualified',
        }),
        model: 'gpt-4o',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      });

      const result = await generateAIResponse(
        mockDb as never,
        { conversationId: 'conv-1', userMessage: 'Hey again' },
        apiKey
      );

      expect(result.success).toBe(true);
      const callArgs = vi.mocked(chatCompletion).mock.calls[0];
      const systemPrompt = callArgs?.[1]?.systemMessage as string;
      // Returning conversation rules should be used, not first message rules
      expect(systemPrompt).toContain('RETURNING CUSTOMER RULES');
    });
  });

  it('should return NOT_FOUND when organization does not exist', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(
      makeConversation()
    );
    mockDb.query.organization.findFirst.mockResolvedValueOnce(null);

    const result = await generateAIResponse(
      mockDb as never,
      { conversationId: 'conv-1', userMessage: 'Hi' },
      apiKey
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  describe('rescheduling flow', () => {
    // Org with a Borradh-managed calendar so `calendarConnected` is true —
    // the precondition for the reschedule offer/execute blocks to run.
    const calendarOrg = () =>
      makeOrganization({
        primaryCalendarType: 'borradh',
        primaryCalendarAccountId: 'cal-acct-1',
      });

    // Org with NO connected calendar → `calendarConnected` is false.
    const noCalendarOrg = () =>
      makeOrganization({
        primaryCalendarType: null,
        primaryCalendarAccountId: null,
      });

    const seedRescheduleConversation = (org = calendarOrg()) => {
      mockDb.query.conversation.findFirst.mockResolvedValueOnce(
        makeConversation()
      );
      mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
      mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([]);
      mockDb.query.metaAd.findMany.mockResolvedValueOnce([]);
      mockDb.query.organizationService.findMany.mockResolvedValueOnce([]);
      mockDb.query.conversationMessage.findMany.mockResolvedValueOnce([]);

      // The AI detects reschedule intent on the first pass.
      vi.mocked(chatCompletion).mockResolvedValue({
        content: JSON.stringify({
          message: 'Let me check our rescheduling policy.',
          rescheduleAppointment: true,
        }),
        model: 'gpt-4o',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      });
    };

    it('runs when the calendar is connected and the AI detects intent', async () => {
      seedRescheduleConversation();
      mockEvaluateReschedulePolicy.mockResolvedValueOnce({
        success: true,
        data: {
          eligible: true,
          reason: 'eligible',
          contextMessage: 'Eligible to reschedule.',
        },
      } as never);

      const result = await generateAIResponse(
        mockDb as never,
        { conversationId: 'conv-1', userMessage: 'I need to move my booking' },
        apiKey
      );

      expect(result.success).toBe(true);
      // Calendar connected → the reschedule policy was evaluated.
      expect(mockEvaluateReschedulePolicy).toHaveBeenCalledTimes(1);
    });

    it('does NOT run when the calendar is not connected', async () => {
      seedRescheduleConversation(noCalendarOrg());

      const result = await generateAIResponse(
        mockDb as never,
        { conversationId: 'conv-1', userMessage: 'I need to move my booking' },
        apiKey
      );

      expect(result.success).toBe(true);
      // No connected calendar → rescheduling is never offered/executed.
      expect(mockEvaluateReschedulePolicy).not.toHaveBeenCalled();
    });
  });
  describe('calendar availability presentation (ENG-814)', () => {
    // A clinic open 10:00-19:00 at 30-minute granularity: 18 slots, of which
    // only the first five were ever shown to the model.
    const fullDaySlots = Array.from({ length: 18 }, (_, i) => {
      const hour = 10 + Math.floor(i / 2);
      const minute = i % 2 === 0 ? 0 : 30;
      const hh = hour.toString().padStart(2, '0');
      const mm = minute.toString().padStart(2, '0');
      return {
        date: '2026-09-03',
        startTime: `${hh}:${mm}`,
        endTime: `${hh}:${mm}`,
        displayTime: `${hour > 12 ? hour - 12 : hour}:${mm} ${hour >= 12 ? 'PM' : 'AM'}`,
        isoStart: `2026-09-03T${hh}:${mm}:00.000Z`,
        isoEnd: `2026-09-03T${hh}:${mm}:00.000Z`,
      };
    });

    const seedAvailabilityConversation = (slots = fullDaySlots) => {
      mockDb.query.conversation.findFirst.mockResolvedValueOnce(
        makeConversation()
      );
      mockDb.query.organization.findFirst.mockResolvedValueOnce(
        makeOrganization({
          bookingDestination: 'borradh',
          primaryCalendarType: 'borradh',
          timezone: 'Europe/Dublin',
        })
      );
      mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([]);
      mockDb.query.metaAd.findMany.mockResolvedValueOnce([]);
      mockDb.query.organizationService.findMany.mockResolvedValueOnce([]);
      mockDb.query.conversationMessage.findMany.mockResolvedValueOnce([]);

      vi.mocked(chatCompletion)
        .mockResolvedValueOnce({
          content: JSON.stringify({
            message: 'Let me look at that day for you.',
            checkAvailability: { date: '2026-09-03', timePreference: 'any' },
          }),
          model: 'gpt-4o',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({ message: 'How about 10 AM or 5 PM?' }),
          model: 'gpt-4o',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        });

      mockCheckAvailability.mockResolvedValueOnce({
        success: true,
        data: { available: true, slots, provider: 'borradh', message: 'ok' },
      } as never);
    };

    it('shows the model the whole day, not just the first five slots', async () => {
      seedAvailabilityConversation();

      await generateAIResponse(
        mockDb as never,
        { conversationId: 'conv-1', userMessage: 'can i book for 3rd sept' },
        apiKey
      );

      const calendarPrompt = vi.mocked(chatCompletion).mock
        .calls[1]?.[0] as string;

      // The afternoon and evening exist as far as the model is concerned.
      expect(calendarPrompt).toContain('6:30 PM');
      expect(calendarPrompt).toContain('2:00 PM');
      // ...and the morning is still there.
      expect(calendarPrompt).toContain('10:00 AM');
    });

    it('tells the model to spread its offer rather than recite the list', async () => {
      seedAvailabilityConversation();

      await generateAIResponse(
        mockDb as never,
        { conversationId: 'conv-1', userMessage: 'anything after 5?' },
        apiKey
      );

      const calendarPrompt = vi.mocked(chatCompletion).mock
        .calls[1]?.[0] as string;

      expect(calendarPrompt).toMatch(/never invent one/i);
      expect(calendarPrompt).toMatch(/spread across the day/i);
    });
  });

  describe('in-chat booking (ENG-815 / ENG-677)', () => {
    const slot = {
      date: '2026-09-03',
      startTime: '14:00',
      endTime: '14:30',
      displayTime: '2:00 PM',
      isoStart: '2026-09-03T13:00:00.000Z',
      isoEnd: '2026-09-03T13:30:00.000Z',
      practitionerId: 'prac-1',
    };

    const nativeOrg = (overrides = {}) =>
      makeOrganization({
        bookingDestination: 'borradh',
        primaryCalendarType: 'borradh',
        timezone: 'Europe/Dublin',
        chatbotSystemPrompt: null,
        ...overrides,
      });

    const seedBookingRequest = (org = nativeOrg(), time = '14:00') => {
      mockDb.query.conversation.findFirst.mockResolvedValueOnce(
        makeConversation({
          metadata: { name: 'Pavit', phone: '+353871234567' },
        })
      );
      mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
      mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([]);
      mockDb.query.metaAd.findMany.mockResolvedValueOnce([]);
      mockDb.query.organizationService.findMany.mockResolvedValueOnce([]);
      mockDb.query.conversationMessage.findMany.mockResolvedValueOnce([]);

      // The exact shape the prompt asks for — and which nothing used to act on.
      vi.mocked(chatCompletion).mockResolvedValueOnce({
        content: JSON.stringify({
          message:
            "Thanks Pavit, I have your number. I'm arranging your haircut for Thursday 3 September at 2:00 PM now.",
          bookAppointment: {
            date: '2026-09-03',
            time,
            customerName: 'Pavit',
          },
        }),
        model: 'gpt-4o',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });
    };

    it('writes the appointment the model asked for and confirms from the row', async () => {
      seedBookingRequest();
      mockCheckAvailability.mockResolvedValueOnce({
        success: true,
        data: {
          available: true,
          slots: [slot],
          provider: 'borradh',
          message: 'ok',
        },
      } as never);
      mockBookDirectAppointment.mockResolvedValueOnce({
        success: true,
        data: {
          success: true,
          appointmentId: 'apt-1',
          confirmationCode: 'APT-ABC123',
          confirmationMessage:
            "You're all booked for Thursday, September 3 at 2:00 PM. Your confirmation code is APT-ABC123. See you then!",
        },
      } as never);

      const result = await generateAIResponse(
        mockDb as never,
        { conversationId: 'conv-1', userMessage: 'yes 2pm please' },
        apiKey
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(mockBookDirectAppointment).toHaveBeenCalledWith(
        mockDb,
        expect.objectContaining({
          conversationId: 'conv-1',
          organizationId: 'org-1',
          slotIsoStart: slot.isoStart,
          slotIsoEnd: slot.isoEnd,
          practitionerId: 'prac-1',
          customerName: 'Pavit',
          customerPhone: '+353871234567',
        })
      );
      // The customer is told what happened, not what the model imagined.
      expect(result.data.message).toContain("You're all booked");
      expect(result.data.bookingCompleted?.appointmentId).toBe('apt-1');
      expect(result.data.bookAppointment).toBeUndefined();
    });

    it('never claims a booking for a time the diary does not have', async () => {
      seedBookingRequest(nativeOrg(), '14:00');
      // 2 PM is not free; 11 AM and 4 PM are.
      mockCheckAvailability.mockResolvedValueOnce({
        success: true,
        data: {
          available: true,
          slots: [
            { ...slot, startTime: '11:00', displayTime: '11 AM' },
            { ...slot, startTime: '16:00', displayTime: '4 PM' },
          ],
          provider: 'borradh',
          message: 'ok',
        },
      } as never);

      const result = await generateAIResponse(
        mockDb as never,
        { conversationId: 'conv-1', userMessage: '2pm please' },
        apiKey
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(mockBookDirectAppointment).not.toHaveBeenCalled();
      // The invented "I'm arranging that now" is replaced, not shipped.
      expect(result.data.message).not.toMatch(/arranging/i);
      expect(result.data.message).toContain('11 AM');
      expect(result.data.message).toContain('4 PM');
      expect(result.data.bookingCompleted).toBeUndefined();
    });

    it('does not book for an org whose real diary lives in another system', async () => {
      seedBookingRequest(
        nativeOrg({ defaultBookingLink: 'https://fresha.com/clinic' })
      );

      const result = await generateAIResponse(
        mockDb as never,
        { conversationId: 'conv-1', userMessage: '2pm please' },
        apiKey
      );

      expect(result.success).toBe(true);
      expect(mockCheckAvailability).not.toHaveBeenCalled();
      expect(mockBookDirectAppointment).not.toHaveBeenCalled();
      // Nothing was written, so nothing may be reported as written.
      if (result.success) {
        expect(result.data.bookingCompleted).toBeUndefined();
      }
    });

    it('re-offers instead of confirming when the slot goes between check and write', async () => {
      seedBookingRequest();
      mockCheckAvailability
        .mockResolvedValueOnce({
          success: true,
          data: {
            available: true,
            slots: [slot],
            provider: 'borradh',
            message: 'ok',
          },
        } as never)
        .mockResolvedValueOnce({
          success: true,
          data: {
            available: true,
            slots: [{ ...slot, startTime: '16:00', displayTime: '4 PM' }],
            provider: 'borradh',
            message: 'ok',
          },
        } as never);
      mockBookDirectAppointment.mockResolvedValueOnce({
        success: true,
        data: {
          success: false,
          appointmentId: '',
          confirmationCode: '',
          confirmationMessage: 'taken',
          slotTaken: true,
        },
      } as never);

      const result = await generateAIResponse(
        mockDb as never,
        { conversationId: 'conv-1', userMessage: '2pm please' },
        apiKey
      );

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.bookingCompleted).toBeUndefined();
      expect(result.data.message).toMatch(/just gone/i);
      expect(result.data.message).toContain('4 PM');
    });

    it('gets a human rather than inventing a reason when the write fails', async () => {
      seedBookingRequest();
      mockCheckAvailability.mockResolvedValueOnce({
        success: true,
        data: {
          available: true,
          slots: [slot],
          provider: 'borradh',
          message: 'ok',
        },
      } as never);
      mockBookDirectAppointment.mockResolvedValueOnce({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'no assignable user' },
      } as never);

      const result = await generateAIResponse(
        mockDb as never,
        { conversationId: 'conv-1', userMessage: '2pm please' },
        apiKey
      );

      expect(result.success).toBe(true);
      if (!result.success) return;
      // Not "that slot's just gone" — nobody took it.
      expect(result.data.message).not.toMatch(/just gone/i);
      expect(result.data.action).toBe('handoff');
      expect(result.data.bookingCompleted).toBeUndefined();
    });

    it('matches a 12-hour time from the model against the diary', async () => {
      seedBookingRequest(nativeOrg(), '2:00 PM');
      mockCheckAvailability.mockResolvedValueOnce({
        success: true,
        data: {
          available: true,
          slots: [slot],
          provider: 'borradh',
          message: 'ok',
        },
      } as never);
      mockBookDirectAppointment.mockResolvedValueOnce({
        success: true,
        data: {
          success: true,
          appointmentId: 'apt-2',
          confirmationCode: 'APT-XYZ',
          confirmationMessage: "You're all booked.",
        },
      } as never);

      const result = await generateAIResponse(
        mockDb as never,
        { conversationId: 'conv-1', userMessage: '2pm please' },
        apiKey
      );

      expect(result.success).toBe(true);
      expect(mockBookDirectAppointment).toHaveBeenCalledTimes(1);
    });

    it('ignores a booking request when no calendar can be resolved', async () => {
      seedBookingRequest(
        makeOrganization({
          bookingDestination: null,
          primaryCalendarType: null,
          primaryCalendarAccountId: null,
          timezone: 'Europe/Dublin',
        })
      );

      const result = await generateAIResponse(
        mockDb as never,
        { conversationId: 'conv-1', userMessage: '2pm please' },
        apiKey
      );

      expect(result.success).toBe(true);
      expect(mockBookDirectAppointment).not.toHaveBeenCalled();
    });
  });
});

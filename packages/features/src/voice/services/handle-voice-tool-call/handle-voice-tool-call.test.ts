import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import * as bookAppointmentModule from '../../../calendar/services/book-appointment/book-appointment.service.js';
import * as checkAvailabilityModule from '../../../calendar/services/check-availability/check-availability.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import { handleVoiceToolCall } from './handle-voice-tool-call.service.js';

// Restored `vi.spyOn`, NOT `vi.mock`. Under `isolate: false` the worker shares
// one module graph, so the old bare-factory `vi.mock` of the whole
// `calendar/services/index.js` barrel DELETED every other calendar export for
// every later file, and silently missed whenever an earlier file had already
// imported the barrel. Barrels expose live getters that cannot be redefined
// anyway, so we spy the SOURCE modules the barrel forwards to.
let mockCheckAvailability: MockInstance;
let mockBookAppointment: MockInstance;

describe('handleVoiceToolCall', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // Matches the old bare `vi.fn()`s: no default return; tests drive them.
    mockCheckAvailability = vi
      .spyOn(checkAvailabilityModule, 'checkAvailability')
      .mockReturnValue(undefined as never);
    mockBookAppointment = vi
      .spyOn(bookAppointmentModule, 'bookAppointment')
      .mockReturnValue(undefined as never);
  });

  afterEach(() => {
    mockCheckAvailability.mockRestore();
    mockBookAppointment.mockRestore();
  });

  const validInput = {
    conversation_id: 'conv_123',
    tool_call_id: 'tc_456',
    tool_name: 'check_availability',
    parameters: {},
  };

  it('returns VALIDATION_ERROR for missing conversation_id', async () => {
    await expectResult(
      handleVoiceToolCall(mockDb as never, {
        ...validInput,
        conversation_id: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for missing tool_name', async () => {
    await expectResult(
      handleVoiceToolCall(mockDb as never, { ...validInput, tool_name: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns graceful error when voice call not found', async () => {
    mockDb.query.voiceCall.findFirst.mockResolvedValueOnce(null);
    const result = await handleVoiceToolCall(mockDb as never, validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      const parsed = JSON.parse(result.data.result);
      expect(parsed.error).toBeDefined();
    }
  });

  it('returns graceful error when organization not determined', async () => {
    mockDb.query.voiceCall.findFirst.mockResolvedValueOnce({
      id: 'conv_123',
      leadId: null,
      metadata: {},
    });
    const result = await handleVoiceToolCall(mockDb as never, validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      const parsed = JSON.parse(result.data.result);
      expect(parsed.error).toBeDefined();
    }
  });

  it('handles check_availability tool call', async () => {
    mockDb.query.voiceCall.findFirst.mockResolvedValueOnce({
      id: 'conv_123',
      leadId: 'lead_1',
      metadata: { organizationId: 'org_1' },
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org_1',
      name: 'Test Org',
      defaultAppointmentDuration: 30,
    });
    mockCheckAvailability.mockResolvedValueOnce({
      success: true,
      data: { available: true, slots: ['10:00'], message: 'Available' },
    } as never);
    const result = await handleVoiceToolCall(mockDb as never, {
      ...validInput,
      parameters: { date: '2025-01-15' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const parsed = JSON.parse(result.data.result);
      expect(parsed.available).toBe(true);
    }
  });

  it('handles transfer_to_human tool call', async () => {
    mockDb.query.voiceCall.findFirst.mockResolvedValueOnce({
      id: 'conv_123',
      leadId: 'lead_1',
      metadata: { organizationId: 'org_1' },
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org_1',
      name: 'Test Org',
      defaultAppointmentDuration: 30,
    });
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValue(undefined);
    const result = await handleVoiceToolCall(mockDb as never, {
      ...validInput,
      tool_name: 'transfer_to_human',
      parameters: { reason: 'Customer request' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const parsed = JSON.parse(result.data.result);
      expect(parsed.success).toBe(true);
    }
  });

  it('handles unknown tool name gracefully', async () => {
    mockDb.query.voiceCall.findFirst.mockResolvedValueOnce({
      id: 'conv_123',
      leadId: 'lead_1',
      metadata: { organizationId: 'org_1' },
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org_1',
      name: 'Test Org',
      defaultAppointmentDuration: 30,
    });
    const result = await handleVoiceToolCall(mockDb as never, {
      ...validInput,
      tool_name: 'unknown_tool',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const parsed = JSON.parse(result.data.result);
      expect(parsed.error).toContain('Unknown tool');
    }
  });
});

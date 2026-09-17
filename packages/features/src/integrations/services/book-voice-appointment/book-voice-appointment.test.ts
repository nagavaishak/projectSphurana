import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import * as createAppointmentModule from '../../../appointments/services/create-appointment/create-appointment.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import { bookVoiceAppointment } from './book-voice-appointment.service.js';

// `createAppointment` is an INTERNAL module that its own suite exercises for
// real — a file-local `vi.mock` would leak under `isolate: false`, so use a
// restored `vi.spyOn`.
let mockCreateAppointment: ReturnType<typeof vi.spyOn>;

const APPOINTMENT = {
  id: 'appt-1',
  title: 'Haircut',
  startDate: new Date('2026-01-01T10:00:00.000Z'),
  endDate: new Date('2026-01-01T11:00:00.000Z'),
  status: 'booked',
};

const INPUT = {
  organizationId: 'org-1',
  customerName: 'Ada Lovelace',
  title: 'Haircut',
  startDate: '2026-01-01T10:00:00.000Z',
  endDate: '2026-01-01T11:00:00.000Z',
  leadId: 'lead-1',
  assignedToId: 'user-1',
};

describe('bookVoiceAppointment', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockCreateAppointment = vi.spyOn(
      createAppointmentModule,
      'createAppointment'
    );
    mockCreateAppointment.mockResolvedValue({
      success: true,
      data: APPOINTMENT,
    } as never);
  });

  afterEach(() => {
    mockCreateAppointment.mockRestore();
  });

  const descriptionOf = () =>
    (mockCreateAppointment.mock.calls[0][1] as { description: string })
      .description;

  it('books with the voice-caller markers and returns the ack shape', async () => {
    const result = await bookVoiceAppointment(mockDb as never, INPUT);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      success: true,
      appointmentId: 'appt-1',
      message: 'Appointment booked successfully',
      appointment: APPOINTMENT,
    });

    const call = mockCreateAppointment.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(call.source).toBe('ai_voice_caller');
    expect(call.status).toBe('booked');
    expect(call.color).toBe('blue');
    // ISO strings are converted to Date objects for the appointment service.
    expect(call.startDate).toEqual(new Date(INPUT.startDate));
    expect(call.endDate).toEqual(new Date(INPUT.endDate));
  });

  // The voice-AI integration parses these lines back off the appointment, so
  // the order, the labels and the `\n` join are a contract, not a preference.
  it('builds the full description in the contracted order', async () => {
    await bookVoiceAppointment(mockDb as never, {
      ...INPUT,
      description: 'Wants a fringe',
      customerPhone: '+353850000000',
      customerEmail: 'ada@example.com',
      conversationId: 'conv-9',
    });

    expect(descriptionOf()).toBe(
      [
        'Wants a fringe',
        'Customer: Ada Lovelace',
        'Phone: +353850000000',
        'Email: ada@example.com',
        'Voice Call ID: conv-9',
      ].join('\n')
    );
  });

  it('omits every absent optional line', async () => {
    await bookVoiceAppointment(mockDb as never, INPUT);
    expect(descriptionOf()).toBe('Customer: Ada Lovelace');
  });

  it('keeps each optional line independent', async () => {
    await bookVoiceAppointment(mockDb as never, {
      ...INPUT,
      customerEmail: 'ada@example.com',
    });
    expect(descriptionOf()).toBe(
      'Customer: Ada Lovelace\nEmail: ada@example.com'
    );
  });

  it('returns VALIDATION_ERROR without booking when the name is missing', async () => {
    const result = await bookVoiceAppointment(mockDb as never, {
      ...INPUT,
      customerName: '',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(mockCreateAppointment).not.toHaveBeenCalled();
  });

  // The entry point maps this through the shared `mapError`, so the code the
  // appointment service chose has to survive the trip unchanged.
  it('passes the appointment service error code through unchanged', async () => {
    mockCreateAppointment.mockResolvedValue({
      success: false,
      error: { code: ErrorCodes.CONFLICT, message: 'Slot taken' },
    } as never);

    const result = await bookVoiceAppointment(mockDb as never, INPUT);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    expect(result.error.message).toBe('Slot taken');
  });
});

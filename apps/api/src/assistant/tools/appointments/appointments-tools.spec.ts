import { createToolCallCounter } from '../../tool-factory/tool-call-limit.js';
import type { AssistantToolsContext } from '../../tool-factory/types.js';
import { bookAppointmentTool } from './book-appointment.tool.js';
import { cancelAppointmentTool } from './cancel-appointment.tool.js';
import { findOpenSlotsTool } from './find-open-slots.tool.js';
import { listAppointmentsTool } from './list-appointments.tool.js';
import { markNoShowTool } from './mark-no-show.tool.js';
import { APPOINTMENTS_PATH_PATTERNS } from './paths.js';
import { rescheduleAppointmentTool } from './reschedule-appointment.tool.js';
import { setAppointmentStatusTool } from './set-appointment-status.tool.js';
import { summariseUpcomingDayTool } from './summarise-upcoming-day.tool.js';

jest.mock('@borradh-workspace/observability', () => ({
  logError: jest.fn(),
  logWarning: jest.fn(),
  isPostHogInitialized: () => false,
  isSentryInitialized: () => false,
  trackEvent: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

// Short-circuit the database barrel — it transitively pulls in
// `@paralleldrive/cuid2` (ESM-only) which the api/jest swc transform doesn't
// handle. The tools themselves never touch `db`; confirmation.ts is the only
// file that imports it, and `buildCtx` overrides the create/verify hooks so
// confirmation.ts is never invoked.
jest.mock('@borradh-workspace/database', () => ({
  db: {},
}));
jest.mock('@borradh-workspace/features/assistant', () => ({
  createConfirmationToken: jest.fn(),
  verifyConfirmationToken: jest.fn(),
}));

interface CtxOverrides {
  apiFetch?: AssistantToolsContext['apiFetch'];
  buildApiFetch?: AssistantToolsContext['buildApiFetch'];
  callCounter?: { count: number; max: number };
  createConfirmation?: AssistantToolsContext['createConfirmation'];
  verifyConfirmation?: AssistantToolsContext['verifyConfirmation'];
}

function buildCtx(overrides: CtxOverrides = {}): AssistantToolsContext {
  const apiFetch = overrides.apiFetch ?? (jest.fn() as never);
  return {
    organizationId: 'org-1',
    timezone: 'Europe/Dublin',
    userId: 'user-1',
    conversationId: 'conv-1',
    apiFetch,
    buildApiFetch: overrides.buildApiFetch ?? jest.fn(() => apiFetch),
    callCounter: overrides.callCounter ?? createToolCallCounter(50),
    runHardBlocks: jest.fn(async () => ({ pass: true })) as never,
    createConfirmation:
      overrides.createConfirmation ??
      (jest.fn(async () => ({
        id: 'token-abc',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      })) as never),
    verifyConfirmation:
      overrides.verifyConfirmation ??
      (jest.fn(async () => ({ valid: true, payload: null })) as never),
  };
}

describe('appointments tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('paths whitelist', () => {
    it('matches the appointments endpoints used by the tools', () => {
      const matches = (path: string) =>
        APPOINTMENTS_PATH_PATTERNS.some((re) => re.test(path));
      expect(matches('appointments')).toBe(true);
      expect(matches('appointments/abc-123')).toBe(true);
      expect(matches('appointments/open-slots')).toBe(true);
      expect(matches('leads/abc')).toBe(false);
    });
  });

  describe('findOpenSlotsTool', () => {
    it('uses the factory feature/action prefix', () => {
      expect(findOpenSlotsTool.name).toBe('appointments_findOpenSlots');
      expect(findOpenSlotsTool.feature).toBe('appointments');
      expect(findOpenSlotsTool.destructive).toBe(false);
    });

    it('POSTs to appointments/open-slots and passes the input through', async () => {
      const apiFetch = jest.fn(async () => ({
        available: true,
        slots: [
          {
            date: '2026-05-12',
            startTime: '14:00',
            endTime: '14:30',
            displayTime: '2:00 PM',
            isoStart: '2026-05-12T14:00:00.000Z',
            isoEnd: '2026-05-12T14:30:00.000Z',
          },
        ],
        provider: 'google_calendar',
        message: 'We have a 2pm slot.',
      }));
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      const result = await findOpenSlotsTool.execute(
        {
          date: '2026-05-12',
          duration: 30,
          serviceId: 'svc-1',
          timePreference: 'afternoon',
          timezone: 'Europe/Dublin',
        },
        ctx
      );

      expect(apiFetch).toHaveBeenCalledTimes(1);
      const [calledPath, calledOpts] = apiFetch.mock.calls[0] as [
        string,
        { method?: string; body?: unknown },
      ];
      expect(calledPath).toBe('appointments/open-slots');
      expect(calledOpts.method).toBe('POST');
      expect(calledOpts.body).toMatchObject({
        date: '2026-05-12',
        duration: 30,
        serviceId: 'svc-1',
        timePreference: 'afternoon',
        timezone: 'Europe/Dublin',
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect((result.data as { slots: unknown[] }).slots).toHaveLength(1);
      }
    });

    it('rejects an unresolvable date and surfaces a today-quoting error (Phase 3)', async () => {
      // The strict YYYY-MM-DD regex is gone; the day is now resolved
      // server-side. An unparseable value (US-order "12-05-2026") is an
      // unresolvable expression → a tool error, never a silent wrong date.
      const apiFetch = jest.fn();
      const ctx = buildCtx({ apiFetch: apiFetch as never });
      const result = await findOpenSlotsTool.execute(
        { date: '12-05-2026' },
        ctx
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('TOOL_EXECUTION_ERROR');
      expect(apiFetch).not.toHaveBeenCalled();
    });

    it('resolves a relative date server-side and echoes the resolved queryDate (Phase 3, #208)', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-29T12:00:00Z'));
      try {
        const apiFetch = jest.fn(async () => ({
          available: false,
          slots: [],
          provider: 'google_calendar',
          message: 'No slots.',
        }));
        const ctx = buildCtx({ apiFetch: apiFetch as never });

        const result = await findOpenSlotsTool.execute(
          { date: 'tomorrow' },
          ctx
        );

        const [, calledOpts] = apiFetch.mock.calls[0] as [
          string,
          { body?: { date?: string; timezone?: string } },
        ];
        // "tomorrow" from Wed 29 Jul → 30 Jul, resolved in the org timezone.
        expect(calledOpts.body?.date).toBe('2026-07-30');
        expect(calledOpts.body?.timezone).toBe('Europe/Dublin');
        expect(result.ok).toBe(true);
        if (result.ok && result.data) {
          expect((result.data as { queryDate: string }).queryDate).toBe(
            '2026-07-30'
          );
        }
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('listAppointmentsTool', () => {
    it('builds a query string from the optional filters', async () => {
      const apiFetch = jest.fn(async () => ({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      }));
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      await listAppointmentsTool.execute(
        {
          startDateFrom: '2026-05-12T00:00:00.000Z',
          startDateTo: '2026-05-19T00:00:00.000Z',
          status: 'booked',
        },
        ctx
      );

      const calledPath = (apiFetch.mock.calls[0] as unknown[])[0] as string;
      expect(calledPath).toMatch(/^appointments\?/);
      expect(calledPath).toContain('status=booked');
      expect(calledPath).toContain('startDateFrom=');
      expect(calledPath).toContain('startDateTo=');
    });

    it('omits the query string when there are no filters', async () => {
      const apiFetch = jest.fn(async () => ({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      }));
      const ctx = buildCtx({ apiFetch: apiFetch as never });
      await listAppointmentsTool.execute({}, ctx);
      const calledPath = (apiFetch.mock.calls[0] as unknown[])[0] as string;
      expect(calledPath).toBe('appointments');
    });

    it('rejects an out-of-range limit', async () => {
      const ctx = buildCtx();
      const result = await listAppointmentsTool.execute({ limit: 9999 }, ctx);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('summariseUpcomingDayTool', () => {
    it('aggregates counts by status and groups by practitioner', async () => {
      const apiFetch = jest.fn(async () => ({
        items: [
          {
            id: 'a-1',
            title: 'Lip filler',
            startDate: '2026-05-12T14:00:00.000Z',
            endDate: '2026-05-12T14:30:00.000Z',
            status: 'booked',
            practitionerId: 'prac-1',
            assignedToId: 'user-9',
            assignedTo: { id: 'user-9', name: 'Niamh' },
          },
          {
            id: 'a-2',
            title: 'Lip filler',
            startDate: '2026-05-12T15:00:00.000Z',
            endDate: '2026-05-12T15:30:00.000Z',
            status: 'booked',
            practitionerId: 'prac-1',
            assignedToId: 'user-9',
            assignedTo: { id: 'user-9', name: 'Niamh' },
          },
          {
            id: 'a-3',
            title: 'Botox',
            startDate: '2026-05-12T16:00:00.000Z',
            endDate: '2026-05-12T16:45:00.000Z',
            status: 'cancelled',
            practitionerId: 'prac-2',
            assignedToId: 'user-10',
            assignedTo: { id: 'user-10', name: 'Aoife' },
          },
        ],
        total: 3,
        limit: 500,
        offset: 0,
      }));
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      const result = await summariseUpcomingDayTool.execute(
        { date: '2026-05-12' },
        ctx
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        const out = result.data as {
          totalScheduled: number;
          totalCancelled: number;
          byPractitioner: {
            practitionerLabel: string;
            appointmentCount: number;
          }[];
          upcoming: unknown[];
        };
        expect(out.totalScheduled).toBe(2);
        expect(out.totalCancelled).toBe(1);
        expect(out.upcoming).toHaveLength(3);
        // Niamh wins the breakdown (2 appts vs Aoife's 1).
        expect(out.byPractitioner[0]?.practitionerLabel).toBe('Niamh');
        expect(out.byPractitioner[0]?.appointmentCount).toBe(2);
      }
    });

    it('builds a 24h date window query', async () => {
      const apiFetch = jest.fn(async () => ({
        items: [],
        total: 0,
        limit: 500,
        offset: 0,
      }));
      const ctx = buildCtx({ apiFetch: apiFetch as never });
      await summariseUpcomingDayTool.execute({ date: '2026-05-12' }, ctx);
      const calledPath = (apiFetch.mock.calls[0] as unknown[])[0] as string;
      expect(calledPath).toContain(
        'startDateFrom=2026-05-12T00%3A00%3A00.000Z'
      );
      expect(calledPath).toContain('startDateTo=2026-05-12T23%3A59%3A59.999Z');
      expect(calledPath).toContain('limit=500');
    });
  });

  describe('bookAppointmentTool — destructive flow', () => {
    it('is registered as destructive with book_appointment action', () => {
      expect(bookAppointmentTool.destructive).toBe(true);
      expect(bookAppointmentTool.destructiveAction).toBe('book_appointment');
    });

    it('first call: builds confirmation summary, issues token, does NOT POST', async () => {
      // The double-booking guardrail may issue a read-only `appointments?...`
      // lookup on the first call (practitionerId is set below), but never a
      // mutating POST — that only happens on the confirmed second call.
      const apiFetch = jest.fn(async () => ({}));
      const createConfirmation = jest.fn(async () => ({
        id: 'token-book',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }));
      const ctx = buildCtx({
        apiFetch: apiFetch as never,
        createConfirmation: createConfirmation as never,
      });

      const result = await bookAppointmentTool.execute(
        {
          leadId: 'lead-1',
          title: 'Lip filler with Niamh',
          startDate: '2026-05-12T14:00:00.000Z',
          endDate: '2026-05-12T14:30:00.000Z',
          practitionerId: 'prac-1',
          customerDisplayName: 'Aoife Murphy',
          serviceDisplayName: 'Lip filler (0.5ml)',
          depositRequired: true,
        },
        ctx
      );

      const postCall = apiFetch.mock.calls.find(
        (c) => (c[1] as { method?: string } | undefined)?.method === 'POST'
      );
      expect(postCall).toBeUndefined();
      expect(createConfirmation).toHaveBeenCalledWith({
        action: 'book_appointment',
        resourceId: 'lead-1',
        payload: expect.objectContaining({
          leadId: 'lead-1',
          startDate: '2026-05-12T14:00:00.000Z',
        }),
      });

      expect(result.ok).toBe(true);
      if (result.ok && result.presentation?.type === 'confirmation_required') {
        expect(result.presentation.token).toBe('token-book');
        const summary = result.presentation.summary;
        const customer = summary?.fields?.find((f) => f.label === 'Customer');
        expect(customer?.value).toBe('Aoife Murphy');
        const service = summary?.fields?.find((f) => f.label === 'Service');
        expect(service?.value).toBe('Lip filler (0.5ml)');
        const deposit = summary?.fields?.find((f) => f.label === 'Deposit');
        expect(deposit?.value).toContain('payment link');
      }
    });

    it('second call: verifies token, POSTs to /appointments, returns the created row', async () => {
      const created = {
        id: 'a-new',
        title: 'Lip filler with Niamh',
        startDate: '2026-05-12T14:00:00.000Z',
        endDate: '2026-05-12T14:30:00.000Z',
        leadId: 'lead-1',
        practitionerId: 'prac-1',
        assignedToId: 'user-9',
        status: 'booked',
      };
      const apiFetch = jest.fn(async () => created);
      const verifyConfirmation = jest.fn(async () => ({
        valid: true,
        payload: null,
      }));
      const ctx = buildCtx({
        apiFetch: apiFetch as never,
        verifyConfirmation: verifyConfirmation as never,
      });

      const result = await bookAppointmentTool.execute(
        {
          leadId: 'lead-1',
          title: 'Lip filler with Niamh',
          startDate: '2026-05-12T14:00:00.000Z',
          endDate: '2026-05-12T14:30:00.000Z',
          practitionerId: 'prac-1',
          confirmationToken: 'token-book',
        },
        ctx
      );

      expect(verifyConfirmation).toHaveBeenCalled();
      const [calledPath, calledOpts] = apiFetch.mock.calls[0] as [
        string,
        { method?: string; body?: Record<string, unknown> },
      ];
      expect(calledPath).toBe('appointments');
      expect(calledOpts.method).toBe('POST');
      expect(calledOpts.body).toMatchObject({
        leadId: 'lead-1',
        title: 'Lip filler with Niamh',
        practitionerId: 'prac-1',
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect((result.data as { appointmentId: string }).appointmentId).toBe(
          'a-new'
        );
      }
    });

    it('resolves a relative start/end expression server-side before POSTing (Phase 3)', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-29T12:00:00Z'));
      try {
        const apiFetch = jest.fn(async () => ({
          id: 'a-rel',
          startDate: '2026-07-30T13:00:00.000Z',
          endDate: '2026-07-30T13:30:00.000Z',
        }));
        const ctx = buildCtx({ apiFetch: apiFetch as never });

        await bookAppointmentTool.execute(
          {
            leadId: 'lead-1',
            title: 'Consultation',
            // Words, not a date — the server resolves them in the org timezone.
            startDate: 'tomorrow 2pm',
            endDate: 'tomorrow 2:30pm',
            confirmationToken: 'token-book',
          },
          ctx
        );

        const [, calledOpts] = apiFetch.mock.calls[0] as [
          string,
          { body?: Record<string, unknown> },
        ];
        const body = calledOpts.body ?? {};
        // "tomorrow 2pm" from Wed 29 Jul → 30 Jul 14:00 Europe/Dublin (UTC+1)
        // = 13:00Z. The model never computed this.
        expect(String(body.startDate)).toBe('2026-07-30T13:00:00.000Z');
        expect(String(body.endDate)).toBe('2026-07-30T13:30:00.000Z');
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('rescheduleAppointmentTool — destructive flow', () => {
    it('is registered as destructive with reschedule_appointment action', () => {
      expect(rescheduleAppointmentTool.destructive).toBe(true);
      expect(rescheduleAppointmentTool.destructiveAction).toBe(
        'reschedule_appointment'
      );
    });

    it('summary surfaces from + to slots and the email flag', async () => {
      const ctx = buildCtx();

      const result = await rescheduleAppointmentTool.execute(
        {
          appointmentId: 'a-1',
          oldStartDate: '2026-05-12T14:00:00.000Z',
          oldEndDate: '2026-05-12T14:30:00.000Z',
          newStartDate: '2026-05-13T16:00:00.000Z',
          newEndDate: '2026-05-13T16:30:00.000Z',
          sendRescheduleEmail: true,
          customerDisplayName: 'Aoife Murphy',
        },
        ctx
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.presentation?.type === 'confirmation_required') {
        expect(result.presentation.resourceId).toBe('a-1');
        const fields = result.presentation.summary?.fields ?? [];
        const from = fields.find((f) => f.label === 'From');
        const to = fields.find((f) => f.label === 'To');
        const email = fields.find((f) => f.label === 'Email customer');
        expect(from?.value).toContain('2026-05-12T14:00:00.000Z');
        expect(to?.value).toContain('2026-05-13T16:00:00.000Z');
        expect(email?.value).toContain('Yes');
      }
    });

    it('second call: PUTs the new slot + email flag', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'a-1',
        title: 'Lip filler',
        startDate: '2026-05-13T16:00:00.000Z',
        endDate: '2026-05-13T16:30:00.000Z',
        status: 'booked',
      }));
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      await rescheduleAppointmentTool.execute(
        {
          appointmentId: 'a-1',
          newStartDate: '2026-05-13T16:00:00.000Z',
          newEndDate: '2026-05-13T16:30:00.000Z',
          sendRescheduleEmail: true,
          confirmationToken: 'token-reschedule',
        },
        ctx
      );

      const [calledPath, calledOpts] = apiFetch.mock.calls[0] as [
        string,
        { method?: string; body?: Record<string, unknown> },
      ];
      expect(calledPath).toBe('appointments/a-1');
      expect(calledOpts.method).toBe('PUT');
      expect(calledOpts.body).toMatchObject({
        startDate: '2026-05-13T16:00:00.000Z',
        endDate: '2026-05-13T16:30:00.000Z',
        sendRescheduleEmail: true,
      });
    });
  });

  describe('cancelAppointmentTool — destructive flow', () => {
    it('is registered as destructive with cancel_appointment action', () => {
      expect(cancelAppointmentTool.destructive).toBe(true);
      expect(cancelAppointmentTool.destructiveAction).toBe(
        'cancel_appointment'
      );
    });

    it('summary surfaces customer / slot / reason / notification line', async () => {
      const ctx = buildCtx();
      const result = await cancelAppointmentTool.execute(
        {
          appointmentId: 'a-1',
          customerDisplayName: 'Aoife Murphy',
          slotDisplay: 'Tuesday 14:00',
          reason: 'Customer rescheduling next week',
        },
        ctx
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.presentation?.type === 'confirmation_required') {
        const fields = result.presentation.summary?.fields ?? [];
        expect(fields.find((f) => f.label === 'Customer')?.value).toBe(
          'Aoife Murphy'
        );
        expect(fields.find((f) => f.label === 'Slot')?.value).toBe(
          'Tuesday 14:00'
        );
        expect(fields.find((f) => f.label === 'Reason')?.value).toContain(
          'rescheduling'
        );
        expect(fields.find((f) => f.label === 'Notification')?.value).toContain(
          'booking system'
        );
      }
    });

    it('second call: PUTs status=cancelled and appends the reason as description', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'a-1',
        title: 'Lip filler',
        status: 'cancelled',
        description: 'Cancelled: customer rescheduling',
      }));
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      await cancelAppointmentTool.execute(
        {
          appointmentId: 'a-1',
          reason: 'customer rescheduling',
          confirmationToken: 'token-cancel',
        },
        ctx
      );

      const [calledPath, calledOpts] = apiFetch.mock.calls[0] as [
        string,
        { method?: string; body?: Record<string, unknown> },
      ];
      expect(calledPath).toBe('appointments/a-1');
      expect(calledOpts.method).toBe('PUT');
      expect(calledOpts.body).toMatchObject({
        status: 'cancelled',
        description: 'Cancelled: customer rescheduling',
      });
    });

    it('omits description when no reason provided', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'a-1',
        title: 'Lip filler',
        status: 'cancelled',
        description: null,
      }));
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      await cancelAppointmentTool.execute(
        { appointmentId: 'a-1', confirmationToken: 'token-cancel' },
        ctx
      );

      const calledOpts = (apiFetch.mock.calls[0] as unknown[])[1] as {
        body?: Record<string, unknown>;
      };
      expect(calledOpts.body).toEqual({ status: 'cancelled' });
    });

    it('summary surfaces the late-cancel fee when lateFeeDisplay is provided', async () => {
      const ctx = buildCtx();
      const result = await cancelAppointmentTool.execute(
        {
          appointmentId: 'a-1',
          customerDisplayName: 'Aoife Murphy',
          reason: 'Feeling unwell',
          lateFeeDisplay: '€25.00',
        },
        ctx
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.presentation?.type === 'confirmation_required') {
        const fields = result.presentation.summary?.fields ?? [];
        const fee = fields.find((f) => f.label.includes('Late-cancel fee'));
        expect(fee).toBeDefined();
        expect(fee?.value).toContain('€25.00');
      }
    });
  });

  describe('markNoShowTool — destructive flow', () => {
    it('is registered as destructive with mark_no_show action', () => {
      expect(markNoShowTool.destructive).toBe(true);
      expect(markNoShowTool.destructiveAction).toBe('mark_no_show');
    });

    it('first call: summary surfaces the slot-freeing effect and no-show fee line', async () => {
      const ctx = buildCtx();
      const result = await markNoShowTool.execute(
        {
          appointmentId: 'a-1',
          customerDisplayName: 'Aoife Murphy',
          slotDisplay: 'Tuesday 14:00',
        },
        ctx
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.presentation?.type === 'confirmation_required') {
        expect(result.presentation.resourceId).toBe('a-1');
        const fields = result.presentation.summary?.fields ?? [];
        const effect = fields.find((f) => f.label === 'Effect');
        expect(effect?.value).toContain('Frees the slot');
        const fee = fields.find((f) => f.label === 'No-show fee');
        expect(fee).toBeDefined();
        // No fee provided → falls back to the generic policy line.
        expect(fee?.value).toContain('not charged automatically');
      }
    });

    it('first call: lateFeeDisplay appears in the No-show fee value', async () => {
      const ctx = buildCtx();
      const result = await markNoShowTool.execute(
        {
          appointmentId: 'a-1',
          lateFeeDisplay: '€25.00',
        },
        ctx
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.presentation?.type === 'confirmation_required') {
        const fields = result.presentation.summary?.fields ?? [];
        const fee = fields.find((f) => f.label === 'No-show fee');
        expect(fee?.value).toContain('€25.00');
      }
    });

    it('second call: PUTs status=no_show', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'a-1',
        title: 'Lip filler',
        status: 'no_show',
        description: null,
      }));
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      await markNoShowTool.execute(
        { appointmentId: 'a-1', confirmationToken: 'token-noshow' },
        ctx
      );

      const [calledPath, calledOpts] = apiFetch.mock.calls[0] as [
        string,
        { method?: string; body?: Record<string, unknown> },
      ];
      expect(calledPath).toBe('appointments/a-1');
      expect(calledOpts.method).toBe('PUT');
      expect(calledOpts.body).toEqual({ status: 'no_show' });
    });

    it('second call: appends the note as a "No-show:" description', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'a-1',
        title: 'Lip filler',
        status: 'no_show',
        description: 'No-show: called ahead',
      }));
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      await markNoShowTool.execute(
        {
          appointmentId: 'a-1',
          note: 'called ahead',
          confirmationToken: 'token-noshow',
        },
        ctx
      );

      const calledOpts = (apiFetch.mock.calls[0] as unknown[])[1] as {
        body?: Record<string, unknown>;
      };
      expect(calledOpts.body).toEqual({
        status: 'no_show',
        description: 'No-show: called ahead',
      });
    });
  });

  describe('setAppointmentStatusTool — non-destructive lifecycle', () => {
    it('is registered as non-destructive with no destructive action', () => {
      expect(setAppointmentStatusTool.destructive).toBeFalsy();
      expect(setAppointmentStatusTool.destructiveAction).toBeUndefined();
    });

    it('execute PUTs the new status without a confirmation gate', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'a-1',
        title: 'Lip filler',
        status: 'arrived',
      }));
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      const result = await setAppointmentStatusTool.execute(
        { appointmentId: 'a-1', status: 'arrived' },
        ctx
      );

      const [calledPath, calledOpts] = apiFetch.mock.calls[0] as [
        string,
        { method?: string; body?: Record<string, unknown> },
      ];
      expect(calledPath).toBe('appointments/a-1');
      expect(calledOpts.method).toBe('PUT');
      expect(calledOpts.body).toEqual({ status: 'arrived' });
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect((result.data as { status: string }).status).toBe('arrived');
      }
    });

    it('inputSchema accepts the day-of lifecycle statuses', () => {
      for (const status of ['confirmed', 'arrived', 'started', 'completed']) {
        const parsed = setAppointmentStatusTool.inputSchema.safeParse({
          appointmentId: 'a-1',
          status,
        });
        expect(parsed.success).toBe(true);
      }
    });

    it('inputSchema rejects the confirmation-gated terminal statuses', () => {
      for (const status of ['no_show', 'cancelled']) {
        const parsed = setAppointmentStatusTool.inputSchema.safeParse({
          appointmentId: 'a-1',
          status,
        });
        expect(parsed.success).toBe(false);
      }
    });
  });

  describe('bookAppointmentTool — deposit guardrail', () => {
    it('surfaces a Deposit field when the looked-up service requires one', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path.startsWith('organization-services/')) {
          return { requiresDeposit: true, depositAmountCents: 5000 };
        }
        return {};
      });
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      const result = await bookAppointmentTool.execute(
        {
          leadId: 'lead-1',
          title: 'Lip filler',
          startDate: '2026-05-12T14:00:00.000Z',
          endDate: '2026-05-12T14:30:00.000Z',
          serviceId: 'svc-1',
        },
        ctx
      );

      expect(apiFetch).toHaveBeenCalledWith(
        'organization-services/svc-1',
        expect.objectContaining({ schema: expect.anything() })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.presentation?.type === 'confirmation_required') {
        const fields = result.presentation.summary?.fields ?? [];
        const deposit = fields.find((f) => f.label === 'Deposit');
        expect(deposit).toBeDefined();
        expect(deposit?.value).toContain('€50.00');
      }
    });

    it('fails open (no crash, no Deposit field) when the service lookup throws', async () => {
      const apiFetch = jest.fn(async () => {
        throw new Error('service lookup down');
      });
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      const result = await bookAppointmentTool.execute(
        {
          leadId: 'lead-1',
          title: 'Lip filler',
          startDate: '2026-05-12T14:00:00.000Z',
          endDate: '2026-05-12T14:30:00.000Z',
          serviceId: 'svc-1',
        },
        ctx
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.presentation?.type === 'confirmation_required') {
        const fields = result.presentation.summary?.fields ?? [];
        expect(fields.find((f) => f.label === 'Deposit')).toBeUndefined();
      }
    });
  });

  describe('bookAppointmentTool — double-booking guardrail', () => {
    const start = '2026-05-12T14:00:00.000Z';
    const end = '2026-05-12T14:30:00.000Z';

    it('warns when an active appointment overlaps the same practitioner', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path.startsWith('appointments?')) {
          return {
            items: [
              {
                id: 'x',
                startDate: '2026-05-12T14:15:00.000Z',
                endDate: '2026-05-12T14:45:00.000Z',
                status: 'booked',
                practitionerId: 'prac-1',
              },
            ],
          };
        }
        return {};
      });
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      const result = await bookAppointmentTool.execute(
        {
          leadId: 'lead-1',
          title: 'Lip filler',
          startDate: start,
          endDate: end,
          practitionerId: 'prac-1',
        },
        ctx
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.presentation?.type === 'confirmation_required') {
        const fields = result.presentation.summary?.fields ?? [];
        const warn = fields.find((f) => f.label.includes('Double-booking'));
        expect(warn).toBeDefined();
        expect(warn?.value).toContain('double-book');
      }
    });

    it('does NOT warn when the only overlap is cancelled (not active)', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path.startsWith('appointments?')) {
          return {
            items: [
              {
                id: 'x',
                startDate: '2026-05-12T14:15:00.000Z',
                endDate: '2026-05-12T14:45:00.000Z',
                status: 'cancelled',
                practitionerId: 'prac-1',
              },
            ],
          };
        }
        return {};
      });
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      const result = await bookAppointmentTool.execute(
        {
          leadId: 'lead-1',
          title: 'Lip filler',
          startDate: start,
          endDate: end,
          practitionerId: 'prac-1',
        },
        ctx
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.presentation?.type === 'confirmation_required') {
        const fields = result.presentation.summary?.fields ?? [];
        expect(
          fields.find((f) => f.label.includes('Double-booking'))
        ).toBeUndefined();
      }
    });

    it('does NOT warn when the overlap belongs to a different practitioner', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path.startsWith('appointments?')) {
          return {
            items: [
              {
                id: 'x',
                startDate: '2026-05-12T14:15:00.000Z',
                endDate: '2026-05-12T14:45:00.000Z',
                status: 'booked',
                practitionerId: 'prac-2',
              },
            ],
          };
        }
        return {};
      });
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      const result = await bookAppointmentTool.execute(
        {
          leadId: 'lead-1',
          title: 'Lip filler',
          startDate: start,
          endDate: end,
          practitionerId: 'prac-1',
        },
        ctx
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.presentation?.type === 'confirmation_required') {
        const fields = result.presentation.summary?.fields ?? [];
        expect(
          fields.find((f) => f.label.includes('Double-booking'))
        ).toBeUndefined();
      }
    });

    it('fails open (no crash) when the overlap lookup throws', async () => {
      const apiFetch = jest.fn(async () => {
        throw new Error('list down');
      });
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      const result = await bookAppointmentTool.execute(
        {
          leadId: 'lead-1',
          title: 'Lip filler',
          startDate: start,
          endDate: end,
          practitionerId: 'prac-1',
        },
        ctx
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.presentation?.type === 'confirmation_required') {
        const fields = result.presentation.summary?.fields ?? [];
        expect(
          fields.find((f) => f.label.includes('Double-booking'))
        ).toBeUndefined();
      }
    });
  });
});

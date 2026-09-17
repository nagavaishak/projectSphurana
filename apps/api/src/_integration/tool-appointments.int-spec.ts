/**
 * TIER 3 — appointment tools driven over a REAL socket against a REAL Postgres.
 *
 * Includes the regression for a defect deriving the response type exposed:
 * `summariseUpcomingDay` declared `assignedToId: string` while the column is
 * NULLABLE, and built its grouping key as
 *
 *   const key = row.practitionerId ?? `staff:${row.assignedToId}`
 *
 * so an appointment with NEITHER a practitioner NOR an assignee — a real,
 * representable state — landed in a bucket literally named `"staff:null"`.
 * Two such appointments merged into one phantom "staff member". A unit test
 * with a hand-written fixture would only find that if its author had already
 * realised the column was nullable, which is the same author who wrote the
 * bug. A real row with real NULLs does not need to be persuaded.
 */
import { appointment, db } from '@borradh-workspace/database';
import { eq } from 'drizzle-orm';
import { AppointmentsController } from '../appointments/appointments.controller.js';
import { listAppointmentsTool } from '../assistant/tools/appointments/list-appointments.tool.js';
import { setAppointmentStatusTool } from '../assistant/tools/appointments/set-appointment-status.tool.js';
import { summariseUpcomingDayTool } from '../assistant/tools/appointments/summarise-upcoming-day.tool.js';
import {
  seedAppointment,
  seedOrgWithMember,
  seedPractitioner,
} from './harness.js';
import { type ToolIntegrationApp, buildToolApp } from './tool-harness.js';

/** A fixed UTC day so the window maths is deterministic. */
const DAY = '2026-03-11';
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00.000Z`);

describe('TIER 3 — appointment tools (real HTTP, real Postgres)', () => {
  let harness: ToolIntegrationApp;

  afterEach(async () => {
    await harness?.close();
  });

  it('listAppointments returns real rows and parses the list envelope', async () => {
    const { organizationId, userId } = await seedOrgWithMember('owner');
    const apptId = await seedAppointment({
      organizationId,
      assignedToId: userId,
      title: 'Consultation',
      startDate: at('10:00'),
      endDate: at('10:30'),
    });

    harness = await buildToolApp([AppointmentsController], {
      userId,
      organizationId,
    });

    const result = await listAppointmentsTool.execute(
      {},
      harness.contextFor(listAppointmentsTool)
    );

    expect(result.ok).toBe(true);
    if (!result.ok || !result.data) throw new Error('tool returned no data');
    const found = result.data.items.find((a) => a.id === apptId);
    expect(found).toBeDefined();
    expect(found?.title).toBe('Consultation');
  });

  it('setAppointmentStatus actually persists the new status', async () => {
    const { organizationId, userId } = await seedOrgWithMember('owner');
    const apptId = await seedAppointment({
      organizationId,
      assignedToId: userId,
    });

    harness = await buildToolApp([AppointmentsController], {
      userId,
      organizationId,
    });

    const result = await setAppointmentStatusTool.execute(
      { appointmentId: apptId, status: 'arrived' },
      harness.contextFor(setAppointmentStatusTool)
    );

    expect(result.ok).toBe(true);

    // Read the row back. A tool that reports a status it did not write is the
    // exact class of defect this whole branch exists to stop, and only a
    // read-back from the real table can tell the difference.
    const [row] = await db
      .select()
      .from(appointment)
      .where(eq(appointment.id, apptId));
    expect(row?.status).toBe('arrived');
  });

  it('summariseUpcomingDay does not bucket unassigned appointments under "staff:null"', async () => {
    const { organizationId, userId } = await seedOrgWithMember('owner');

    // Two appointments with NO practitioner and NO assignee. `assignedToId` is
    // NOT NULL at seed time, so null it out directly — this is precisely the
    // state the old grouping key could not express.
    const a = await seedAppointment({
      organizationId,
      assignedToId: userId,
      title: 'Orphan A',
      startDate: at('09:00'),
      endDate: at('09:30'),
    });
    const b = await seedAppointment({
      organizationId,
      assignedToId: userId,
      title: 'Orphan B',
      startDate: at('11:00'),
      endDate: at('11:30'),
    });
    await db
      .update(appointment)
      .set({ assignedToId: null, practitionerId: null })
      .where(eq(appointment.id, a));
    await db
      .update(appointment)
      .set({ assignedToId: null, practitionerId: null })
      .where(eq(appointment.id, b));

    harness = await buildToolApp([AppointmentsController], {
      userId,
      organizationId,
    });

    const result = await summariseUpcomingDayTool.execute(
      { date: DAY },
      harness.contextFor(summariseUpcomingDayTool)
    );

    if (!result.ok) throw new Error(`TOOL FAILED: ${JSON.stringify(result)}`);
    if (!result.data) throw new Error('tool returned no data');

    const labels = result.data.byPractitioner.map((p) => p.practitionerLabel);
    // The regression: no bucket may be named after a stringified null.
    expect(labels.some((l) => l.includes('null'))).toBe(false);
    expect(labels).toContain('Unassigned');

    const unassigned = result.data.byPractitioner.find(
      (p) => p.practitionerLabel === 'Unassigned'
    );
    expect(unassigned?.appointmentCount).toBe(2);
  });

  it('summariseUpcomingDay groups a practitioner’s appointments separately', async () => {
    const { organizationId, userId } = await seedOrgWithMember('owner');
    const practitionerId = await seedPractitioner({
      organizationId,
      name: 'Dr Nolan',
    });
    await seedAppointment({
      organizationId,
      assignedToId: userId,
      practitionerId,
      title: 'With practitioner',
      startDate: at('13:00'),
      endDate: at('13:30'),
    });

    harness = await buildToolApp([AppointmentsController], {
      userId,
      organizationId,
    });

    const result = await summariseUpcomingDayTool.execute(
      { date: DAY },
      harness.contextFor(summariseUpcomingDayTool)
    );

    expect(result.ok).toBe(true);
    if (!result.ok || !result.data) throw new Error('tool returned no data');
    expect(result.data.totalScheduled).toBeGreaterThanOrEqual(1);
    expect(result.data.byPractitioner.length).toBeGreaterThanOrEqual(1);
  });
});

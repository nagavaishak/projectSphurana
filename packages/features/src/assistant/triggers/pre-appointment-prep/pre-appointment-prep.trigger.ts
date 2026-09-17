import { appointment, sql } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import type { DbConnection, Result } from '../../../shared/index.js';
import { type TriggerOutcome, runOrgLoop } from '../_shared.js';

/**
 * Trigger: `pre_appointment_prep`
 * Fires daily (e.g. 9am local to the clinic — simplified here as a global
 * daily run, see scheduler wiring). Finds appointments starting in the next
 * 24h and nudges the owner to prep (first visit from ad → focus on
 * experience, rebook before they leave, etc.).
 */
const runImpl = async (db: DbConnection): Promise<Result<TriggerOutcome>> => {
  const qualifying = await db.execute(sql<
    { organizationId: string; appointmentId: string }[]
  >`
    SELECT
      a.organization_id AS "organizationId",
      a.id AS "appointmentId"
    FROM ${appointment} a
    WHERE a.start_date > NOW()
      AND a.start_date < NOW() + INTERVAL '24 hours'
      AND a.status IN ('booked', 'confirmed', 'arrived', 'started')
    ORDER BY a.start_date ASC
    LIMIT 100
  `);

  const rows =
    (qualifying as unknown as {
      organizationId: string;
      appointmentId: string;
    }[]) ?? [];

  return runOrgLoop(
    db,
    rows.map(({ organizationId, appointmentId }) => ({
      organizationId,
      kind: 'pre_appointment_prep' as const,
      title: 'Appointment coming up',
      body: 'Focus on the experience and rebook them before they leave.',
      metadata: { appointmentId },
      primaryAction: {
        label: 'View appointment',
        type: 'navigate' as const,
        target: `/dashboard/appointments/${appointmentId}`,
      },
    }))
  );
};

export const runPreAppointmentPrepTrigger = (db: DbConnection) =>
  trackedResult('assistant.triggers.preAppointmentPrep', () => runImpl(db));

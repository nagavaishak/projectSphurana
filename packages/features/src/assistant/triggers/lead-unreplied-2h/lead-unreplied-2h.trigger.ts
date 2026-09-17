import { conversation, sql } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { conversationInboxPath } from '../../../shared/index.js';
import type { DbConnection, Result } from '../../../shared/index.js';
import { type TriggerOutcome, runOrgLoop } from '../_shared.js';

/**
 * Trigger: `lead_unreplied_2h`
 * Fires every 15 minutes. Finds conversations where the most recent message
 * was from the lead and the message landed more than 2 hours ago — surface
 * a nudge so the owner replies before the lead cools.
 *
 * One rec per qualifying conversation (not per org), so the toast's navigate
 * target can link directly to the specific inbox thread.
 *
 * Row is keyed on the conversationId via metadata for the widget's navigate
 * target to resolve. Dedup is per-org per-kind (not per-conversation), so if
 * multiple leads are waiting, only the first surfaces until the owner replies
 * or dismisses. That's the intended behaviour for v2 — keep the queue simple.
 */
const runImpl = async (db: DbConnection): Promise<Result<TriggerOutcome>> => {
  const qualifying = await db.execute(sql<
    { organizationId: string; conversationId: string }[]
  >`
    SELECT
      c.organization_id AS "organizationId",
      c.id AS "conversationId"
    FROM ${conversation} c
    WHERE c.last_message_at < NOW() - INTERVAL '2 hours'
      AND c.status = 'bot_handling'
    ORDER BY c.last_message_at ASC
    LIMIT 100
  `);

  const rows =
    (qualifying as unknown as {
      organizationId: string;
      conversationId: string;
    }[]) ?? [];

  return runOrgLoop(
    db,
    rows.map(({ organizationId, conversationId }) => ({
      organizationId,
      kind: 'lead_unreplied_2h' as const,
      title: 'A lead is waiting for a reply',
      body: "It's been over 2 hours. Reply now to keep the conversation warm.",
      metadata: { conversationId },
      primaryAction: {
        label: 'Open inbox',
        type: 'navigate' as const,
        target: conversationInboxPath(conversationId),
      },
    }))
  );
};

export const runLeadUnreplied2hTrigger = (db: DbConnection) =>
  trackedResult('assistant.triggers.leadUnreplied2h', () => runImpl(db), {
    // The only trigger on a 15-minute interval (every other one is daily), so
    // a per-run success event is ~96/day per deployment saying only "it ran" —
    // and liveness is already covered by the Better Stack heartbeat the
    // scheduler pings on this same interval. Outcomes surface via
    // `claire.triggerOutcome`; failures still emit here.
    trackSuccess: false,
  });

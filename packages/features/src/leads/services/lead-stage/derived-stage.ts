import { lead } from '@borradh-workspace/database';
import type { LeadStageGroup, LeadStatus } from '@borradh-workspace/labels';
import { type SQL, sql } from 'drizzle-orm';

/**
 * Pipeline stage is DERIVED, not stored.
 *
 * A stage is a statement about what has happened to a person — we messaged
 * them, they answered, they booked — and every one of those facts already has
 * a row somewhere. Storing the conclusion as well means two sources of truth
 * that drift the moment anything writes one without the other, which is what a
 * mutable `lead.status` plus a mirrored opportunity row gave us.
 *
 * The one stage that is NOT a fact about events is `lost`: nothing in the data
 * says "we gave up on them", so it stays an explicit mark on `lead.status` and
 * takes precedence over everything below it.
 *
 *   lost      — explicitly marked (`lead.status = 'lost'`)
 *   booked    — `converted_at` is stamped (first appointment or first paid sale)
 *   qualified — they have replied: an inbound message on a linked conversation
 *   contacted — we reached out: an outbound message, or `last_contacted_at`
 *   new       — none of the above
 *
 * `last_contacted_at` is in the `contacted` test on purpose: outreach that
 * never touched a chat channel (a phone call logged by reception) has no
 * `conversation` row, and without it those leads would sit at `new` forever.
 *
 * Both EXISTS probes hang off `conversation.lead_id` — the FK this work adds.
 * Before it, the link was a `metadata.leadId` JSON string with no index, and
 * deriving anything at list scale was not possible.
 *
 * A FUNCTION, not a module-level const, and that is load-bearing. Every
 * `${lead.status}` below dereferences a drizzle COLUMN, so a const evaluates
 * the whole template the moment this module is imported. Any consumer that
 * loads it before `@borradh-workspace/database` has finished initialising —
 * which is what happens under `apps/api`'s jest suite as soon as a new import
 * edge reaches the leads barrel — gets `Cannot read properties of undefined
 * (reading 'status')`, thrown from a module the failing spec never meant to
 * touch. Building the fragment on call keeps the import side-effect-free.
 */
export const derivedLeadStage = (): SQL<LeadStatus> => sql<LeadStatus>`(CASE
  WHEN ${lead.status} = 'lost' THEN 'lost'
  WHEN ${lead.convertedAt} IS NOT NULL THEN 'booked'
  WHEN EXISTS (
    SELECT 1 FROM conversation c
    JOIN conversation_message m ON m.conversation_id = c.id
    WHERE c.lead_id = ${lead.id} AND m.role = 'user'
  ) THEN 'qualified'
  WHEN ${lead.lastContactedAt} IS NOT NULL OR EXISTS (
    SELECT 1 FROM conversation c
    JOIN conversation_message m ON m.conversation_id = c.id
    WHERE c.lead_id = ${lead.id} AND m.role IN ('bot', 'agent')
  ) THEN 'contacted'
  ELSE 'new'
END)`;

/**
 * The stages each Clients tab shows. `all` applies no filter (it must include
 * `lost`, which has no tab of its own) and so is absent here.
 */
const TAB_STAGES = {
  leads: ['new'],
  contacted: ['contacted', 'qualified'],
  booked: ['booked'],
} as const satisfies Partial<Record<LeadStageGroup, readonly LeadStatus[]>>;

/** `WHERE` fragment restricting to one tab's derived stages. */
export function derivedStageInTab(tab: Exclude<LeadStageGroup, 'all'>): SQL {
  const stages = TAB_STAGES[tab];
  return sql`${derivedLeadStage()} IN (${sql.join(
    stages.map((s) => sql`${s}`),
    sql`, `
  )})`;
}

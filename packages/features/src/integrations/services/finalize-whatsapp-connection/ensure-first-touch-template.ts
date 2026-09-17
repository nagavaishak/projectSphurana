import { whatsappTemplate } from '@borradh-workspace/database';
import { logError } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';

import {
  FIRST_TOUCH_TEMPLATE_BODY,
  FIRST_TOUCH_TEMPLATE_EXAMPLE,
  FIRST_TOUCH_TEMPLATE_NAME,
  FOLLOW_UP_TEMPLATE_BODIES,
  FOLLOW_UP_TEMPLATE_EXAMPLES,
  FOLLOW_UP_TEMPLATE_NAMES,
} from '../../../conversations/index.js';
import type { DbConnection } from '../../../shared/index.js';
import { createWhatsappTemplate } from '../create-whatsapp-template/index.js';

/**
 * Submit the `claire_first_touch` opener template for approval as soon as a
 * clinic connects WhatsApp.
 *
 * Meta approval takes minutes to 48h, and until it lands every lead-form
 * first touch falls back to SMS — which works, but loses the clinic's name and
 * logo on the header. Submitting at connect time means the wait overlaps with
 * the rest of onboarding instead of starting the first time a lead arrives.
 *
 * Best-effort by design: a template failure must never fail the WhatsApp
 * connection itself. The clinic is connected either way, and the opener
 * degrades to SMS.
 *
 * Idempotent — a reconnect (or a second number on the same WABA) must not
 * resubmit a template that already exists.
 */
export async function ensureFirstTouchTemplate(
  db: DbConnection,
  args: { organizationId: string; accountId: string }
): Promise<void> {
  const { organizationId, accountId } = args;

  // Both are needed before a clinic's outbound sequence can run on WhatsApp:
  // the opener, and a separate nudge template. Follow-ups to a lead who has
  // NOT replied are still business-initiated — the 24h service window only
  // opens on a message from the customer — so they need their own approved
  // template, and it cannot be the opener, whose fixed text says "the form you
  // submitted".
  // One nudge template PER STEP: Meta enforces a ratio of static text to
  // variables, so the copy cannot live in a variable (subcode 2388293).
  const wanted = [
    {
      name: FIRST_TOUCH_TEMPLATE_NAME,
      body: FIRST_TOUCH_TEMPLATE_BODY,
      bodyExample: [...FIRST_TOUCH_TEMPLATE_EXAMPLE],
    },
    {
      name: FOLLOW_UP_TEMPLATE_NAMES.followup_1,
      body: FOLLOW_UP_TEMPLATE_BODIES.followup_1,
      bodyExample: [...FOLLOW_UP_TEMPLATE_EXAMPLES.followup_1],
    },
    {
      name: FOLLOW_UP_TEMPLATE_NAMES.followup_2,
      body: FOLLOW_UP_TEMPLATE_BODIES.followup_2,
      bodyExample: [...FOLLOW_UP_TEMPLATE_EXAMPLES.followup_2],
    },
  ];

  try {
    for (const { name, body, bodyExample } of wanted) {
      const existing = await db.query.whatsappTemplate.findFirst({
        where: and(
          eq(whatsappTemplate.organizationId, organizationId),
          eq(whatsappTemplate.name, name)
        ),
      });
      if (existing) continue;

      await createWhatsappTemplate(db, {
        organizationId,
        accountId,
        name,
        // A cold message to someone who submitted a lead form is MARKETING,
        // not UTILITY. Mis-categorising is a common rejection cause and, worse,
        // a policy breach if it were approved.
        category: 'MARKETING',
        language: 'en',
        body,
        bodyExample,
      });
    }
  } catch (error) {
    logError('integrations.ensureFirstTouchTemplate', error, {
      feature: 'integrations',
      extra: { organizationId, accountId },
    });
  }
}

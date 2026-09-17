/**
 * Email the people who can actually act on a domain problem.
 *
 * Owners and admins, because a domain change is a registrar/Business-Manager
 * task; a stylist cannot do anything with it. Mirrors the recipient query
 * `meta-ads/run-health-alerts` uses so there is one idea of "who gets told".
 */

import { member, user } from '@borradh-workspace/database';
import { sendHtmlEmail } from '@borradh-workspace/email';
import { createLogger, logError } from '@borradh-workspace/observability';
import { and, eq, sql } from 'drizzle-orm';
import type { DbConnection } from '../../shared/index.js';

const logger = createLogger('MicrositeDomainNotify');

export interface OrgRecipient {
  userId: string;
  name: string;
  email: string;
}

export const getOrgAdmins = async (
  db: DbConnection,
  organizationId: string
): Promise<OrgRecipient[]> => {
  const rows = await db
    .select({ userId: user.id, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(
      and(
        eq(member.organizationId, organizationId),
        sql`${member.role} IN ('owner', 'admin')`
      )
    );

  return rows.map((r) => ({ userId: r.userId, name: r.name, email: r.email }));
};

/**
 * Send one notice to every admin. Never throws — a failed send must not roll
 * back the state transition that triggered it, and the transition is already
 * recorded in the row.
 */
export const notifyOrgAdmins = async (
  db: DbConnection,
  input: { organizationId: string; subject: string; html: string }
): Promise<{ sent: number }> => {
  try {
    const admins = await getOrgAdmins(db, input.organizationId);
    if (admins.length === 0) {
      logger.warn('No admins to notify about a microsite domain', {
        organizationId: input.organizationId,
      });
      return { sent: 0 };
    }

    await sendHtmlEmail({
      to: admins.map((a) => a.email),
      subject: input.subject,
      html: input.html,
    });

    return { sent: admins.length };
  } catch (error) {
    logError('microsites.notifyOrgAdmins', error, {
      feature: 'microsites',
      extra: { organizationId: input.organizationId, subject: input.subject },
    });
    return { sent: 0 };
  }
};

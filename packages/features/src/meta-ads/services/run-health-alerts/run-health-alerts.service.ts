import { member, organization, user } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { getRedis } from '@borradh-workspace/redis';
import { and, eq, sql } from 'drizzle-orm';
import { listActiveMetaIntegrations } from '../../../integrations/services/list-active-meta-integrations/list-active-meta-integrations.service.js';
import { sendIntercomMessage } from '../../../notifications/services/send-intercom-message/send-intercom-message.service.js';
import { sendPushNotification } from '../../../notifications/services/send-push-notification/send-push-notification.service.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { type HealthCheckItem, healthCheck } from '../health-check/index.js';
import {
  type RunHealthAlertsInput,
  runHealthAlertsSchema,
} from './run-health-alerts.schema.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHECK_LABELS: Record<string, string> = {
  meta_connection: 'Meta Connection',
  account_status: 'Account Status',
  payment_method: 'Payment Method',
  spending_limit: 'Spending Limit',
  page_access: 'Page Access',
  instagram_linked: 'Instagram Linked',
};

const REDIS_KEY_PREFIX = 'meta-health-alert';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AlertItem {
  organizationId: string;
  organizationName: string;
  check: HealthCheckItem;
}

interface OrgRecipient {
  userId: string;
  name: string;
  email: string;
}

export interface RunHealthAlertsResult {
  totalChecked: number;
  totalFailing: number;
  alertsSent: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getOrgName(
  db: DbConnection,
  organizationId: string
): Promise<string> {
  const org = await db.query.organization.findFirst({
    where: and(eq(organization.id, organizationId), notDeleted(organization)),
    columns: { name: true },
  });
  return org?.name ?? 'Unknown';
}

async function getOrgAdmins(
  db: DbConnection,
  organizationId: string
): Promise<OrgRecipient[]> {
  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(
      and(
        eq(member.organizationId, organizationId),
        sql`${member.role} IN ('owner', 'admin')`
      )
    );

  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    email: r.email,
  }));
}

function buildIntercomHtml(alerts: AlertItem[]): string {
  const lines = alerts.map((a) => {
    const label = CHECK_LABELS[a.check.check] ?? a.check.check;
    const detail = a.check.detail ?? 'Action required.';
    const actionLink = a.check.actionUrl
      ? ` <a href="${a.check.actionUrl}">${a.check.actionLabel ?? 'Fix in Meta'}</a>`
      : '';
    return `<p><strong>${label}:</strong> ${detail}${actionLink}</p>`;
  });

  return `<p>Your Meta Ads account needs attention:</p>${lines.join('')}`;
}

function buildPushBody(alerts: AlertItem[]): string {
  if (alerts.length === 1) {
    const label = CHECK_LABELS[alerts[0].check.check] ?? alerts[0].check.check;
    return `${label}: ${alerts[0].check.detail ?? 'Action required.'}`;
  }
  const labels = alerts.map(
    (a) => CHECK_LABELS[a.check.check] ?? a.check.check
  );
  return `${alerts.length} issues: ${labels.join(', ')}`;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const runHealthAlertsImpl = async (
  db: DbConnection,
  input: RunHealthAlertsInput = {}
): Promise<Result<RunHealthAlertsResult>> => {
  const parsed = runHealthAlertsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, dedupTtlSeconds } = parsed.data;

  // 1. Get all active integrations
  const integrationsResult = await listActiveMetaIntegrations(db);
  if (!integrationsResult.success) {
    return err(
      new FeatureError(
        integrationsResult.error.code,
        integrationsResult.error.message
      )
    );
  }

  const integrations = organizationId
    ? integrationsResult.data.filter((i) => i.organizationId === organizationId)
    : integrationsResult.data;
  if (integrations.length === 0) {
    return ok({ totalChecked: 0, totalFailing: 0, alertsSent: 0 });
  }

  const redis = getRedis();
  const newAlerts: AlertItem[] = [];

  // 2. Run health check per integration, deduplicate via Redis
  for (const integration of integrations) {
    try {
      const result = await healthCheck(db, {
        organizationId: integration.organizationId,
        requireInstagram: false,
      });

      if (!result.success) continue;

      const failingChecks = result.data.checks.filter(
        (c) => c.status === 'fail'
      );
      if (failingChecks.length === 0) continue;

      const orgName = await getOrgName(db, integration.organizationId);

      for (const check of failingChecks) {
        const redisKey = `${REDIS_KEY_PREFIX}:${integration.organizationId}:${check.check}`;
        const alreadyAlerted = await redis.get(redisKey);
        if (alreadyAlerted) continue;

        await redis.set(redisKey, '1', 'EX', dedupTtlSeconds);
        newAlerts.push({
          organizationId: integration.organizationId,
          organizationName: orgName,
          check,
        });
      }
    } catch (error) {
      logError('metaAds.runHealthAlerts.integration', error, {
        feature: 'meta-ads',
        extra: { organizationId: integration.organizationId },
      });
    }
  }

  if (newAlerts.length === 0) {
    return ok({
      totalChecked: integrations.length,
      totalFailing: 0,
      alertsSent: 0,
    });
  }

  // 3. Send team email
  try {
    const { apiEnv } = await import('@borradh-workspace/env/api');
    const alertEmail = apiEnv.ALERT_EMAIL;

    if (alertEmail) {
      const { sendEmail, MetaHealthAlertEmail } = await import(
        '@borradh-workspace/email'
      );

      await sendEmail({
        to: alertEmail,
        subject: `⚠️ ${newAlerts.length} Meta account issue${newAlerts.length === 1 ? '' : 's'} detected`,
        template: MetaHealthAlertEmail,
        props: {
          alerts: newAlerts.map((a) => ({
            organizationName: a.organizationName,
            checkName: CHECK_LABELS[a.check.check] ?? a.check.check,
            detail: a.check.detail ?? '',
            actionUrl: a.check.actionUrl,
            actionLabel: a.check.actionLabel,
          })),
        },
      });
    }
  } catch (error) {
    logError('metaAds.runHealthAlerts.teamEmail', error, {
      feature: 'meta-ads',
    });
  }

  // 4. Send user notifications (Intercom + push), grouped by org
  const alertsByOrg = new Map<string, AlertItem[]>();
  for (const alert of newAlerts) {
    const existing = alertsByOrg.get(alert.organizationId) ?? [];
    existing.push(alert);
    alertsByOrg.set(alert.organizationId, existing);
  }

  let alertsSent = 0;

  for (const [organizationId, orgAlerts] of alertsByOrg) {
    try {
      const recipients = await getOrgAdmins(db, organizationId);
      const { apiEnv } = await import('@borradh-workspace/env/api');

      const intercomConfig = {
        accessToken: apiEnv.INTERCOM_ACCESS_TOKEN,
        adminId: apiEnv.INTERCOM_ADMIN_ID,
      };

      const htmlBody = buildIntercomHtml(orgAlerts);
      const pushBody = buildPushBody(orgAlerts);

      for (const recipient of recipients) {
        // Intercom in-app message
        await sendIntercomMessage(
          { userId: recipient.userId, messageBody: htmlBody },
          intercomConfig
        );

        // Push notification
        await sendPushNotification(db, {
          userId: recipient.userId,
          title: 'Action needed on your Meta Ads',
          body: pushBody,
        });

        alertsSent++;
      }
    } catch (error) {
      logError('metaAds.runHealthAlerts.userNotify', error, {
        feature: 'meta-ads',
        extra: { organizationId },
      });
    }
  }

  return ok({
    totalChecked: integrations.length,
    totalFailing: newAlerts.length,
    alertsSent,
  });
};

export const runHealthAlerts = (
  db: DbConnection,
  input: RunHealthAlertsInput = {}
) =>
  trackedResult(
    'metaAds.runHealthAlerts',
    () => runHealthAlertsImpl(db, input),
    { properties: { inputOverrides: Object.keys(input).join(',') } }
  );

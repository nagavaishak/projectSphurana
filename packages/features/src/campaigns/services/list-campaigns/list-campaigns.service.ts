import {
  campaign,
  campaignRecipient,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { type SQL, and, count, desc, eq, inArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type ListCampaignsInput,
  listCampaignsSchema,
} from './list-campaigns.schema.js';

const listCampaignsImpl = async (
  db: DbConnection,
  input: ListCampaignsInput
) => {
  const parsed = listCampaignsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, status, limit, offset } = parsed.data;

  const conditions: SQL[] = [
    eq(campaign.organizationId, organizationId),
    notDeleted(campaign),
  ];
  if (status) conditions.push(eq(campaign.status, status));

  const rows = await db.query.campaign.findMany({
    where: and(...conditions),
    orderBy: desc(campaign.createdAt),
    limit,
    offset,
    with: { segment: { columns: { name: true } } },
  });

  // Per-channel recipient counts so the list can answer "who did this reach?"
  // without opening each campaign. One grouped query for the whole page.
  const ids = rows.map((c) => c.id);
  const countsByCampaign = new Map<string, Record<string, number>>();
  if (ids.length > 0) {
    const grouped = await db
      .select({
        campaignId: campaignRecipient.campaignId,
        channel: campaignRecipient.channel,
        recipients: count(),
      })
      .from(campaignRecipient)
      .where(inArray(campaignRecipient.campaignId, ids))
      .groupBy(campaignRecipient.campaignId, campaignRecipient.channel);
    for (const g of grouped) {
      const perChannel = countsByCampaign.get(g.campaignId) ?? {};
      perChannel[g.channel] = Number(g.recipients);
      countsByCampaign.set(g.campaignId, perChannel);
    }
  }

  const items = rows.map(({ segment: seg, ...c }) => ({
    ...c,
    segmentName: seg?.name ?? null,
    recipientCounts: countsByCampaign.get(c.id) ?? {},
  }));

  // `total` used to be `items.length` — the PAGE size under a field named
  // total, so it could never exceed `limit`. Count over the SAME predicate.
  // `conditions` is reused verbatim, so the count can never drift from the
  // filter the page was built with.
  const [totalRow] = await db
    .select({ value: count() })
    .from(campaign)
    .where(and(...conditions));

  return ok({ items, total: totalRow?.value ?? 0, limit, offset });
};

export const listCampaigns = (db: DbConnection, input: ListCampaignsInput) =>
  trackedResult(
    'campaigns.listCampaigns',
    () => withOrgScope((tx) => listCampaignsImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type ListCampaignsResult = Awaited<ReturnType<typeof listCampaigns>>;

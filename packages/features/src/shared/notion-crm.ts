import type { NotionCrmService } from '@borradh-workspace/integrations/notion';
import { logError } from '@borradh-workspace/observability';

let instance: NotionCrmService | null = null;
let initFailed = false;

async function getNotionCrm(): Promise<NotionCrmService | null> {
  if (initFailed) return null;
  if (instance) return instance;

  try {
    const { NotionCrmService: Svc } = await import(
      '@borradh-workspace/integrations/notion'
    );
    instance = new Svc();
    return instance;
  } catch {
    // NOTION_API_KEY not configured – silently skip all future calls
    initFailed = true;
    return null;
  }
}

/**
 * Fire-and-forget: create a contact in Notion CRM when a user signs up.
 */
export function fireNotionLeadCreated(email: string, name: string): void {
  if (!email) return;
  getNotionCrm()
    .then((svc) =>
      svc?.createContact({
        email,
        name,
        stage: 'New',
        notes: 'Auto-created on sign-up',
      })
    )
    .catch((error) =>
      logError('notion.leadCreated', error, {
        feature: 'notion',
        extra: { email },
      })
    );
}

/**
 * Fire-and-forget: update existing contact with org details when org is created.
 */
export function fireNotionOrgCreated(
  orgName: string,
  businessType: string,
  ownerEmail: string
): void {
  if (!ownerEmail) return;
  getNotionCrm()
    .then((svc) =>
      svc?.upsertContact({
        email: ownerEmail,
        stage: 'Onboarded',
        businessName: orgName,
        businessType,
        notes: 'Organization created',
      })
    )
    .catch((error) =>
      logError('notion.orgCreated', error, {
        feature: 'notion',
        extra: { orgName, ownerEmail },
      })
    );
}

/**
 * Fire-and-forget: mark contact as Customer on subscription activation.
 */
export function fireNotionSubscriptionActivated(
  email: string,
  _orgName?: string
): void {
  if (!email) return;
  getNotionCrm()
    .then((svc) =>
      svc?.updateContact({
        email,
        stage: 'Customer',
        notes: 'Subscription activated',
      })
    )
    .catch((error) =>
      logError('notion.subscriptionActivated', error, {
        feature: 'notion',
        extra: { email },
      })
    );
}

/**
 * Fire-and-forget: mark contact as Lost on account deletion.
 */
export function fireNotionAccountDeleted(
  email: string,
  _orgName?: string
): void {
  if (!email) return;
  getNotionCrm()
    .then((svc) =>
      svc?.updateContact({
        email,
        stage: 'Lost',
        notes: 'Account deleted',
      })
    )
    .catch((error) =>
      logError('notion.accountDeleted', error, {
        feature: 'notion',
        extra: { email },
      })
    );
}

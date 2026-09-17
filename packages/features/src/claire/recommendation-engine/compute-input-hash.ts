import { createHash } from 'node:crypto';
import type {
  ChatbotSettings,
  MarketPosition,
  OrganizationService,
} from '@borradh-workspace/database';

export type ComputeInputHashInput = {
  services: OrganizationService[];
  chatbotSettings: ChatbotSettings | null;
  ownerSelfReport?: { marketPosition?: MarketPosition };
};

const stableServiceShape = (s: OrganizationService) => ({
  id: s.id,
  name: s.name.trim().toLowerCase(),
  category: s.category,
  priceText: s.priceText?.trim() ?? null,
});

// Owner-side signals that should trigger reclassification when they change.
// Anything else on ChatbotSettings is treated as cosmetic.
const stableOwnerShape = (settings: ChatbotSettings | null) => {
  if (!settings) return null;
  return {
    ownerCredentials: settings.ownerCredentials?.trim().toLowerCase() ?? null,
    ownerAwards: settings.ownerAwards?.trim().toLowerCase() ?? null,
  };
};

export const computeInputHash = (input: ComputeInputHashInput): string => {
  const services = input.services
    .map(stableServiceShape)
    .sort((a, b) => a.id.localeCompare(b.id));

  const canonical = JSON.stringify({
    services,
    owner: stableOwnerShape(input.chatbotSettings),
    selfReport: {
      marketPosition: input.ownerSelfReport?.marketPosition ?? null,
    },
  });

  return createHash('sha256').update(canonical).digest('hex');
};

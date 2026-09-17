import {
  MOBILE_FILTER_CHROME_CLASS,
  MobileSearchField,
  type MobileSegmentedTab,
  MobileSegmentedTabs,
} from '@/features/mobile-ui';
import { Facebook, Instagram, MessageCircle } from 'lucide-react';

import {
  type HandledByAgentOption,
  HandledByFilterDropdown,
  type HandledByFilterValue,
} from './handled-by-filter-dropdown';

export type { HandledByFilterValue };

const platformTabs: MobileSegmentedTab[] = [
  { value: 'all', label: 'All', ariaLabel: 'All platforms' },
  {
    value: 'instagram_dm',
    icon: Instagram,
    ariaLabel: 'Instagram',
  },
  { value: 'whatsapp', icon: MessageCircle, ariaLabel: 'WhatsApp' },
  {
    value: 'facebook_messenger',
    icon: Facebook,
    ariaLabel: 'Facebook Messenger',
  },
];

interface ConversationsInboxFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  platformFilter: string;
  onPlatformFilterChange: (value: string) => void;
  handledByFilter: HandledByFilterValue;
  onHandledByFilterChange: (value: HandledByFilterValue) => void;
  agentOptions: HandledByAgentOption[];
}

export function ConversationsInboxFilters({
  search,
  onSearchChange,
  platformFilter,
  onPlatformFilterChange,
  handledByFilter,
  onHandledByFilterChange,
  agentOptions,
}: ConversationsInboxFiltersProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <MobileSegmentedTabs
          value={platformFilter}
          onValueChange={onPlatformFilterChange}
          tabs={platformTabs}
          aria-label="Filter by platform"
        />

        <HandledByFilterDropdown
          value={handledByFilter}
          onValueChange={onHandledByFilterChange}
          agentOptions={agentOptions}
          triggerClassName={MOBILE_FILTER_CHROME_CLASS}
        />
      </div>

      <MobileSearchField
        value={search}
        onChange={onSearchChange}
        placeholder="Search your client messages..."
      />
    </div>
  );
}

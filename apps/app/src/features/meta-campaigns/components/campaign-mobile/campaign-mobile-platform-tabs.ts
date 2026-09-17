import type { MobileSegmentedTab } from '@/features/mobile-ui';
import type { MessagingDestination } from '@borradh-workspace/api-client/types';
import { Facebook, Instagram, MessageCircle } from 'lucide-react';

/** Create campaign (Messages): WhatsApp + Instagram + Facebook — multi select. */
export const CAMPAIGN_MOBILE_DESTINATION_TAB_VALUES: MessagingDestination[] = [
  'whatsapp',
  'instagram_dm',
  'messenger',
];

export const CAMPAIGN_MOBILE_DESTINATION_TABS: MobileSegmentedTab[] = [
  {
    value: 'whatsapp',
    icon: MessageCircle,
    ariaLabel: 'WhatsApp',
  },
  {
    value: 'instagram_dm',
    icon: Instagram,
    ariaLabel: 'Instagram',
  },
  {
    value: 'messenger',
    icon: Facebook,
    ariaLabel: 'Facebook',
  },
];

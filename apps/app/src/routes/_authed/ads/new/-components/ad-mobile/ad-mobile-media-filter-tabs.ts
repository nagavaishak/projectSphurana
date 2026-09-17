import type { MobileSegmentedTab } from '@/features/mobile-ui';
import { Film, Paintbrush } from 'lucide-react';

/** Two groups: videos (generated + uploaded) and graphics (rendered + images). */
export type AdMobileMediaTab = 'videos' | 'graphics';

export const AD_MOBILE_MEDIA_FILTER_TABS: MobileSegmentedTab[] = [
  {
    value: 'videos',
    label: 'Videos',
    icon: Film,
    ariaLabel: 'Videos',
  },
  {
    value: 'graphics',
    label: 'Graphics',
    icon: Paintbrush,
    ariaLabel: 'Graphics',
  },
];

/**
 * Within each media group, split by where the media came from — `generated`
 * (videos we created / rendered graphics) vs `uploaded` (the org's own
 * uploaded video/image assets). Mirrors the desktop wizard's sub-tabs.
 */
export type AdMobileMediaSource = 'generated' | 'uploaded';

export const AD_MOBILE_MEDIA_SOURCE_TABS: MobileSegmentedTab[] = [
  {
    value: 'generated',
    label: 'Generated',
    ariaLabel: 'Generated',
  },
  {
    value: 'uploaded',
    label: 'Uploaded',
    ariaLabel: 'Uploaded',
  },
];

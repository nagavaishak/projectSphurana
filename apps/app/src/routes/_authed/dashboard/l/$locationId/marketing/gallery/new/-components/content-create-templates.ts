import {
  VIDEO_TEMPLATES,
  type VideoTemplateFilter,
  type VideoTemplateItem,
  filterVideoTemplates,
} from '@/features/socials/components/video-templates';

/**
 * Video templates offered in the mobile create-content funnel. These are the
 * SAME templates the desktop `NewPostDialog` renders — taken from the shared
 * catalogue (`features/socials/components/video-templates`) rather than
 * hand-copied, which is how this list drifted three templates behind.
 */
export type ContentVideoTemplate = VideoTemplateItem;
export const CONTENT_VIDEO_TEMPLATES = VIDEO_TEMPLATES;

export type ContentTemplateFilter = VideoTemplateFilter;

export const CONTENT_TEMPLATE_FILTERS: {
  value: ContentTemplateFilter;
  label: string;
}[] = [
  { value: 'all', label: 'All' },
  { value: 'paid', label: 'Paid' },
  { value: 'organic', label: 'Organic' },
];

export function filterContentTemplates(
  filter: ContentTemplateFilter
): ContentVideoTemplate[] {
  return filterVideoTemplates(filter);
}

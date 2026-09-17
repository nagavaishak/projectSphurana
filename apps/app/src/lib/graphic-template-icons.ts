import {
  BookOpenCheckIcon,
  CameraIcon,
  ContrastIcon,
  FileTextIcon,
  GitCompareArrowsIcon,
  ImageIcon,
  LayersIcon,
  LightbulbIcon,
  ListChecksIcon,
  ListOrderedIcon,
  MessageSquareQuoteIcon,
  MessagesSquareIcon,
  PenLineIcon,
  RouteIcon,
  ShieldQuestionIcon,
  TrendingUpIcon,
  TypeIcon,
  VoteIcon,
} from 'lucide-react';
import type { ElementType } from 'react';

/**
 * Icon per curated graphic template slug (see the carousel/single registries
 * in @borradh-workspace/features). Slugs missing here fall back by kind, so a
 * new registry template shows up in the pickers without a frontend change.
 */
const GRAPHIC_TEMPLATE_ICONS: Record<string, ElementType> = {
  // Carousels
  'clearskin-blackwhite': ContrastIcon,
  'clearskin-storytime': TypeIcon,
  phoenix: ListOrderedIcon,
  'phoenix-2': FileTextIcon,
  therapie: MessagesSquareIcon,
  'day-in-the-life': CameraIcon,
  'treatment-compare': GitCompareArrowsIcon,
  'myth-countdown': ShieldQuestionIcon,
  'client-journey': RouteIcon,
  'read-before-book': BookOpenCheckIcon,
  // Singles
  'stat-serif-centered': TrendingUpIcon,
  'concern-list-photo': ListChecksIcon,
  'its-not-cheap-longform': PenLineIcon,
  'testimonial-quote': MessageSquareQuoteIcon,
  'didyouknow-fact': LightbulbIcon,
  'poll-thisorthat': VoteIcon,
};

export function graphicTemplateIcon(
  slug: string,
  kind: 'single' | 'carousel'
): ElementType {
  return (
    GRAPHIC_TEMPLATE_ICONS[slug] ??
    (kind === 'carousel' ? LayersIcon : ImageIcon)
  );
}

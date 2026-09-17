import {
  Award,
  BookOpen,
  CircleDollarSignIcon,
  EyeIcon,
  FootprintsIcon,
  HighlighterIcon,
  LayoutListIcon,
  ListChecksIcon,
  ListOrderedIcon,
  MessageCircleReplyIcon,
  MessageSquareQuoteIcon,
  PencilLineIcon,
  QuoteIcon,
  ScaleIcon,
  ShieldQuestionIcon,
  Sparkles,
  Tag,
  TimerIcon,
  TrendingUpIcon,
  VoteIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * THE video-template catalogue for the create-content flows. Both the desktop
 * `NewPostDialog` and the mobile create-content funnel
 * (`gallery/new`) render from this list — never from a hand-copy, which is how
 * the mobile funnel ended up three templates behind.
 */
export interface VideoTemplateItem {
  id: string;
  title: string;
  description: string;
  /** Drives the All / Paid / Organic filter. */
  usageType: 'ad' | 'organic';
  icon: LucideIcon;
}

export const VIDEO_TEMPLATES: VideoTemplateItem[] = [
  {
    id: 'authority',
    title: 'Authority',
    description: 'Share expertise and build trust.',
    usageType: 'ad',
    icon: Award,
  },
  // 'before-after' is RETIRED — see RETIRED_TEMPLATE_IDS in
  // packages/features/src/videos/templates/template-definitions.ts. We cannot
  // confirm that a "before" and an "after" are the same client and treatment,
  // so the format was withdrawn rather than risk presenting two different
  // people as one person's result.
  {
    id: 'educational',
    title: 'Educational',
    description: 'Teach with quick tips and insights.',
    usageType: 'ad',
    icon: BookOpen,
  },
  {
    id: 'offer',
    title: 'Offer',
    description: 'Promote deals and limited-time offers.',
    usageType: 'ad',
    icon: Tag,
  },
  {
    id: 'caption-tease',
    title: 'Caption Tease',
    description:
      'Headline + cursive hook over procedure b-roll. Drives caption reads.',
    usageType: 'organic',
    icon: PencilLineIcon,
  },
  {
    id: 'fade-benefits',
    title: 'Fade-In Benefits',
    description:
      'Benefit statements fade in word-by-word (serif) over procedure b-roll.',
    usageType: 'organic',
    icon: Sparkles,
  },
  {
    id: 'aesthetic-line',
    title: 'Aesthetic Line',
    description:
      'A single understated serif line that fades in over calm b-roll.',
    usageType: 'organic',
    icon: QuoteIcon,
  },
  {
    id: 'numbered-list',
    title: 'Numbered List',
    description:
      'A bold title and a numbered list of tips over darkened b-roll.',
    usageType: 'organic',
    icon: ListOrderedIcon,
  },
  {
    id: 'ins-outs',
    title: 'INS + OUTS',
    description: 'Two-column list of dos and don’ts over darkened b-roll.',
    usageType: 'organic',
    icon: LayoutListIcon,
  },
  {
    id: 'question-cta',
    title: 'Question + Read Caption',
    description:
      'Hooked question with a "Read caption" CTA. Long story belongs in the caption.',
    usageType: 'organic',
    icon: MessageSquareQuoteIcon,
  },
  {
    id: 'improves',
    title: 'Service Improves',
    description: 'Service name, then one benefit per clip, ending on a CTA.',
    usageType: 'organic',
    icon: ListChecksIcon,
  },
  {
    id: 'highlight-caption',
    title: 'Highlight Caption',
    description:
      'Lines reveal one at a time on solid brand-colour highlight blocks. The trending reel caption format.',
    usageType: 'organic',
    icon: HighlighterIcon,
  },
  {
    id: 'curiosity-hook',
    title: 'Curiosity Hook',
    description:
      'A bold claim up top, "watch till the end" at the bottom. A curiosity gap that drives full watches.',
    usageType: 'organic',
    icon: EyeIcon,
  },
  {
    id: 'step-timer',
    title: 'Step + Timer',
    description:
      'Numbered timed steps, one per clip. Save-worthy routine and protocol content.',
    usageType: 'organic',
    icon: TimerIcon,
  },
  {
    id: 'poll',
    title: 'Engagement Poll',
    description:
      'Vote with a like, comment or share — results show natively on the post.',
    usageType: 'organic',
    icon: VoteIcon,
  },
  {
    id: 'myth-fact',
    title: 'Myth → Fact',
    description:
      'A wrong belief flips to the correction — red MYTH to green FACT cards.',
    usageType: 'organic',
    icon: ShieldQuestionIcon,
  },
  {
    id: 'versus',
    title: 'X vs Y',
    description:
      'Two treatments compared attribute by attribute, ending on a verdict.',
    usageType: 'organic',
    icon: ScaleIcon,
  },
  {
    id: 'price-reveal',
    title: 'Price Reveal',
    description:
      'A receipt builds line by line; the total lands last. Transparency sells.',
    usageType: 'organic',
    icon: CircleDollarSignIcon,
  },
  {
    id: 'client-question',
    title: 'Client Question',
    description: 'A pinned client DM answered beat by beat over footage.',
    usageType: 'organic',
    icon: MessageCircleReplyIcon,
  },
  {
    id: 'come-with-me',
    title: 'Come With Me',
    description:
      'The invitation mini-vlog: script title + diary captions, calm pace.',
    usageType: 'organic',
    icon: FootprintsIcon,
  },
  {
    id: 'time-progress',
    title: 'Time-lapse Progress',
    description:
      'A "Day 1 → Day 30" timestamp over before→after footage. Watch results happen.',
    usageType: 'organic',
    icon: TrendingUpIcon,
  },
];

export type VideoTemplateFilter = 'all' | 'paid' | 'organic';

export const VIDEO_TEMPLATE_FILTER_LABELS: Record<VideoTemplateFilter, string> =
  {
    all: 'All',
    paid: 'Paid',
    organic: 'Organic',
  };

export const VIDEO_TEMPLATE_FILTERS: VideoTemplateFilter[] = [
  'all',
  'paid',
  'organic',
];

export function filterVideoTemplates(
  filter: VideoTemplateFilter
): VideoTemplateItem[] {
  return VIDEO_TEMPLATES.filter((t) => {
    if (filter === 'all') return true;
    if (filter === 'paid') return t.usageType === 'ad';
    return t.usageType === 'organic';
  });
}

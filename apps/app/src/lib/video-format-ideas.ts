import type { ContentIdeaCategory } from '@/components/ui/content-idea-card';

export interface VideoFormatIdea {
  id: string;
  title: string;
  description: string;
  category: ContentIdeaCategory;
  isRecommended?: boolean;
}

/** Shared video format list for Quick Create dialog and ad mobile format page. */
export const VIDEO_FORMAT_IDEAS: VideoFormatIdea[] = [
  {
    id: 'authority',
    title: 'Authority',
    description: 'Share expertise and build trust.',
    category: 'Trust',
    isRecommended: true,
  },
  {
    id: 'before-after',
    title: 'Before and After',
    description: 'Showcase real results and transformations.',
    category: 'Results',
    isRecommended: true,
  },
  {
    id: 'educational',
    title: 'Education',
    description: 'Teach with quick tips and insights.',
    category: 'Informative',
  },
  {
    id: 'offer',
    title: 'Offer',
    description: 'Promote deals and limited-time offers.',
    category: 'Promotion',
  },
];

export const QUICK_CREATE_VIDEO_FORMAT_IDEAS: VideoFormatIdea[] = [
  ...VIDEO_FORMAT_IDEAS,
  {
    id: 'caption-tease',
    title: 'Caption Tease',
    description: 'Headline + cursive hook over procedure b-roll.',
    category: 'Informative',
  },
  {
    id: 'fade-benefits',
    title: 'Fade-In Benefits',
    description: 'Benefit statements fade in over procedure b-roll.',
    category: 'Informative',
  },
  {
    id: 'aesthetic-line',
    title: 'Aesthetic Line',
    description: 'A single understated line over calm b-roll.',
    category: 'Trust',
  },
  {
    id: 'numbered-list',
    title: 'Numbered List',
    description: 'A bold title and numbered tips over b-roll.',
    category: 'Informative',
  },
  {
    id: 'ins-outs',
    title: 'INS + OUTS',
    description: "Two-column dos and don'ts over b-roll.",
    category: 'Informative',
  },
  {
    id: 'question-cta',
    title: 'Question + Read Caption',
    description: 'Hooked question with a read-caption CTA.',
    category: 'Social Proof',
  },
  {
    id: 'improves',
    title: 'Service Improves',
    description: 'Service name, benefit beats, and CTA.',
    category: 'Promotion',
  },
];

import type { LucideIcon } from 'lucide-react';
import {
  ChartLine,
  Image,
  Megaphone,
  Pencil,
  Rocket,
  UserPlus,
} from 'lucide-react';

export interface AskAiMobileQuickAction {
  skillId: string;
  label: string;
  message: string;
  icon: LucideIcon;
}

/** Suggested actions for the mobile Ask AI sheet empty state. */
export const ASK_AI_MOBILE_QUICK_ACTIONS: ReadonlyArray<AskAiMobileQuickAction> =
  [
    {
      skillId: 'generate-graphic',
      label: 'Create a graphic',
      message: 'I want to create a graphic',
      icon: Image,
    },
    {
      skillId: 'create-ad',
      label: 'Launch an ad',
      message: 'I want to launch an ad',
      icon: Megaphone,
    },
    {
      skillId: 'plan-campaign',
      label: 'Plan a campaign',
      message: 'Help me plan a campaign',
      icon: Rocket,
    },
    {
      skillId: 'book-client',
      label: 'Book a client',
      message: 'Help me book a client',
      icon: UserPlus,
    },
    {
      skillId: 'write-copy',
      label: 'Write copy',
      message: 'Help me write copy',
      icon: Pencil,
    },
    {
      skillId: 'performance-report',
      label: 'Performance Report',
      message: 'Show me a performance report',
      icon: ChartLine,
    },
  ];

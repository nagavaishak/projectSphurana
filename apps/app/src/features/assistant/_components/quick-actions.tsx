import type { LucideIcon } from 'lucide-react';
import {
  Box,
  ChartNoAxesColumnIncreasing,
  NotepadText,
  SquareCode,
} from 'lucide-react';

export interface QuickAction {
  skillId: string;
  label: string;
  message: string;
  icon?: LucideIcon;
  iconColor?: string;
}

export const QUICK_ACTIONS: ReadonlyArray<QuickAction> = [
  {
    skillId: 'generate-video',
    label: 'Create Video',
    message: 'I want to create a video',
    icon: ChartNoAxesColumnIncreasing,
    iconColor: '#00BCFF',
  },
  {
    skillId: 'generate-graphic',
    label: 'Create Graphic',
    message: 'I want to create a graphic',
    icon: Box,
    iconColor: '#00D3F2',
  },
  {
    skillId: 'create-ad',
    label: 'Launch Ad',
    message: 'I want to launch an ad',
    icon: NotepadText,
    iconColor: '#FF8904',
  },
  {
    skillId: 'summarise-conversations',
    label: 'Summarise Conversations',
    message: 'Summarise my recent conversations',
    icon: SquareCode,
    iconColor: '#615FFF',
  },
];

import type {
  TrainingCategory,
  TrainingVideo,
  UserVideoProgress,
} from '@borradh-workspace/database';

export type { TrainingVideo, UserVideoProgress, TrainingCategory };

export interface TrainingVideoWithProgress extends TrainingVideo {
  progress: UserVideoProgress | null;
}

export interface TrainingVideosByCategory {
  category: TrainingCategory;
  categoryLabel: string;
  videos: TrainingVideoWithProgress[];
}

export interface UserProgressSummary {
  totalVideos: number;
  completedVideos: number;
  progressPercentage: number;
}

/**
 * Human-readable labels for training categories
 */
export const CATEGORY_LABELS: Record<TrainingCategory, string> = {
  'getting-started': 'Getting Started',
  'dashboard-guide': 'Dashboard Guide',
  'video-creation': 'Video Creation',
  'lead-management': 'Lead Management',
  sequences: 'Sequences & Automation',
  'best-practices': 'Best Practices',
  advanced: 'Advanced',
};

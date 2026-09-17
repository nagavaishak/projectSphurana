import type { ContentItemWithAsset } from '../../types';

/**
 * The asset's render is still in flight (not yet terminal). `failed` is
 * terminal, so it does NOT count as rendering — otherwise a failed render
 * spins forever instead of offering a way out.
 */
export function assetIsRendering(item: ContentItemWithAsset): boolean {
  const status =
    item.kind === 'graphic' ? item.graphic?.status : item.video?.status;
  if (!status) return true; // hydration race — treat as rendering
  return status !== 'ready' && status !== 'failed';
}

export function assetHasFailed(item: ContentItemWithAsset): boolean {
  const status =
    item.kind === 'graphic' ? item.graphic?.status : item.video?.status;
  return status === 'failed';
}

/**
 * A short label for the rail. Falls back through caption → asset title →
 * position, because a queue entry with no label is unclickable in practice.
 */
export function itemLabel(item: ContentItemWithAsset, index: number): string {
  const caption = item.caption?.trim();
  if (caption) {
    const firstLine = caption.split('\n')[0]?.trim() ?? '';
    if (firstLine) {
      return firstLine.length > 48 ? `${firstLine.slice(0, 47)}…` : firstLine;
    }
  }
  const title =
    item.kind === 'graphic' ? item.graphic?.title : item.video?.title;
  return title?.trim() || `Post ${index + 1}`;
}

export type ItemDotState =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'rendering'
  | 'failed';

export function itemDotState(item: ContentItemWithAsset): ItemDotState {
  if (item.reviewStatus === 'accepted') return 'accepted';
  if (item.reviewStatus === 'rejected') return 'rejected';
  if (assetHasFailed(item)) return 'failed';
  if (assetIsRendering(item)) return 'rendering';
  return 'pending';
}

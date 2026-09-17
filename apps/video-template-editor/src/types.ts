import type { TemplateDoc } from '@borradh-workspace/video-templates';

// A NodePath addresses a sub-node of a TemplateDoc.
// Examples:
//   ['root']                             → the root region
//   ['root', 'overlays', 0]              → the first overlay of the leaf root
//   ['root', 'overlays', 0, 'placement'] → that overlay's placement field
//   ['globals', 'audio', 'music']        → the music slot
//
// Keys are kept as strings | numbers and consumed by node-path.ts helpers.
export type NodePath = ReadonlyArray<string | number>;

export type PatchUpdater<T = TemplateDoc> = (current: T) => T;

// Cross-pane events the toolbar / hotkeys emit, consumed by W-FpH.
export type EditorCommand =
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'save-json' }
  | { kind: 'load-json'; file: File }
  | { kind: 'reset' };

import type { AssetContentTypeTag } from '@borradh-workspace/labels';

// Slot<T> is a typed hole in a TemplateDoc. Synthesis resolves every query slot.
export type Slot<T> =
  | { source: 'fixed'; value: T }
  | { source: 'query'; query: SlotQuery; required: boolean };

export type SlotQuery =
  | {
      kind: 'asset-clips';
      tag: AssetContentTypeTag;
      count: [min: number, max: number];
    }
  | {
      kind: 'asset-media';
      tag: AssetContentTypeTag;
      mediaType: 'image' | 'video';
    }
  | {
      kind: 'script-text';
      role: 'hook' | 'body' | 'cta' | 'disclaimer' | 'list';
      index?: number;
    }
  | { kind: 'music'; mood?: string; bpm?: [number, number] }
  | {
      kind: 'brand';
      field: 'primaryColor' | 'logoUrl' | 'businessName' | 'tagline';
    };

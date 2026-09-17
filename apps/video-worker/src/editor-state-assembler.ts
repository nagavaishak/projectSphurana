/**
 * EditorStateAssembler — helper class that encapsulates the repetitive
 * asset → item → track pattern used when building an EditorState.
 */
import type {
  Asset,
  EditorState,
  Item,
  Track,
  VideoOrientation,
} from '@borradh-workspace/remotion';

export class EditorStateAssembler {
  private assets: Record<string, Asset> = {};
  private items: Record<string, Item> = {};
  private trackMap: Map<string, { name: string; itemIds: string[] }> =
    new Map();
  private nextId = 1;

  /** Register an asset, return its ID */
  addAsset(type: Asset['type'], src: string): string {
    const id = `asset-${this.nextId++}`;
    this.assets[id] = { id, type, src };
    return id;
  }

  /** Register an item on a track, return its ID */
  addItem(
    trackId: string,
    trackName: string,
    item: Omit<Item, 'id' | 'trackId'>
  ): string {
    const id = `item-${this.nextId++}`;
    this.items[id] = { ...item, id, trackId } as Item;

    if (!this.trackMap.has(trackId)) {
      this.trackMap.set(trackId, { name: trackName, itemIds: [] });
    }
    this.trackMap.get(trackId)?.itemIds.push(id);
    return id;
  }

  /** Build final EditorState (tracks ordered by insertion) */
  build(meta: {
    fps: number;
    durationInFrames: number;
    compositionWidth: number;
    compositionHeight: number;
    orientation: VideoOrientation;
  }): EditorState {
    const tracks: Track[] = [];
    for (const [id, { name, itemIds }] of this.trackMap) {
      tracks.push({ id, name, items: itemIds });
    }
    return {
      tracks,
      items: this.items,
      assets: this.assets,
      ...meta,
    };
  }
}

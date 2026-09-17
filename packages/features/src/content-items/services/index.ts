export * from './insert-slot/index.js';
export * from './load-slot/index.js';
export * from './record-attempt/index.js';
export * from './ensure-item-for-asset/index.js';
// A proposal is an item whose attempt 0 has no asset yet. That null is what
// lets a card in the transcript know it has already been acted on — the thing
// React state forgets on every remount.
export * from './open-content-proposal/index.js';
export * from './get-content-item-state/index.js';
export * from './attach-content-asset/index.js';
export * from './create-content-graphic/index.js';
// ONE create for both kinds, for the reason there is one revise: the item
// bookkeeping is identical and was previously written out per kind, in tools.
export * from './create-content/index.js';
// ONE revise for both kinds. The item bookkeeping — ensure, produce, record —
// is identical; only how the new cut is produced differs, and writing that
// skeleton out twice is how a rule kept landing on videos and not graphics.
export * from './revise-content/index.js';

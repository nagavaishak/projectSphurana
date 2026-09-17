import type { NodePath } from '../types';

// Stable string key for a NodePath. Used for React keys, Sets, etc.
// `['root', 'overlays', 0]` → `'root.overlays.0'`
export const pathKey = (p: NodePath): string => p.map(String).join('.');

// Walk into `root` following each segment of `path`. Returns `undefined`
// for any segment that doesn't exist. Supports plain objects and arrays.
export const getAtPath = (root: unknown, path: NodePath): unknown => {
  let cursor: unknown = root;
  for (const segment of path) {
    if (cursor === null || cursor === undefined) return undefined;
    if (Array.isArray(cursor)) {
      const idx = typeof segment === 'number' ? segment : Number(segment);
      if (!Number.isFinite(idx)) return undefined;
      cursor = cursor[idx];
      continue;
    }
    if (typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[String(segment)];
  }
  return cursor;
};

// Immutably set `value` at `path` inside `root`. Deep-clones along the
// path so existing references outside the path are preserved. The shape
// at each step is preserved: arrays stay arrays, objects stay objects.
// Path segments that point through `undefined`/`null` containers create
// a fresh container of the appropriate kind based on the *next* segment
// (numeric → array, otherwise → object).
export const setAtPath = <T>(root: T, path: NodePath, value: unknown): T => {
  if (path.length === 0) return value as T;

  const recurse = (current: unknown, depth: number): unknown => {
    if (depth === path.length) return value;
    const segment = path[depth];
    const nextSegment = path[depth + 1];
    const isCurrentArray = Array.isArray(current);
    const isCurrentObject =
      !isCurrentArray && current !== null && typeof current === 'object';

    if (isCurrentArray) {
      const arr = current as unknown[];
      const idx = typeof segment === 'number' ? segment : Number(segment);
      const child = recurse(arr[idx], depth + 1);
      const copy = arr.slice();
      copy[idx] = child;
      return copy;
    }

    if (isCurrentObject) {
      const obj = current as Record<string, unknown>;
      const key = String(segment);
      const child = recurse(obj[key], depth + 1);
      return { ...obj, [key]: child };
    }

    // Container doesn't exist yet — synthesize one based on the next segment.
    const nextIsIndex = typeof nextSegment === 'number';
    if (typeof segment === 'number') {
      const arr: unknown[] = [];
      arr[segment] = recurse(undefined, depth + 1);
      return arr;
    }
    if (nextIsIndex) {
      return { [String(segment)]: recurse(undefined, depth + 1) };
    }
    return { [String(segment)]: recurse(undefined, depth + 1) };
  };

  return recurse(root, 0) as T;
};

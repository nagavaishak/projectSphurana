// Media picker for Slot<MediaSource[]> or Slot<MediaSource>.
//
// Two ways to add media: paste a URL, or pick a local file (which we turn into
// a blob: URL via URL.createObjectURL). Local URLs are revoked on unmount to
// avoid leaks, and they don't persist across reloads — we warn about that
// inline so users aren't surprised when reload empties the picker.

import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { pathKey } from '../../lib/node-path.js';
import type { NodePath } from '../../types.js';

export interface MediaSource {
  url: string;
  mediaType: 'video' | 'image';
  trimStartFrames: number;
  naturalDurationFrames?: number;
}

export interface MediaPickerProps {
  value: MediaSource[] | MediaSource | undefined;
  onChange: (next: MediaSource[] | MediaSource) => void;
  /** If true, the slot value is a single MediaSource; otherwise a list. */
  single: boolean;
  path: NodePath;
}

function inferMediaType(filename: string): 'video' | 'image' {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  return ['mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv'].includes(ext)
    ? 'video'
    : 'image';
}

function isBlobUrl(url: string): boolean {
  return url.startsWith('blob:');
}

export const MediaPicker: React.FC<MediaPickerProps> = ({
  value,
  onChange,
  single,
  path,
}) => {
  const items: MediaSource[] = single
    ? value
      ? [value as MediaSource]
      : []
    : ((value as MediaSource[] | undefined) ?? []);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [urlDraft, setUrlDraft] = useState('');

  // Track blob URLs we created so we can revoke them on unmount.
  const ownedBlobUrls = useRef<Set<string>>(new Set());
  useEffect(() => {
    const owned = ownedBlobUrls.current;
    return () => {
      for (const url of owned) URL.revokeObjectURL(url);
      owned.clear();
    };
  }, []);

  const commit = (next: MediaSource[]) => {
    if (single) {
      // Keep only the last in single-mode.
      onChange(
        (next[next.length - 1] ?? {
          url: '',
          mediaType: 'image',
          trimStartFrames: 0,
        }) as MediaSource
      );
    } else {
      onChange(next);
    }
  };

  const appendFiles = (files: FileList | File[]) => {
    const added: MediaSource[] = [];
    for (const file of Array.from(files)) {
      const url = URL.createObjectURL(file);
      ownedBlobUrls.current.add(url);
      added.push({
        url,
        mediaType: inferMediaType(file.name),
        trimStartFrames: 0,
      });
    }
    if (added.length === 0) return;
    if (single) {
      // Replace.
      const replaced = added.slice(-1);
      commit(replaced);
    } else {
      commit([...items, ...added]);
    }
  };

  const appendUrl = () => {
    const trimmed = urlDraft.trim();
    if (!trimmed) return;
    const added: MediaSource = {
      url: trimmed,
      mediaType: inferMediaType(trimmed),
      trimStartFrames: 0,
    };
    if (single) {
      commit([added]);
    } else {
      commit([...items, added]);
    }
    setUrlDraft('');
  };

  const removeAt = (i: number) => {
    const target = items[i];
    if (
      target &&
      isBlobUrl(target.url) &&
      ownedBlobUrls.current.has(target.url)
    ) {
      URL.revokeObjectURL(target.url);
      ownedBlobUrls.current.delete(target.url);
    }
    const copy = items.slice();
    copy.splice(i, 1);
    commit(copy);
  };

  const updateAt = (i: number, patch: Partial<MediaSource>) => {
    const copy = items.slice();
    const current = copy[i];
    if (!current) return;
    copy[i] = { ...current, ...patch };
    commit(copy);
  };

  const hasBlobItems = items.some((it) => isBlobUrl(it.url));

  return (
    <div className="schema-form-slot-media">
      {items.length === 0 ? (
        <div className="schema-form-empty">
          No media yet — add a URL or file below.
        </div>
      ) : null}

      {items.map((item, i) => {
        const rowPath = single ? path : [...path, i];
        return (
          <div
            className="schema-form-array-row"
            key={`${item.url}-${i}`}
            data-path={pathKey(rowPath)}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  alignItems: 'center',
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    textTransform: 'uppercase',
                    padding: '1px 6px',
                    borderRadius: 3,
                    background: 'var(--bg-elev-2)',
                    color: 'var(--fg-muted)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {item.mediaType}
                </span>
                {isBlobUrl(item.url) ? (
                  <span
                    style={{
                      fontSize: 10,
                      color: 'var(--fg-muted)',
                    }}
                  >
                    (local)
                  </span>
                ) : null}
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                    fontSize: 11,
                    color: 'var(--fg-muted)',
                  }}
                  title={item.url}
                >
                  {item.url}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  alignItems: 'center',
                }}
              >
                <label
                  style={{
                    fontSize: 11,
                    color: 'var(--fg-muted)',
                  }}
                  htmlFor={pathKey([...rowPath, 'trimStartFrames'])}
                >
                  trim start (frames)
                </label>
                <input
                  id={pathKey([...rowPath, 'trimStartFrames'])}
                  type="number"
                  min={0}
                  style={{ width: 80 }}
                  value={item.trimStartFrames}
                  onChange={(e) =>
                    updateAt(i, {
                      trimStartFrames: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                />
                <select
                  value={item.mediaType}
                  onChange={(e) =>
                    updateAt(i, {
                      mediaType: e.target.value as 'image' | 'video',
                    })
                  }
                >
                  <option value="image">image</option>
                  <option value="video">video</option>
                </select>
              </div>
            </div>
            <button
              type="button"
              className="schema-form-array-remove"
              onClick={() => removeAt(i)}
            >
              remove
            </button>
          </div>
        );
      })}

      {hasBlobItems ? (
        <div
          style={{
            fontSize: 11,
            color: 'var(--fg-muted)',
            margin: '4px 0 8px',
          }}
        >
          Local files use blob: URLs and won't persist across reloads.
        </div>
      ) : null}

      <div
        style={{
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          marginTop: 6,
        }}
      >
        <input
          type="text"
          placeholder="paste URL…"
          value={urlDraft}
          style={{ flex: 1, minWidth: 0 }}
          onChange={(e) => setUrlDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              appendUrl();
            }
          }}
        />
        <button type="button" onClick={appendUrl}>
          {single ? 'set URL' : '+ url'}
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          {single ? 'pick file' : '+ file'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple={!single}
          hidden
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              appendFiles(e.target.files);
            }
            // Reset so the same file can be re-picked.
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
};

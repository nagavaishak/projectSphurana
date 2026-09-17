import type { TemplateDoc } from '@borradh-workspace/video-templates';
import { useEffect, useState } from 'react';

import {
  type LibraryEntry,
  deleteEntry,
  duplicateEntry,
  loadLibrary,
  saveEntry,
  subscribeLibrary,
  updateEntry,
} from '../lib/template-library';
import {
  closeLibraryPanel,
  useLibraryPanelOpen,
} from '../lib/use-library-panel';
import { useEditorStore } from '../state';

// ── Helpers ──────────────────────────────────────────────────────────

const countSpineItems = (doc: TemplateDoc): number => {
  let count = 0;
  const visit = (region: TemplateDoc['root']): void => {
    if (region.kind === 'leaf') {
      count += region.spine.length + region.overlays.length;
      return;
    }
    for (const child of region.children) visit(child.region);
  };
  visit(doc.root);
  return count;
};

const formatMusic = (doc: TemplateDoc): string => {
  const music = doc.globals.audio.music;
  if (!music) return 'none';
  if (music.source === 'fixed') return music.value.trackId;
  return `query:${music.query.kind}`;
};

const formatTimestamp = (ms: number): string => {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ms).toLocaleDateString();
};

// ── Styles ───────────────────────────────────────────────────────────

const overlayWrapStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'stretch',
  justifyContent: 'flex-end',
  zIndex: 1000,
  pointerEvents: 'none',
};

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  border: 0,
  padding: 0,
  cursor: 'pointer',
  zIndex: 1000,
  pointerEvents: 'auto',
};

const panelStyle: React.CSSProperties = {
  width: 420,
  maxWidth: '90vw',
  background: 'var(--bg, #1a1a1a)',
  color: 'var(--fg, #eee)',
  borderLeft: '1px solid var(--border, #333)',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '-4px 0 16px rgba(0, 0, 0, 0.3)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '12px 16px',
  borderBottom: '1px solid var(--border, #333)',
};

const buttonStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 12,
  background: 'var(--bg-elev, #2a2a2a)',
  color: 'var(--fg, #eee)',
  border: '1px solid var(--border, #444)',
  borderRadius: 4,
  cursor: 'pointer',
};

const smallButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  padding: '4px 8px',
  fontSize: 11,
};

const dangerButtonStyle: React.CSSProperties = {
  ...smallButtonStyle,
  borderColor: 'var(--border-danger, #5a2a2a)',
  color: 'var(--fg-danger, #f8a)',
};

const entryRowStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--border-soft, #2a2a2a)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-muted, #888)',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '4px 6px',
  fontSize: 13,
  background: 'var(--bg-input, #111)',
  color: 'var(--fg, #eee)',
  border: '1px solid var(--border, #444)',
  borderRadius: 3,
};

// ── Component ────────────────────────────────────────────────────────

export const LibraryPanel = (): React.ReactElement | null => {
  const open = useLibraryPanelOpen();
  const setDoc = useEditorStore((s) => s.setDoc);
  const [entries, setEntries] = useState<LibraryEntry[]>(() => loadLibrary());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  useEffect(() => {
    if (!open) return;
    // Refresh on open in case another tab wrote in the meantime.
    setEntries(loadLibrary());
    const unsubscribe = subscribeLibrary(setEntries);
    return unsubscribe;
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLibraryPanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const handleSaveCurrent = (): void => {
    const defaultName = useEditorStore.getState().doc.id || 'Untitled';
    const name = window.prompt('Name for this template:', defaultName);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    saveEntry(trimmed, useEditorStore.getState().doc);
  };

  const handleLoad = (entry: LibraryEntry): void => {
    setDoc(entry.doc);
  };

  const handleDelete = (entry: LibraryEntry): void => {
    if (!window.confirm(`Delete "${entry.name}"? This cannot be undone.`)) {
      return;
    }
    deleteEntry(entry.id);
  };

  const handleDuplicate = (entry: LibraryEntry): void => {
    duplicateEntry(entry.id);
  };

  const beginRename = (entry: LibraryEntry): void => {
    setRenamingId(entry.id);
    setRenameDraft(entry.name);
  };

  const commitRename = (): void => {
    if (!renamingId) return;
    const trimmed = renameDraft.trim();
    if (trimmed) updateEntry(renamingId, { name: trimmed });
    setRenamingId(null);
    setRenameDraft('');
  };

  const cancelRename = (): void => {
    setRenamingId(null);
    setRenameDraft('');
  };

  return (
    <>
      <button
        type="button"
        aria-label="Close library"
        onClick={closeLibraryPanel}
        style={backdropStyle}
      />
      <div style={overlayWrapStyle}>
        <aside
          role="dialog"
          aria-label="Template library"
          aria-modal="true"
          style={{ ...panelStyle, pointerEvents: 'auto' }}
        >
          <div style={headerStyle}>
            <strong style={{ fontSize: 14 }}>Template library</strong>
            <span style={{ ...subtitleStyle, marginLeft: 4 }}>
              {entries.length} saved
            </span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={handleSaveCurrent}
              style={buttonStyle}
            >
              Save current
            </button>
            <button
              type="button"
              onClick={closeLibraryPanel}
              aria-label="Close library"
              style={{ ...buttonStyle, padding: '4px 8px' }}
            >
              ×
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {entries.length === 0 ? (
              <div
                style={{
                  padding: 24,
                  textAlign: 'center',
                  color: 'var(--fg-muted, #888)',
                  fontSize: 13,
                }}
              >
                No saved templates yet. Click "Save current" to add one.
              </div>
            ) : (
              entries.map((entry) => {
                const items = countSpineItems(entry.doc);
                const music = formatMusic(entry.doc);
                const isRenaming = renamingId === entry.id;
                return (
                  <div key={entry.id} style={entryRowStyle}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      {isRenaming ? (
                        <>
                          <input
                            // biome-ignore lint/a11y/noAutofocus: rename UX
                            autoFocus
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename();
                              else if (e.key === 'Escape') cancelRename();
                            }}
                            style={inputStyle}
                          />
                          <button
                            type="button"
                            onClick={commitRename}
                            style={smallButtonStyle}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelRename}
                            style={smallButtonStyle}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <strong style={{ fontSize: 13, flex: 1 }}>
                            {entry.name}
                          </strong>
                          <button
                            type="button"
                            onClick={() => handleLoad(entry)}
                            style={smallButtonStyle}
                          >
                            Load
                          </button>
                          <button
                            type="button"
                            onClick={() => beginRename(entry)}
                            style={smallButtonStyle}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDuplicate(entry)}
                            style={smallButtonStyle}
                          >
                            Duplicate
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(entry)}
                            style={dangerButtonStyle}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                    <div style={subtitleStyle}>
                      {items} items, music: {music}
                    </div>
                    <div style={subtitleStyle}>
                      saved {formatTimestamp(entry.updatedAt)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      </div>
    </>
  );
};

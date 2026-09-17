import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import {
  downloadDocAsJson,
  getLastSavedAt,
  loadDocFromFile,
} from '../persistence';
import { useEditorStore } from '../state';
import { canRedo, canUndo, redo, undo } from '../undo';
import { LibraryButton } from './library-button';
import { SamplePicker } from './sample-picker';

// Toolbar — sits inside or above the preview pane. The parent decides where
// to mount it. All actions go through the existing store + undo/persistence
// modules; the toolbar itself has no business logic.
export const Toolbar = () => {
  const doc = useEditorStore((s) => s.doc);
  const setDoc = useEditorStore((s) => s.setDoc);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Re-render on doc changes so undo/redo button enabled-state and the
  // saved-indicator stay in sync. The doc subscription above already covers
  // most cases; this tick keeps the timestamp fresh while idle.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, []);

  const handleSave = () => {
    downloadDocAsJson(doc);
  };

  const handleLoadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so the same file can be re-selected.
    e.target.value = '';
    if (!file) return;
    try {
      const loaded = await loadDocFromFile(file);
      setDoc(loaded);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-alert
      window.alert(`Failed to load template:\n\n${msg}`);
    }
  };

  const lastSavedAt = getLastSavedAt();
  const isSaved = lastSavedAt > 0 && Date.now() - lastSavedAt <= 1500;

  const buttonStyle: React.CSSProperties = {
    padding: '6px 10px',
    fontSize: 12,
    background: 'var(--bg-elev, #2a2a2a)',
    color: 'var(--fg, #eee)',
    border: '1px solid var(--border, #444)',
    borderRadius: 4,
    cursor: 'pointer',
  };
  const disabledStyle: React.CSSProperties = {
    ...buttonStyle,
    opacity: 0.4,
    cursor: 'not-allowed',
  };

  const undoOk = canUndo();
  const redoOk = canRedo();

  return (
    <div
      role="toolbar"
      aria-label="Editor toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderBottom: '1px solid var(--border, #333)',
        background: 'var(--bg-toolbar, #1c1c1c)',
        boxShadow: '0 2px 6px rgba(0, 0, 0, 0.35)',
      }}
    >
      <button type="button" onClick={handleSave} style={buttonStyle}>
        Save
      </button>
      <button type="button" onClick={handleLoadClick} style={buttonStyle}>
        Load
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      <span
        style={{ width: 1, height: 18, background: 'var(--border, #333)' }}
      />

      <button
        type="button"
        onClick={undo}
        disabled={!undoOk}
        style={undoOk ? buttonStyle : disabledStyle}
        title="Undo (cmd/ctrl-z)"
      >
        Undo
      </button>
      <button
        type="button"
        onClick={redo}
        disabled={!redoOk}
        style={redoOk ? buttonStyle : disabledStyle}
        title="Redo (cmd/ctrl-shift-z)"
      >
        Redo
      </button>

      <span
        style={{ width: 1, height: 18, background: 'var(--border, #333)' }}
      />

      <SamplePicker />

      <span
        style={{ width: 1, height: 18, background: 'var(--border, #333)' }}
      />

      <LibraryButton />

      <span style={{ flex: 1 }} />

      <span
        aria-live="polite"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          color: isSaved ? 'var(--fg-muted, #888)' : 'var(--fg-warn, #d4a017)',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: isSaved ? 'var(--ok, #4ade80)' : 'var(--warn, #d4a017)',
            display: 'inline-block',
          }}
        />
        {isSaved ? 'Saved' : 'Unsaved'}
      </span>
    </div>
  );
};

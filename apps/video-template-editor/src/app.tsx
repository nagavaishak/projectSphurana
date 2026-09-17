import { useEffect } from 'react';
import { Toolbar } from './components/toolbar';
import { ValidationBanner } from './components/validation-banner';
import { installAppHotkeys } from './lib/hotkeys';
import { useResizableColumns } from './lib/resizable-columns';
import { InspectorPane } from './panes/inspector-pane';
import { LibraryPanel } from './panes/library-panel';
import { OutlinePane } from './panes/outline-pane';
import { PreviewPane } from './panes/preview-pane';
import { TimelinePane } from './panes/timeline-pane';
import { installAutosave, loadInitialDoc } from './persistence';
import { useEditorStore } from './state';
import { installUndoHotkeys, installUndoStack } from './undo';

export const App = () => {
  const { widths, outlineHandle, inspectorHandle } = useResizableColumns();

  // One-shot: restore any autosaved doc on mount, then install subscribers.
  // Order matters — load BEFORE installing the undo stack so the restored
  // state doesn't land on the history as an undoable push.
  useEffect(() => {
    const initialDoc = loadInitialDoc(useEditorStore.getState().doc);
    useEditorStore.getState().setDoc(initialDoc);

    const stops = [
      installUndoStack(),
      installAutosave(),
      installUndoHotkeys(),
      installAppHotkeys(),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, []);

  // Build the grid template directly from the resizable widths so the divs
  // collapse instead of overflowing when the user shrinks a column.
  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: `${widths.outline}px 4px 1fr 4px ${widths.inspector}px`,
  };

  return (
    <div className="editor-shell" style={gridStyle}>
      <section className="pane pane-outline">
        <OutlinePane />
      </section>

      <div
        className="column-resizer"
        onPointerDown={outlineHandle.onPointerDown}
      />

      <section className="pane pane-preview">
        <Toolbar />
        <ValidationBanner />
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            minHeight: 0,
          }}
        >
          <PreviewPane />
        </div>
      </section>

      <div
        className="column-resizer"
        onPointerDown={inspectorHandle.onPointerDown}
      />

      <section className="pane pane-inspector">
        <InspectorPane />
      </section>

      <section className="pane pane-timeline">
        <TimelinePane />
      </section>

      <LibraryPanel />
    </div>
  );
};

import { useEffect, useState } from 'react';

import { loadLibrary, subscribeLibrary } from '../lib/template-library';
import {
  toggleLibraryPanel,
  useLibraryPanelOpen,
} from '../lib/use-library-panel';

const buttonStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 12,
  background: 'var(--bg-elev, #2a2a2a)',
  color: 'var(--fg, #eee)',
  border: '1px solid var(--border, #444)',
  borderRadius: 4,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

const activeButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: 'var(--bg-active, #3a3a3a)',
  borderColor: 'var(--border-active, #666)',
};

const badgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 16,
  height: 16,
  padding: '0 4px',
  fontSize: 10,
  borderRadius: 8,
  background: 'var(--badge-bg, #444)',
  color: 'var(--fg, #eee)',
};

export const LibraryButton = (): React.ReactElement => {
  const open = useLibraryPanelOpen();
  const [count, setCount] = useState<number>(() => loadLibrary().length);

  useEffect(() => {
    setCount(loadLibrary().length);
    const unsubscribe = subscribeLibrary((entries) => setCount(entries.length));
    return unsubscribe;
  }, []);

  return (
    <button
      type="button"
      onClick={toggleLibraryPanel}
      style={open ? activeButtonStyle : buttonStyle}
      aria-pressed={open}
      aria-label={`Library (${count} saved)`}
      title="Saved templates"
    >
      Library
      {count > 0 ? <span style={badgeStyle}>{count}</span> : null}
    </button>
  );
};

import { useEffect, useState } from 'react';
import { useEditorStore } from '../state';

// Banner rendered between the toolbar and the player when the store has a
// non-null `error`. The dismiss button just hides the banner locally; the
// underlying error clears on its own once the doc validates again.
//
// We track the dismissed message so a *new* error (different string) re-shows
// the banner even if the user dismissed a prior one.
export const ValidationBanner = () => {
  const error = useEditorStore((s) => s.error);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    if (error === null) setDismissed(null);
  }, [error]);

  if (!error) return null;
  if (dismissed === error) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="validation-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        background: 'rgba(255, 106, 106, 0.12)',
        borderBottom: '1px solid var(--error, #ff6a6a)',
        color: 'var(--error, #ff6a6a)',
        fontSize: 12,
      }}
    >
      <span aria-hidden style={{ fontWeight: 700 }}>
        !
      </span>
      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={error}
      >
        {error}
      </span>
      <button
        type="button"
        onClick={() => setDismissed(error)}
        aria-label="Dismiss"
        style={{
          background: 'transparent',
          border: '1px solid currentColor',
          color: 'inherit',
          borderRadius: 4,
          padding: '2px 8px',
          fontSize: 11,
          cursor: 'pointer',
        }}
      >
        Dismiss
      </button>
    </div>
  );
};

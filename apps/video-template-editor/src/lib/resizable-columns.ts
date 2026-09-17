import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

// Persists the user's column widths across reloads. Keyed with `:v1` so a
// shape change can bump the key without honouring stale values.
const STORAGE_KEY = 'editor:column-widths:v1';

export interface ColumnWidths {
  outline: number; // px
  inspector: number; // px
}

const DEFAULTS: ColumnWidths = { outline: 260, inspector: 340 };
const MIN_WIDTH = 160;
const MAX_WIDTH = 640;

const clamp = (value: number): number =>
  Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, value));

const loadFromStorage = (): ColumnWidths => {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as Record<string, unknown>).outline === 'number' &&
      typeof (parsed as Record<string, unknown>).inspector === 'number'
    ) {
      const p = parsed as ColumnWidths;
      return { outline: clamp(p.outline), inspector: clamp(p.inspector) };
    }
  } catch {
    // ignore malformed storage
  }
  return DEFAULTS;
};

const saveToStorage = (widths: ColumnWidths): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  } catch {
    // quota/private mode — ignore
  }
};

export type ResizeHandlers = {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
};

export interface UseResizableColumnsResult {
  widths: ColumnWidths;
  // Handlers for the outline ↔ preview divider; drags adjust `outline`.
  outlineHandle: ResizeHandlers;
  // Handlers for the preview ↔ inspector divider; drags adjust `inspector`.
  inspectorHandle: ResizeHandlers;
  reset: () => void;
}

/**
 * Hook that yields drag handlers for the two vertical separators in the
 * 3-column editor shell (outline | preview | inspector). Widths are stored in
 * localStorage so they persist across reloads. Returns current widths plus
 * `onPointerDown` callbacks suitable for the resizer divs.
 *
 * Stupid by design: no library, just pointer events on the window during a
 * drag and a single state update on pointer-up. No layout effects — the
 * caller is expected to use the returned widths in a `grid-template-columns`
 * inline style (or equivalent).
 */
export const useResizableColumns = (): UseResizableColumnsResult => {
  const [widths, setWidths] = useState<ColumnWidths>(() => loadFromStorage());
  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  // Persist on change (skipped on initial mount since we just loaded it).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    saveToStorage(widths);
  }, [widths]);

  const makeHandle = useCallback(
    (which: 'outline' | 'inspector'): ResizeHandlers => ({
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = widthsRef.current[which];

        const onMove = (ev: PointerEvent) => {
          const dx = ev.clientX - startX;
          // Outline grows when the divider moves right; inspector grows when
          // it moves left.
          const next =
            which === 'outline'
              ? clamp(startWidth + dx)
              : clamp(startWidth - dx);
          setWidths((prev) =>
            prev[which] === next ? prev : { ...prev, [which]: next }
          );
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
        };

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      },
    }),
    []
  );

  const outlineHandle = makeHandle('outline');
  const inspectorHandle = makeHandle('inspector');

  const reset = useCallback(() => setWidths(DEFAULTS), []);

  return { widths, outlineHandle, inspectorHandle, reset };
};

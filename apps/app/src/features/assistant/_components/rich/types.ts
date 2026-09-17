/**
 * Shared shapes for generic chat-rendering primitives.
 *
 * Any tool whose `output` matches one of these shapes will be rendered by
 * the corresponding primitive (`CreatingStatus` / `CreatedCard`) via the
 * generic dispatch in `tool-renderer.tsx`, with no need to add a tool-specific
 * case.
 *
 * Tools opt in by returning data of this shape from the server-side tool
 * implementation. See `creating-status.tsx` and `created-card.tsx` for the
 * matching renderers.
 */

/** Indeterminate "kick-off" status tile (spinner + label + optional detail). */
export interface CreatingState {
  uiState: 'creating';
  label: string;
  detail?: string;
}

/** Action a `CreatedCard` button can perform when clicked. */
export type CreatedAction =
  | {
      /** Submit `text` as a new user message in the chat. */
      type: 'prompt';
      text: string;
    }
  | {
      /** Open `url` in a new tab. */
      type: 'href';
      url: string;
    };

/** Button shown on a `CreatedCard`. */
export interface CreatedActionButton {
  label: string;
  intent?: 'primary' | 'secondary' | 'destructive';
  action: CreatedAction;
}

/** Definition-list-style field rendered inside a `CreatedCard`. */
export interface CreatedField {
  label: string;
  value: string;
}

/**
 * Result card variants.
 *   - 'created' (default): green check icon — "this was created".
 *   - 'preview':           magnifying-glass icon — "this is what I'd do; you
 *                          haven't approved yet". Used by `previewCampaign`
 *                          so the resolved defaults render as a persistent
 *                          card the operator can read after a refresh.
 */
export type CreatedVariant = 'created' | 'preview';

/** Success / preview card (icon + title + key/value fields + actions). */
export interface CreatedState {
  uiState: 'created';
  /** Defaults to 'created' when omitted, so older tool outputs keep working. */
  variant?: CreatedVariant;
  title: string;
  fields: CreatedField[];
  actions?: CreatedActionButton[];
}

/** Narrow an arbitrary tool output to a `CreatingState`. */
export function isCreatingState(value: unknown): value is CreatingState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.uiState === 'creating' && typeof v.label === 'string';
}

/** Narrow an arbitrary tool output to a `CreatedState`. */
export function isCreatedState(value: unknown): value is CreatedState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.uiState === 'created' &&
    typeof v.title === 'string' &&
    Array.isArray(v.fields)
  );
}

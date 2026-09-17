import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

export interface OpenArtifact {
  kind: 'video' | 'graphic';
  id: string;
  /**
   * The content item this asset belongs to, when the opener knows it.
   *
   * The panel's Save / Schedule / Reject act on the ITEM — the decision is
   * about the post, not the file — so without this the panel can show content
   * but not decide on it. Optional because a caller may only have an asset id;
   * the actions are simply absent there rather than guessed at.
   */
  itemId?: string;
}

interface ArtifactPanelValue {
  /** What the panel is showing, or null when it is closed. */
  artifact: OpenArtifact | null;
  openArtifact: (artifact: OpenArtifact) => void;
  close: () => void;
}

const ArtifactPanelContext = createContext<ArtifactPanelValue | null>(null);

/**
 * The side panel a finished render opens into.
 *
 * WHY A CONTEXT rather than state on the chat view. The thing that knows a
 * render has finished is a card buried several levels down in a message list,
 * and the thing that has to react is the page layout. Threading a callback
 * from the route through `MessageList` → `ToolRenderer` → the card would put a
 * prop about panel layout on every component in between, none of which have
 * any business knowing the panel exists.
 *
 * It holds a KIND and an ID and nothing else. The panel fetches its own state,
 * so a card that starts a render hands over an identity and forgets about it —
 * which matters because the render outlives the turn that started it, and
 * often the card too.
 *
 * `kind` is carried rather than inferred from the id: a video and a graphic are
 * different endpoints and different players, and asking the panel to guess
 * which it has from a uuid would be a lookup with a wrong answer available.
 */
export function ArtifactPanelProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [artifact, setArtifact] = useState<OpenArtifact | null>(null);

  const openArtifact = useCallback(
    (next: OpenArtifact) => setArtifact(next),
    []
  );
  const close = useCallback(() => setArtifact(null), []);

  const value = useMemo(
    () => ({ artifact, openArtifact, close }),
    [artifact, openArtifact, close]
  );

  return (
    <ArtifactPanelContext.Provider value={value}>
      {children}
    </ArtifactPanelContext.Provider>
  );
}

/**
 * Open the side panel on a finished render.
 *
 * Returns a no-op outside a provider ON PURPOSE. The same cards render in the
 * batch review workspace and in the compact mobile sheet, neither of which has
 * a side panel — and a card that threw because of where it was mounted would
 * be a worse failure than one that quietly does not open a panel that does not
 * exist.
 */
export function useHasArtifactPanel(): boolean {
  return useContext(ArtifactPanelContext) !== null;
}

/**
 * Whether a provider already exists above this point.
 *
 * The chat mounts its own provider so it works standalone, but the review page
 * needs one ABOVE both the chat and the panel — its queue opens artifacts, and
 * a provider nested inside the chat would be invisible to it. Two providers
 * would leave the queue writing to one and the panel reading the other.
 */
export function useArtifactPanel(): ArtifactPanelValue {
  const ctx = useContext(ArtifactPanelContext);
  return (
    ctx ?? {
      artifact: null,
      openArtifact: () => undefined,
      close: () => undefined,
    }
  );
}

/**
 * Hand-off from the home-screen prompt into the assistant.
 *
 * The home prompt is a launcher, not a chat surface — on submit it stashes the
 * draft text + any picked files here, then navigates to
 * `/assistant?new=1&handoff=<token>`. The assistant route reads the entry back
 * out using the token from its own URL.
 *
 * Why a token instead of a single "consume once on mount" slot: the assistant
 * page is not guaranteed to mount exactly once per navigation. `_authed` swaps
 * the whole chrome (`<Outlet/>` → `<AssistantProductLayout/>`) when the
 * pathname changes, the `/assistant` chunk is fetched lazily on a cold session,
 * and React may discard a render before it commits. Any of those can run the
 * page's render phase more than once, and a store that cleared itself on the
 * first read would hand the draft to a pass that never survived — the user
 * landed in an empty composer and had to retype their message.
 *
 * So reads here are **idempotent**: the entry stays put until the message has
 * actually been dispatched (`clearAssistantHandoff`, called once a conversation
 * exists). Keying by token is what makes that safe — a stale entry can only be
 * revived by the exact URL that carries its token.
 *
 * The draft is mirrored into `sessionStorage` so it also survives a full page
 * reload. `File` objects can't be serialised, so they live in the module map
 * only — a reload drops attachments but keeps the text, which is the strictly
 * better half to save.
 */
export interface PendingAssistantHandoff {
  draft?: string;
  files?: File[];
}

const STORAGE_PREFIX = 'claire-handoff:';

/** Token → entry. Holds the `File` objects, which can't go in storage. */
const entries = new Map<string, PendingAssistantHandoff>();

function storageKey(token: string): string {
  return `${STORAGE_PREFIX}${token}`;
}

/**
 * `sessionStorage` throws outright in some embedded webviews and in Safari's
 * private mode. It is a nice-to-have here (reload survival), never the primary
 * store, so every access is best-effort.
 */
function safeStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Drop every entry except `keep` so abandoned drafts can't accumulate. */
function pruneExcept(keep: string): void {
  for (const token of entries.keys()) {
    if (token !== keep) entries.delete(token);
  }
  const storage = safeStorage();
  if (!storage) return;
  try {
    const stale: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(STORAGE_PREFIX) && key !== storageKey(keep)) {
        stale.push(key);
      }
    }
    for (const key of stale) storage.removeItem(key);
  } catch {
    // Storage unavailable — the module map above is already pruned.
  }
}

function newToken(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Stashes a hand-off and returns the token to put in the `/assistant` URL.
 * Supersedes any previous hand-off.
 */
export function createAssistantHandoff(
  handoff: PendingAssistantHandoff
): string {
  const token = newToken();
  entries.set(token, handoff);
  pruneExcept(token);

  if (handoff.draft) {
    try {
      safeStorage()?.setItem(storageKey(token), handoff.draft);
    } catch {
      // Quota or private mode — the module map still has it for this session.
    }
  }
  return token;
}

/**
 * Reads the hand-off for `token` without clearing it. Safe to call during
 * render and on every re-mount — repeated reads return the same entry.
 */
export function readAssistantHandoff(
  token: string | undefined
): PendingAssistantHandoff | null {
  if (!token) return null;

  const entry = entries.get(token);
  if (entry) return entry;

  // Survived a reload: the files are gone with the old JS realm, but the text
  // is still in storage.
  let draft: string | null = null;
  try {
    draft = safeStorage()?.getItem(storageKey(token)) ?? null;
  } catch {
    draft = null;
  }
  if (!draft) return null;

  const restored: PendingAssistantHandoff = { draft };
  entries.set(token, restored);
  return restored;
}

/**
 * Releases a hand-off once its message has actually been dispatched. Called
 * when the conversation exists — before that point the entry has to stay
 * readable so a re-mount can still pick it up.
 */
export function clearAssistantHandoff(token: string | undefined): void {
  if (!token) return;
  entries.delete(token);
  try {
    safeStorage()?.removeItem(storageKey(token));
  } catch {
    // Nothing to do — the module map is already clear.
  }
}

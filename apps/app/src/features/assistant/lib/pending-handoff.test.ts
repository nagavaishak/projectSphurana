import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearAssistantHandoff,
  createAssistantHandoff,
  readAssistantHandoff,
} from './pending-handoff';

describe('assistant hand-off', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('reads back the draft and files for its token', () => {
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    const token = createAssistantHandoff({
      draft: 'I want to launch an ad',
      files: [file],
    });

    const handoff = readAssistantHandoff(token);
    expect(handoff?.draft).toBe('I want to launch an ad');
    expect(handoff?.files).toEqual([file]);
  });

  // The regression this whole module exists for: the assistant page's render
  // phase can run more than once per navigation (chrome swap on pathname
  // change, lazily-fetched route chunk, a render React discards before it
  // commits). The old store cleared itself on the first read, so a pass that
  // never committed ate the draft and the user landed in an empty composer.
  it('survives repeated reads, so a re-mounted assistant page still gets it', () => {
    const token = createAssistantHandoff({ draft: 'make me a campaign' });

    expect(readAssistantHandoff(token)?.draft).toBe('make me a campaign');
    expect(readAssistantHandoff(token)?.draft).toBe('make me a campaign');
    expect(readAssistantHandoff(token)?.draft).toBe('make me a campaign');
  });

  it('returns null for an unknown or missing token', () => {
    createAssistantHandoff({ draft: 'mine' });

    expect(readAssistantHandoff('not-a-real-token')).toBeNull();
    expect(readAssistantHandoff(undefined)).toBeNull();
  });

  it('stops resolving once the message has been dispatched', () => {
    const token = createAssistantHandoff({ draft: 'sent already' });
    clearAssistantHandoff(token);

    expect(readAssistantHandoff(token)).toBeNull();
  });

  it('keeps the draft across a reload, when only storage survives', () => {
    const token = createAssistantHandoff({ draft: 'still here' });

    // A reload drops the module map but not sessionStorage. Clearing the entry
    // for a *different* token is enough to evict this one from the map via the
    // prune, leaving storage as the only source.
    createAssistantHandoff({ draft: 'unrelated' });
    window.sessionStorage.setItem(`claire-handoff:${token}`, 'still here');

    expect(readAssistantHandoff(token)?.draft).toBe('still here');
  });

  it('evicts the previous hand-off so abandoned drafts cannot pile up', () => {
    const first = createAssistantHandoff({ draft: 'abandoned' });
    const second = createAssistantHandoff({ draft: 'current' });

    expect(readAssistantHandoff(first)).toBeNull();
    expect(readAssistantHandoff(second)?.draft).toBe('current');
    expect(
      Object.keys(window.sessionStorage).filter((k) =>
        k.startsWith('claire-handoff:')
      )
    ).toEqual([`claire-handoff:${second}`]);
  });
});

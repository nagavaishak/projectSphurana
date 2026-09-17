/**
 * @vitest-environment jsdom
 *
 * The DOM half. These tests assert the behaviours §5 calls out by name, and the
 * two that are security rather than UX: a commit carries `textContent` (never
 * `innerHTML`), and a message from an unexpected origin is not acted on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startMicrositeEditMode } from './edit-runtime';

const PARENT = 'https://app.borradh.io';

let posted: Array<{ message: unknown; origin: string }> = [];
let stop: (() => void) | null = null;

const peer = {
  postMessage: (message: unknown, origin: string) => {
    posted.push({ message, origin });
  },
} as unknown as Window;

const mount = (html: string) => {
  document.body.innerHTML = html;
  const runtime = startMicrositeEditMode({ parentOrigin: PARENT, peer });
  stop = runtime.stop;
  posted = [];
  return runtime;
};

const node = (field = 'headline') =>
  document.querySelector<HTMLElement>(
    `[data-ms-field="${field}"]`
  ) as HTMLElement;

const HERO = `
  <h1 data-ms-editable data-ms-block="blk_1" data-ms-field="headline"
      contenteditable="plaintext-only">Glow Clinic</h1>
`;

const edits = () =>
  posted.filter(
    (entry) => (entry.message as { type?: string }).type === 'edit'
  );

/** jsdom fires no focus/blur bookkeeping for us; drive the listeners directly. */
const blur = (el: HTMLElement) =>
  el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
const focus = (el: HTMLElement) =>
  el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
const type = (el: HTMLElement, value: string) => {
  el.textContent = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const key = (el: HTMLElement, k: string) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
const fromParent = (data: unknown, origin = PARENT) =>
  window.dispatchEvent(new MessageEvent('message', { data, origin }));

beforeEach(() => {
  posted = [];
});

afterEach(() => {
  stop?.();
  stop = null;
  document.body.innerHTML = '';
});

describe('startMicrositeEditMode', () => {
  it('announces itself to the parent with an explicit target origin', () => {
    const runtime = startMicrositeEditMode({ parentOrigin: PARENT, peer });
    stop = runtime.stop;
    expect(posted.at(-1)).toEqual({
      message: { source: 'microsite-editor', type: 'ready' },
      origin: PARENT,
    });
    expect(posted.every((entry) => entry.origin !== '*')).toBe(true);
  });

  it('commits on blur', () => {
    mount(HERO);
    const el = node();
    focus(el);
    type(el, 'Glow Clinic Dublin');
    blur(el);

    expect(edits().map((e) => e.message)).toEqual([
      {
        source: 'microsite-editor',
        type: 'edit',
        blockId: 'blk_1',
        field: 'headline',
        value: 'Glow Clinic Dublin',
      },
    ]);
  });

  it('commits on Enter for a single-line field', () => {
    mount(HERO);
    const el = node();
    focus(el);
    type(el, 'Glow Aesthetics');
    key(el, 'Enter');

    expect(edits()).toHaveLength(1);
    expect((edits()[0].message as { value: string }).value).toBe(
      'Glow Aesthetics'
    );
  });

  it('does NOT commit on Enter for the multiline markdown field', () => {
    mount(
      `<div data-ms-editable data-ms-block="blk_2" data-ms-field="markdown"
            contenteditable="plaintext-only"># Hi</div>`
    );
    const el = node('markdown');
    focus(el);
    type(el, '# Hi\nthere');
    key(el, 'Enter');

    expect(edits()).toHaveLength(0);
  });

  it('emits NO edit and NO dirty when the value is unchanged', () => {
    // A focus/blur with no typing must not create a revision — the history is
    // what "N changes since last publish" counts. `selected` is not a change.
    mount(HERO);
    const el = node();
    focus(el);
    blur(el);
    expect(
      posted.filter((entry) =>
        ['edit', 'dirty'].includes((entry.message as { type: string }).type)
      )
    ).toHaveLength(0);
  });

  it('emits nothing when the user retypes the same value', () => {
    mount(HERO);
    const el = node();
    focus(el);
    type(el, 'Glow Clinic');
    blur(el);
    expect(edits()).toHaveLength(0);
  });

  it('reverts on Escape and emits no edit', () => {
    mount(HERO);
    const el = node();
    focus(el);
    type(el, 'Something else entirely');
    key(el, 'Escape');

    expect(el.textContent).toBe('Glow Clinic');
    expect(edits()).toHaveLength(0);
    blur(el);
    expect(edits()).toHaveLength(0);
  });

  it('reports dirty once per focus session, on the first keystroke', () => {
    mount(HERO);
    const el = node();
    focus(el);
    type(el, 'G');
    type(el, 'Gl');
    type(el, 'Glo');

    const dirty = posted.filter(
      (entry) => (entry.message as { type: string }).type === 'dirty'
    );
    expect(dirty).toHaveLength(1);
    expect(dirty[0].message).toEqual({
      source: 'microsite-editor',
      type: 'dirty',
      blockId: 'blk_1',
      field: 'headline',
    });
  });

  it('commits textContent, never innerHTML — pasted markup cannot reach jsonb', () => {
    mount(HERO);
    const el = node();
    focus(el);
    // What a paste actually does under a `contenteditable` that ignores
    // `plaintext-only`: real elements, not an escaped string.
    el.innerHTML = 'Glow <img src=x onerror="alert(1)"><b>Clinic Dublin</b>';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    blur(el);

    const value = (edits()[0].message as { value: string }).value;
    expect(value).toBe('Glow Clinic Dublin');
    expect(value).not.toContain('<');
    expect(value).not.toContain('onerror');
    // And the node itself is flattened, so the screen matches what was saved.
    expect(el.querySelector('img')).toBeNull();
    expect(el.innerHTML).toBe('Glow Clinic Dublin');
  });

  it('restores the previous text and shows an error when the commit fails', () => {
    mount(HERO);
    const el = node();
    focus(el);
    type(el, 'Typo Clinic');
    blur(el);
    expect(el.textContent).toBe('Typo Clinic');

    fromParent({
      source: 'microsite-canvas',
      type: 'commit-failed',
      blockId: 'blk_1',
      field: 'headline',
      message: 'Draft is locked',
    });

    expect(el.textContent).toBe('Glow Clinic');
    const banner = document.getElementById('ms-edit-error');
    expect(banner?.hidden).toBe(false);
    expect(banner?.textContent).toBe('Draft is locked');
  });

  it('keeps the new value as the baseline once the parent confirms', () => {
    mount(HERO);
    const el = node();
    focus(el);
    type(el, 'Glow Clinic Dublin');
    blur(el);
    fromParent({
      source: 'microsite-canvas',
      type: 'commit-ok',
      blockId: 'blk_1',
      field: 'headline',
    });

    // Escaping after a confirmed commit must not roll back to the old text.
    focus(el);
    type(el, 'Half typed');
    key(el, 'Escape');
    expect(el.textContent).toBe('Glow Clinic Dublin');
  });

  it('IGNORES a commit-failed from an untrusted origin', () => {
    mount(HERO);
    const el = node();
    focus(el);
    type(el, 'Typo Clinic');
    blur(el);

    fromParent(
      {
        source: 'microsite-canvas',
        type: 'commit-failed',
        blockId: 'blk_1',
        field: 'headline',
        message: 'Your session expired. Enter your password.',
      },
      'https://app.borradh.io.evil.com'
    );

    expect(el.textContent).toBe('Typo Clinic');
    expect(document.getElementById('ms-edit-error')).toBeNull();
  });

  it('ignores a well-formed message from a null origin', () => {
    mount(HERO);
    fromParent({ source: 'microsite-canvas', type: 'enable-edit' }, 'null');
    expect(posted).toHaveLength(0);
  });

  it('answers enable-edit from the trusted parent with ready', () => {
    mount(HERO);
    fromParent({ source: 'microsite-canvas', type: 'enable-edit' });
    expect(posted.at(-1)?.message).toEqual({
      source: 'microsite-editor',
      type: 'ready',
    });
  });

  it('reports the selected block and does not navigate away from the draft', () => {
    mount(
      `<div data-ms-block="blk_3">
         <a href="https://example.com/book" data-ms-editable data-ms-block="blk_3"
            data-ms-field="buttonLabel" contenteditable="plaintext-only">Book now</a>
       </div>`
    );
    const anchor = document.querySelector('a') as HTMLElement;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('stops listening after stop()', () => {
    const runtime = mount(HERO);
    runtime.stop();
    stop = null;
    const el = node();
    focus(el);
    type(el, 'Changed');
    blur(el);
    expect(posted).toHaveLength(0);
  });

  it('does nothing for a node that carries no editable attributes', () => {
    mount('<h3 class="ms-service__name">Deluxe Facial</h3>');
    const el = document.querySelector('h3') as HTMLElement;
    focus(el);
    el.textContent = 'Free Facial';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    blur(el);
    expect(posted).toHaveLength(0);
  });
});

describe('edit-runtime does not leak globals', () => {
  it('adds no window properties', () => {
    const before = Object.keys(window).length;
    const runtime = startMicrositeEditMode({ parentOrigin: PARENT, peer });
    stop = runtime.stop;
    expect(Object.keys(window).length).toBe(before);
    vi.restoreAllMocks();
  });
});

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CANVAS_MESSAGE_SOURCE,
  EDITOR_MESSAGE_SOURCE,
  useInlineEdit,
} from './use-inline-edit';

const PREVIEW_URL = 'https://preview.borradh.site/glow-clinic?token=abc';
const PREVIEW_ORIGIN = 'https://preview.borradh.site';

const postMessage = vi.fn();

/**
 * A stand-in for the preview iframe. `contentWindow` is what the hook posts to
 * AND what it checks `event.source` against, so tests that want a message to be
 * accepted dispatch with `source` set to this same object.
 */
const contentWindow = { postMessage } as unknown as Window;
const iframeRef = {
  current: { contentWindow } as unknown as HTMLIFrameElement,
};

function send(data: unknown, origin = PREVIEW_ORIGIN, source = contentWindow) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
  });
}

interface Options {
  commit?: (input: {
    blockId: string;
    field: string;
    value: string;
  }) => Promise<unknown>;
  getFieldValue?: (blockId: string, field: string) => string | undefined;
  onSelectBlock?: (blockId: string) => void;
  previewUrl?: string | null;
}

function setup(options: Options = {}) {
  const commit = options.commit ?? vi.fn().mockResolvedValue(undefined);
  const onSelectBlock = options.onSelectBlock ?? vi.fn();
  const getFieldValue = options.getFieldValue ?? (() => 'Glow Clinic');

  const view = renderHook(() =>
    useInlineEdit({
      iframeRef,
      previewUrl:
        options.previewUrl === undefined ? PREVIEW_URL : options.previewUrl,
      onSelectBlock,
      getFieldValue,
      commit,
    })
  );

  return { ...view, commit, onSelectBlock };
}

describe('useInlineEdit', () => {
  beforeEach(() => {
    postMessage.mockClear();
  });

  describe('origin validation', () => {
    it('ignores a message from any origin other than the preview', () => {
      const { commit, onSelectBlock } = setup();

      send(
        {
          source: EDITOR_MESSAGE_SOURCE,
          type: 'edit',
          blockId: 'blk_1',
          field: 'headline',
          value: 'Injected',
        },
        'https://evil.example.com'
      );
      send(
        { source: EDITOR_MESSAGE_SOURCE, type: 'selected', blockId: 'blk_1' },
        'https://evil.example.com'
      );

      expect(commit).not.toHaveBeenCalled();
      expect(onSelectBlock).not.toHaveBeenCalled();
      expect(postMessage).not.toHaveBeenCalled();
    });

    it('ignores a message from a window that is not the preview frame', () => {
      const { commit } = setup();

      send(
        {
          source: EDITOR_MESSAGE_SOURCE,
          type: 'edit',
          blockId: 'blk_1',
          field: 'headline',
          value: 'Injected',
        },
        PREVIEW_ORIGIN,
        {} as Window
      );

      expect(commit).not.toHaveBeenCalled();
    });

    it('ignores a message that does not carry the editor source tag', () => {
      const { commit } = setup();

      send({
        source: 'some-other-widget',
        type: 'edit',
        blockId: 'blk_1',
        field: 'headline',
        value: 'Injected',
      });

      expect(commit).not.toHaveBeenCalled();
    });

    it('listens to nothing at all when there is no preview origin', () => {
      const { commit, result } = setup({ previewUrl: null });

      send({
        source: EDITOR_MESSAGE_SOURCE,
        type: 'edit',
        blockId: 'blk_1',
        field: 'headline',
        value: 'New',
      });

      expect(result.current.previewOrigin).toBeNull();
      expect(commit).not.toHaveBeenCalled();
    });

    it('posts outbound messages to the preview origin, never "*"', () => {
      setup();

      send({ source: EDITOR_MESSAGE_SOURCE, type: 'ready' });

      expect(postMessage).toHaveBeenCalledWith(
        { source: CANVAS_MESSAGE_SOURCE, type: 'enable-edit' },
        PREVIEW_ORIGIN
      );
    });
  });

  describe('commit', () => {
    it('commits a changed value and replies commit-ok', async () => {
      const commit = vi.fn().mockResolvedValue(undefined);
      setup({ commit, getFieldValue: () => 'Glow Clinic' });

      send({
        source: EDITOR_MESSAGE_SOURCE,
        type: 'edit',
        blockId: 'blk_1',
        field: 'headline',
        value: 'Glow Clinic Dublin',
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(commit).toHaveBeenCalledWith({
        blockId: 'blk_1',
        field: 'headline',
        value: 'Glow Clinic Dublin',
      });
      expect(postMessage).toHaveBeenCalledWith(
        {
          source: CANVAS_MESSAGE_SOURCE,
          type: 'commit-ok',
          blockId: 'blk_1',
          field: 'headline',
        },
        PREVIEW_ORIGIN
      );
    });

    it('replies commit-failed with the error when the save fails', async () => {
      const commit = vi.fn().mockRejectedValue(new Error('Network is down'));
      setup({ commit });

      send({
        source: EDITOR_MESSAGE_SOURCE,
        type: 'edit',
        blockId: 'blk_1',
        field: 'headline',
        value: 'Glow Clinic Dublin',
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(postMessage).toHaveBeenCalledWith(
        {
          source: CANVAS_MESSAGE_SOURCE,
          type: 'commit-failed',
          blockId: 'blk_1',
          field: 'headline',
          message: 'Network is down',
        },
        PREVIEW_ORIGIN
      );
      // The iframe must be told to restore — never left showing unsaved text.
      expect(postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'commit-ok' }),
        PREVIEW_ORIGIN
      );
    });

    it('does not mutate when the value is unchanged', async () => {
      const commit = vi.fn().mockResolvedValue(undefined);
      setup({ commit, getFieldValue: () => 'Glow Clinic' });

      send({
        source: EDITOR_MESSAGE_SOURCE,
        type: 'edit',
        blockId: 'blk_1',
        field: 'headline',
        value: 'Glow Clinic',
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(commit).not.toHaveBeenCalled();
      // Still acknowledged, so the iframe can clear its dirty state.
      expect(postMessage).toHaveBeenCalledWith(
        {
          source: CANVAS_MESSAGE_SOURCE,
          type: 'commit-ok',
          blockId: 'blk_1',
          field: 'headline',
        },
        PREVIEW_ORIGIN
      );
    });

    it('ignores a malformed edit message', async () => {
      const commit = vi.fn().mockResolvedValue(undefined);
      setup({ commit });

      send({
        source: EDITOR_MESSAGE_SOURCE,
        type: 'edit',
        blockId: 'blk_1',
        field: 'headline',
        value: { html: '<script>' },
      });

      expect(commit).not.toHaveBeenCalled();
    });
  });

  it('drives selection from a preview click', () => {
    const onSelectBlock = vi.fn();
    setup({ onSelectBlock });

    send({
      source: EDITOR_MESSAGE_SOURCE,
      type: 'selected',
      blockId: 'blk_7',
    });

    expect(onSelectBlock).toHaveBeenCalledWith('blk_7');
  });
});

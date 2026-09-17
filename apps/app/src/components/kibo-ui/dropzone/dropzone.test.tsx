import { render } from '@testing-library/react';
import type { DropzoneOptions, FileRejection } from 'react-dropzone';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Capture the `onDrop` the component hands to react-dropzone so the drop
 * callback can be driven directly — the branch under test is that wrapper,
 * not the library's file plumbing.
 */
let captured: DropzoneOptions['onDrop'];

vi.mock('react-dropzone', () => ({
  useDropzone: (options: DropzoneOptions) => {
    captured = options.onDrop;
    return {
      getRootProps: () => ({}),
      getInputProps: () => ({}),
      isDragActive: false,
    };
  },
}));

import { Dropzone } from './index';

const file = (name: string) => new File(['x'], name, { type: 'image/png' });

const rejection = (name: string, message: string): FileRejection => ({
  file: file(name),
  errors: [{ code: 'file-too-large', message }],
});

describe('Dropzone', () => {
  beforeEach(() => {
    captured = undefined;
  });

  const setup = () => {
    const onDrop = vi.fn();
    const onError = vi.fn();
    render(<Dropzone maxFiles={20} onDrop={onDrop} onError={onError} />);
    return { onDrop, onError };
  };

  /**
   * The regression this file exists for.
   *
   * The wrapper used to `return` as soon as anything was rejected, throwing
   * away every accepted file beside it. Every consumer of this component is
   * multi-file (5–50), so one oversized clip in a batch of fifty silently
   * imported nothing on a control that advertises fifty at a time.
   */
  it('keeps the accepted files when some of the drop was rejected', () => {
    const { onDrop, onError } = setup();

    captured?.(
      [file('a.png'), file('b.png')],
      [rejection('huge.png', 'File is larger than 15728640 bytes')],
      new Event('drop')
    );

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onDrop).toHaveBeenCalledOnce();
    expect(onDrop.mock.calls[0][0].map((f: File) => f.name)).toEqual([
      'a.png',
      'b.png',
    ]);
  });

  it('reports the rejection and drops nothing when none were accepted', () => {
    const { onDrop, onError } = setup();

    captured?.(
      [],
      [rejection('huge.png', 'File is larger than 15728640 bytes')],
      new Event('drop')
    );

    expect(onError).toHaveBeenCalledOnce();
    expect(onDrop).not.toHaveBeenCalled();
  });

  /**
   * Over-count stays all-or-nothing: react-dropzone moves EVERY file into
   * `fileRejections` with `too-many-files`, so nothing is accepted and the
   * drop is refused outright — correct, since nobody can say which N of N+1
   * was meant.
   */
  it('refuses the whole drop when it exceeds maxFiles', () => {
    const { onDrop, onError } = setup();

    captured?.(
      [],
      [
        rejection('a.png', 'Too many files'),
        rejection('b.png', 'Too many files'),
      ],
      new Event('drop')
    );

    expect(onError).toHaveBeenCalledOnce();
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('passes a clean drop straight through', () => {
    const { onDrop, onError } = setup();

    captured?.([file('a.png')], [], new Event('drop'));

    expect(onError).not.toHaveBeenCalled();
    expect(onDrop).toHaveBeenCalledOnce();
  });
});

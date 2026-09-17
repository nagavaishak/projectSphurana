import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { MicrositePage } from '../api/types';
import { useChangedBlocks } from './use-changed-blocks';

function page(headline: string): MicrositePage[] {
  return [
    {
      id: 'pg_1',
      path: '/',
      title: 'Home',
      blocks: [
        {
          id: 'blk_1',
          type: 'hero',
          variant: 'default',
          props: { headline },
        },
        {
          id: 'blk_2',
          type: 'gallery',
          variant: 'default',
          props: { title: 'Our work' },
        },
      ],
    },
  ] as unknown as MicrositePage[];
}

describe('useChangedBlocks', () => {
  it('flashes a block whose content changed', () => {
    const { result, rerender } = renderHook(
      ({ pages }) => useChangedBlocks(pages),
      { initialProps: { pages: page('Glow Clinic') } }
    );

    expect(result.current.size).toBe(0);
    rerender({ pages: page('Glow Clinic Dublin') });

    expect(result.current.has('blk_1')).toBe(true);
    expect(result.current.has('blk_2')).toBe(false);
  });

  it('does not flash a block the user just edited inline', () => {
    const suppressedBlockIds = { current: new Set<string>() };

    const { result, rerender } = renderHook(
      ({ pages }) => useChangedBlocks(pages, { suppressedBlockIds }),
      { initialProps: { pages: page('Glow Clinic') } }
    );

    suppressedBlockIds.current.add('blk_1');
    rerender({ pages: page('Glow Clinic Dublin') });

    expect(result.current.size).toBe(0);
    // Consumed — a later agent turn touching the same block still flashes.
    expect(suppressedBlockIds.current.size).toBe(0);

    rerender({ pages: page('Glow Clinic Dublin 2') });
    expect(result.current.has('blk_1')).toBe(true);
  });
});

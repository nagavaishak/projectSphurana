import { describe, expect, it } from 'vitest';
import type { VideoStatus } from '../types';
import { isVideoInFlight, listVideosQueryOptions } from './list-videos.hook';

/**
 * Drive the `refetchInterval` decision. Bare statuses get a fresh `updatedAt`
 * (so in-flight rows count as actively progressing); pass an object to control
 * the timestamp and exercise the stall cut-off.
 */
const pollFor = (
  items: Array<VideoStatus | { status: VideoStatus; updatedAt: string }>
) => {
  const { refetchInterval } = listVideosQueryOptions();
  if (typeof refetchInterval !== 'function') {
    throw new Error(
      'refetchInterval must be the function form to stop polling'
    );
  }
  const nowIso = new Date().toISOString();
  return refetchInterval({
    state: {
      data: {
        items: items.map((it) =>
          typeof it === 'string' ? { status: it, updatedAt: nowIso } : it
        ),
      },
    },
  } as never);
};

describe('isVideoInFlight', () => {
  it('treats worker-owned statuses as in flight', () => {
    expect(isVideoInFlight('queued')).toBe(true);
    expect(isVideoInFlight('processing')).toBe(true);
  });

  it('treats settled statuses as not in flight', () => {
    expect(isVideoInFlight('ready')).toBe(false);
    expect(isVideoInFlight('failed')).toBe(false);
  });

  it('treats draft as not in flight — it waits on the user, not the worker', () => {
    expect(isVideoInFlight('draft')).toBe(false);
  });
});

describe('listVideosQueryOptions refetchInterval', () => {
  it('polls while a video is queued', () => {
    expect(pollFor(['queued'])).toBe(5000);
  });

  it('polls while a video is processing', () => {
    expect(pollFor(['processing'])).toBe(5000);
  });

  it('polls when one render is in flight among settled videos', () => {
    expect(pollFor(['ready', 'ready', 'processing', 'failed'])).toBe(5000);
  });

  it('stops once every video has settled', () => {
    expect(pollFor(['ready', 'failed', 'ready'])).toBe(false);
  });

  it('stops polling a render wedged past the stall threshold', () => {
    const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    expect(pollFor([{ status: 'processing', updatedAt: stale }])).toBe(false);
  });

  it('does not poll for drafts alone', () => {
    expect(pollFor(['draft', 'ready'])).toBe(false);
  });

  it('does not poll for an empty library', () => {
    expect(pollFor([])).toBe(false);
  });

  it('does not poll before the first fetch resolves', () => {
    const { refetchInterval } = listVideosQueryOptions();
    if (typeof refetchInterval !== 'function') throw new Error('expected fn');
    expect(refetchInterval({ state: { data: undefined } } as never)).toBe(
      false
    );
  });
});

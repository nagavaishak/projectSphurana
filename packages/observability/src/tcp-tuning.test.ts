import { describe, expect, it, vi } from 'vitest';
import { applyTcpResilienceTuning } from './tcp-tuning.js';

describe('applyTcpResilienceTuning', () => {
  const tuning = {
    'net.ipv4.tcp_retries2': '8',
    'net.ipv4.tcp_keepalive_time': '30',
  };

  it('is a no-op on non-Linux platforms (dev/macOS)', () => {
    const write = vi.fn();
    const result = applyTcpResilienceTuning({
      platform: 'darwin',
      write,
      log: () => {},
      tuning,
    });
    expect(write).not.toHaveBeenCalled();
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('writes each sysctl to the right /proc/sys path on Linux', () => {
    const writes: Array<[string, string]> = [];
    const result = applyTcpResilienceTuning({
      platform: 'linux',
      exists: () => true,
      write: (p, v) => writes.push([p, v]),
      log: () => {},
      tuning,
    });
    expect(writes).toEqual([
      ['/proc/sys/net/ipv4/tcp_retries2', '8'],
      ['/proc/sys/net/ipv4/tcp_keepalive_time', '30'],
    ]);
    expect(result.applied).toEqual([
      'net.ipv4.tcp_retries2=8',
      'net.ipv4.tcp_keepalive_time=30',
    ]);
    expect(result.skipped).toEqual([]);
  });

  it('skips (does not throw) when a write fails — never fatal at boot', () => {
    const result = applyTcpResilienceTuning({
      platform: 'linux',
      exists: () => true,
      write: (p) => {
        if (p.endsWith('tcp_retries2')) throw new Error('EACCES');
      },
      log: () => {},
      tuning,
    });
    expect(result.applied).toEqual(['net.ipv4.tcp_keepalive_time=30']);
    expect(result.skipped).toEqual(['net.ipv4.tcp_retries2 (EACCES)']);
  });

  it('skips a sysctl whose /proc path is absent', () => {
    const result = applyTcpResilienceTuning({
      platform: 'linux',
      exists: (p) => !p.endsWith('tcp_keepalive_time'),
      write: () => {},
      log: () => {},
      tuning,
    });
    expect(result.applied).toEqual(['net.ipv4.tcp_retries2=8']);
    expect(result.skipped).toEqual([
      'net.ipv4.tcp_keepalive_time (no /proc/sys/net/ipv4/tcp_keepalive_time)',
    ]);
  });
});

/** @vitest-environment jsdom */
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RuntimeConfigProvider,
  RuntimeConfigScript,
  useRuntimeConfig,
} from './client.js';
import type { RuntimeConfig } from './schema.js';

const sampleConfig: RuntimeConfig = {
  apiUrl: 'https://api.example.com',
  appUrl: 'https://app.example.com',
  appEnv: 'production',
  posthogKey: 'phc_test',
  posthogHost: 'https://eu.i.posthog.com',
  sentryDsn: null,
  sentryEnvironment: undefined,
  marketingSentryDsn: null,
  sentryWebDisabled: false,
  intercomAppId: null,
  googleMapsApiKey: undefined,
  turnstileSiteKey: undefined,
  stripePublishableKey: undefined,
  metaAppId: undefined,
  whatsappEmbeddedSignupConfigId: undefined,
  cdnUrl: undefined,
  cdnEnabled: false,
  s3PublicAssetsBucket: undefined,
  s3Region: undefined,
};

afterEach(() => {
  (window as { __CONFIG__?: unknown }).__CONFIG__ = undefined;
  vi.restoreAllMocks();
});

describe('RuntimeConfigProvider — initialConfig mode', () => {
  it('makes config readable synchronously via useRuntimeConfig', () => {
    const { result } = renderHook(() => useRuntimeConfig(), {
      wrapper: ({ children }) => (
        <RuntimeConfigProvider initialConfig={sampleConfig}>
          {children}
        </RuntimeConfigProvider>
      ),
    });
    expect(result.current.apiUrl).toBe(sampleConfig.apiUrl);
    expect(result.current.posthogKey).toBe(sampleConfig.posthogKey);
  });

  it('writes the config to window.__CONFIG__ on mount', () => {
    render(
      <RuntimeConfigProvider initialConfig={sampleConfig}>
        <span>child</span>
      </RuntimeConfigProvider>
    );
    expect(window.__CONFIG__).toEqual(sampleConfig);
  });
});

describe('RuntimeConfigProvider — fetchUrl mode', () => {
  it('renders fallback first, then resolves with the fetched config', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(sampleConfig), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const Probe = () => {
      const cfg = useRuntimeConfig();
      return <span data-testid="probe">{cfg.apiUrl}</span>;
    };

    const { queryByTestId, getByText } = render(
      <RuntimeConfigProvider
        fetchUrl="/api/runtime-config"
        fallback={<span>loading...</span>}
      >
        <Probe />
      </RuntimeConfigProvider>
    );

    expect(getByText('loading...')).toBeTruthy();
    expect(queryByTestId('probe')).toBeNull();

    await waitFor(() => {
      expect(queryByTestId('probe')?.textContent).toBe(sampleConfig.apiUrl);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/runtime-config',
      expect.objectContaining({
        credentials: 'same-origin',
        signal: expect.any(AbortSignal),
      })
    );
    expect(window.__CONFIG__).toEqual(sampleConfig);
  });

  it('keeps showing fallback when the fetch errors', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('boom', { status: 500, statusText: 'Internal Error' })
    );

    const { getByText, queryByTestId } = render(
      <RuntimeConfigProvider
        fetchUrl="/api/runtime-config"
        fallback={<span>fallback</span>}
      >
        <span data-testid="probe">should not appear</span>
      </RuntimeConfigProvider>
    );

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalled();
    });
    expect(getByText('fallback')).toBeTruthy();
    expect(queryByTestId('probe')).toBeNull();
    expect(window.__CONFIG__).toBeUndefined();
  });

  it('validates the fetched payload against the schema', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ apiUrl: 'not-a-url' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    await act(async () => {
      render(
        <RuntimeConfigProvider
          fetchUrl="/api/runtime-config"
          fallback={<span>fallback</span>}
        >
          <span>child</span>
        </RuntimeConfigProvider>
      );
    });

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalled();
    });
  });
});

describe('useRuntimeConfig', () => {
  it('throws when used outside a provider', () => {
    expect(() => renderHook(() => useRuntimeConfig())).toThrowError(
      /RuntimeConfigProvider/
    );
  });
});

describe('RuntimeConfigScript', () => {
  it('renders a script tag that assigns window.__CONFIG__', () => {
    const { container } = render(<RuntimeConfigScript config={sampleConfig} />);
    const script = container.querySelector('script');
    expect(script).not.toBeNull();
    expect(script?.innerHTML).toContain('window.__CONFIG__=');
    expect(script?.innerHTML.endsWith(';')).toBe(true);
  });

  it('safely escapes characters that could break out of the script tag', () => {
    const LS = String.fromCharCode(0x2028);
    const PS = String.fromCharCode(0x2029);
    const hostile: RuntimeConfig = {
      ...sampleConfig,
      intercomAppId: '</script><script>alert(1)</script>',
      sentryDsn: `<!--<script>--> &amp; ${LS} ${PS}`,
    };
    const { container } = render(<RuntimeConfigScript config={hostile} />);
    const html = container.querySelector('script')?.innerHTML ?? '';

    expect(html).not.toContain('</script>');
    expect(html).not.toContain('<!--');
    expect(html).not.toContain(LS);
    expect(html).not.toContain(PS);
    expect(html).toContain('\\u003c');
    expect(html).toContain('\\u003e');
    expect(html).toContain('\\u0026');
    expect(html).toContain('\\u2028');
    expect(html).toContain('\\u2029');
  });

  it('produces JSON that round-trips back to the original values', () => {
    const { container } = render(<RuntimeConfigScript config={sampleConfig} />);
    const html = container.querySelector('script')?.innerHTML ?? '';
    const match = html.match(/^window\.__CONFIG__=(.*);$/s);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match?.[1] ?? '') as Partial<RuntimeConfig>;
    expect(parsed.apiUrl).toBe(sampleConfig.apiUrl);
    expect(parsed.posthogKey).toBe(sampleConfig.posthogKey);
    expect(parsed.sentryDsn).toBeNull();
  });

  it('forwards a nonce attribute when provided', () => {
    const { container } = render(
      <RuntimeConfigScript config={sampleConfig} nonce="abc123" />
    );
    expect(container.querySelector('script')?.getAttribute('nonce')).toBe(
      'abc123'
    );
  });
});

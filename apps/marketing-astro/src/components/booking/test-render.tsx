/**
 * Render helper for the booking component tests.
 *
 * apps/app has `@/test/render`; this app has no component-test infrastructure
 * at all, so the equivalent lives here rather than being invented as a new
 * shared module from inside a feature port.
 *
 * Two deliberate differences from the apps/app original, both forced by what is
 * installed rather than chosen:
 *  - No `@testing-library/jest-dom`. Assertions use plain values
 *    (`.textContent`, `.disabled`, `toBeNull()`); `getBy*` still throws when an
 *    element is missing, so the tests fail for the same reasons.
 *  - No `@testing-library/user-event`. Interactions go through `fireEvent`,
 *    which dispatches the same React events; it does not simulate the full
 *    pointer/keyboard sequence, so a bug that only manifests under real
 *    keyboard navigation would not be caught here.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, configure, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach } from 'vitest';

// RTL only auto-cleans when vitest runs with `globals: true`, which this app
// does not. Without this every test renders into the previous test's DOM and
// `getByRole` starts failing with "multiple elements found" — a failure mode
// that looks like a component bug and isn't.
afterEach(() => cleanup());

// Testing Library gives `findBy*` one second, which is generous on a laptop and
// not always enough on a CI runner: the FIRST async query in a file pays for
// jsdom construction, the React and react-query module graphs, and whatever
// else the box is doing at that moment.
//
// That is not hypothetical here. `manage-booking-content.test.tsx` failed in CI
// on `findByText('Lip Filler')` — the first assertion in the file — while the
// eight tests after it passed, and the whole file passes locally. The data it
// was waiting for comes from an already-resolved mock, so nothing was actually
// slow except the cold start.
//
// Configured on the shared helper rather than in a setup file because every
// component test imports `screen` from HERE, and this workspace resolves two
// copies of @testing-library/dom — configuring the other one would silently do
// nothing. Raising the ceiling does not slow a passing test: `findBy*` polls
// and returns as soon as the element appears.
configure({ asyncUtilTimeout: 10_000 });

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

// The return type is inferred rather than annotated as `RenderResult`: two
// copies of @testing-library/dom are resolvable in this workspace and the
// nominal `RenderResult` from one does not satisfy the other's.
export function renderWithProviders(ui: ReactElement) {
  const queryClient = createTestQueryClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  return { queryClient, ...render(ui, { wrapper: Wrapper }) };
}

export * from '@testing-library/react';

import { apiClient } from '@borradh-workspace/api-client';
import { createFileRoute } from '@tanstack/react-router';
import { AlertCircle, CheckCircle, Monitor, Server } from 'lucide-react';
import posthog from 'posthog-js';
import { useState } from 'react';

import { PageShell } from '@/components/app/page-shell';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { logError } from '@/lib/log-error';

import { CapgoDebugCard } from './-components/capgo-debug-card';
import { TapToPayDebugCard } from './-components/tap-to-pay-debug-card';

export const Route = createFileRoute('/_authed/dashboard/debug/')({
  component: DebugPage,
});

interface TestResult {
  type: 'success' | 'error';
  message: string;
  timestamp: string;
}

function DebugPage() {
  const [results, setResults] = useState<TestResult[]>([]);
  const [isLoading, setIsLoading] = useState<string | null>(null);

  const addResult = (type: 'success' | 'error', message: string) => {
    setResults((prev) => [
      { type, message, timestamp: new Date().toISOString() },
      ...prev.slice(0, 9),
    ]);
  };

  // --- Frontend (browser) error paths -------------------------------------

  // Caught error through the shared logError funnel → Sentry + PostHog.
  const triggerFrontendLogError = () => {
    setIsLoading('frontend-log-error');
    logError('debug.frontend', new Error('Test frontend logError'), {
      feature: 'debug',
      extra: { source: 'debug-page' },
    });
    addResult('success', 'logError fired → Sentry + PostHog');
    setIsLoading(null);
  };

  // Direct posthog-js exception capture (normalized $exception with stack).
  const triggerPosthogException = () => {
    setIsLoading('frontend-posthog');
    posthog.captureException(new Error('Test posthog.captureException'), {
      source: 'debug-page',
    });
    addResult('success', 'posthog.captureException fired → PostHog');
    setIsLoading(null);
  };

  // Unhandled promise rejection — auto-captured via capture_exceptions.
  const triggerUnhandledRejection = () => {
    void Promise.reject(new Error('Test unhandled promise rejection'));
    addResult('success', 'Unhandled rejection fired → auto-captured');
  };

  // Unhandled throw — crashes the page; auto-captured by both SDKs.
  const triggerUnhandledFrontendError = () => {
    throw new Error('Test unhandled frontend error');
  };

  // --- Backend (API) error paths ------------------------------------------

  const hitBackend = async (
    key: string,
    path: string,
    method: 'get' | 'post' = 'get',
    expectError = false
  ) => {
    setIsLoading(key);
    try {
      await (method === 'get' ? apiClient.get(path) : apiClient.post(path));
      addResult(
        expectError ? 'error' : 'success',
        expectError
          ? `Expected an error from ${path} but it succeeded`
          : `${path} → check Sentry + PostHog`
      );
    } catch (_error) {
      addResult(
        'success',
        expectError
          ? `${path} threw as expected → check Sentry + PostHog`
          : `${path} request failed`
      );
    } finally {
      setIsLoading(null);
    }
  };

  const checkBackendHealth = async () => {
    setIsLoading('health');
    try {
      const response = await apiClient.get<{
        status: string;
        environment: string;
        sentryDsn: string;
        posthogApiKey: string;
      }>('debug/health');
      addResult(
        'success',
        `env: ${response.environment} · Sentry: ${response.sentryDsn} · PostHog: ${response.posthogApiKey}`
      );
    } catch (error) {
      addResult('error', `Health check failed: ${error}`);
    } finally {
      setIsLoading(null);
    }
  };

  return (
    <>
      <title>Debug | Borradh</title>
      <PageShell>
        <Alert className="mb-6">
          <AlertCircle className="size-4" />
          <AlertTitle>Error-tracking test bench</AlertTitle>
          <AlertDescription>
            Each button fires a real error through a different path. Every path
            dual-sends to <strong>Sentry</strong> and <strong>PostHog</strong>{' '}
            during the migration — confirm the event lands in both. Non-prod
            only.
          </AlertDescription>
        </Alert>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Monitor className="size-5" />
                <CardTitle>Frontend (browser)</CardTitle>
              </div>
              <CardDescription>
                Exercises posthog-js capture + the logError funnel
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                onClick={triggerFrontendLogError}
                disabled={isLoading === 'frontend-log-error'}
                variant="outline"
                className="w-full justify-start"
              >
                logError (Sentry + PostHog)
              </Button>
              <Button
                onClick={triggerPosthogException}
                disabled={isLoading === 'frontend-posthog'}
                variant="outline"
                className="w-full justify-start"
              >
                posthog.captureException
              </Button>
              <Button
                onClick={triggerUnhandledRejection}
                variant="outline"
                className="w-full justify-start"
              >
                Unhandled Promise Rejection
              </Button>
              <Button
                onClick={triggerUnhandledFrontendError}
                variant="destructive"
                className="w-full justify-start"
              >
                Unhandled Error (Crashes Page)
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Server className="size-5" />
                <CardTitle>Backend (API)</CardTitle>
              </div>
              <CardDescription>
                Each path routes through a different reporting funnel
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                onClick={checkBackendHealth}
                disabled={isLoading === 'health'}
                variant="secondary"
                className="w-full justify-start"
              >
                Check Debug Health
              </Button>
              <Button
                onClick={() =>
                  hitBackend(
                    'be-unhandled',
                    'debug/error/unhandled',
                    'get',
                    true
                  )
                }
                disabled={isLoading === 'be-unhandled'}
                variant="outline"
                className="w-full justify-start"
              >
                Raw Throw (exception filter)
              </Button>
              <Button
                onClick={() => hitBackend('be-log', 'debug/error/log-error')}
                disabled={isLoading === 'be-log'}
                variant="outline"
                className="w-full justify-start"
              >
                logError() handled path
              </Button>
              <Button
                onClick={() => hitBackend('be-tracked', 'debug/error/tracked')}
                disabled={isLoading === 'be-tracked'}
                variant="outline"
                className="w-full justify-start"
              >
                tracked() wrapper
              </Button>
              <Button
                onClick={() =>
                  hitBackend('be-tr', 'debug/error/tracked-result')
                }
                disabled={isLoading === 'be-tr'}
                variant="outline"
                className="w-full justify-start"
              >
                trackedResult() wrapper
              </Button>
              <Button
                onClick={() => hitBackend('be-db', 'debug/error/db-cause')}
                disabled={isLoading === 'be-db'}
                variant="outline"
                className="w-full justify-start"
              >
                Wrapped DB cause
              </Button>
              <Button
                onClick={() =>
                  hitBackend(
                    'be-cap',
                    'debug/capture/exception?message=Test from debug page',
                    'post'
                  )
                }
                disabled={isLoading === 'be-cap'}
                variant="outline"
                className="w-full justify-start"
              >
                captureException
              </Button>
            </CardContent>
          </Card>

          <CapgoDebugCard />

          <TapToPayDebugCard />
        </div>

        {results.length > 0 && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Test Results</CardTitle>
              <CardDescription>Recent test executions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {results.map((result) => (
                  <div
                    key={result.timestamp}
                    className="flex items-center gap-3 p-2 rounded-lg bg-muted/50"
                  >
                    {result.type === 'success' ? (
                      <CheckCircle className="size-4 text-success" />
                    ) : (
                      <AlertCircle className="size-4 text-destructive" />
                    )}
                    <span className="flex-1 text-sm">{result.message}</span>
                    <Badge variant="outline" className="text-xs">
                      {new Date(result.timestamp).toLocaleTimeString()}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </PageShell>
    </>
  );
}

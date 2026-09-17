import { SpanKind, trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { createLogger } from '../logger.js';

type ExportResult = { code: 0 | 1; error?: Error };

const logger = createLogger('PostHogOtel');
let processor: BatchSpanProcessor | null = null;

class HttpOnlySpanExporter implements SpanExporter {
  constructor(private inner: OTLPTraceExporter) {}

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void
  ): void {
    const httpSpans = spans.filter((span) => {
      if (span.kind !== SpanKind.SERVER && span.kind !== SpanKind.CLIENT)
        return false;
      const attrs = span.attributes;
      return (
        attrs['http.method'] !== undefined ||
        attrs['http.request.method'] !== undefined
      );
    });

    if (httpSpans.length === 0) {
      resultCallback({ code: 0 });
      return;
    }

    // biome-ignore lint/suspicious/noExplicitAny: bridging local ExportResult to SDK's internal type
    this.inner.export(httpSpans, resultCallback as any);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}

export function setupPostHogOtelExport(apiKey: string, host: string): void {
  try {
    // biome-ignore lint/suspicious/noExplicitAny: OTEL provider internals (getDelegate, addSpanProcessor) are not in the public TracerProvider type
    const globalProvider = trace.getTracerProvider() as any;

    const provider =
      globalProvider &&
      typeof globalProvider.getDelegate === 'function' &&
      typeof globalProvider.getDelegate()?.addSpanProcessor === 'function'
        ? globalProvider.getDelegate()
        : typeof globalProvider?.addSpanProcessor === 'function'
          ? globalProvider
          : null;

    if (!provider) {
      logger.warn(
        'PostHog OTEL: no compatible provider found (call initSentry first)'
      );
      return;
    }

    const exporter = new OTLPTraceExporter({
      url: `${host.replace(/\/$/, '')}/v1/traces`,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const httpExporter = new HttpOnlySpanExporter(exporter);
    // biome-ignore lint/suspicious/noExplicitAny: HttpOnlySpanExporter satisfies SpanExporter but TS can't verify across SDK version boundaries
    processor = new BatchSpanProcessor(httpExporter as any, {
      scheduledDelayMillis: 5000,
      maxExportBatchSize: 512,
    });

    provider.addSpanProcessor(processor);
    logger.info('PostHog OTEL exporter attached');
  } catch (err) {
    logger.warn('PostHog OTEL: failed to set up exporter', { error: err });
  }
}

export async function flushPostHogOtelExport(): Promise<void> {
  if (processor) {
    await processor.forceFlush();
  }
}

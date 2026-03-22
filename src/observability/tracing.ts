/**
 * OpenTelemetry Tracing Setup
 * Initializes distributed tracing for the NeuroBase pipeline
 */

import { logger } from '../utils/logger';

let otelApi: any;
let otelSdk: any;

export interface TracingConfig {
  enabled: boolean;
  serviceName?: string;
  exporterEndpoint?: string;
  sampleRate?: number;
}

let tracer: any = null;
let initialized = false;

/**
 * Initialize OpenTelemetry tracing
 */
export async function initTracing(config: TracingConfig): Promise<void> {
  if (!config.enabled || initialized) return;

  try {
    otelApi = require('@opentelemetry/api');
    otelSdk = require('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

    const exporter = new OTLPTraceExporter({
      url: config.exporterEndpoint || 'http://localhost:4318/v1/traces',
    });

    const sdk = new otelSdk.NodeSDK({
      traceExporter: exporter,
      instrumentations: [getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-pg': { enabled: true },
        '@opentelemetry/instrumentation-express': { enabled: true },
        '@opentelemetry/instrumentation-http': { enabled: true },
      })],
      serviceName: config.serviceName || 'neurobase',
    });

    await sdk.start();
    tracer = otelApi.trace.getTracer('neurobase');
    initialized = true;

    logger.info({ endpoint: config.exporterEndpoint }, 'OpenTelemetry tracing initialized');

    // Graceful shutdown
    process.on('SIGTERM', () => {
      sdk.shutdown().catch((err: any) => logger.error({ err }, 'Error shutting down tracing'));
    });
  } catch (error) {
    logger.warn({ error }, 'OpenTelemetry packages not installed. Tracing disabled.');
    logger.info('Install: npm install @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/auto-instrumentations-node');
  }
}

/**
 * Get the current tracer (returns a no-op if not initialized)
 */
export function getTracer(): any {
  if (tracer) return tracer;

  // Return a no-op tracer
  return {
    startSpan: (name: string) => new NoOpSpan(name),
    startActiveSpan: (_name: string, fn: (span: any) => any) => fn(new NoOpSpan(_name)),
  };
}

/**
 * Get current trace and span IDs for log correlation
 */
export function getTraceContext(): { traceId: string; spanId: string } {
  if (!otelApi) {
    return { traceId: '', spanId: '' };
  }

  try {
    const span = otelApi.trace.getActiveSpan();
    if (span) {
      const ctx = span.spanContext();
      return { traceId: ctx.traceId, spanId: ctx.spanId };
    }
  } catch {
    // No active span
  }

  return { traceId: '', spanId: '' };
}

/**
 * No-op span for when tracing is disabled
 */
class NoOpSpan {
  // @ts-expect-error - stored for debugging
  private _name: string;

  constructor(name: string) {
    this._name = name;
  }

  setAttribute(_key: string, _value: any): this { return this; }
  setAttributes(_attrs: any): this { return this; }
  addEvent(_name: string, _attrs?: any): this { return this; }
  setStatus(_status: any): this { return this; }
  end(): void {}
  isRecording(): boolean { return false; }
  spanContext(): any { return { traceId: '', spanId: '', traceFlags: 0 }; }
}

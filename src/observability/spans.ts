/**
 * NeuroBase Span Definitions
 * Defines spans for the complete query lifecycle
 */

import { getTracer } from './tracing';

export type SpanName =
  | 'neurobase.query'
  | 'rag.route'
  | 'linguistic.translate'
  | 'validator.check'
  | 'optimizer.analyze'
  | 'database.execute'
  | 'memory.store'
  | 'memory.retrieve'
  | 'security.analyze'
  | 'sandbox.test'
  | 'correction.loop'
  | 'candidate.select'
  | 'value.explore'
  | 'schema.prune'
  | 'diagnostic.search'
  | 'explainer.generate';

/**
 * Start a new span for a NeuroBase operation
 */
export function startSpan(name: SpanName, attributes?: Record<string, string | number | boolean>): any {
  const tracer = getTracer();
  const span = tracer.startSpan(name);

  if (attributes) {
    span.setAttributes(attributes);
  }

  return span;
}

/**
 * Execute a function within a span
 */
export async function withSpan<T>(
  name: SpanName,
  fn: (span: any) => Promise<T>,
  attributes?: Record<string, string | number | boolean>
): Promise<T> {
  const span = startSpan(name, attributes);

  try {
    const result = await fn(span);
    span.setStatus({ code: 1 }); // OK
    return result;
  } catch (error: any) {
    span.setStatus({ code: 2, message: error.message }); // ERROR
    span.setAttribute('error', true);
    span.setAttribute('error.message', error.message);
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Record a query lifecycle with nested spans
 */
export function createQuerySpan(query: string, userId?: string): any {
  const span = startSpan('neurobase.query', {
    'query.text': query.substring(0, 200),
    ...(userId ? { 'user.id': userId } : {}),
  });
  return span;
}

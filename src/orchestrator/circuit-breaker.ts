/**
 * Circuit Breaker for LLM Providers
 * Prevents cascade failures when LLM providers are down
 */

import { logger } from '../utils/logger';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  name: string;
  timeoutMs?: number;
  errorThresholdPercentage?: number;
  resetTimeMs?: number;
  volumeThreshold?: number;
}

interface CircuitStats {
  successes: number;
  failures: number;
  timeouts: number;
  lastFailure?: Date;
  lastSuccess?: Date;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private stats: CircuitStats = { successes: 0, failures: 0, timeouts: 0 };
  private openedAt?: Date;
  private name: string;
  private timeoutMs: number;
  private errorThresholdPercentage: number;
  private resetTimeMs: number;
  private volumeThreshold: number;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.errorThresholdPercentage = options.errorThresholdPercentage ?? 50;
    this.resetTimeMs = options.resetTimeMs ?? 60000;
    this.volumeThreshold = options.volumeThreshold ?? 5;
  }

  /**
   * Execute a function through the circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      // Check if enough time has passed to try again
      if (this.shouldAttemptReset()) {
        this.state = 'half-open';
        logger.info({ breaker: this.name }, 'Circuit breaker half-open, attempting reset');
      } else {
        throw new CircuitBreakerError(`Circuit breaker "${this.name}" is OPEN`);
      }
    }

    try {
      const result = await this.withTimeout(fn);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Check if a fallback should be used (circuit is open)
   */
  isOpen(): boolean {
    return this.state === 'open';
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats(): CircuitStats & { state: CircuitState; name: string } {
    return { ...this.stats, state: this.state, name: this.name };
  }

  /**
   * Reset the circuit breaker
   */
  reset(): void {
    this.state = 'closed';
    this.stats = { successes: 0, failures: 0, timeouts: 0 };
    this.openedAt = undefined;
    logger.info({ breaker: this.name }, 'Circuit breaker reset');
  }

  private onSuccess(): void {
    this.stats.successes++;
    this.stats.lastSuccess = new Date();

    if (this.state === 'half-open') {
      this.state = 'closed';
      this.stats.failures = 0;
      logger.info({ breaker: this.name }, 'Circuit breaker closed after successful attempt');
    }
  }

  private onFailure(error: any): void {
    this.stats.failures++;
    this.stats.lastFailure = new Date();

    if (error instanceof TimeoutError) {
      this.stats.timeouts++;
    }

    if (this.state === 'half-open') {
      this.trip();
      return;
    }

    // Check if error threshold exceeded
    const total = this.stats.successes + this.stats.failures;
    if (total >= this.volumeThreshold) {
      const errorRate = (this.stats.failures / total) * 100;
      if (errorRate >= this.errorThresholdPercentage) {
        this.trip();
      }
    }
  }

  private trip(): void {
    this.state = 'open';
    this.openedAt = new Date();
    logger.warn({ breaker: this.name, stats: this.stats }, 'Circuit breaker OPEN');
  }

  private shouldAttemptReset(): boolean {
    if (!this.openedAt) return true;
    const elapsed = Date.now() - this.openedAt.getTime();
    return elapsed >= this.resetTimeMs;
  }

  private async withTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new TimeoutError(`Operation timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      fn()
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }
}

export class CircuitBreakerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Manages circuit breakers for multiple LLM providers
 */
export class LLMCircuitBreakerManager {
  private breakers: Map<string, CircuitBreaker> = new Map();
  private providerPriority: string[] = ['openai', 'anthropic', 'ollama'];

  constructor(providers: string[]) {
    this.providerPriority = providers;
    for (const provider of providers) {
      this.breakers.set(provider, new CircuitBreaker({
        name: `llm-${provider}`,
        timeoutMs: 30000,
        errorThresholdPercentage: 50,
        resetTimeMs: 60000,
      }));
    }
  }

  /**
   * Get the next available provider (first one with closed circuit)
   */
  getAvailableProvider(): string | null {
    for (const provider of this.providerPriority) {
      const breaker = this.breakers.get(provider);
      if (breaker && !breaker.isOpen()) {
        return provider;
      }
    }
    return null;
  }

  getBreaker(provider: string): CircuitBreaker | undefined {
    return this.breakers.get(provider);
  }

  getAllStats(): Array<CircuitStats & { state: CircuitState; name: string }> {
    return Array.from(this.breakers.values()).map(b => b.getStats());
  }
}

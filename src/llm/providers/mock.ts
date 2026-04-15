/**
 * Mock LLM provider — for tests and offline development.
 *
 * Two modes:
 *   1. Scripted: pass scenarios { match: RegExp | string, response: string } at
 *      construction. The provider scans the last user message and returns the
 *      first scenario whose `match` hits.
 *   2. Fallback: when nothing matches, returns the `defaultResponse` (configurable).
 *
 * Embeddings are deterministic — a small hash over the text — so tests get
 * stable vectors without any network or dependency.
 *
 * Inspired by claw-code's mock-anthropic-service crate. Designed so a future
 * "parity harness" can replay captured request → response pairs against
 * NeuroBase without touching any real provider.
 */

import * as crypto from 'crypto';
import { BaseLLMProvider, LLMMessage, LLMResponse, LLMOptions } from '../base';

export interface MockScenario {
  match: string | RegExp;
  response: string;
  /** When true, response is treated as already-JSON-stringified and returned as-is. */
  raw?: boolean;
}

export interface MockProviderOptions {
  model?: string;
  scenarios?: MockScenario[];
  defaultResponse?: string;
  embeddingDim?: number;
  /** Record every received request — useful for assertions in tests. */
  recordCalls?: boolean;
}

export interface RecordedCall {
  messages: LLMMessage[];
  options?: LLMOptions;
}

export class MockLLMProvider extends BaseLLMProvider {
  private model: string;
  private scenarios: MockScenario[];
  private defaultResponse: string;
  private embeddingDim: number;
  private recordCalls: boolean;
  private callLog: RecordedCall[] = [];

  constructor(options: MockProviderOptions = {}) {
    super();
    this.model = options.model ?? 'mock-model-1';
    this.scenarios = options.scenarios ?? [];
    this.defaultResponse =
      options.defaultResponse ??
      JSON.stringify({
        sql: 'SELECT 1 AS mock',
        explanation: 'mock provider default response',
        confidence: 0.5,
        isConversational: false,
      });
    this.embeddingDim = options.embeddingDim ?? 1536;
    this.recordCalls = options.recordCalls ?? true;
  }

  getModel(): string { return this.model; }
  setModel(model: string): void { this.model = model; }

  /** Add a scenario at runtime (useful inside a test). */
  addScenario(scenario: MockScenario): void {
    this.scenarios.push(scenario);
  }

  /** Reset recorded calls. */
  resetCalls(): void {
    this.callLog = [];
  }

  /** Inspect what the provider has received. */
  getCalls(): RecordedCall[] {
    return [...this.callLog];
  }

  async generateCompletion(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    if (this.recordCalls) {
      this.callLog.push({ messages, options });
    }

    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';

    for (const scenario of this.scenarios) {
      const matched =
        typeof scenario.match === 'string'
          ? lastUser.includes(scenario.match)
          : scenario.match.test(lastUser);
      if (matched) {
        return {
          content: scenario.response,
          usage: estimateUsage(messages, scenario.response),
        };
      }
    }

    return {
      content: this.defaultResponse,
      usage: estimateUsage(messages, this.defaultResponse),
    };
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const hash = crypto.createHash('sha256').update(text).digest();
    const vec = new Array(this.embeddingDim);
    for (let i = 0; i < this.embeddingDim; i++) {
      // Map each output dim to a byte of the hash (wrapping), normalized to [-1, 1].
      const byte = hash[i % hash.length];
      vec[i] = (byte / 127.5) - 1;
    }
    return vec;
  }
}

function estimateUsage(messages: LLMMessage[], response: string) {
  const inTok = Math.ceil(messages.reduce((a, m) => a + m.content.length, 0) / 4);
  const outTok = Math.ceil(response.length / 4);
  return {
    promptTokens: inTok,
    completionTokens: outTok,
    totalTokens: inTok + outTok,
  };
}

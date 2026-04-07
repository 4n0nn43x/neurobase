/**
 * OpenRouter LLM Provider
 *
 * OpenAI-compatible API gateway with one key, hundreds of models
 * (anthropic/claude-sonnet-4-5, openai/gpt-4o, google/gemini-2.0-flash, etc).
 */

import OpenAI from 'openai';
import { BaseLLMProvider, LLMMessage, LLMResponse, LLMOptions } from '../base';
import { OpenRouterConfig } from '../../types';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export interface OpenRouterModel {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

export class OpenRouterProvider extends BaseLLMProvider {
  private client: OpenAI;
  private config: OpenRouterConfig;

  constructor(config: OpenRouterConfig) {
    super();
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders: {
        'HTTP-Referer': config.appUrl || 'https://github.com/4n0nn43x/neurobase',
        'X-Title': config.appName || 'NeuroBase',
      },
    });
  }

  async generateCompletion(
    messages: LLMMessage[],
    options?: LLMOptions,
  ): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: this.config.model,
      messages: messages.map((msg) => ({ role: msg.role, content: msg.content })),
      temperature: options?.temperature ?? this.config.temperature,
      max_tokens: options?.maxTokens ?? this.config.maxTokens,
      stop: options?.stopSequences,
    });

    const choice = response.choices[0];
    if (!choice || !choice.message.content) {
      throw new Error('No response from OpenRouter');
    }

    return {
      content: choice.message.content,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  }

  async generateEmbedding(_text: string): Promise<number[]> {
    // OpenRouter does not expose a unified embeddings endpoint.
    // Embedding generation should be routed through OpenAI/Cohere/local instead.
    throw new Error(
      'OpenRouter does not provide embeddings. Configure a separate embedding provider.',
    );
  }

  /**
   * Update the model used by this provider instance.
   * Useful for the interactive /model command.
   */
  setModel(model: string): void {
    this.config.model = model;
  }

  getModel(): string {
    return this.config.model;
  }

  /**
   * List models available through this OpenRouter key.
   * Does NOT require auth, but using auth gets per-account pricing.
   */
  static async listModels(apiKey?: string): Promise<OpenRouterModel[]> {
    const headers: Record<string, string> = {};
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const res = await fetch(`${OPENROUTER_BASE_URL}/models`, { headers });
    if (!res.ok) {
      throw new Error(`OpenRouter models fetch failed: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as { data: OpenRouterModel[] };
    return json.data || [];
  }

  /**
   * Verify a key is valid by hitting a low-cost endpoint.
   * Returns true on 2xx, throws on auth failure.
   */
  static async verifyKey(apiKey: string): Promise<boolean> {
    const res = await fetch(`${OPENROUTER_BASE_URL}/auth/key`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error('OpenRouter API key rejected (401/403)');
    }
    return res.ok;
  }
}

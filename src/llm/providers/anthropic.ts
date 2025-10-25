/**
 * Anthropic Claude LLM Provider
 */

import Anthropic from '@anthropic-ai/sdk';
import { BaseLLMProvider, LLMMessage, LLMResponse, LLMOptions } from '../base';
import { AnthropicConfig } from '../../types';

export class AnthropicProvider extends BaseLLMProvider {
  private client: Anthropic;
  private config: AnthropicConfig;

  constructor(config: AnthropicConfig) {
    super();
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });
  }

  async generateCompletion(
    messages: LLMMessage[],
    options?: LLMOptions
  ): Promise<LLMResponse> {
    // Anthropic requires system message to be separate
    const systemMessage = messages.find((m) => m.role === 'system');
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: options?.maxTokens ?? this.config.maxTokens,
      temperature: options?.temperature ?? this.config.temperature,
      system: systemMessage?.content,
      messages: conversationMessages.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      stop_sequences: options?.stopSequences,
    });

    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Anthropic');
    }

    return {
      content: textContent.text,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    };
  }

  async generateEmbedding(text: string): Promise<number[]> {
    // Anthropic doesn't provide embeddings directly
    // Fall back to a simple hash-based embedding for demonstration
    // In production, you'd use a dedicated embedding service
    console.warn('Anthropic does not provide embeddings. Using fallback method.');

    // Simple fallback: use OpenAI's embedding or a local model
    // For now, return a placeholder
    return Array(1536).fill(0);
  }

  /**
   * Generate SQL from natural language using Claude
   */
  async generateSQL(
    query: string,
    schema: string,
    examples?: string
  ): Promise<{ sql: string; explanation: string; confidence: number }> {
    const messages = this.createSQLPrompt(query, schema, examples);
    const response = await this.generateCompletion(messages, {
      temperature: 0.1,
    });

    try {
      const result = this.extractJSON(response.content);
      return {
        sql: result.sql,
        explanation: result.explanation || '',
        confidence: result.confidence || 0.8,
      };
    } catch (error) {
      // Fallback: try to extract SQL from response
      const sqlMatch = response.content.match(/SELECT[\s\S]*?;/i);
      if (sqlMatch) {
        return {
          sql: sqlMatch[0],
          explanation: 'Extracted from response',
          confidence: 0.6,
        };
      }
      throw new Error(`Failed to parse SQL from response: ${error}`);
    }
  }

  /**
   * Optimize SQL query using Claude
   */
  async optimizeSQL(
    sql: string,
    executionPlan: string,
    schema: string
  ): Promise<{
    optimizedSQL: string;
    suggestions: Array<{
      type: string;
      description: string;
      impact: string;
      sql?: string;
    }>;
    improvement: string;
  }> {
    const messages = this.createOptimizationPrompt(sql, executionPlan, schema);
    const response = await this.generateCompletion(messages, {
      temperature: 0.1,
    });

    const result = this.extractJSON(response.content);
    return {
      optimizedSQL: result.optimizedSQL || sql,
      suggestions: result.suggestions || [],
      improvement: result.improvement || 'No specific improvements identified',
    };
  }
}

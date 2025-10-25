/**
 * Ollama Local LLM Provider
 */

import { Ollama } from 'ollama';
import { BaseLLMProvider, LLMMessage, LLMResponse, LLMOptions } from '../base';
import { OllamaConfig } from '../../types';

export class OllamaProvider extends BaseLLMProvider {
  private client: Ollama;
  private config: OllamaConfig;

  constructor(config: OllamaConfig) {
    super();
    this.config = config;
    this.client = new Ollama({
      host: config.baseUrl,
    });
  }

  async generateCompletion(
    messages: LLMMessage[],
    options?: LLMOptions
  ): Promise<LLMResponse> {
    const response = await this.client.chat({
      model: this.config.model,
      messages: messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
      options: {
        temperature: options?.temperature ?? this.config.temperature,
        num_predict: options?.maxTokens,
        stop: options?.stopSequences,
      },
    });

    if (!response.message?.content) {
      throw new Error('No response from Ollama');
    }

    return {
      content: response.message.content,
      usage: {
        promptTokens: response.prompt_eval_count || 0,
        completionTokens: response.eval_count || 0,
        totalTokens: (response.prompt_eval_count || 0) + (response.eval_count || 0),
      },
    };
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.client.embeddings({
      model: this.config.model,
      prompt: text,
    });

    return response.embedding;
  }

  /**
   * Generate SQL from natural language using Ollama
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
   * Optimize SQL query using Ollama
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

    try {
      const result = this.extractJSON(response.content);
      return {
        optimizedSQL: result.optimizedSQL || sql,
        suggestions: result.suggestions || [],
        improvement: result.improvement || 'No specific improvements identified',
      };
    } catch (error) {
      // Fallback: return original SQL with no suggestions
      return {
        optimizedSQL: sql,
        suggestions: [],
        improvement: 'Unable to generate optimizations',
      };
    }
  }

  /**
   * Check if Ollama server is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.client.list();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<string[]> {
    const response = await this.client.list();
    return response.models.map((m) => m.name);
  }
}

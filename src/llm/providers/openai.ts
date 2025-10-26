/**
 * OpenAI LLM Provider
 */

import OpenAI from 'openai';
import { BaseLLMProvider, LLMMessage, LLMResponse, LLMOptions } from '../base';
import { OpenAIConfig } from '../../types';

export class OpenAIProvider extends BaseLLMProvider {
  private client: OpenAI;
  private config: OpenAIConfig;

  constructor(config: OpenAIConfig) {
    super();
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
    });
  }

  async generateCompletion(
    messages: LLMMessage[],
    options?: LLMOptions
  ): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: this.config.model,
      messages: messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
      temperature: options?.temperature ?? this.config.temperature,
      max_tokens: options?.maxTokens ?? this.config.maxTokens,
      stop: options?.stopSequences,
    });

    const choice = response.choices[0];
    if (!choice || !choice.message.content) {
      throw new Error('No response from OpenAI');
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

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });

    return response.data[0].embedding;
  }

  /**
   * Generate SQL from natural language using OpenAI
   */
  async generateSQL(
    query: string,
    schema: string,
    examples?: string,
    conversationContext?: string
  ): Promise<{
    sql: string;
    explanation: string;
    confidence: number;
    isConversational?: boolean;
    conversationalResponse?: string;
    needsClarification?: boolean;
    clarificationQuestion?: string;
    suggestedInterpretations?: Array<{ description: string; sql: string }>;
  }> {
    const messages = this.createSQLPrompt(query, schema, examples, conversationContext);
    const response = await this.generateCompletion(messages, {
      temperature: 0.1,
    });

    try {
      const result = this.extractJSON(response.content);
      return {
        sql: result.sql || '',
        explanation: result.explanation || '',
        confidence: result.confidence || 0.8,
        isConversational: result.isConversational || false,
        conversationalResponse: result.conversationalResponse,
        needsClarification: result.needsClarification || false,
        clarificationQuestion: result.clarificationQuestion,
        suggestedInterpretations: result.suggestedInterpretations,
      };
    } catch (error) {
      // Fallback: try to extract SQL from response
      const sqlMatch = response.content.match(/SELECT[\s\S]*?;/i);
      if (sqlMatch) {
        return {
          sql: sqlMatch[0],
          explanation: 'Extracted from response',
          confidence: 0.6,
          isConversational: false,
        };
      }
      throw new Error(`Failed to parse SQL from response: ${error}`);
    }
  }

  /**
   * Optimize SQL query using OpenAI
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

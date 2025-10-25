/**
 * LLM Provider Factory
 */

import { BaseLLMProvider } from './base';
import { OpenAIProvider } from './providers/openai';
import { AnthropicProvider } from './providers/anthropic';
import { OllamaProvider } from './providers/ollama';
import { LLMConfig } from '../types';

export * from './base';
export * from './providers/openai';
export * from './providers/anthropic';
export * from './providers/ollama';

export class LLMFactory {
  static create(config: LLMConfig): BaseLLMProvider {
    switch (config.provider) {
      case 'openai':
        if (!config.openai) {
          throw new Error('OpenAI configuration is missing');
        }
        return new OpenAIProvider(config.openai);

      case 'anthropic':
        if (!config.anthropic) {
          throw new Error('Anthropic configuration is missing');
        }
        return new AnthropicProvider(config.anthropic);

      case 'ollama':
        if (!config.ollama) {
          throw new Error('Ollama configuration is missing');
        }
        return new OllamaProvider(config.ollama);

      default:
        throw new Error(`Unsupported LLM provider: ${config.provider}`);
    }
  }
}

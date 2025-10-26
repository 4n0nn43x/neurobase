/**
 * Configuration loader for NeuroBase
 */

import dotenv from 'dotenv';
import { Config } from '../types';

dotenv.config();

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvVarOptional(key: string, defaultValue?: string): string | undefined {
  return process.env[key] || defaultValue;
}

function getEnvVarNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  return value ? parseInt(value, 10) : defaultValue;
}

function getEnvVarBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

export function loadConfig(): Config {
  const llmProvider = getEnvVar('LLM_PROVIDER', 'openai') as 'openai' | 'anthropic' | 'ollama';

  const config: Config = {
    tiger: {
      connectionString: getEnvVar('DATABASE_URL'),
    },
    llm: {
      provider: llmProvider,
      openai:
        llmProvider === 'openai'
          ? {
              apiKey: getEnvVar('OPENAI_API_KEY'),
              model: getEnvVar('OPENAI_MODEL', 'gpt-4-turbo-preview'),
              temperature: getEnvVarNumber('OPENAI_TEMPERATURE', 0.1),
              maxTokens: getEnvVarNumber('OPENAI_MAX_TOKENS', 2000),
            }
          : undefined,
      anthropic:
        llmProvider === 'anthropic'
          ? {
              apiKey: getEnvVar('ANTHROPIC_API_KEY'),
              model: getEnvVar('ANTHROPIC_MODEL', 'claude-3-5-sonnet-20241022'),
              temperature: getEnvVarNumber('ANTHROPIC_TEMPERATURE', 0.1),
              maxTokens: getEnvVarNumber('ANTHROPIC_MAX_TOKENS', 2000),
            }
          : undefined,
      ollama:
        llmProvider === 'ollama'
          ? {
              baseUrl: getEnvVar('OLLAMA_BASE_URL', 'http://localhost:11434'),
              model: getEnvVar('OLLAMA_MODEL', 'llama3.2'),
              temperature: getEnvVarNumber('OLLAMA_TEMPERATURE', 0.1),
            }
          : undefined,
    },
    neurobase: {
      mode: (getEnvVar('NEUROBASE_MODE', 'interactive') as 'interactive' | 'api' | 'readonly'),
      logLevel: (getEnvVar('NEUROBASE_LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error'),
      port: getEnvVarNumber('NEUROBASE_PORT', 3000),
    },
    features: {
      enableLearning: getEnvVarBoolean('ENABLE_LEARNING', true),
      enableOptimization: getEnvVarBoolean('ENABLE_OPTIMIZATION', true),
      enableSchemaSuggestions: getEnvVarBoolean('ENABLE_SCHEMA_SUGGESTIONS', true),
      enableQueryCache: getEnvVarBoolean('ENABLE_QUERY_CACHE', true),
    },
    security: {
      apiRateLimit: getEnvVarNumber('API_RATE_LIMIT', 100),
      readonlyMode: getEnvVarBoolean('READONLY_MODE', false),
      maxQueryTime: getEnvVarNumber('MAX_QUERY_TIME', 30000),
    },
  };

  return config;
}

export const config = loadConfig();

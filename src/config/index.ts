/**
 * Configuration loader for NeuroBase
 */

import dotenv from 'dotenv';
import { Config, LLMProviderName } from '../types';
import { loadProfile, getActiveDatabase } from './profile-store';
import { getCredential } from './credential-store';

dotenv.config();

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
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

function requireKey(envName: string): string {
  throw new Error(
    `Missing API key for ${envName}. Run \`neurobase setup\` or set ${envName} in your environment.`,
  );
}

/**
 * Resolution order (highest priority first):
 *   1. process.env  (CLI flags or shell exports)
 *   2. ~/.neurobase/profiles/<active>.json + credentials.json
 *   3. .env file (already loaded into process.env above by dotenv)
 *
 * The profile path takes precedence over .env so that a global wizard-driven
 * setup beats a stale per-project .env. Users on the legacy .env flow keep
 * working unchanged because process.env wins over the profile.
 */
export function loadConfig(profileName?: string): Config {
  const profile = loadProfile(profileName);
  const activeDb = getActiveDatabase(profile);

  const llmProvider = (process.env.LLM_PROVIDER || profile?.llm?.provider || 'openai') as LLMProviderName;
  const dbEngine = (process.env.DB_ENGINE || activeDb?.engine || 'postgresql') as 'postgresql' | 'mysql' | 'sqlite' | 'mongodb';

  const dbUrl = process.env.DATABASE_URL || activeDb?.connectionString;
  if (!dbUrl) {
    throw new Error(
      'No database configured. Run `neurobase setup db` to register one, or set DATABASE_URL.',
    );
  }

  const config: Config = {
    database: {
      engine: dbEngine,
      connectionString: dbUrl,
      ssl: {
        enabled: getEnvVarBoolean('DB_SSL_ENABLED', activeDb?.ssl?.enabled ?? true),
        rejectUnauthorized: getEnvVarBoolean('DB_SSL_REJECT_UNAUTHORIZED', activeDb?.ssl?.rejectUnauthorized ?? true),
      },
      pool: {
        max: getEnvVarNumber('DB_POOL_MAX', activeDb?.pool?.max ?? 20),
        idleTimeoutMillis: getEnvVarNumber('DB_POOL_IDLE_TIMEOUT', activeDb?.pool?.idleTimeoutMillis ?? 30000),
        connectionTimeoutMillis: getEnvVarNumber('DB_POOL_CONNECTION_TIMEOUT', activeDb?.pool?.connectionTimeoutMillis ?? 10000),
      },
    },
    llm: {
      provider: llmProvider,
      openai:
        llmProvider === 'openai'
          ? {
              apiKey: process.env.OPENAI_API_KEY || getCredential('openai') || profile?.llm?.openai?.apiKey || requireKey('OPENAI_API_KEY'),
              model: process.env.OPENAI_MODEL || profile?.llm?.openai?.model || 'gpt-4o',
              temperature: getEnvVarNumber('OPENAI_TEMPERATURE', profile?.llm?.openai?.temperature ?? 0.1),
              maxTokens: getEnvVarNumber('OPENAI_MAX_TOKENS', profile?.llm?.openai?.maxTokens ?? 2000),
            }
          : undefined,
      anthropic:
        llmProvider === 'anthropic'
          ? {
              apiKey: process.env.ANTHROPIC_API_KEY || getCredential('anthropic') || profile?.llm?.anthropic?.apiKey || requireKey('ANTHROPIC_API_KEY'),
              model: process.env.ANTHROPIC_MODEL || profile?.llm?.anthropic?.model || 'claude-sonnet-4-5',
              temperature: getEnvVarNumber('ANTHROPIC_TEMPERATURE', profile?.llm?.anthropic?.temperature ?? 0.1),
              maxTokens: getEnvVarNumber('ANTHROPIC_MAX_TOKENS', profile?.llm?.anthropic?.maxTokens ?? 2000),
            }
          : undefined,
      openrouter:
        llmProvider === 'openrouter'
          ? {
              apiKey: process.env.OPENROUTER_API_KEY || getCredential('openrouter') || profile?.llm?.openrouter?.apiKey || requireKey('OPENROUTER_API_KEY'),
              model: process.env.OPENROUTER_MODEL || profile?.llm?.openrouter?.model || 'anthropic/claude-sonnet-4-5',
              temperature: getEnvVarNumber('OPENROUTER_TEMPERATURE', profile?.llm?.openrouter?.temperature ?? 0.1),
              maxTokens: getEnvVarNumber('OPENROUTER_MAX_TOKENS', profile?.llm?.openrouter?.maxTokens ?? 2000),
              appName: process.env.OPENROUTER_APP_NAME || profile?.llm?.openrouter?.appName,
              appUrl: process.env.OPENROUTER_APP_URL || profile?.llm?.openrouter?.appUrl,
            }
          : undefined,
      ollama:
        llmProvider === 'ollama'
          ? {
              baseUrl: process.env.OLLAMA_BASE_URL || profile?.llm?.ollama?.baseUrl || 'http://localhost:11434',
              model: process.env.OLLAMA_MODEL || profile?.llm?.ollama?.model || 'llama3.2',
              temperature: getEnvVarNumber('OLLAMA_TEMPERATURE', profile?.llm?.ollama?.temperature ?? 0.1),
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
      enableSelfCorrection: getEnvVarBoolean('ENABLE_SELF_CORRECTION', true),
      enableMultiCandidate: getEnvVarBoolean('ENABLE_MULTI_CANDIDATE', false),
    },
    security: {
      apiRateLimit: getEnvVarNumber('API_RATE_LIMIT', 100),
      readonlyMode: getEnvVarBoolean('READONLY_MODE', false),
      maxQueryTime: getEnvVarNumber('MAX_QUERY_TIME', 30000),
      maxLLMTime: getEnvVarNumber('MAX_LLM_TIME', 60000),
      privacyMode: (getEnvVar('PRIVACY_MODE', profile?.security?.privacyMode ?? 'schema-only') as 'strict' | 'schema-only' | 'permissive'),
      permissionLevel: (process.env.PERMISSION_LEVEL ?? profile?.security?.permissionLevel ?? 'write') as 'read-only' | 'write' | 'ddl' | 'admin',
    },
  };

  return config;
}

// Lazy proxy — loadConfig() runs on first access, not at module import.
// Keeps `neurobase --version`, `--help`, `setup`, and `doctor` working without a .env file.
let _config: Config | null = null;
export const config = new Proxy({} as Config, {
  get(_target, prop) {
    if (!_config) _config = loadConfig();
    return _config[prop as keyof Config];
  },
  has(_target, prop) {
    if (!_config) _config = loadConfig();
    return prop in _config;
  },
  ownKeys() {
    if (!_config) _config = loadConfig();
    return Reflect.ownKeys(_config);
  },
  getOwnPropertyDescriptor(_target, prop) {
    if (!_config) _config = loadConfig();
    return Reflect.getOwnPropertyDescriptor(_config, prop);
  },
});

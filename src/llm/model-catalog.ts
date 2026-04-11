/**
 * Static + dynamic model catalogues for the `/model` slash command
 * and the login wizard.
 *
 * Static lists are short curated defaults. For OpenRouter and Ollama,
 * the live endpoint is queried when possible.
 */

import { OpenRouterProvider } from './providers/openrouter';
import type { LLMProviderName } from '../types';

export interface ModelChoice {
  value: string;
  label: string;
  hint?: string;
}

export const ANTHROPIC_MODELS: ModelChoice[] = [
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', hint: 'recommended' },
  { value: 'claude-opus-4-7', label: 'Claude Opus 4.7', hint: 'strongest reasoning' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', hint: 'fastest, cheapest' },
];

export const OPENAI_MODELS: ModelChoice[] = [
  { value: 'gpt-4o', label: 'GPT-4o', hint: 'recommended' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini', hint: 'fastest, cheapest' },
  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
];

const OLLAMA_FALLBACK: ModelChoice[] = [
  { value: 'llama3.2', label: 'llama3.2' },
  { value: 'qwen2.5-coder', label: 'qwen2.5-coder', hint: 'code-tuned' },
  { value: 'mistral', label: 'mistral' },
];

const OPENROUTER_FALLBACK: ModelChoice[] = [
  { value: 'anthropic/claude-sonnet-4-5', label: 'anthropic/claude-sonnet-4-5', hint: 'recommended' },
  { value: 'openai/gpt-4o', label: 'openai/gpt-4o' },
  { value: 'google/gemini-2.0-flash-001', label: 'google/gemini-2.0-flash-001' },
];

export async function getModelChoices(
  provider: LLMProviderName,
  context?: { apiKey?: string; baseUrl?: string; limit?: number },
): Promise<ModelChoice[]> {
  const limit = context?.limit ?? 40;

  if (provider === 'anthropic') return ANTHROPIC_MODELS;
  if (provider === 'openai') return OPENAI_MODELS;

  if (provider === 'openrouter') {
    try {
      const fetched = await OpenRouterProvider.listModels(context?.apiKey);
      if (fetched.length > 0) {
        return fetched.slice(0, limit).map((m) => ({
          value: m.id,
          label: m.name || m.id,
          hint: m.context_length ? `${Math.round(m.context_length / 1000)}k ctx` : undefined,
        }));
      }
    } catch { /* fall through */ }
    return OPENROUTER_FALLBACK;
  }

  if (provider === 'ollama') {
    try {
      const base = context?.baseUrl || 'http://localhost:11434';
      const res = await fetch(`${base.replace(/\/$/, '')}/api/tags`);
      if (res.ok) {
        const data = (await res.json()) as { models?: Array<{ name: string }> };
        const installed = (data.models || []).map((m) => ({ value: m.name, label: m.name }));
        if (installed.length > 0) return installed;
      }
    } catch { /* fall through */ }
    return OLLAMA_FALLBACK;
  }

  return [];
}

/**
 * Searchable model picker — shared by the login wizard and the
 * interactive /model command.
 *
 * Backed by @inquirer/prompts search() so users can type to filter
 * a large list (OpenRouter currently exposes 300+ models).
 */

import { search } from '@inquirer/prompts';
import type { ModelChoice } from '../llm/model-catalog';

export interface PickModelOptions {
  message?: string;
  models: ModelChoice[];
  currentValue?: string;
}

export async function pickModel(opts: PickModelOptions): Promise<string | null> {
  const models = opts.models;
  if (models.length === 0) return null;

  const message =
    opts.message ?? (opts.currentValue ? `Model (current: ${opts.currentValue})` : 'Model');

  try {
    const selected = await search<string>({
      message,
      source: async (input) => {
        const q = (input ?? '').toLowerCase().trim();
        const filtered = q
          ? models.filter(
              (m) => m.value.toLowerCase().includes(q) || m.label.toLowerCase().includes(q),
            )
          : models;

        return filtered.map((m) => ({
          name: m.hint ? `${m.label}  —  ${m.hint}` : m.label,
          value: m.value,
          description: m.hint,
        }));
      },
    });
    return selected;
  } catch (err) {
    // Inquirer throws ExitPromptError on Ctrl+C / ESC. Surface as null so
    // callers can interpret it as "user cancelled" without crashing.
    const name = (err as { name?: string })?.name;
    if (name === 'ExitPromptError' || name === 'AbortPromptError') return null;
    throw err;
  }
}

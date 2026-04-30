/**
 * Cost Tracker — per-provider, per-model token accounting with optional
 * daily budget enforcement.
 *
 * NeuroBase fires 3-5 LLM calls per user query (linguistic agent, optimiser,
 * explainer, self-correction, multi-candidate). Without explicit tracking,
 * production costs are invisible until the bill arrives. This module
 * subscribes to LLM responses, accumulates token spend, and emits an alert
 * when a configured budget is exceeded.
 *
 * Inspired by claw-code's cost_tracker.py (much smaller scope here — we
 * only care about LLM tokens, not arbitrary "units").
 */

import { logger } from '../utils/logger';

export type ProviderName = 'openai' | 'anthropic' | 'openrouter' | 'ollama';

export interface TokenRate {
  /** USD per 1M input (prompt) tokens. */
  inputPer1M: number;
  /** USD per 1M output (completion) tokens. */
  outputPer1M: number;
}

/**
 * Default rates as of late-2025 pricing. Customers can override via
 * setRate() — OpenRouter pricing varies per model so the default rates
 * are conservative averages.
 */
const DEFAULT_RATES: Record<string, TokenRate> = {
  // Anthropic
  'claude-sonnet-4-5':            { inputPer1M: 3.00,  outputPer1M: 15.00 },
  'claude-opus-4-7':              { inputPer1M: 15.00, outputPer1M: 75.00 },
  'claude-haiku-4-5-20251001':    { inputPer1M: 0.80,  outputPer1M: 4.00  },

  // OpenAI
  'gpt-4o':       { inputPer1M: 2.50, outputPer1M: 10.00 },
  'gpt-4o-mini':  { inputPer1M: 0.15, outputPer1M: 0.60 },
  'gpt-4-turbo':  { inputPer1M: 10.0, outputPer1M: 30.0 },

  // Ollama — local, no $ cost.
  'ollama-local': { inputPer1M: 0, outputPer1M: 0 },
};

export interface UsageRecord {
  timestamp: number;
  provider: ProviderName;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

export interface BudgetConfig {
  /** Daily budget in USD; null = unlimited. */
  dailyUsd: number | null;
  /** Fraction of the budget at which to emit a warning (default 0.8). */
  warnThreshold?: number;
}

type BudgetHandler = (evt: { spentUsd: number; budgetUsd: number; threshold: 'warn' | 'exceeded' }) => void;

export class CostTracker {
  private records: UsageRecord[] = [];
  private rates: Record<string, TokenRate> = { ...DEFAULT_RATES };
  private budget: BudgetConfig = { dailyUsd: null, warnThreshold: 0.8 };
  private handlers: BudgetHandler[] = [];
  private lastWarnedDay = '';
  private lastExceededDay = '';

  setBudget(budget: BudgetConfig): void {
    this.budget = { warnThreshold: 0.8, ...budget };
  }

  /** Override the cost rate for a specific model (e.g. enterprise pricing). */
  setRate(model: string, rate: TokenRate): void {
    this.rates[model] = rate;
  }

  /** Subscribe to threshold events. */
  onBudgetEvent(handler: BudgetHandler): void {
    this.handlers.push(handler);
  }

  /** Record one LLM round-trip. Returns the computed cost in USD. */
  record(input: {
    provider: ProviderName;
    model: string;
    promptTokens: number;
    completionTokens: number;
  }): UsageRecord {
    const rate = this.rateFor(input.provider, input.model);
    const cost =
      (input.promptTokens / 1_000_000) * rate.inputPer1M +
      (input.completionTokens / 1_000_000) * rate.outputPer1M;

    const rec: UsageRecord = {
      timestamp: Date.now(),
      provider: input.provider,
      model: input.model,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      costUsd: cost,
    };
    this.records.push(rec);
    this.checkBudget();
    return rec;
  }

  /** USD spent so far today (UTC). */
  spentToday(): number {
    const dayKey = this.dayKey();
    return this.records
      .filter((r) => this.dayKeyFor(r.timestamp) === dayKey)
      .reduce((sum, r) => sum + r.costUsd, 0);
  }

  /** Total tokens (in + out) today, useful for `/stats`. */
  tokensToday(): { input: number; output: number; total: number } {
    const dayKey = this.dayKey();
    const today = this.records.filter((r) => this.dayKeyFor(r.timestamp) === dayKey);
    const input = today.reduce((s, r) => s + r.promptTokens, 0);
    const output = today.reduce((s, r) => s + r.completionTokens, 0);
    return { input, output, total: input + output };
  }

  /** Per-model breakdown for today (sorted descending by cost). */
  breakdownToday(): Array<{ model: string; tokens: number; costUsd: number; calls: number }> {
    const dayKey = this.dayKey();
    const byModel: Record<string, { tokens: number; costUsd: number; calls: number }> = {};
    for (const r of this.records) {
      if (this.dayKeyFor(r.timestamp) !== dayKey) continue;
      const slot = byModel[r.model] ?? { tokens: 0, costUsd: 0, calls: 0 };
      slot.tokens += r.promptTokens + r.completionTokens;
      slot.costUsd += r.costUsd;
      slot.calls += 1;
      byModel[r.model] = slot;
    }
    return Object.entries(byModel)
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.costUsd - a.costUsd);
  }

  /** Number of recorded calls (all-time, in-memory). */
  totalCalls(): number {
    return this.records.length;
  }

  /** Drop in-memory history. */
  reset(): void {
    this.records = [];
    this.lastWarnedDay = '';
    this.lastExceededDay = '';
  }

  private rateFor(provider: ProviderName, model: string): TokenRate {
    if (provider === 'ollama') return this.rates['ollama-local'];
    if (this.rates[model]) return this.rates[model];
    // OpenRouter model ids are namespaced ("anthropic/claude-sonnet-4-5"); try
    // the un-namespaced tail before falling back to a conservative default.
    const tail = model.split('/').pop();
    if (tail && this.rates[tail]) return this.rates[tail];
    return { inputPer1M: 1.0, outputPer1M: 3.0 };
  }

  private checkBudget(): void {
    const budget = this.budget.dailyUsd;
    if (budget === null || budget <= 0) return;

    const spent = this.spentToday();
    const threshold = this.budget.warnThreshold ?? 0.8;
    const day = this.dayKey();

    if (spent >= budget && this.lastExceededDay !== day) {
      this.lastExceededDay = day;
      logger.warn({ spent, budget }, 'Daily LLM cost budget exceeded');
      for (const h of this.handlers) {
        try { h({ spentUsd: spent, budgetUsd: budget, threshold: 'exceeded' }); } catch { /* swallow */ }
      }
    } else if (spent >= budget * threshold && this.lastWarnedDay !== day) {
      this.lastWarnedDay = day;
      logger.warn({ spent, budget, threshold }, 'Daily LLM cost approaching budget');
      for (const h of this.handlers) {
        try { h({ spentUsd: spent, budgetUsd: budget, threshold: 'warn' }); } catch { /* swallow */ }
      }
    }
  }

  private dayKey(): string {
    return this.dayKeyFor(Date.now());
  }

  private dayKeyFor(ts: number): string {
    return new Date(ts).toISOString().slice(0, 10);
  }
}

/** Singleton — most callers don't need a per-instance tracker. */
let _instance: CostTracker | null = null;

export function getCostTracker(): CostTracker {
  if (!_instance) _instance = new CostTracker();
  return _instance;
}

export function resetCostTracker(): void {
  _instance = null;
}

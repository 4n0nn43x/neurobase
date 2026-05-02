/**
 * Cost tracker — math, budgets, event firing.
 */

import { CostTracker } from '../../src/observability/cost-tracker';

describe('CostTracker', () => {
  it('computes cost from default Anthropic rates', () => {
    const t = new CostTracker();
    // claude-sonnet-4-5: $3 / 1M input, $15 / 1M output
    const rec = t.record({ provider: 'anthropic', model: 'claude-sonnet-4-5', promptTokens: 1_000_000, completionTokens: 1_000_000 });
    expect(rec.costUsd).toBeCloseTo(18, 5);
  });

  it('charges $0 for ollama', () => {
    const t = new CostTracker();
    const rec = t.record({ provider: 'ollama', model: 'llama3.2', promptTokens: 10_000, completionTokens: 5_000 });
    expect(rec.costUsd).toBe(0);
  });

  it('resolves OpenRouter namespaced model ids', () => {
    const t = new CostTracker();
    const rec = t.record({
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4-5',
      promptTokens: 1_000_000,
      completionTokens: 0,
    });
    // Should pick up the "claude-sonnet-4-5" rate from the trailing segment.
    expect(rec.costUsd).toBeCloseTo(3, 5);
  });

  it('falls back to a conservative default rate for unknown models', () => {
    const t = new CostTracker();
    const rec = t.record({ provider: 'openai', model: 'mystery-model-x', promptTokens: 1_000_000, completionTokens: 0 });
    expect(rec.costUsd).toBeCloseTo(1.0, 5);
  });

  it('setRate overrides the default', () => {
    const t = new CostTracker();
    t.setRate('claude-sonnet-4-5', { inputPer1M: 0.5, outputPer1M: 1.0 });
    const rec = t.record({ provider: 'anthropic', model: 'claude-sonnet-4-5', promptTokens: 1_000_000, completionTokens: 1_000_000 });
    expect(rec.costUsd).toBeCloseTo(1.5, 5);
  });

  it('accumulates spend across multiple calls (same day)', () => {
    const t = new CostTracker();
    t.record({ provider: 'anthropic', model: 'claude-sonnet-4-5', promptTokens: 500_000, completionTokens: 100_000 });
    t.record({ provider: 'anthropic', model: 'claude-sonnet-4-5', promptTokens: 500_000, completionTokens: 100_000 });
    expect(t.spentToday()).toBeCloseTo((1_000_000 / 1_000_000) * 3 + (200_000 / 1_000_000) * 15, 5);
    expect(t.totalCalls()).toBe(2);
  });

  it('fires a warn event when crossing 80% of the daily budget', () => {
    const t = new CostTracker();
    t.setBudget({ dailyUsd: 10, warnThreshold: 0.8 });
    const events: string[] = [];
    t.onBudgetEvent((e) => events.push(e.threshold));
    // 1M input @ $3/M + 0.5M output @ $15/M = $3 + $7.5 = $10.5 → crosses both
    // 80% ($8) and the full budget ($10) on the same record.
    t.record({ provider: 'anthropic', model: 'claude-sonnet-4-5', promptTokens: 1_000_000, completionTokens: 500_000 });
    expect(events).toContain('exceeded');
  });

  it('breakdown sorts models by cost descending', () => {
    const t = new CostTracker();
    t.record({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001', promptTokens: 100_000, completionTokens: 0 });
    t.record({ provider: 'anthropic', model: 'claude-opus-4-7', promptTokens: 100_000, completionTokens: 0 });
    t.record({ provider: 'anthropic', model: 'claude-sonnet-4-5', promptTokens: 100_000, completionTokens: 0 });
    const breakdown = t.breakdownToday();
    expect(breakdown[0].model).toBe('claude-opus-4-7');
    expect(breakdown[breakdown.length - 1].model).toBe('claude-haiku-4-5-20251001');
  });

  it('reset clears in-memory state', () => {
    const t = new CostTracker();
    t.record({ provider: 'anthropic', model: 'claude-sonnet-4-5', promptTokens: 1_000_000, completionTokens: 0 });
    expect(t.totalCalls()).toBe(1);
    t.reset();
    expect(t.totalCalls()).toBe(0);
    expect(t.spentToday()).toBe(0);
  });
});

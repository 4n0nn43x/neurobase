/**
 * MockLLMProvider — exercises the offline test provider used to verify the
 * pipeline without hitting Anthropic/OpenAI/OpenRouter.
 */

import { MockLLMProvider } from '../../src/llm/providers/mock';

describe('MockLLMProvider', () => {
  it('returns the default response when no scenario matches', async () => {
    const mock = new MockLLMProvider({
      defaultResponse: JSON.stringify({ sql: 'SELECT 42', confidence: 0.9 }),
    });

    const res = await mock.generateCompletion([{ role: 'user', content: 'whatever' }]);
    const parsed = JSON.parse(res.content);
    expect(parsed.sql).toBe('SELECT 42');
    expect(res.usage).toBeDefined();
    expect(res.usage!.promptTokens).toBeGreaterThan(0);
  });

  it('matches string scenarios against the last user message', async () => {
    const mock = new MockLLMProvider({
      scenarios: [
        { match: 'top 5 customers', response: JSON.stringify({ sql: 'SELECT * FROM customers LIMIT 5' }) },
      ],
    });

    const res = await mock.generateCompletion([
      { role: 'system', content: 'You are an SQL expert' },
      { role: 'user', content: 'show me the top 5 customers by revenue' },
    ]);

    expect(JSON.parse(res.content).sql).toBe('SELECT * FROM customers LIMIT 5');
  });

  it('matches regex scenarios', async () => {
    const mock = new MockLLMProvider({
      scenarios: [
        { match: /count.*orders/i, response: JSON.stringify({ sql: 'SELECT COUNT(*) FROM orders' }) },
      ],
    });

    const res = await mock.generateCompletion([{ role: 'user', content: 'Count the orders placed today' }]);
    expect(JSON.parse(res.content).sql).toBe('SELECT COUNT(*) FROM orders');
  });

  it('records calls when recordCalls is on', async () => {
    const mock = new MockLLMProvider({ recordCalls: true });
    await mock.generateCompletion([{ role: 'user', content: 'first' }]);
    await mock.generateCompletion([{ role: 'user', content: 'second' }]);

    const calls = mock.getCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0].messages[0].content).toBe('first');
    expect(calls[1].messages[0].content).toBe('second');
  });

  it('supports setModel for the /model command flow', () => {
    const mock = new MockLLMProvider({ model: 'mock-a' });
    expect(mock.getModel()).toBe('mock-a');
    mock.setModel('mock-b');
    expect(mock.getModel()).toBe('mock-b');
  });

  it('produces deterministic embeddings of the requested dimension', async () => {
    const mock = new MockLLMProvider({ embeddingDim: 8 });
    const a = await mock.generateEmbedding('hello world');
    const b = await mock.generateEmbedding('hello world');
    const c = await mock.generateEmbedding('different text');

    expect(a).toHaveLength(8);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    // All values normalized to roughly [-1, 1]
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

/**
 * Integration test — full NL → SQL → execute path with a stub LLM and a
 * stub adapter. No external services, no native deps.
 *
 * Verifies that the linguistic agent's JSON output reaches the adapter,
 * the security analyzer / supervisor gates run before execution, and the
 * resulting rows make it back to the caller.
 */

import { MemoryAdapter } from './memory-adapter';
import { MockLLMProvider } from '../../src/llm/providers/mock';
import { LinguisticAgent } from '../../src/agents/linguistic';
import { SQLSecurityAnalyzer } from '../../src/security/sql-parser';
import { OperationSupervisor } from '../../src/orchestrator/supervisor';

const SAMPLE_TABLES = [
  { name: 'customers', schema: 'public' },
  { name: 'orders', schema: 'public' },
];

describe('pipeline integration (mock LLM + memory adapter)', () => {
  it('routes a natural-language question to a SELECT and returns rows', async () => {
    const adapter = new MemoryAdapter({
      tables: SAMPLE_TABLES as never,
      responses: [
        {
          match: /SELECT[\s\S]*customers/i,
          rows: [
            { id: 1, name: 'Alice', order_count: 12 },
            { id: 2, name: 'Bob',   order_count: 9 },
          ],
        },
      ],
    });

    const llm = new MockLLMProvider({
      scenarios: [
        {
          match: 'top customers',
          response: JSON.stringify({
            sql: 'SELECT c.name, COUNT(o.id) AS order_count FROM customers c LEFT JOIN orders o ON c.id = o.customer_id GROUP BY c.name ORDER BY order_count DESC LIMIT 5',
            explanation: 'Top customers ordered by their order count.',
            confidence: 0.92,
            isConversational: false,
          }),
        },
      ],
    });

    const ling = new LinguisticAgent(llm, adapter as never);
    const result = await ling.process({
      query: { text: 'top customers by total orders' },
      schema: { tables: [], views: [], functions: [] } as never,
      learningHistory: [],
    });

    expect(result.sql).toMatch(/SELECT[\s\S]*customers/i);
    expect(result.confidence).toBeGreaterThan(0.5);

    // Security analyzer + supervisor accept it.
    const analyzer = new SQLSecurityAnalyzer();
    const analysis = analyzer.analyze(result.sql);
    expect(analysis.isAllowed).toBe(true);

    const sup = new OperationSupervisor();
    const enforce = sup.enforce(result.sql, 'read-only');
    expect(enforce.allowed).toBe(true);
    expect(enforce.riskLevel).toBe('read');

    // Adapter returns the canned rows for that query shape.
    const exec = await adapter.query(result.sql);
    expect(exec.rows).toHaveLength(2);
    expect(exec.rows[0]).toMatchObject({ name: 'Alice', order_count: 12 });
    expect(adapter.queries[0].sql).toBe(result.sql);
  });

  it('blocks the pipeline on a DELETE without WHERE before it ever runs', async () => {
    const adapter = new MemoryAdapter();
    const sup = new OperationSupervisor();

    const offending = 'DELETE FROM users';
    const enforce = sup.enforce(offending, 'write');

    expect(enforce.allowed).toBe(false);
    expect(enforce.reason).toMatch(/destructive|DELETE/i);
    expect(adapter.queries).toHaveLength(0); // never reaches the adapter
  });

  it('blocks DDL under the write level, allows it under ddl/admin', async () => {
    const sup = new OperationSupervisor();
    const sql = 'CREATE TABLE foo (id INTEGER)';
    expect(sup.enforce(sql, 'read-only').allowed).toBe(false);
    expect(sup.enforce(sql, 'write').allowed).toBe(false);
    expect(sup.enforce(sql, 'ddl').allowed).toBe(true);
    expect(sup.enforce(sql, 'admin').allowed).toBe(true);
  });

  it('GRANT stays blocked at every level (privilege escalation guard)', async () => {
    const sup = new OperationSupervisor();
    const sql = 'GRANT ALL ON users TO PUBLIC';
    for (const level of ['read-only', 'write', 'ddl', 'admin'] as const) {
      const r = sup.enforce(sql, level);
      expect(r.allowed).toBe(false);
    }
  });

  it('records LLM call usage on the mock provider', async () => {
    const llm = new MockLLMProvider({
      scenarios: [{ match: 'anything', response: JSON.stringify({ sql: 'SELECT 1', confidence: 1 }) }],
    });
    await llm.generateCompletion([{ role: 'user', content: 'anything goes' }]);
    expect(llm.getCalls()).toHaveLength(1);
    expect(llm.getCalls()[0].messages[0].content).toBe('anything goes');
  });
});

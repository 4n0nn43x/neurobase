/**
 * Schema pruner scoring + budget.
 *
 * The pruner is the gatekeeper that decides which tables the LLM gets to see.
 * Bugs here are silent — the LLM either hallucinates against a wrong subset
 * or runs out of context. Lock down the scoring math.
 */

import { SchemaPruner } from '../../src/rag/schema-pruner';
import type { DatabaseSchema, TableSchema } from '../../src/types';

function table(name: string, cols: Array<{ name: string; type?: string; description?: string }>, fks: Array<{ column: string; referencedTable: string; referencedColumn: string }> = []): TableSchema {
  return {
    name,
    schema: 'public',
    columns: cols.map((c) => ({
      name: c.name,
      type: c.type ?? 'text',
      nullable: true,
      description: c.description,
    })),
    primaryKeys: ['id'],
    foreignKeys: fks,
    indexes: [],
  };
}

describe('SchemaPruner', () => {
  it('returns every table unchanged when the schema is small', () => {
    const pruner = new SchemaPruner();
    const schema: DatabaseSchema = {
      tables: [
        table('users', [{ name: 'id' }, { name: 'email' }]),
        table('orders', [{ name: 'id' }, { name: 'user_id' }]),
      ],
      views: [], functions: [],
    };
    const out = pruner.prune(schema, 'show me all users');
    expect(out).toMatch(/Table: users/);
    expect(out).toMatch(/Table: orders/);
  });

  it('prioritises tables matching keywords in the query', () => {
    const pruner = new SchemaPruner();
    const tables: TableSchema[] = [];
    // 15 distractor tables so pruning activates (>10)
    for (let i = 0; i < 15; i++) {
      tables.push(table(`other_${i}`, [{ name: 'id' }, { name: 'value' }]));
    }
    tables.push(table('customers', [{ name: 'id' }, { name: 'name' }]));
    tables.push(table('orders', [{ name: 'id' }, { name: 'customer_id' }, { name: 'amount' }]));

    const schema: DatabaseSchema = { tables, views: [], functions: [] };
    const out = pruner.prune(schema, 'top customers by total orders');

    // Both target tables must be present even with 15 distractors.
    expect(out).toMatch(/Table: customers/);
    expect(out).toMatch(/Table: orders/);
  });

  it('respects the explicit token budget', () => {
    const pruner = new SchemaPruner();
    const tables: TableSchema[] = [];
    for (let i = 0; i < 25; i++) {
      tables.push(table(`tbl_${i}`, [
        { name: 'id' }, { name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' },
      ]));
    }
    const schema: DatabaseSchema = { tables, views: [], functions: [] };

    const tiny = pruner.prune(schema, 'random query', { tokenBudget: 200 });
    const huge = pruner.prune(schema, 'random query', { tokenBudget: 10000 });

    expect(tiny.length).toBeLessThan(huge.length);
  });

  it('honours tier-based budgets (tier 1/2 = compact, tier 4 = max)', () => {
    const pruner = new SchemaPruner();
    const tables: TableSchema[] = [];
    // 80 tables with many columns each → tier-1 budget (2k) cuts well below tier-4 (6k)
    for (let i = 0; i < 80; i++) {
      tables.push(table(`tbl_${i}`, [
        { name: 'id' }, { name: 'col_a' }, { name: 'col_b' },
        { name: 'col_c' }, { name: 'col_d' }, { name: 'col_e' },
      ]));
    }
    const schema: DatabaseSchema = { tables, views: [], functions: [] };

    const tier1 = pruner.prune(schema, 'q', { tier: 1 });
    const tier4 = pruner.prune(schema, 'q', { tier: 4 });

    expect(tier4.length).toBeGreaterThan(tier1.length);
  });

  it('pulls FK-connected tables in even when they did not score', () => {
    const pruner = new SchemaPruner();
    const tables: TableSchema[] = [];
    for (let i = 0; i < 12; i++) {
      tables.push(table(`noise_${i}`, [{ name: 'id' }, { name: 'data' }]));
    }
    tables.push(table('orders', [{ name: 'id' }, { name: 'customer_id' }],
      [{ column: 'customer_id', referencedTable: 'customers', referencedColumn: 'id' }]));
    tables.push(table('customers', [{ name: 'id' }, { name: 'email' }]));

    const schema: DatabaseSchema = { tables, views: [], functions: [] };
    // Query mentions only "orders" — without FK pull, customers wouldn't show.
    const out = pruner.prune(schema, 'orders from yesterday', { tokenBudget: 600 });
    expect(out).toMatch(/Table: orders/);
    expect(out).toMatch(/customers/);
  });

  it('historical frequency boosts a previously-used table', () => {
    const pruner = new SchemaPruner();
    const tables: TableSchema[] = [];
    for (let i = 0; i < 15; i++) {
      tables.push(table(`unused_${i}`, [{ name: 'id' }, { name: 'data' }]));
    }
    tables.push(table('hot_table', [{ name: 'id' }, { name: 'value' }]));
    const schema: DatabaseSchema = { tables, views: [], functions: [] };

    for (let i = 0; i < 5; i++) pruner.recordTableUsage('hot_table');
    const out = pruner.prune(schema, 'totally unrelated query text', { tokenBudget: 500 });
    expect(out).toMatch(/hot_table/);
  });
});

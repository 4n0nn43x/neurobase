/**
 * Minimal in-memory DatabaseAdapter used by integration tests.
 *
 * Just enough surface for NeuroBase.query() to round-trip a stubbed
 * scenario — schema introspection returns a hard-coded shape, query()
 * returns canned rows for the SQL the test expects.
 */

import type {
  DatabaseAdapter, DBQueryResult, TransactionHandle, TableInfo,
  ColumnInfo, ForeignKeyInfo, IndexInfo, ViewInfo, FunctionInfo,
  DatabaseStats, ForkInfo, ForkOptions, DialectHints,
} from '../../src/database/adapter';

export interface CannedResult {
  match: RegExp;
  rows: Record<string, unknown>[];
}

export interface MemoryAdapterOptions {
  tables?: TableInfo[];
  responses?: CannedResult[];
  defaultRows?: Record<string, unknown>[];
}

export class MemoryAdapter implements DatabaseAdapter {
  private opts: MemoryAdapterOptions;
  public queries: Array<{ sql: string; params?: unknown[] }> = [];

  constructor(opts: MemoryAdapterOptions = {}) {
    this.opts = opts;
  }

  async connect(): Promise<void> { /* no-op */ }
  async disconnect(): Promise<void> { /* no-op */ }
  async testConnection(): Promise<boolean> { return true; }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<DBQueryResult<T>> {
    this.queries.push({ sql, params });
    const canned = (this.opts.responses ?? []).find((r) => r.match.test(sql));
    const rows = (canned?.rows ?? this.opts.defaultRows ?? []) as T[];
    return { rows, rowCount: rows.length };
  }

  async execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }> {
    this.queries.push({ sql, params });
    return { rowCount: 0 };
  }

  async beginTransaction(): Promise<TransactionHandle> {
    return {
      query: async <T = Record<string, unknown>>() => ({ rows: [] as T[], rowCount: 0 }),
      commit: async () => undefined,
      rollback: async () => undefined,
    };
  }

  async getTables(): Promise<TableInfo[]> {
    return this.opts.tables ?? [];
  }
  async getColumns(): Promise<ColumnInfo[]> { return []; }
  async getPrimaryKeys(): Promise<string[]> { return []; }
  async getForeignKeys(): Promise<ForeignKeyInfo[]> { return []; }
  async getIndexes(): Promise<IndexInfo[]> { return []; }
  async getViews(): Promise<ViewInfo[]> { return []; }
  async getFunctions(): Promise<FunctionInfo[]> { return []; }
  async getRowCount(): Promise<number> { return 0; }
  async explain(): Promise<unknown> { return null; }
  async getDatabaseStats(): Promise<DatabaseStats> {
    return { sizeBytes: 0, tableCount: 0, indexCount: 0, connectionCount: 1 };
  }

  async createFork(_options: ForkOptions): Promise<ForkInfo> {
    return { id: 'mem-fork-1', name: 'mem-fork-1', status: 'ready', createdAt: new Date().toISOString() };
  }
  async listForks(): Promise<ForkInfo[]> { return []; }
  async deleteFork(): Promise<void> { /* no-op */ }

  getDialectName(): string { return 'PostgreSQL'; }
  getDialectHints(): DialectHints {
    return {
      parameterStyle: '$1, $2, $3',
      supportsILIKE: true, supportsCTEs: true, supportsWindowFunctions: true,
      supportsJSONB: true, supportsReturning: true, identifierQuote: '"',
      tips: [],
    };
  }
}

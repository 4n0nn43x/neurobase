/**
 * DatabaseConnection - Backward-compatible facade
 * Delegates to DatabaseAdapter for actual operations
 *
 * @deprecated Use DatabaseAdapter directly via AdapterFactory
 */

import { DatabaseAdapter, DatabaseConfig, DBQueryResult } from './adapter';
import { AdapterFactory } from './adapter-factory';

export class DatabaseConnection {
  private adapter: DatabaseAdapter;
  private connected = false;

  constructor(config: DatabaseConfig) {
    this.adapter = AdapterFactory.create(config);
  }

  async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.adapter.connect();
      this.connected = true;
    }
  }

  async query<T = any>(
    sql: string,
    params?: any[],
    options?: { timeout?: number }
  ): Promise<DBQueryResult<T>> {
    await this.ensureConnected();
    return this.adapter.query<T>(sql, params, options);
  }

  async explainQuery(sql: string, params?: any[]): Promise<any[]> {
    await this.ensureConnected();
    return this.adapter.explain(sql, params);
  }

  async testConnection(): Promise<boolean> {
    await this.ensureConnected();
    return this.adapter.testConnection();
  }

  async getDatabaseStats(): Promise<{ size: string; tables: number; connections: number }> {
    await this.ensureConnected();
    return this.adapter.getDatabaseStats();
  }

  async close(): Promise<void> {
    await this.adapter.disconnect();
    this.connected = false;
  }

  getAdapter(): DatabaseAdapter {
    return this.adapter;
  }
}

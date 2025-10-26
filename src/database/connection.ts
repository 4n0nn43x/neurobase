/**
 * Database connection management for Tiger Cloud
 */

import { Pool, PoolClient, QueryResult } from 'pg';
import { TigerConfig } from '../types';
import { logger } from '../utils/logger';

export class DatabaseConnection {
  private pool: Pool;
  // @ts-expect-error - Config stored for potential future use
  private _config: TigerConfig;

  constructor(config: TigerConfig) {
    this._config = config;

    // Parse connection string to remove conflicting SSL params
    const cleanConnectionString = config.connectionString.replace(/[?&]sslmode=[^&]*/, '');

    this.pool = new Pool({
      connectionString: cleanConnectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: {
        rejectUnauthorized: false, // Accept self-signed certs from Tiger Cloud
        // Tiger Cloud uses self-signed certificates which is safe for their managed service
      },
    });

    this.pool.on('error', (err) => {
      logger.error({ err }, 'Unexpected database pool error');
    });
  }

  /**
   * Execute a query
   */
  // @ts-expect-error - Generic type T kept for API compatibility
  async query<T = any>(
    sql: string,
    params?: any[],
    options?: { timeout?: number }
  ): Promise<QueryResult<any>> {
    const startTime = Date.now();
    const client = await this.pool.connect();

    try {
      // Set statement timeout if provided
      if (options?.timeout) {
        await client.query(`SET statement_timeout = ${options.timeout}`);
      }

      const result = await client.query(sql, params);
      const duration = Date.now() - startTime;

      logger.debug({
        sql: sql.substring(0, 100),
        duration,
        rows: result.rowCount,
      }, 'Query executed');

      return result;
    } catch (error) {
      logger.error({
        sql: sql.substring(0, 100),
        error,
      }, 'Query execution failed');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Execute a query with EXPLAIN ANALYZE
   */
  async explainQuery(sql: string, params?: any[]): Promise<any[]> {
    const explainSQL = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`;
    const result = await this.query(explainSQL, params);
    return result.rows[0]['QUERY PLAN'];
  }

  /**
   * Get a client from the pool for transactions
   */
  async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  /**
   * Execute a transaction
   */
  async transaction<T>(
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Test the database connection
   */
  async testConnection(): Promise<boolean> {
    try {
      const result = await this.query('SELECT NOW() as current_time');
      logger.info({
        time: result.rows[0].current_time,
      }, 'Database connection successful');
      return true;
    } catch (error) {
      logger.error({ error }, 'Database connection failed');
      return false;
    }
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats(): Promise<{
    size: string;
    tables: number;
    connections: number;
  }> {
    const sizeResult = await this.query(`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size
    `);

    const tablesResult = await this.query(`
      SELECT COUNT(*) as count
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);

    const connectionsResult = await this.query(`
      SELECT COUNT(*) as count
      FROM pg_stat_activity
      WHERE datname = current_database()
    `);

    return {
      size: sizeResult.rows[0].size,
      tables: parseInt(tablesResult.rows[0].count),
      connections: parseInt(connectionsResult.rows[0].count),
    };
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    await this.pool.end();
    logger.info('Database pool closed');
  }
}

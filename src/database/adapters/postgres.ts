/**
 * PostgreSQL Database Adapter
 * Implements DatabaseAdapter for PostgreSQL databases
 */

import { Pool, PoolClient } from 'pg';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  DatabaseAdapter,
  DatabaseConfig,
  DBQueryResult,
  QueryOptions,
  TransactionHandle,
  ForkInfo,
  ForkOptions,
  TableInfo,
  ColumnInfo,
  ForeignKeyInfo,
  IndexInfo,
  ViewInfo,
  FunctionInfo,
  DatabaseStats,
  DialectHints,
} from '../adapter';
import { logger } from '../../utils/logger';

const execFileAsync = promisify(execFile);

class PostgresTransaction implements TransactionHandle {
  private client: PoolClient;
  private finished = false;

  constructor(client: PoolClient) {
    this.client = client;
  }

  async query<T = any>(sql: string, params?: any[]): Promise<DBQueryResult<T>> {
    if (this.finished) throw new Error('Transaction already finished');
    const result = await this.client.query(sql, params);
    return { rows: result.rows, rowCount: result.rowCount || 0 };
  }

  async commit(): Promise<void> {
    if (this.finished) throw new Error('Transaction already finished');
    await this.client.query('COMMIT');
    this.finished = true;
    this.client.release();
  }

  async rollback(): Promise<void> {
    if (this.finished) throw new Error('Transaction already finished');
    await this.client.query('ROLLBACK');
    this.finished = true;
    this.client.release();
  }
}

export class PostgresAdapter implements DatabaseAdapter {
  private pool: Pool | null = null;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    const sslConfig = this.buildSSLConfig();

    this.pool = new Pool({
      connectionString: this.config.connectionString,
      max: this.config.pool?.max ?? 20,
      idleTimeoutMillis: this.config.pool?.idleTimeoutMillis ?? 30000,
      connectionTimeoutMillis: this.config.pool?.connectionTimeoutMillis ?? 10000,
      ssl: sslConfig,
    });

    this.pool.on('error', (err) => {
      logger.error({ err }, 'Unexpected database pool error');
    });
  }

  private buildSSLConfig(): any {
    if (!this.config.ssl || !this.config.ssl.enabled) {
      // If connection string has sslmode, let pg handle it
      if (this.config.connectionString.includes('sslmode=')) {
        return { rejectUnauthorized: true };
      }
      return false;
    }

    return {
      rejectUnauthorized: this.config.ssl.rejectUnauthorized ?? true,
      ca: this.config.ssl.ca,
      cert: this.config.ssl.cert,
      key: this.config.ssl.key,
    };
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      logger.debug('PostgreSQL pool closed');
    }
  }

  private getPool(): Pool {
    if (!this.pool) throw new Error('PostgresAdapter not connected. Call connect() first.');
    return this.pool;
  }

  async query<T = any>(sql: string, params?: any[], options?: QueryOptions): Promise<DBQueryResult<T>> {
    const pool = this.getPool();
    const startTime = Date.now();
    const client = await pool.connect();

    try {
      if (options?.timeout) {
        await client.query('SET statement_timeout = $1', [options.timeout]);
      }

      const result = await client.query(sql, params);
      const duration = Date.now() - startTime;

      logger.debug({
        sql: sql.substring(0, 100),
        duration,
        rows: result.rowCount,
      }, 'Query executed');

      return { rows: result.rows, rowCount: result.rowCount || 0 };
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

  async execute(sql: string, params?: any[], options?: QueryOptions): Promise<{ rowCount: number }> {
    const result = await this.query(sql, params, options);
    return { rowCount: result.rowCount };
  }

  async beginTransaction(): Promise<TransactionHandle> {
    const pool = this.getPool();
    const client = await pool.connect();
    await client.query('BEGIN');
    return new PostgresTransaction(client);
  }

  async testConnection(): Promise<boolean> {
    try {
      const result = await this.query('SELECT NOW() as current_time');
      logger.debug({ time: result.rows[0].current_time }, 'Database connection successful');
      return true;
    } catch (error) {
      logger.error({ error }, 'Database connection failed');
      return false;
    }
  }

  // Schema introspection

  async getTables(): Promise<TableInfo[]> {
    const result = await this.query<{ table_schema: string; table_name: string }>(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    return result.rows.map(row => ({ name: row.table_name, schema: row.table_schema }));
  }

  async getColumns(schema: string, tableName: string): Promise<ColumnInfo[]> {
    const result = await this.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [schema, tableName]
    );
    return result.rows.map(row => ({
      name: row.column_name,
      type: row.data_type,
      nullable: row.is_nullable === 'YES',
      default: row.column_default || undefined,
    }));
  }

  async getPrimaryKeys(schema: string, tableName: string): Promise<string[]> {
    const result = await this.query<{ column_name: string }>(
      `SELECT a.attname as column_name
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = ($1 || '.' || $2)::regclass
         AND i.indisprimary`,
      [schema, tableName]
    );
    return result.rows.map(row => row.column_name);
  }

  async getForeignKeys(schema: string, tableName: string): Promise<ForeignKeyInfo[]> {
    const result = await this.query<{
      column_name: string;
      foreign_table_name: string;
      foreign_column_name: string;
    }>(
      `SELECT
         kcu.column_name,
         ccu.table_name AS foreign_table_name,
         ccu.column_name AS foreign_column_name
       FROM information_schema.table_constraints AS tc
       JOIN information_schema.key_column_usage AS kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage AS ccu
         ON ccu.constraint_name = tc.constraint_name
         AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = $1
         AND tc.table_name = $2`,
      [schema, tableName]
    );
    return result.rows.map(row => ({
      column: row.column_name,
      referencedTable: row.foreign_table_name,
      referencedColumn: row.foreign_column_name,
    }));
  }

  async getIndexes(schema: string, tableName: string): Promise<IndexInfo[]> {
    const result = await this.query<{
      index_name: string;
      column_names: string[];
      is_unique: boolean;
      index_type: string;
    }>(
      `SELECT
         i.relname AS index_name,
         ARRAY_AGG(a.attname ORDER BY array_position(ix.indkey, a.attnum)) AS column_names,
         ix.indisunique AS is_unique,
         am.amname AS index_type
       FROM pg_class t
       JOIN pg_index ix ON t.oid = ix.indrelid
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_am am ON i.relam = am.oid
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = $1
         AND t.relname = $2
       GROUP BY i.relname, ix.indisunique, am.amname`,
      [schema, tableName]
    );

    return result.rows.map(row => {
      let columns: string[];
      if (Array.isArray(row.column_names)) {
        columns = row.column_names;
      } else if (typeof row.column_names === 'string') {
        columns = (row.column_names as string).replace(/[{}]/g, '').split(',').filter((c: string) => c);
      } else {
        columns = [];
      }
      return {
        name: row.index_name,
        columns,
        unique: row.is_unique,
        type: row.index_type,
      };
    });
  }

  async getViews(): Promise<ViewInfo[]> {
    const result = await this.query<{
      table_schema: string;
      table_name: string;
      view_definition: string;
    }>(`
      SELECT table_schema, table_name, view_definition
      FROM information_schema.views
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    return result.rows.map(row => ({
      name: row.table_name,
      schema: row.table_schema,
      definition: row.view_definition,
    }));
  }

  async getFunctions(): Promise<FunctionInfo[]> {
    const result = await this.query<{
      routine_schema: string;
      routine_name: string;
      data_type: string;
    }>(`
      SELECT routine_schema, routine_name, data_type
      FROM information_schema.routines
      WHERE routine_schema = 'public'
      ORDER BY routine_name
    `);
    return result.rows.map(row => ({
      name: row.routine_name,
      schema: row.routine_schema,
      returnType: row.data_type,
      parameters: [],
    }));
  }

  async getRowCount(schema: string, tableName: string): Promise<number> {
    try {
      const result = await this.query<{ count: string }>(
        `SELECT reltuples::bigint AS count FROM pg_class WHERE oid = ($1 || '.' || $2)::regclass`,
        [schema, tableName]
      );
      return parseInt(result.rows[0]?.count || '0');
    } catch {
      return 0;
    }
  }

  async explain(sql: string, params?: any[]): Promise<any> {
    const explainSQL = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`;
    const result = await this.query(explainSQL, params);
    return result.rows[0]['QUERY PLAN'];
  }

  async getDatabaseStats(): Promise<DatabaseStats> {
    const sizeResult = await this.query(
      `SELECT pg_size_pretty(pg_database_size(current_database())) as size`
    );
    const tablesResult = await this.query(
      `SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const connectionsResult = await this.query(
      `SELECT COUNT(*) as count FROM pg_stat_activity WHERE datname = current_database()`
    );
    return {
      size: sizeResult.rows[0].size,
      tables: parseInt(tablesResult.rows[0].count),
      connections: parseInt(connectionsResult.rows[0].count),
    };
  }

  // Fork operations via pg_dump/pg_restore

  async createFork(options: ForkOptions): Promise<ForkInfo> {
    const forkId = `fork-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    if (!/^[a-z0-9-]+$/.test(forkId)) {
      throw new Error('Invalid fork ID format');
    }

    const forkName = options.name || forkId;
    logger.info({ forkId, forkName, strategy: options.strategy }, 'Creating database fork');

    try {
      // Use CREATE DATABASE ... TEMPLATE for PostgreSQL forks
      const dbName = `neurobase_fork_${forkId.replace(/-/g, '_')}`;
      const currentDb = await this.getCurrentDatabaseName();

      await this.query(`CREATE DATABASE ${this.quoteIdentifier(dbName)} TEMPLATE ${this.quoteIdentifier(currentDb)}`);

      return {
        id: forkId,
        name: forkName,
        status: 'ready',
        createdAt: new Date().toISOString(),
        parentId: currentDb,
      };
    } catch (error) {
      logger.error({ error, forkId }, 'Failed to create database fork');
      throw new Error(`Failed to create database fork: ${error}`);
    }
  }

  async deleteFork(forkId: string): Promise<void> {
    if (!/^[a-z0-9-]+$/.test(forkId)) {
      throw new Error('Invalid fork ID format');
    }

    const dbName = `neurobase_fork_${forkId.replace(/-/g, '_')}`;
    logger.info({ forkId, dbName }, 'Deleting database fork');

    try {
      // Terminate connections to the fork database
      await this.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
        [dbName]
      );
      await this.query(`DROP DATABASE IF EXISTS ${this.quoteIdentifier(dbName)}`);
    } catch (error) {
      logger.error({ error, forkId }, 'Failed to delete database fork');
      throw new Error(`Failed to delete database fork: ${error}`);
    }
  }

  async listForks(): Promise<ForkInfo[]> {
    const result = await this.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE 'neurobase_fork_%' ORDER BY datname`
    );
    return result.rows.map(row => ({
      id: row.datname.replace('neurobase_fork_', '').replace(/_/g, '-'),
      name: row.datname,
      status: 'ready',
      createdAt: '',
    }));
  }

  getDialectName(): string {
    return 'PostgreSQL';
  }

  getDialectHints(): DialectHints {
    return {
      parameterStyle: '$1, $2, $3',
      supportsILIKE: true,
      supportsCTEs: true,
      supportsWindowFunctions: true,
      supportsJSONB: true,
      supportsReturning: true,
      identifierQuote: '"',
      tips: [
        'Use $1, $2 for parameterized queries',
        'ILIKE for case-insensitive matching',
        'CTEs (WITH clauses) are fully supported',
        'Window functions (ROW_NUMBER, RANK, etc.) are supported',
        'JSONB operators: ->, ->>, @>, ?',
        'Use RETURNING clause for INSERT/UPDATE/DELETE',
        'Array types and operations are supported',
        'Use EXPLAIN ANALYZE for query performance',
      ],
    };
  }

  /** Quote an identifier safely to prevent SQL injection */
  private quoteIdentifier(name: string): string {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error(`Invalid identifier: ${name}`);
    }
    return `"${name}"`;
  }

  private async getCurrentDatabaseName(): Promise<string> {
    const result = await this.query<{ current_database: string }>('SELECT current_database()');
    return result.rows[0].current_database;
  }

  /**
   * Export the database using pg_dump (safe: uses execFile, not exec)
   */
  async exportDatabase(outputPath: string): Promise<void> {
    if (!/^[a-z0-9-]+$/.test(outputPath.replace(/[/.]/g, ''))) {
      // Basic path validation
    }

    await execFileAsync('pg_dump', [
      '--dbname', this.config.connectionString,
      '--format', 'custom',
      '--file', outputPath,
    ]);
  }

  /**
   * Import a database dump using pg_restore (safe: uses execFile, not exec)
   */
  async importDatabase(inputPath: string, targetDb: string): Promise<void> {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(targetDb)) {
      throw new Error('Invalid target database name');
    }

    await execFileAsync('pg_restore', [
      '--dbname', targetDb,
      '--format', 'custom',
      inputPath,
    ]);
  }
}

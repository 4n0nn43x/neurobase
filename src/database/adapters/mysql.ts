/**
 * MySQL Database Adapter
 * Implements DatabaseAdapter for MySQL databases
 */

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

let mysql2: any;

class MySQLTransaction implements TransactionHandle {
  private connection: any;
  private finished = false;

  constructor(connection: any) {
    this.connection = connection;
  }

  async query<T = any>(sql: string, params?: any[]): Promise<DBQueryResult<T>> {
    if (this.finished) throw new Error('Transaction already finished');
    const [rows] = await this.connection.execute(sql, params);
    return { rows: Array.isArray(rows) ? rows : [], rowCount: Array.isArray(rows) ? rows.length : 0 };
  }

  async commit(): Promise<void> {
    if (this.finished) throw new Error('Transaction already finished');
    await this.connection.commit();
    this.finished = true;
    this.connection.release();
  }

  async rollback(): Promise<void> {
    if (this.finished) throw new Error('Transaction already finished');
    await this.connection.rollback();
    this.finished = true;
    this.connection.release();
  }
}

export class MySQLAdapter implements DatabaseAdapter {
  private pool: any = null;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    try {
      mysql2 = require('mysql2/promise');
    } catch {
      throw new Error('mysql2 package is not installed. Run: npm install mysql2');
    }

    this.pool = mysql2.createPool({
      uri: this.config.connectionString,
      waitForConnections: true,
      connectionLimit: this.config.pool?.max ?? 20,
      queueLimit: 0,
      ssl: this.config.ssl?.enabled ? {
        rejectUnauthorized: this.config.ssl.rejectUnauthorized ?? true,
      } : undefined,
    });

    this.pool.on('error', (err: any) => {
      logger.error({ err }, 'MySQL pool error');
    });
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  private getPool(): any {
    if (!this.pool) throw new Error('MySQLAdapter not connected');
    return this.pool;
  }

  async query<T = any>(sql: string, params?: any[], options?: QueryOptions): Promise<DBQueryResult<T>> {
    const pool = this.getPool();
    const startTime = Date.now();

    try {
      if (options?.timeout) {
        await pool.execute(`SET SESSION max_execution_time = ?`, [options.timeout]);
      }

      const [rows] = await pool.execute(sql, params);
      const duration = Date.now() - startTime;

      logger.debug({ sql: sql.substring(0, 100), duration }, 'MySQL query executed');

      const resultRows = Array.isArray(rows) ? rows : [];
      return { rows: resultRows as T[], rowCount: resultRows.length };
    } catch (error) {
      logger.error({ sql: sql.substring(0, 100), error }, 'MySQL query failed');
      throw error;
    }
  }

  async execute(sql: string, params?: any[], options?: QueryOptions): Promise<{ rowCount: number }> {
    const result = await this.query(sql, params, options);
    return { rowCount: result.rowCount };
  }

  async beginTransaction(): Promise<TransactionHandle> {
    const pool = this.getPool();
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    return new MySQLTransaction(connection);
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async getTables(): Promise<TableInfo[]> {
    const result = await this.query<{ TABLE_SCHEMA: string; TABLE_NAME: string }>(
      `SELECT TABLE_SCHEMA, TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`
    );
    return result.rows.map(r => ({ name: r.TABLE_NAME, schema: r.TABLE_SCHEMA }));
  }

  async getColumns(schema: string, tableName: string): Promise<ColumnInfo[]> {
    const result = await this.query<{
      COLUMN_NAME: string; DATA_TYPE: string; IS_NULLABLE: string; COLUMN_DEFAULT: string | null;
    }>(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [schema, tableName]
    );
    return result.rows.map(r => ({
      name: r.COLUMN_NAME, type: r.DATA_TYPE,
      nullable: r.IS_NULLABLE === 'YES', default: r.COLUMN_DEFAULT || undefined,
    }));
  }

  async getPrimaryKeys(schema: string, tableName: string): Promise<string[]> {
    const result = await this.query<{ COLUMN_NAME: string }>(
      `SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
       ORDER BY ORDINAL_POSITION`,
      [schema, tableName]
    );
    return result.rows.map(r => r.COLUMN_NAME);
  }

  async getForeignKeys(schema: string, tableName: string): Promise<ForeignKeyInfo[]> {
    const result = await this.query<{
      COLUMN_NAME: string; REFERENCED_TABLE_NAME: string; REFERENCED_COLUMN_NAME: string;
    }>(
      `SELECT kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE kcu
       JOIN information_schema.TABLE_CONSTRAINTS tc
         ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA
       WHERE tc.CONSTRAINT_TYPE = 'FOREIGN KEY'
         AND kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ?`,
      [schema, tableName]
    );
    return result.rows.map(r => ({
      column: r.COLUMN_NAME,
      referencedTable: r.REFERENCED_TABLE_NAME,
      referencedColumn: r.REFERENCED_COLUMN_NAME,
    }));
  }

  async getIndexes(schema: string, tableName: string): Promise<IndexInfo[]> {
    const result = await this.query<{
      INDEX_NAME: string; COLUMN_NAME: string; NON_UNIQUE: number; INDEX_TYPE: string;
    }>(
      `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, INDEX_TYPE
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [schema, tableName]
    );

    const indexMap = new Map<string, IndexInfo>();
    for (const r of result.rows) {
      if (!indexMap.has(r.INDEX_NAME)) {
        indexMap.set(r.INDEX_NAME, {
          name: r.INDEX_NAME, columns: [], unique: r.NON_UNIQUE === 0, type: r.INDEX_TYPE,
        });
      }
      indexMap.get(r.INDEX_NAME)!.columns.push(r.COLUMN_NAME);
    }
    return Array.from(indexMap.values());
  }

  async getViews(): Promise<ViewInfo[]> {
    const result = await this.query<{ TABLE_SCHEMA: string; TABLE_NAME: string; VIEW_DEFINITION: string }>(
      `SELECT TABLE_SCHEMA, TABLE_NAME, VIEW_DEFINITION
       FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE()`
    );
    return result.rows.map(r => ({ name: r.TABLE_NAME, schema: r.TABLE_SCHEMA, definition: r.VIEW_DEFINITION }));
  }

  async getFunctions(): Promise<FunctionInfo[]> {
    const result = await this.query<{ ROUTINE_SCHEMA: string; ROUTINE_NAME: string; DATA_TYPE: string }>(
      `SELECT ROUTINE_SCHEMA, ROUTINE_NAME, DATA_TYPE
       FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()`
    );
    return result.rows.map(r => ({
      name: r.ROUTINE_NAME, schema: r.ROUTINE_SCHEMA, returnType: r.DATA_TYPE, parameters: [],
    }));
  }

  async getRowCount(_schema: string, tableName: string): Promise<number> {
    try {
      const result = await this.query<{ TABLE_ROWS: number }>(
        `SELECT TABLE_ROWS FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [tableName]
      );
      return result.rows[0]?.TABLE_ROWS || 0;
    } catch {
      return 0;
    }
  }

  async explain(sql: string, params?: any[]): Promise<any> {
    const result = await this.query(`EXPLAIN FORMAT=JSON ${sql}`, params);
    return JSON.parse(result.rows[0]['EXPLAIN']);
  }

  async getDatabaseStats(): Promise<DatabaseStats> {
    const sizeResult = await this.query(
      `SELECT ROUND(SUM(DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 2) as size_mb
       FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`
    );
    const tablesResult = await this.query(
      `SELECT COUNT(*) as cnt FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`
    );
    const connResult = await this.query(`SHOW STATUS LIKE 'Threads_connected'`);

    return {
      size: `${sizeResult.rows[0]?.size_mb || 0} MB`,
      tables: tablesResult.rows[0]?.cnt || 0,
      connections: parseInt(connResult.rows[0]?.Value || '0'),
    };
  }

  async createFork(options: ForkOptions): Promise<ForkInfo> {
    const forkId = `fork-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    logger.info({ forkId, options }, 'MySQL fork via mysqldump not yet implemented');
    return { id: forkId, name: options.name || forkId, status: 'pending', createdAt: new Date().toISOString() };
  }

  async deleteFork(_forkId: string): Promise<void> {
    logger.warn('MySQL fork deletion not yet implemented');
  }

  async listForks(): Promise<ForkInfo[]> {
    return [];
  }

  getDialectName(): string {
    return 'MySQL';
  }

  getDialectHints(): DialectHints {
    return {
      parameterStyle: '?, ?, ?',
      supportsILIKE: false,
      supportsCTEs: true,
      supportsWindowFunctions: true,
      supportsJSONB: false,
      supportsReturning: false,
      identifierQuote: '`',
      tips: [
        'Use ? for parameterized queries',
        'No ILIKE - use LOWER() with LIKE or COLLATE for case-insensitive matching',
        'CTEs supported since MySQL 8.0',
        'Window functions supported since MySQL 8.0',
        'JSON functions: JSON_EXTRACT(), ->> operator',
        'No RETURNING clause - use LAST_INSERT_ID() instead',
        'Use EXPLAIN FORMAT=JSON for query analysis',
        'LIMIT syntax: LIMIT offset, count',
      ],
    };
  }
}

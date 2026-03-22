/**
 * SQLite Database Adapter
 * Implements DatabaseAdapter for SQLite databases
 */

import * as fs from 'fs';
import * as path from 'path';
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

let BetterSqlite3: any;

class SQLiteTransaction implements TransactionHandle {
  private db: any;
  private finished = false;

  constructor(db: any) {
    this.db = db;
    this.db.exec('BEGIN');
  }

  async query<T = any>(sql: string, params?: any[]): Promise<DBQueryResult<T>> {
    if (this.finished) throw new Error('Transaction already finished');
    const stmt = this.db.prepare(sql);
    if (/^\s*(SELECT|PRAGMA|EXPLAIN)/i.test(sql)) {
      const rows = params ? stmt.all(...params) : stmt.all();
      return { rows, rowCount: rows.length };
    }
    const result = params ? stmt.run(...params) : stmt.run();
    return { rows: [], rowCount: result.changes };
  }

  async commit(): Promise<void> {
    if (this.finished) throw new Error('Transaction already finished');
    this.db.exec('COMMIT');
    this.finished = true;
  }

  async rollback(): Promise<void> {
    if (this.finished) throw new Error('Transaction already finished');
    this.db.exec('ROLLBACK');
    this.finished = true;
  }
}

export class SQLiteAdapter implements DatabaseAdapter {
  private db: any = null;
  private dbPath: string;

  constructor(config: DatabaseConfig) {
    this.dbPath = config.connectionString;
  }

  async connect(): Promise<void> {
    try {
      BetterSqlite3 = require('better-sqlite3');
    } catch {
      throw new Error('better-sqlite3 package is not installed. Run: npm install better-sqlite3');
    }

    this.db = new BetterSqlite3(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    logger.debug({ path: this.dbPath }, 'SQLite database opened');
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private getDb(): any {
    if (!this.db) throw new Error('SQLiteAdapter not connected');
    return this.db;
  }

  async query<T = any>(sql: string, params?: any[], _options?: QueryOptions): Promise<DBQueryResult<T>> {
    const db = this.getDb();
    const startTime = Date.now();

    try {
      const stmt = db.prepare(sql);

      if (/^\s*(SELECT|PRAGMA|EXPLAIN|WITH)/i.test(sql)) {
        const rows = params && params.length > 0 ? stmt.all(...params) : stmt.all();
        logger.debug({ sql: sql.substring(0, 100), duration: Date.now() - startTime }, 'SQLite query');
        return { rows, rowCount: rows.length };
      }

      const result = params && params.length > 0 ? stmt.run(...params) : stmt.run();
      return { rows: [], rowCount: result.changes };
    } catch (error) {
      logger.error({ sql: sql.substring(0, 100), error }, 'SQLite query failed');
      throw error;
    }
  }

  async execute(sql: string, params?: any[], options?: QueryOptions): Promise<{ rowCount: number }> {
    const result = await this.query(sql, params, options);
    return { rowCount: result.rowCount };
  }

  async beginTransaction(): Promise<TransactionHandle> {
    return new SQLiteTransaction(this.getDb());
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
    const result = await this.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    );
    return result.rows.map(r => ({ name: r.name, schema: 'main' }));
  }

  async getColumns(_schema: string, tableName: string): Promise<ColumnInfo[]> {
    const result = await this.query<{
      name: string; type: string; notnull: number; dflt_value: string | null;
    }>(`PRAGMA table_info("${tableName.replace(/"/g, '""')}")`);

    return result.rows.map(r => ({
      name: r.name,
      type: r.type || 'TEXT',
      nullable: r.notnull === 0,
      default: r.dflt_value || undefined,
    }));
  }

  async getPrimaryKeys(_schema: string, tableName: string): Promise<string[]> {
    const result = await this.query<{ name: string; pk: number }>(
      `PRAGMA table_info("${tableName.replace(/"/g, '""')}")`
    );
    return result.rows.filter(r => r.pk > 0).map(r => r.name);
  }

  async getForeignKeys(_schema: string, tableName: string): Promise<ForeignKeyInfo[]> {
    const result = await this.query<{
      from: string; table: string; to: string;
    }>(`PRAGMA foreign_key_list("${tableName.replace(/"/g, '""')}")`);

    return result.rows.map(r => ({
      column: r.from,
      referencedTable: r.table,
      referencedColumn: r.to,
    }));
  }

  async getIndexes(_schema: string, tableName: string): Promise<IndexInfo[]> {
    const indexList = await this.query<{
      name: string; unique: number;
    }>(`PRAGMA index_list("${tableName.replace(/"/g, '""')}")`);

    const indexes: IndexInfo[] = [];
    for (const idx of indexList.rows) {
      const cols = await this.query<{ name: string }>(
        `PRAGMA index_info("${idx.name.replace(/"/g, '""')}")`
      );
      indexes.push({
        name: idx.name,
        columns: cols.rows.map(c => c.name),
        unique: idx.unique === 1,
        type: 'btree',
      });
    }
    return indexes;
  }

  async getViews(): Promise<ViewInfo[]> {
    const result = await this.query<{ name: string; sql: string }>(
      `SELECT name, sql FROM sqlite_master WHERE type = 'view' ORDER BY name`
    );
    return result.rows.map(r => ({ name: r.name, schema: 'main', definition: r.sql }));
  }

  async getFunctions(): Promise<FunctionInfo[]> {
    return []; // SQLite doesn't expose user functions via SQL
  }

  async getRowCount(_schema: string, tableName: string): Promise<number> {
    try {
      const result = await this.query<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM "${tableName.replace(/"/g, '""')}"`
      );
      return result.rows[0]?.cnt || 0;
    } catch {
      return 0;
    }
  }

  async explain(sql: string, params?: any[]): Promise<any> {
    const result = await this.query(`EXPLAIN QUERY PLAN ${sql}`, params);
    return result.rows;
  }

  async getDatabaseStats(): Promise<DatabaseStats> {
    let size = '0 B';
    try {
      const stats = fs.statSync(this.dbPath);
      const mb = stats.size / (1024 * 1024);
      size = mb > 1 ? `${mb.toFixed(2)} MB` : `${(stats.size / 1024).toFixed(2)} KB`;
    } catch {
      // File might not exist yet
    }

    const tables = await this.getTables();
    return { size, tables: tables.length, connections: 1 };
  }

  // Fork = file copy (instant!)
  async createFork(options: ForkOptions): Promise<ForkInfo> {
    const forkId = `fork-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const ext = path.extname(this.dbPath);
    const base = path.basename(this.dbPath, ext);
    const dir = path.dirname(this.dbPath);
    const forkPath = path.join(dir, `${base}_${forkId}${ext}`);

    fs.copyFileSync(this.dbPath, forkPath);

    // Also copy WAL and SHM if they exist
    if (fs.existsSync(`${this.dbPath}-wal`)) {
      fs.copyFileSync(`${this.dbPath}-wal`, `${forkPath}-wal`);
    }
    if (fs.existsSync(`${this.dbPath}-shm`)) {
      fs.copyFileSync(`${this.dbPath}-shm`, `${forkPath}-shm`);
    }

    logger.info({ forkId, forkPath }, 'SQLite fork created by file copy');

    return {
      id: forkId,
      name: options.name || forkId,
      status: 'ready',
      createdAt: new Date().toISOString(),
      parentId: this.dbPath,
    };
  }

  async deleteFork(forkId: string): Promise<void> {
    if (!/^fork-[a-z0-9-]+$/.test(forkId)) {
      throw new Error('Invalid fork ID');
    }

    const ext = path.extname(this.dbPath);
    const base = path.basename(this.dbPath, ext);
    const dir = path.dirname(this.dbPath);
    const forkPath = path.join(dir, `${base}_${forkId}${ext}`);

    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${forkPath}${suffix}`;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }

    logger.info({ forkId }, 'SQLite fork deleted');
  }

  async listForks(): Promise<ForkInfo[]> {
    const ext = path.extname(this.dbPath);
    const base = path.basename(this.dbPath, ext);
    const dir = path.dirname(this.dbPath);

    const files = fs.readdirSync(dir).filter(f => f.startsWith(`${base}_fork-`) && f.endsWith(ext));

    return files.map(f => ({
      id: f.replace(`${base}_`, '').replace(ext, ''),
      name: f,
      status: 'ready',
      createdAt: '',
    }));
  }

  getDialectName(): string {
    return 'SQLite';
  }

  getDialectHints(): DialectHints {
    return {
      parameterStyle: '?, ?, ?',
      supportsILIKE: false,
      supportsCTEs: true,
      supportsWindowFunctions: true,
      supportsJSONB: false,
      supportsReturning: true,
      identifierQuote: '"',
      tips: [
        'Use ? for parameterized queries',
        'No ILIKE - use LOWER() with LIKE for case-insensitive matching',
        'Limited ALTER TABLE - cannot drop/rename columns in older SQLite',
        'Use INTEGER PRIMARY KEY AUTOINCREMENT for auto-increment',
        'JSON functions available: json_extract(), json_array(), json_object()',
        'RETURNING clause supported since SQLite 3.35.0',
        'Use EXPLAIN QUERY PLAN for query analysis',
        'Types are flexible (type affinity system)',
      ],
    };
  }
}

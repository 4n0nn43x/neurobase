/**
 * Database Adapter Interface
 * Abstraction layer for multi-database support
 */

export type DatabaseEngine = 'postgresql' | 'mysql' | 'sqlite' | 'mongodb';

export interface DatabaseConfig {
  engine: DatabaseEngine;
  connectionString: string;
  ssl?: {
    enabled: boolean;
    rejectUnauthorized?: boolean;
    ca?: string;
    cert?: string;
    key?: string;
  };
  pool?: {
    max: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
  };
}

export interface TransactionHandle {
  query<T = any>(sql: string, params?: any[]): Promise<DBQueryResult<T>>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface DBQueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export interface ForkInfo {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  parentId?: string;
}

export interface ForkOptions {
  name?: string;
  strategy: 'snapshot' | 'copy' | 'template';
}

export interface DatabaseAdapter {
  /** Connect to the database */
  connect(): Promise<void>;

  /** Disconnect from the database */
  disconnect(): Promise<void>;

  /** Execute a query and return results */
  query<T = any>(sql: string, params?: any[], options?: QueryOptions): Promise<DBQueryResult<T>>;

  /** Execute a statement (INSERT/UPDATE/DELETE) without returning rows */
  execute(sql: string, params?: any[], options?: QueryOptions): Promise<{ rowCount: number }>;

  /** Begin a transaction */
  beginTransaction(): Promise<TransactionHandle>;

  /** Test the connection */
  testConnection(): Promise<boolean>;

  // Schema introspection
  getTables(): Promise<TableInfo[]>;
  getColumns(schema: string, tableName: string): Promise<ColumnInfo[]>;
  getPrimaryKeys(schema: string, tableName: string): Promise<string[]>;
  getForeignKeys(schema: string, tableName: string): Promise<ForeignKeyInfo[]>;
  getIndexes(schema: string, tableName: string): Promise<IndexInfo[]>;
  getViews(): Promise<ViewInfo[]>;
  getFunctions(): Promise<FunctionInfo[]>;
  getRowCount(schema: string, tableName: string): Promise<number>;

  /** Get EXPLAIN output for a query */
  explain(sql: string, params?: any[]): Promise<any>;

  /** Get database statistics */
  getDatabaseStats(): Promise<DatabaseStats>;

  // Fork operations
  createFork(options: ForkOptions): Promise<ForkInfo>;
  deleteFork(forkId: string): Promise<void>;
  listForks(): Promise<ForkInfo[]>;

  /** Get the SQL dialect name */
  getDialectName(): string;

  /** Get dialect-specific hints for LLM prompting */
  getDialectHints(): DialectHints;
}

export interface QueryOptions {
  timeout?: number;
}

export interface TableInfo {
  name: string;
  schema: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default?: string;
  description?: string;
}

export interface ForeignKeyInfo {
  column: string;
  referencedTable: string;
  referencedColumn: string;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  type: string;
}

export interface ViewInfo {
  name: string;
  schema: string;
  definition: string;
}

export interface FunctionInfo {
  name: string;
  schema: string;
  returnType: string;
  parameters: { name: string; type: string; default?: string }[];
}

export interface DatabaseStats {
  size: string;
  tables: number;
  connections: number;
}

export interface DialectHints {
  parameterStyle: string;
  supportsILIKE: boolean;
  supportsCTEs: boolean;
  supportsWindowFunctions: boolean;
  supportsJSONB: boolean;
  supportsReturning: boolean;
  identifierQuote: string;
  tips: string[];
}
